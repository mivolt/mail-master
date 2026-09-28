import { ImapFlow } from 'imapflow'
import type {
  FetchMessageObject,
  ImapFlowOptions,
  ListResponse,
  MessageStructureObject,
  StatusObject
} from 'imapflow'
import { describeNoTlsError, isWrongTlsModeError } from './errors'

export interface ImapConfig {
  host: string
  port: number
  secure: boolean
  /** 配合 secure:false 使用：必须成功 STARTTLS，服务器不支持时明确报错而不是明文继续 */
  doSTARTTLS?: boolean
  user: string
  pass: string
}

export type ImapTlsMode = 'ssl' | 'starttls' | 'plain'

export interface ImapConnectResult {
  client: ImapFlow
  /** 实际生效的连接方式：ssl=隐式TLS；starttls=明文端口升级；plain=未加密 */
  tls: ImapTlsMode
}

export const CLIENT_INFO = {
  name: 'MailMaster',
  version: '0.1.0',
  vendor: 'MailMaster'
}

export function createImapClient(
  config: ImapConfig,
  logger?: ImapFlowOptions['logger']
): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    doSTARTTLS: config.doSTARTTLS === true,
    auth: { user: config.user, pass: config.pass },
    clientInfo: CLIENT_INFO,
    logger: logger ?? false,
    greetingTimeout: 20000,
    socketTimeout: 180000
  })
}

function socketEncrypted(client: ImapFlow): boolean {
  const socket = (client as unknown as { socket?: { encrypted?: boolean } }).socket
  return socket?.encrypted === true
}

/**
 * 建立连接并返回实际使用的加密方式。「加密」开关只表达意图：
 * 开 = 强加密——隐式 TLS 失败（端口不是 SSL 端口）自动改走 STARTTLS，
 * 服务器不支持 STARTTLS 就明确报错，绝不静默降级成明文；
 * 关 = 尽力加密——服务器广告 STARTTLS 就升级，否则明文（用户显式选择，
 * 常见于只开 143/25 的内网企业邮箱）。
 */
export async function connectImap(
  config: ImapConfig,
  logger?: ImapFlowOptions['logger']
): Promise<ImapConnectResult> {
  const open = async (secure: boolean, doSTARTTLS: boolean): Promise<ImapFlow> => {
    const client = createImapClient({ ...config, secure, doSTARTTLS }, logger)
    try {
      await client.connect()
      return client
    } catch (error) {
      try {
        client.close()
      } catch {
        // 连接从未建立，无需清理
      }
      throw error
    }
  }

  if (config.secure) {
    let client: ImapFlow
    try {
      client = await open(true, false)
      return { client, tls: 'ssl' }
    } catch (first) {
      if (!isWrongTlsModeError(first)) throw first
    }
    try {
      client = await open(false, true)
      return { client, tls: 'starttls' }
    } catch (second) {
      throw describeNoTlsError(second)
    }
  }

  const client = await open(false, false)
  return { client, tls: socketEncrypted(client) ? 'starttls' : 'plain' }
}

export interface RemoteFolder {
  path: string
  name: string
  delimiter: string
  specialUse: string | null
}

export async function listRemoteFolders(client: ImapFlow): Promise<RemoteFolder[]> {
  const list: ListResponse[] = await client.list()
  const out: RemoteFolder[] = []
  for (const item of list) {
    if (item.flags?.has('\\Noselect')) continue
    if (!item.path) continue
    out.push({
      path: item.path,
      name: item.name || item.path,
      delimiter: item.delimiter || '/',
      specialUse: item.specialUse ?? null
    })
  }
  return out
}

export function isInbox(folder: { path: string; specialUse: string | null }): boolean {
  return folder.specialUse === '\\Inbox' || folder.path.toUpperCase() === 'INBOX'
}

// 部分服务器（如 Coremail）不给「已发送」打 \Sent 标记，需按名称兜底
const SENT_NAME_PATTERN =
  /^(sent|sent items|sent mail|sent messages|已发送|已发送邮件|发件箱|寄件备份)$/i

export function isSentLike(folder: { name: string; specialUse: string | null }): boolean {
  if (folder.specialUse === '\\Sent') return true
  return SENT_NAME_PATTERN.test(folder.name.trim())
}

function toJsonAddresses(list?: { name?: string; address?: string }[]): string {
  if (!list?.length) return '[]'
  return JSON.stringify(
    list
      .filter((item) => Boolean(item.address))
      .map((item) => ({ name: item.name ?? '', address: item.address ?? '' }))
  )
}

