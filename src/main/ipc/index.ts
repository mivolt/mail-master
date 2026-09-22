import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CH, EV } from '@shared/channels'
import { ACCOUNT_COLORS, detectProvider, presetById } from '@shared/presets'
import type {
  Account,
  AccountInput,
  AppInfo,
  AttachmentMeta,
  DiagReport,
  Folder,
  ListQuery,
  MessageDetail,
  MessageMeta,
  SendInput,
  SendResult,
  StorageInfo,
  SyncResult,
  TestResult,
  UnreadSummary
} from '@shared/types'
import * as accountsRepo from '../db/accounts'
import * as messagesRepo from '../db/messages'
import { readSettings, writeSetting } from '../db/settings'
import { applyLaunchAtLogin } from '../autostart'
import { SETTINGS, type AppSettings } from '@shared/settings'
import type { MailEngine } from '../mail/engine'
import { createImapClient, listRemoteFolders, type ImapConfig } from '../mail/imap'
import { runDiagnostics } from '../mail/diagnostics'
import { describeMailError, withTimeout, AUTH_HINT } from '../mail/errors'
import { buildEmailDocument, buildPlainTextDocument, sanitizeEmailHtml } from '../mail/parser'
import { sendMail, verifySmtp, type SmtpConfig } from '../mail/smtp'
import { decryptSecret, encryptSecret } from '../security/vault'
import { clearAllData, storageInfo } from '../storage'
import { notifyNewMail } from '../notifications'
import { updateTrayUnread } from '../tray'

function pickColor(): string {
  const existing = accountsRepo.listAccounts().length
  return ACCOUNT_COLORS[existing % ACCOUNT_COLORS.length]
}

function normalizeInput(raw: AccountInput): AccountInput {
  const email = (raw.email ?? '').trim()
  const preset = raw.provider ? presetById(raw.provider) : detectProvider(email)
  return {
    ...raw,
    email,
    displayName: (raw.displayName ?? '').trim() || email.split('@')[0] || email,
    provider: raw.provider ?? preset.id,
    username: (raw.username ?? '').trim() || email,
    // 授权码常从网页复制，容易带上尾随空格或换行；不 trim 会得到
    // 误导性的「password error」，让人以为是码本身不对
    secret: (raw.secret ?? '').trim(),
    imapHost: (raw.imapHost ?? '').trim(),
    smtpHost: (raw.smtpHost ?? '').trim(),
    imapPort: Number(raw.imapPort) || 993,
    smtpPort: Number(raw.smtpPort) || 465
  }
}

function validateInput(input: AccountInput): string | null {
  if (!input.email || !input.email.includes('@')) return '请填写有效的邮箱地址'
  if (!input.imapHost) return '请填写 IMAP 服务器地址'
  if (!input.smtpHost) return '请填写 SMTP 服务器地址'
  if (!input.secret) return '请填写密码或授权码'
  return null
}

function toImapConfig(input: AccountInput): ImapConfig {
  return {
    host: input.imapHost,
    port: input.imapPort,
    secure: input.imapSecure,
    user: input.username,
    pass: input.secret
  }
}

function toSmtpConfig(input: AccountInput): SmtpConfig {
  return {
    host: input.smtpHost,
    port: input.smtpPort,
    secure: input.smtpSecure,
    user: input.username,
    pass: input.secret
  }
}

const VERIFY_TIMEOUT_MS = 30000

async function verifyImap(config: ImapConfig): Promise<void> {
  const client = createImapClient(config)
  try {
    await client.connect()
    await listRemoteFolders(client)
  } finally {
    try {
      await Promise.race([
        client.logout(),
        new Promise((resolve) => setTimeout(resolve, 3000))
      ])
    } catch {
      /* noop */
    }
  }
}

function renderDetail(detail: MessageDetail, blockImages: boolean): MessageDetail {
  if (!detail.bodyLoaded) return detail
  if (detail.bodyHtml) {
    const fragment = sanitizeEmailHtml(detail.bodyHtml, { blockRemoteImages: blockImages })
    const blocked = blockImages && fragment.includes('data-blocked-src')
    return {
      ...detail,
      bodyHtml: buildEmailDocument(fragment, blocked),
      hasBlockedImages: blocked
    }
  }
  if (detail.bodyText) {
    return { ...detail, bodyHtml: buildPlainTextDocument(detail.bodyText) }
  }
  return detail
}

