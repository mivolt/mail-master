import type { ImapFlow } from 'imapflow'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Account, NewMailEvent, SyncProgress, SyncResult } from '@shared/types'
import * as accountsRepo from '../db/accounts'
import * as messagesRepo from '../db/messages'
import { currentOrDefault } from '../db/settings'
import { decryptSecret } from '../security/vault'
import {
  createImapClient,
  fetchFolderMetadata,
  fetchMessageSources,
  folderStatus,
  isInbox,
  isSentLike,
  listRemoteFolders,
  setFlaggedFlag,
  setSeenFlag
} from './imap'
import { buildCidMap, makeSnippet, parseMessageSource, sanitizeEmailHtml } from './parser'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const RECONNECT_BASE_DELAY = 3000
const RECONNECT_MAX_DELAY = 60000
const OTHER_FOLDER_MIN_WINDOW = 30

export interface EngineHooks {
  onProgress?: (progress: SyncProgress) => void
  onNewMail?: (event: NewMailEvent) => void
  onSyncDone?: (result: SyncResult) => void
}

function safeFilename(input: string, used: Set<string>): string {
  const base = (input || 'attachment')
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .trim()
    .slice(0, 120)
  const name = base || 'attachment'
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let index = 2
  let candidate = `${stem} (${index})${ext}`
  while (used.has(candidate)) {
    index += 1
    candidate = `${stem} (${index})${ext}`
  }
  used.add(candidate)
  return candidate
}

export class AccountWorker {
  private client: ImapFlow | null = null
  private connectPromise: Promise<ImapFlow> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = false
  private watchEnabled = false
  private retryTimer: NodeJS.Timeout | null = null
  private retryDelay = RECONNECT_BASE_DELAY
  private resyncTimer: NodeJS.Timeout | null = null
  private syncing = false
  private inboxKnownTotal = -1

  constructor(
    readonly accountId: number,
    private readonly attachmentsDir: string,
    private readonly hooks: EngineHooks
  ) {}

  private emit(phase: SyncProgress['phase'], message: string): void {
    this.hooks.onProgress?.({ accountId: this.accountId, phase, message })
  }

