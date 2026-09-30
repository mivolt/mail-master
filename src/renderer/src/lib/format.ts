export interface AddressItem {
  name: string
  address: string
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY = 86400000

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

export function parseAddresses(json: string): AddressItem[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.address === 'string')
      .map((item) => ({ name: String(item.name ?? ''), address: String(item.address) }))
  } catch {
    return []
  }
}

export function senderLabel(name: string, address: string): string {
  if (name?.trim()) return name.trim()
  if (address) return address.split('@')[0]
  return '(未知发件人)'
}

export function initialOf(name: string, address: string): string {
  const source = (name?.trim() || address || '?').trim()
  const first = Array.from(source)[0] ?? '?'
  return first.toUpperCase()
}

export function avatarColor(seed: string): string {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return `hsl(${hash % 360} 58% 52%)`
}

export function formatListDate(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  if (ts >= startOfToday) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (ts >= startOfToday - DAY) return '昨天'
  if (ts >= startOfToday - 6 * DAY) return WEEKDAYS[date.getDay()]
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function formatFullDate(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${index > 0 && value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`
}

export type FolderIconName =
  | 'inbox'
  | 'send'
  | 'draft'
  | 'trash'
  | 'spam'
  | 'archive'
  | 'folder'

/**
 * 文件夹显示名。服务器返回的常见英文名（INBOX/Drafts/Sent…）映射成中文，
 * 中文原名原样保留；specialUse 标记兜底。仅影响显示，数据层保持服务器原名。
 */
const FOLDER_NAME_CN: Record<string, string> = {
  inbox: '收件箱',
  drafts: '草稿箱',
  sent: '已发送',
  'sent messages': '已发送',
  'sent items': '已发送',
  junk: '垃圾邮件',
  'junk e-mail': '垃圾邮件',
  'bulk mail': '垃圾邮件',
  spam: '垃圾邮件',
  trash: '已删除',
  deleted: '已删除',
  'deleted messages': '已删除'
}

export function folderDisplayName(name: string, specialUse?: string | null): string {
  if (/[\u4e00-\u9fff]/.test(name)) return name
  const mapped = FOLDER_NAME_CN[name.trim().toLowerCase()]
  if (mapped) return mapped
  switch (specialUse) {
    case '\\Inbox':
      return '收件箱'
    case '\\Drafts':
      return '草稿箱'
    case '\\Sent':
      return '已发送'
    case '\\Junk':
      return '垃圾邮件'
    case '\\Trash':
      return '已删除'
    default:
      return name
  }
}

export function folderIconName(specialUse: string | null, path: string): FolderIconName {
  switch (specialUse) {
    case '\\Inbox':
      return 'inbox'
    case '\\Sent':
      return 'send'
    case '\\Drafts':
      return 'draft'
    case '\\Trash':
      return 'trash'
    case '\\Junk':
      return 'spam'
    case '\\Archive':
      return 'archive'
    default:
      break
  }
  const upper = path.toUpperCase()
  if (upper === 'INBOX') return 'inbox'
  if (upper.includes('SENT') || upper.includes('已发送')) return 'send'
  if (upper.includes('DRAFT') || upper.includes('草稿')) return 'draft'
  if (upper.includes('TRASH') || upper.includes('DELETED') || upper.includes('已删除')) return 'trash'
  if (upper.includes('JUNK') || upper.includes('SPAM') || upper.includes('垃圾')) return 'spam'
  if (upper.includes('ARCHIVE') || upper.includes('归档')) return 'archive'
  return 'folder'
}

export function folderRank(specialUse: string | null, path: string): number {
  const order: Record<FolderIconName, number> = {
    inbox: 0,
    draft: 1,
    send: 2,
    archive: 3,
    spam: 4,
    trash: 5,
    folder: 6
  }
  return order[folderIconName(specialUse, path)]
}

export function splitRecipients(value: string): string[] {
  return value
    .split(/[,;，；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}