export function attachmentParts(node?: MessageStructureObject): string[] {
  const parts: string[] = []
  const walk = (current?: MessageStructureObject): void => {
    if (!current) return
    const disposition = (current.disposition ?? '').toLowerCase()
    const filename = current.dispositionParameters?.filename ?? current.parameters?.name
    if (disposition === 'attachment' || (Boolean(filename) && disposition !== 'inline')) {
      if (current.part) parts.push(current.part)
    }
    if (current.childNodes) for (const child of current.childNodes) walk(child)
  }
  walk(node)
  return parts
}

export interface RemoteMessageMeta {
  uid: number
  seq: number
  messageId: string | null
  subject: string
  fromName: string
  fromAddr: string
  toJson: string
  ccJson: string
  date: number
  size: number
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
}

function mapFetchMessage(msg: FetchMessageObject): RemoteMessageMeta {
  const envelope = msg.envelope
  const from = envelope?.from?.[0]
  const flags = msg.flags ?? new Set<string>()
  const rawDate = envelope?.date
  const parsed = rawDate instanceof Date ? rawDate.getTime() : Date.parse(String(rawDate ?? ''))

  return {
    uid: msg.uid,
    seq: msg.seq,
    messageId: envelope?.messageId ?? null,
    subject: (envelope?.subject ?? '').trim(),
    fromName: from?.name ?? '',
    fromAddr: from?.address ?? '',
    toJson: toJsonAddresses(envelope?.to),
    ccJson: toJsonAddresses(envelope?.cc),
    date: Number.isFinite(parsed) ? parsed : 0,
    size: msg.size ?? 0,
    isRead: flags.has('\\Seen'),
    isStarred: flags.has('\\Flagged'),
    hasAttachments: attachmentParts(msg.bodyStructure).length > 0
  }
}

export interface FolderMetadataResult {
  messages: RemoteMessageMeta[]
  total: number
  uidValidity: number
  uidNext: number
}

export async function fetchFolderMetadata(
  client: ImapFlow,
  path: string,
  window: number
): Promise<FolderMetadataResult> {
  const lock = await client.getMailboxLock(path)
  try {
    const box = client.mailbox
    if (!box) return { messages: [], total: 0, uidValidity: 0, uidNext: 0 }

    const total = box.exists
    const uidValidity = Number(box.uidValidity)
    const uidNext = box.uidNext
    if (total === 0) return { messages: [], total, uidValidity, uidNext }

    const start = Math.max(1, total - window + 1)
    const messages: RemoteMessageMeta[] = []
    for await (const msg of client.fetch(
      `${start}:*`,
      { uid: true, envelope: true, flags: true, size: true, bodyStructure: true },
      { uid: false }
    )) {
      messages.push(mapFetchMessage(msg))
    }
    return { messages, total, uidValidity, uidNext }
  } finally {
    lock.release()
  }
}

export async function fetchMessageSources(
  client: ImapFlow,
  path: string,
  uids: number[]
): Promise<Map<number, Buffer>> {
  const result = new Map<number, Buffer>()
  if (uids.length === 0) return result

  const lock = await client.getMailboxLock(path)
  try {
    for await (const msg of client.fetch(
      uids.join(','),
      { uid: true, source: true },
      { uid: true }
    )) {
      if (msg.source) result.set(msg.uid, msg.source)
    }
  } finally {
    lock.release()
  }
  return result
}

export async function setSeenFlag(
  client: ImapFlow,
  path: string,
  uid: number,
  seen: boolean
): Promise<void> {
  const lock = await client.getMailboxLock(path)
  try {
    if (seen) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    } else {
      await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
    }
  } finally {
    lock.release()
  }
}

export async function setFlaggedFlag(
  client: ImapFlow,
  path: string,
  uid: number,
  flagged: boolean
): Promise<void> {
  const lock = await client.getMailboxLock(path)
  try {
    if (flagged) {
      await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true })
    } else {
      await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true })
    }
  } finally {
    lock.release()
  }
}

export async function folderStatus(
  client: ImapFlow,
  paths: string[]
): Promise<Map<string, { messages: number; unseen: number; uidValidity: number; uidNext: number }>> {
  const out = new Map<
    string,
    { messages: number; unseen: number; uidValidity: number; uidNext: number }
  >()

  for (const path of paths) {
    try {
      const item = (await client.status(path, {
        messages: true,
        unseen: true,
        uidValidity: true,
        uidNext: true
      })) as StatusObject | false
      if (!item) continue
      out.set(path, {
        messages: item.messages ?? 0,
        unseen: item.unseen ?? 0,
        uidValidity: Number(item.uidValidity ?? 0),
        uidNext: item.uidNext ?? 0
      })
    } catch {
      // 单个文件夹查询失败（权限不足等）不应影响其余文件夹
    }
  }

  return out
}