  /** 串行化所有会与同一 IMAP 连接交互的任务，保证 STORE 先于后续 FETCH 落地 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private resolveAccount(): { account: Account; secret: string } {
    const account = accountsRepo.findAccount(this.accountId)
    if (!account) throw new Error('账号不存在')
    const secret = decryptSecret(accountsRepo.getAccountSecretEnc(this.accountId))
    if (!secret) throw new Error('无法解密该账号的密码，请重新编辑账号并输入密码')
    return { account, secret }
  }

  private async connect(): Promise<ImapFlow> {
    if (this.client && this.client.usable) return this.client
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = (async () => {
      const { account, secret } = this.resolveAccount()
      const client = createImapClient({
        host: account.imapHost,
        port: account.imapPort,
        secure: account.imapSecure,
        user: account.username,
        pass: secret
      })
      this.attachListeners(client)
      await client.connect()
      this.client = client
      this.retryDelay = RECONNECT_BASE_DELAY
      return client
    })()

    try {
      return await this.connectPromise
    } finally {
      this.connectPromise = null
    }
  }

  private attachListeners(client: ImapFlow): void {
    client.on('error', () => {
      // 连接级错误统一走 close 分支处理重连
    })

    client.on('close', () => {
      if (this.client === client) this.client = null
      if (!this.stopped && this.watchEnabled) this.scheduleReconnect()
    })

    client.on('exists', (data) => {
      if (this.stopped) return
      const box = client.mailbox
      if (!box || !isInbox({ path: box.path, specialUse: box.specialUse ?? null })) return

      // imapflow 在每次 SELECT / 重新打开邮箱时都会因计数变化发出 exists，
      // 因此不能直接相信 prevCount，必须与本地已知总数比对，否则每次同步都会误报新邮件。
      const count = data.count ?? 0
      const known = this.inboxKnownTotal
      this.inboxKnownTotal = count
      if (known < 0) return

      const delta = count - known
      if (delta <= 0) return

      this.hooks.onNewMail?.({ accountId: this.accountId, count: delta })
      this.scheduleResync()
    })
  }

  private scheduleResync(): void {
    if (this.stopped || this.syncing) return
    if (this.resyncTimer) clearTimeout(this.resyncTimer)
    this.resyncTimer = setTimeout(() => {
      this.resyncTimer = null
      if (!this.stopped && !this.syncing) void this.sync().catch(() => undefined)
    }, 1200)
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return
    const delay = this.retryDelay
    this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_DELAY)
    this.emit('error', `${Math.round(delay / 1000)} 秒后重连…`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.stopped) return
      void this.sync().catch(() => undefined)
    }, delay)
  }

  private async disconnect(): Promise<void> {
    const client = this.client
    this.client = null
    if (!client) return
    try {
      client.removeAllListeners()
    } catch {
      /* noop */
    }
    try {
      await Promise.race([
        client.logout(),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ])
    } catch {
      /* noop */
    }
  }

  sync(): Promise<SyncResult> {
    return this.enqueue(() => this.runSync())
  }

  private async runSync(): Promise<SyncResult> {
    if (this.stopped) {
      return { accountId: this.accountId, folders: 0, newMessages: 0, error: '已停止' }
    }

    this.syncing = true
    try {
      const { account } = this.resolveAccount()
      const client = await this.connect()

      this.emit('folders', '读取文件夹列表…')
      const remote = await listRemoteFolders(client)
      accountsRepo.upsertFolders(account.id, remote)
      const folders = accountsRepo.listFolders(account.id)
      const inbox = folders.find((folder) => isInbox(folder))

      const statuses = await folderStatus(
        client,
        folders.map((folder) => folder.path)
      )
      for (const folder of folders) {
        const status = statuses.get(folder.path)
        if (!status) continue
        accountsRepo.setFolderState(folder.id, {
          unread: status.unseen,
          total: status.messages,
          uidValidity: status.uidValidity,
          uidNext: status.uidNext
        })
      }

      const settings = currentOrDefault()
      // 非收件箱文件夹按比例缩小窗口，避免每个文件夹都拉几百封
      const otherWindow = Math.max(
        OTHER_FOLDER_MIN_WINDOW,
        Math.round(settings.syncWindow / 5)
      )

      let newMessages = 0

      if (inbox) {
        this.emit('messages', '同步收件箱…')
        newMessages += await this.syncFolder(
          client,
          account,
          inbox,
          settings.syncWindow,
          true,
          settings.bodyPrefetch
        )
      }

      for (const folder of folders) {
        if (folder.id === inbox?.id) continue
        if (!isSentLike(folder) && folder.specialUse !== '\\Drafts') continue
        this.emit('messages', `同步「${folder.name}」…`)
        newMessages += await this.syncFolder(
          client,
          account,
          folder,
          otherWindow,
          false,
          settings.bodyPrefetch
        )
      }

      for (const folder of folders) messagesRepo.recomputeFolderCounts(folder.id)

      accountsRepo.markSynced(account.id, null)
      this.emit('done', '同步完成')

      if (inbox) {
        try {
          await client.mailboxOpen(inbox.path)
        } catch {
          /* 恢复 IDLE 监听失败不影响同步结果 */
        }
      }

      const result: SyncResult = { accountId: account.id, folders: folders.length, newMessages }
      this.hooks.onSyncDone?.(result)
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      accountsRepo.markSynced(this.accountId, message)
      this.emit('error', message)
      await this.disconnect()
      if (this.watchEnabled) this.scheduleReconnect()
      return { accountId: this.accountId, folders: 0, newMessages: 0, error: message }
    } finally {
      this.syncing = false
    }
  }

  private async syncFolder(
    client: ImapFlow,
    account: Account,
    folder: { id: number; path: string },
    window: number,
    isInboxFolder: boolean,
    bodyPrefetch: number
  ): Promise<number> {
    const meta = await fetchFolderMetadata(client, folder.path, window)
    const known = messagesRepo.existingUids(account.id, folder.id)

    const idByUid = new Map<number, number>()
    let freshCount = 0

    for (const item of meta.messages) {
      const id = messagesRepo.upsertMessage({
        accountId: account.id,
        folderId: folder.id,
        uid: item.uid,
        messageId: item.messageId,
        subject: item.subject,
        fromName: item.fromName,
        fromAddr: item.fromAddr,
        toJson: item.toJson,
        ccJson: item.ccJson,
        date: item.date,
        snippet: '',
        size: item.size,
        isRead: item.isRead,
        isStarred: item.isStarred,
        hasAttachments: item.hasAttachments
      })
      idByUid.set(item.uid, id)
      if (!known.has(item.uid)) freshCount += 1
    }

    const fresh = meta.messages.filter((item) => !known.has(item.uid))
    if (fresh.length > 0 && bodyPrefetch > 0) {
      await this.prefetchBodies(client, folder.path, fresh.slice(-bodyPrefetch), idByUid)
    }

    accountsRepo.setFolderState(folder.id, {
      unread: meta.messages.filter((item) => !item.isRead).length,
      total: meta.total,
      uidValidity: meta.uidValidity,
      uidNext: meta.uidNext
    })

    if (isInboxFolder) {
      // 首次同步时本地没有已知总数，全部邮件都算「新的」，
      // 此时不该弹通知——否则刚添加账号就会收到一堆「收到 N 封新邮件」。
      const hadPriorSync = this.inboxKnownTotal >= 0
      this.inboxKnownTotal = meta.total
      if (hadPriorSync && freshCount > 0) {
        // 带上最新一封的信息，供系统通知展示与「点击直达」
        const newest = fresh[fresh.length - 1]
        const newestId = newest ? idByUid.get(newest.uid) : undefined
        const row = newestId ? messagesRepo.getMessageRaw(newestId) : undefined
        this.hooks.onNewMail?.({
          accountId: account.id,
          count: freshCount,
          latestMessageId: newestId,
          latestFrom: row ? row.from_name || row.from_addr : undefined,
          latestSubject: row?.subject
        })
      }
    }

    return freshCount
  }

  private async prefetchBodies(
    client: ImapFlow,
    path: string,
    items: { uid: number }[],
    idByUid: Map<number, number>
  ): Promise<void> {
    if (items.length === 0) return
    this.emit('bodies', `下载 ${items.length} 封邮件正文…`)
    const sources = await fetchMessageSources(
      client,
      path,
      items.map((item) => item.uid)
    )
    for (const item of items) {
      const source = sources.get(item.uid)
      const id = idByUid.get(item.uid)
      if (!source || !id) continue
      try {
        await this.storeParsed(id, source)
      } catch {
        // 单封解析失败不应中断整批同步
      }
    }
  }

  async storeParsed(messageId: number, source: Buffer): Promise<void> {
    const parsed = await parseMessageSource(source)
    const cidMap = buildCidMap(parsed.attachments)
    const html = parsed.html
      ? sanitizeEmailHtml(parsed.html, { blockRemoteImages: false, cidMap })
      : null
    const text = parsed.text || null
    messagesRepo.saveMessageBody(messageId, {
      html,
      text,
      snippet: parsed.snippet || makeSnippet(text ?? '')
    })
    messagesRepo.replaceAttachments(messageId, this.persistAttachments(messageId, parsed.attachments))
  }

  private persistAttachments(
    messageId: number,
    attachments: Awaited<ReturnType<typeof parseMessageSource>>['attachments']
  ): {
    filename: string
    mime: string
    size: number
    contentId: string | null
    isInline: boolean
    savedPath: string | null
  }[] {
    const used = new Set<string>()
    return attachments.map((item) => {
      let savedPath: string | null = null
      if (item.content.length > 0 && item.content.length <= MAX_ATTACHMENT_BYTES) {
        const dir = join(this.attachmentsDir, String(messageId))
        mkdirSync(dir, { recursive: true })
        const filename = safeFilename(item.filename, used)
        savedPath = join(dir, filename)
        writeFileSync(savedPath, item.content)
      }
      return {
        filename: item.filename,
        mime: item.mime,
        size: item.size,
        contentId: item.contentId,
        isInline: item.isInline,
        savedPath
      }
    })
  }

  async loadBody(messageId: number): Promise<boolean> {
    const row = messagesRepo.getMessageRaw(messageId)
    if (!row) return false
    if (row.body_loaded === 1) return true

    const client = await this.connect()
    const sources = await fetchMessageSources(client, row.folder_path, [row.uid])
    const source = sources.get(row.uid)
    if (!source) return false
    await this.storeParsed(messageId, source)
    return true
  }

  async syncSingleFolder(folderId: number): Promise<number> {
    const folder = accountsRepo.findFolderById(folderId)
    if (!folder) return 0
    const account = accountsRepo.findAccount(this.accountId)
    if (!account) return 0

    return this.enqueue(async () => {
      const client = await this.connect()
      const settings = currentOrDefault()
      const window = Math.max(
        OTHER_FOLDER_MIN_WINDOW,
        Math.round(settings.syncWindow / 5)
      )
      const count = await this.syncFolder(
        client,
        account,
        folder,
        window,
        false,
        settings.bodyPrefetch
      )
      messagesRepo.recomputeFolderCounts(folder.id)
      return count
    })
  }

  pushSeen(folderPath: string, uid: number, seen: boolean): Promise<void> {
    return this.enqueue(async () => {
      try {
        const client = await this.connect()
        await setSeenFlag(client, folderPath, uid, seen)
      } catch {
        // 服务器标记失败不影响本地状态
      }
    })
  }

  pushStarred(folderPath: string, uid: number, starred: boolean): Promise<void> {
    return this.enqueue(async () => {
      try {
        const client = await this.connect()
        await setFlaggedFlag(client, folderPath, uid, starred)
      } catch {
        // 同上
      }
    })
  }

  startWatch(): void {
    this.stopped = false
    this.watchEnabled = true
    void this.sync().catch(() => undefined)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.watchEnabled = false
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.resyncTimer) {
      clearTimeout(this.resyncTimer)
      this.resyncTimer = null
    }
    await this.disconnect()
  }
}