export interface IpcContext {
  engine: MailEngine
  getWindow: () => BrowserWindow | null
  userDataDir: string
  attachmentsDir: string
  /** 设置变更后的副作用（如开关菜单栏图标、开机自启） */
  onSettingsChanged?: (key: string) => void
}

/** 未读数变化后同步 Dock 角标与菜单栏标题 */
export function refreshUnreadIndicators(): void {
  try {
    const total = messagesRepo.unreadSummary().total
    if (process.platform === 'darwin') {
      app.dock?.setBadge(total > 0 ? String(total) : '')
    }
    updateTrayUnread(total)
  } catch {
    // Dock 角标与菜单栏属于系统集成，出问题不应影响应用本身
  }
}

export function registerIpc(ctx: IpcContext): void {
  const { engine } = ctx

  ipcMain.handle(CH.appInfo, (): AppInfo => {
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform
    }
  })

  ipcMain.handle(CH.appOpenExternal, async (_event, url: string): Promise<void> => {
    if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http(s) 链接')
    await shell.openExternal(url)
  })

  ipcMain.handle(CH.appStorageInfo, (): StorageInfo =>
    storageInfo(ctx.userDataDir, ctx.attachmentsDir)
  )

  ipcMain.handle(CH.appOpenDataDir, async (): Promise<void> => {
    const error = await shell.openPath(ctx.userDataDir)
    if (error) throw new Error(error)
  })

  ipcMain.handle(CH.appClearData, async (): Promise<boolean> => {
    const window = ctx.getWindow()
    const options = {
      type: 'warning' as const,
      buttons: ['取消', '清除全部数据'],
      defaultId: 0,
      cancelId: 0,
      message: '清除全部本地数据？',
      detail:
        '将删除所有已保存的邮箱账号、已缓存的邮件正文与附件，并退出应用。服务器上的邮件不受影响，重新添加账号后会重新同步。此操作不可撤销。'
    }
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    if (result.response !== 1) return false

    await engine.stopAll()
    clearAllData(ctx.userDataDir, ctx.attachmentsDir)
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 250)
    return true
  })

  ipcMain.handle(CH.settingsGet, (): AppSettings => readSettings())

  ipcMain.handle(CH.settingsSet, (_event, key: string, value: string): AppSettings => {
    const definition = SETTINGS.find((item) => item.key === key)
    if (!definition) throw new Error(`未知的设置项：${key}`)
    writeSetting(key, value)
    const next = readSettings()
    if (key === 'launchAtLogin') applyLaunchAtLogin(next.launchAtLogin)
    ctx.onSettingsChanged?.(key)
    return next
  })

  ipcMain.handle(CH.diagRun, async (_event, raw: AccountInput): Promise<DiagReport> => {
    return runDiagnostics(normalizeInput(raw))
  })

  // 已保存账号无需重新输入密码即可诊断：凭据从钥匙串解密
  ipcMain.handle(CH.diagRunAccount, async (_event, accountId: number): Promise<DiagReport> => {
    const account = accountsRepo.findAccount(accountId)
    if (!account) throw new Error('账号不存在')
    const secret = decryptSecret(accountsRepo.getAccountSecretEnc(accountId))
    if (!secret) throw new Error('无法解密该账号的密码，请重新编辑账号并输入密码')
    return runDiagnostics({
      email: account.email,
      displayName: account.displayName,
      provider: account.provider,
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      imapSecure: account.imapSecure,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      smtpSecure: account.smtpSecure,
      username: account.username,
      secret
    })
  })

  ipcMain.handle(CH.diagCopy, (_event, text: string): void => {
    clipboard.writeText(text)
  })

  ipcMain.handle(CH.accountsList, (): Account[] => accountsRepo.listAccounts())

  ipcMain.handle(CH.foldersList, (_event, accountId: number): Folder[] =>
    accountsRepo.listFolders(accountId)
  )

  ipcMain.handle(CH.accountsTest, async (_event, raw: AccountInput): Promise<TestResult> => {
    const input = normalizeInput(raw)
    const invalid = validateInput(input)
    if (invalid) return { ok: false, error: invalid }

    const [imap, smtp] = await Promise.allSettled([
      withTimeout(verifyImap(toImapConfig(input)), VERIFY_TIMEOUT_MS, 'IMAP 连接'),
      withTimeout(verifySmtp(toSmtpConfig(input)), VERIFY_TIMEOUT_MS, 'SMTP 连接')
    ])

    const imapOk = imap.status === 'fulfilled'
    const smtpOk = smtp.status === 'fulfilled'
    if (imapOk && smtpOk) return { ok: true, imapOk, smtpOk }

    const errors: string[] = []
    let authFailed = false
    if (!imapOk) {
      const info = describeMailError((imap as PromiseRejectedResult).reason, { withHint: false })
      authFailed = authFailed || info.authenticationFailed
      errors.push(`IMAP：${info.message}`)
    }
    if (!smtpOk) {
      const info = describeMailError((smtp as PromiseRejectedResult).reason, { withHint: false })
      authFailed = authFailed || info.authenticationFailed
      errors.push(`SMTP：${info.message}`)
    }
    // 提示只说一次，避免两个服务都失败时重复刷屏
    if (authFailed) errors.push(AUTH_HINT)
    return { ok: false, imapOk, smtpOk, authFailed, error: errors.join('\n') }
  })

  ipcMain.handle(CH.accountsAdd, async (_event, raw: AccountInput): Promise<Account> => {
    const input = normalizeInput(raw)
    const invalid = validateInput(input)
    if (invalid) throw new Error(invalid)
    if (accountsRepo.findAccountByEmail(input.email)) {
      throw new Error(`账号 ${input.email} 已存在`)
    }

    try {
      await withTimeout(verifyImap(toImapConfig(input)), VERIFY_TIMEOUT_MS, 'IMAP 连接')
    } catch (error) {
      throw new Error(describeMailError(error).message)
    }

    const id = accountsRepo.createAccount(input, encryptSecret(input.secret), input.color || pickColor())
    const account = accountsRepo.findAccount(id)
    if (!account) throw new Error('账号创建失败')

    void engine.syncAccount(id).catch(() => undefined)
    return account
  })

  ipcMain.handle(
    CH.accountsUpdate,
    async (_event, id: number, raw: Partial<AccountInput>): Promise<Account> => {
      const current = accountsRepo.findAccount(id)
      if (!current) throw new Error('账号不存在')

      const patch: Partial<AccountInput> = { ...raw }
      if (patch.secret) {
        accountsRepo.updateAccountSecret(id, encryptSecret(patch.secret))
      }
      delete patch.secret
      if (Object.keys(patch).length > 0) {
        accountsRepo.updateAccountFields(id, patch)
      }

      const updated = accountsRepo.findAccount(id)
      if (!updated) throw new Error('账号更新失败')
      return updated
    }
  )

  ipcMain.handle(CH.accountsRemove, async (_event, id: number): Promise<void> => {
    await engine.stopAccount(id)
    accountsRepo.deleteAccount(id)
  })

  ipcMain.handle(CH.mailList, (_event, query: ListQuery): { items: MessageMeta[]; total: number } => {
    return {
      items: messagesRepo.listMessages(query),
      total: messagesRepo.countMessages(query)
    }
  })

  ipcMain.handle(
    CH.mailGet,
    async (_event, id: number, blockImages: boolean): Promise<MessageDetail | null> => {
      let detail = messagesRepo.getMessage(id)
      if (!detail) return null

      if (!detail.bodyLoaded) {
        try {
          await engine.loadBody(detail.accountId, id)
        } catch {
          // 正文拉取失败时仍然返回元数据，界面可提示重试
        }
        detail = messagesRepo.getMessage(id) ?? detail
      }

      if (!detail.isRead) {
        messagesRepo.setRead(id, true)
        messagesRepo.recomputeFolderCounts(detail.folderId)
        void engine.pushSeen(detail.accountId, detail.folderPath, detail.uid, true)
        refreshUnreadIndicators()
        detail = { ...detail, isRead: true }
      }

      return renderDetail(detail, blockImages)
    }
  )

  ipcMain.handle(CH.mailSetRead, (_event, id: number, read: boolean): UnreadSummary => {
    const row = messagesRepo.getMessageRaw(id)
    if (row) {
      messagesRepo.setRead(id, read)
      messagesRepo.recomputeFolderCounts(row.folder_id)
      void engine.pushSeen(row.account_id, row.folder_path, row.uid, read)
    }
    const summary = messagesRepo.unreadSummary()
    refreshUnreadIndicators()
    return summary
  })

  ipcMain.handle(CH.mailSetStarred, (_event, id: number, starred: boolean): boolean => {
    const row = messagesRepo.getMessageRaw(id)
    if (!row) return false
    messagesRepo.setStarred(id, starred)
    void engine.pushStarred(row.account_id, row.folder_path, row.uid, starred)
    return starred
  })

  ipcMain.handle(CH.mailSync, async (_event, accountId?: number): Promise<SyncResult[]> => {
    if (accountId) return [await engine.syncAccount(accountId)]
    return engine.syncAll()
  })

  ipcMain.handle(CH.mailSyncFolder, (_event, accountId: number, folderId: number): Promise<number> =>
    engine.syncFolder(accountId, folderId)
  )

  ipcMain.handle(CH.mailUnread, (): UnreadSummary => messagesRepo.unreadSummary())

  ipcMain.handle(CH.attachmentOpen, async (_event, id: number): Promise<string> => {
    const attachment = messagesRepo.findAttachment(id)
    if (!attachment?.savedPath) throw new Error('附件尚未下载到本地')
    if (!existsSync(attachment.savedPath)) throw new Error('附件文件已丢失，请重新同步该邮件')
    const error = await shell.openPath(attachment.savedPath)
    if (error) throw new Error(error)
    return attachment.savedPath
  })

  ipcMain.handle(CH.attachmentSaveAs, async (_event, id: number): Promise<string | null> => {
    const attachment: AttachmentMeta | undefined = messagesRepo.findAttachment(id)
    if (!attachment?.savedPath) throw new Error('附件尚未下载到本地')

    const window = ctx.getWindow()
    const result = window
      ? await dialog.showSaveDialog(window, { defaultPath: attachment.filename })
      : await dialog.showSaveDialog({ defaultPath: attachment.filename })
    if (result.canceled || !result.filePath) return null

    copyFileSync(attachment.savedPath, result.filePath)
    return result.filePath
  })

  ipcMain.handle(CH.composePickFiles, async (): Promise<{ filename: string; path: string }[]> => {
    const window = ctx.getWindow()
    const options = {
      properties: ['openFile', 'multiSelections'] as const
    }
    const result = window
      ? await dialog.showOpenDialog(window, { properties: [...options.properties] })
      : await dialog.showOpenDialog({ properties: [...options.properties] })
    if (result.canceled) return []
    return result.filePaths.map((filePath) => ({ filename: basename(filePath), path: filePath }))
  })

  ipcMain.handle(CH.composeSend, async (_event, input: SendInput): Promise<SendResult> => {
    const account = accountsRepo.findAccount(input.accountId)
    if (!account) return { ok: false, error: '发件账号不存在' }
    if (!input.to.length && !input.cc.length && !input.bcc.length) {
      return { ok: false, error: '请至少填写一个收件人' }
    }

    const secret = decryptSecret(accountsRepo.getAccountSecretEnc(input.accountId))
    if (!secret) return { ok: false, error: '无法解密该账号的密码，请重新编辑账号并输入密码' }

    try {
      await sendMail(
        {
          host: account.smtpHost,
          port: account.smtpPort,
          secure: account.smtpSecure,
          user: account.username,
          pass: secret
        },
        input,
        { name: account.displayName, address: account.email }
      )
      void engine.syncAccount(account.id).catch(() => undefined)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: describeMailError(error).message }
    }
  })
}

export function attachEngineHooks(ctx: IpcContext): void {
  const send = (channel: string, payload: unknown): void => {
    const window = ctx.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  const focusWindow = (): void => {
    const window = ctx.getWindow()
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  ctx.engine.setHooks({
    onProgress: (progress) => send(EV.progress, progress),

    onNewMail: (event) => {
      send(EV.newMail, event)
      refreshUnreadIndicators()

      // 窗口就在眼前时应用内提示已经够了，再弹系统通知属于重复打扰
      const window = ctx.getWindow()
      const windowFocused = Boolean(window && !window.isDestroyed() && window.isFocused())
      if (windowFocused || !readSettings().notifyNewMail) return

      const account = accountsRepo.findAccount(event.accountId)
      notifyNewMail({
        accountName: account?.displayName || account?.email || '邮箱',
        event,
        onClick: () => {
          focusWindow()
          if (event.latestMessageId) {
            send(EV.openMessage, {
              accountId: event.accountId,
              messageId: event.latestMessageId
            })
          }
        }
      })
    },

    onSyncDone: (result) => {
      send(EV.syncDone, result)
      refreshUnreadIndicators()
    }
  })
}

export function attachmentsDirFor(userDataDir: string): string {
  return join(userDataDir, 'attachments')
}
