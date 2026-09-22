export type ProviderId = 'qq' | '163' | 'gmail' | 'outlook' | 'custom'

export interface ProviderPreset {
  id: ProviderId
  label: string
  /** 服务商选择按钮上的短标签 */
  shortLabel: string
  domains: string[]
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  hint: string
  warning?: string
  /** 分步引导，把专业概念消化掉，用户照着点即可 */
  steps: string[]
  /** 密码栏该填什么（授权码 / 应用专用密码 / 密码），直接写在字段标签上 */
  secretLabel: string
  /** 授权码 / 密码的形态说明，降低「填什么」的困惑 */
  codeHint: string
  /** 可一键打开的官方页面（只填可确定的地址） */
  openUrl?: string
  openLabel?: string
}

export interface AccountInput {
  email: string
  displayName: string
  provider: ProviderId
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  secret: string
  color?: string
}

export interface Account {
  id: number
  email: string
  displayName: string
  provider: ProviderId
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  color: string
  createdAt: number
  lastSyncAt: number | null
  syncError: string | null
}

export interface Folder {
  id: number
  accountId: number
  path: string
  name: string
  delimiter: string
  specialUse: string | null
  unread: number
  total: number
}

export interface MessageMeta {
  id: number
  accountId: number
  folderId: number
  uid: number
  messageId: string | null
  subject: string
  fromName: string
  fromAddr: string
  toJson: string
  ccJson: string
  date: number
  snippet: string
  size: number
  isRead: boolean
  isStarred: boolean
  hasAttachments: boolean
  accountEmail: string
  accountColor: string
  folderPath: string
  folderName: string
}

export interface AttachmentMeta {
  id: number
  messageId: number
  filename: string
  mime: string
  size: number
  isInline: boolean
  savedPath: string | null
}

export interface MessageDetail extends MessageMeta {
  bodyHtml: string | null
  bodyText: string | null
  bodyLoaded: boolean
  hasBlockedImages: boolean
  attachments: AttachmentMeta[]
}

/** 'inbox' 只看收件箱；'allFolders' 跨文件夹（排除垃圾/已删除/草稿/已发送） */
export type FolderScope = 'inbox' | 'allFolders'

export interface ListQuery {
  accountId?: number | null
  folderId?: number | null
  folderScope?: FolderScope
  limit?: number
  offset?: number
  unreadOnly?: boolean
  starredOnly?: boolean
  keyword?: string
}

export interface OutgoingAttachment {
  filename: string
  path: string
}

export interface SendInput {
  accountId: number
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html?: string
  attachments: OutgoingAttachment[]
}

export interface SendResult {
  ok: boolean
  error?: string
}

export interface TestResult {
  ok: boolean
  error?: string
  imapOk?: boolean
  smtpOk?: boolean
  authFailed?: boolean
}

export interface SyncResult {
  accountId: number
  folders: number
  newMessages: number
  error?: string
}

export interface UnreadSummary {
  /** 各账号收件箱的未读合计 */
  total: number
  byAccount: Record<number, number>
  /** 跨文件夹未读（排除垃圾/已删除/草稿/已发送） */
  allFolders: number
}

export interface SyncProgress {
  accountId: number
  phase: 'folders' | 'messages' | 'bodies' | 'idle' | 'done' | 'error'
  message: string
}

export interface NewMailEvent {
  accountId: number
  count: number
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

export interface StorageInfo {
  userDataDir: string
  databasePath: string
  attachmentsDir: string
  databaseBytes: number
  attachmentsBytes: number
  accountCount: number
  messageCount: number
  attachmentCount: number
  /** 凭据是否由系统钥匙串加密（false 表示降级为明文存储） */
  encryptionAvailable: boolean
}

export interface DiagReport {
  text: string
  imapOk: boolean
  smtpOk: boolean
  authFailed: boolean
}