export class MailEngine {
  private workers = new Map<number, AccountWorker>()
  private hooks: EngineHooks = {}

  constructor(private readonly attachmentsDir: string) {}

  setHooks(hooks: EngineHooks): void {
    this.hooks = hooks
  }

  private worker(accountId: number): AccountWorker {
    let worker = this.workers.get(accountId)
    if (!worker) {
      worker = new AccountWorker(accountId, this.attachmentsDir, {
        onProgress: (progress) => this.hooks.onProgress?.(progress),
        onNewMail: (event) => this.hooks.onNewMail?.(event),
        onSyncDone: (result) => this.hooks.onSyncDone?.(result)
      })
      this.workers.set(accountId, worker)
    }
    return worker
  }

  syncAccount(accountId: number): Promise<SyncResult> {
    return this.worker(accountId).sync()
  }

  syncAll(): Promise<SyncResult[]> {
    const accounts = accountsRepo.listAccounts()
    return Promise.all(accounts.map((account) => this.syncAccount(account.id)))
  }

  syncFolder(accountId: number, folderId: number): Promise<number> {
    return this.worker(accountId).syncSingleFolder(folderId)
  }

  loadBody(accountId: number, messageId: number): Promise<boolean> {
    return this.worker(accountId).loadBody(messageId)
  }

  pushSeen(accountId: number, folderPath: string, uid: number, seen: boolean): Promise<void> {
    return this.worker(accountId).pushSeen(folderPath, uid, seen)
  }

  pushStarred(accountId: number, folderPath: string, uid: number, starred: boolean): Promise<void> {
    return this.worker(accountId).pushStarred(folderPath, uid, starred)
  }

  startAll(): void {
    for (const account of accountsRepo.listAccounts()) {
      this.worker(account.id).startWatch()
    }
  }

  async stopAccount(accountId: number): Promise<void> {
    const worker = this.workers.get(accountId)
    if (!worker) return
    await worker.stop()
    this.workers.delete(accountId)
  }

  async stopAll(): Promise<void> {
    const workers = [...this.workers.values()]
    this.workers.clear()
    await Promise.all(workers.map((worker) => worker.stop()))
  }
}
