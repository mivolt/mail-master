import { getDb, toBool, toInt } from './index'
import { isExcludedFromUnread } from '@shared/folders'
import type {
  AttachmentMeta,
  ListQuery,
  MessageDetail,
  MessageMeta,
  UnreadSummary
} from '@shared/types'

export interface MessageRow {
  id: number
  account_id: number
  folder_id: number
  uid: number
  message_id: string | null
  subject: string
  from_name: string
  from_addr: string
  to_json: string
  cc_json: string
  date: number
  snippet: string
  size: number
  is_read: number
  is_starred: number
  has_attachments: number
  body_html: string | null
  body_text: string | null
  body_loaded: number
  account_email: string
  account_color: string
  folder_path: string
  folder_name: string
}

interface AttachmentRow {
  id: number
  message_id: number
  filename: string
  mime: string
  size: number
  content_id: string | null
  is_inline: number
  saved_path: string | null
}

const INBOX_CLAUSE = "(f.special_use = '\\Inbox' OR UPPER(f.path) = 'INBOX')"

function mapMeta(row: MessageRow): MessageMeta {
  return {
    id: row.id,
    accountId: row.account_id,
    folderId: row.folder_id,
    uid: row.uid,
    messageId: row.message_id,
    subject: row.subject,
    fromName: row.from_name,
    fromAddr: row.from_addr,
    toJson: row.to_json,
    ccJson: row.cc_json,
    date: row.date,
    snippet: row.snippet,
    size: row.size,
    isRead: toBool(row.is_read),
    isStarred: toBool(row.is_starred),
    hasAttachments: toBool(row.has_attachments),
    accountEmail: row.account_email,
    accountColor: row.account_color,
    folderPath: row.folder_path,
    folderName: row.folder_name
  }
}

function mapAttachment(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    messageId: row.message_id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    isInline: toBool(row.is_inline),
    savedPath: row.saved_path
  }
}

const SELECT_META = `
  SELECT m.*, a.email AS account_email, a.color AS account_color,
         f.path AS folder_path, f.name AS folder_name
  FROM messages m
  JOIN accounts a ON a.id = m.account_id
  JOIN folders f ON f.id = m.folder_id
`

/** 跨文件夹视图要排除的文件夹 id（垃圾/已删除/草稿/已发送） */
function excludedFolderIds(): number[] {
  const rows = getDb()
    .prepare('SELECT id, name, path, special_use FROM folders')
    .all() as unknown as {
    id: number
    name: string
    path: string
    special_use: string | null
  }[]
  return rows
    .filter((row) =>
      isExcludedFromUnread({ name: row.name, path: row.path, specialUse: row.special_use })
    )
    .map((row) => row.id)
}

function buildFilters(query: ListQuery): { where: string; params: (string | number)[] } {
  const clauses: string[] = []
  const params: (string | number)[] = []

  if (query.folderId) {
    clauses.push('m.folder_id = ?')
    params.push(query.folderId)
  } else {
    if (query.accountId) {
      clauses.push('m.account_id = ?')
      params.push(query.accountId)
    }
    if (query.folderScope === 'allFolders') {
      const excluded = excludedFolderIds()
      if (excluded.length) {
        clauses.push(`m.folder_id NOT IN (${excluded.map(() => '?').join(',')})`)
        params.push(...excluded)
      }
    } else {
      clauses.push(INBOX_CLAUSE)
    }
  }

  if (query.unreadOnly) clauses.push('m.is_read = 0')
  if (query.starredOnly) clauses.push('m.is_starred = 1')

  const keyword = query.keyword?.trim()
  if (keyword) {
    clauses.push('(m.subject LIKE ? OR m.from_addr LIKE ? OR m.from_name LIKE ? OR m.snippet LIKE ?)')
    const like = `%${keyword}%`
    params.push(like, like, like, like)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function listMessages(query: ListQuery): MessageMeta[] {
  const { where, params } = buildFilters(query)
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000)
  const offset = Math.max(query.offset ?? 0, 0)
  const sql = `${SELECT_META} ${where} ORDER BY m.date DESC, m.id DESC LIMIT ? OFFSET ?`
  const rows = getDb()
    .prepare(sql)
    .all(...params, limit, offset) as unknown as MessageRow[]
  return rows.map(mapMeta)
}

export function countMessages(query: ListQuery): number {
  const { where, params } = buildFilters(query)
  const sql = `
    SELECT COUNT(*) AS n FROM messages m
    JOIN accounts a ON a.id = m.account_id
    JOIN folders f ON f.id = m.folder_id
    ${where}
  `
  const row = getDb().prepare(sql).get(...params) as unknown as { n: number }
  return row?.n ?? 0
}

export function getMessage(id: number): MessageDetail | undefined {
  const row = getDb().prepare(`${SELECT_META} WHERE m.id = ?`).get(id) as unknown as
    | MessageRow
    | undefined
  if (!row) return undefined
  return {
    ...mapMeta(row),
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    bodyLoaded: toBool(row.body_loaded),
    hasBlockedImages: false,
    attachments: listAttachments(id)
  }
}

export function getMessageRaw(id: number): MessageRow | undefined {
  return getDb()
    .prepare(`${SELECT_META} WHERE m.id = ?`)
    .get(id) as unknown as MessageRow | undefined
}

export function existingUids(accountId: number, folderId: number): Set<number> {
  const rows = getDb()
    .prepare('SELECT uid FROM messages WHERE account_id = ? AND folder_id = ?')
    .all(accountId, folderId) as unknown as { uid: number }[]
  return new Set(rows.map((r) => r.uid))
}

export interface IncomingMessage {
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
}

export function upsertMessage(input: IncomingMessage): number {
  const db = getDb()
  db.prepare(
    `INSERT INTO messages
      (account_id, folder_id, uid, message_id, subject, from_name, from_addr,
       to_json, cc_json, date, snippet, size, is_read, is_starred, has_attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, folder_id, uid) DO UPDATE SET
       is_read = excluded.is_read,
       is_starred = excluded.is_starred,
       has_attachments = MAX(messages.has_attachments, excluded.has_attachments),
       subject = CASE WHEN excluded.subject <> '' THEN excluded.subject ELSE messages.subject END,
       snippet = CASE WHEN messages.snippet = '' THEN excluded.snippet ELSE messages.snippet END`
  ).run(
    input.accountId,
    input.folderId,
    input.uid,
    input.messageId,
    input.subject,
    input.fromName,
    input.fromAddr,
    input.toJson,
    input.ccJson,
    input.date,
    input.snippet,
    input.size,
    toInt(input.isRead),
    toInt(input.isStarred),
    toInt(input.hasAttachments)
  )
  const row = db
    .prepare('SELECT id FROM messages WHERE account_id = ? AND folder_id = ? AND uid = ?')
    .get(input.accountId, input.folderId, input.uid) as unknown as { id: number }
  return row.id
}

export function saveMessageBody(
  id: number,
  body: { html: string | null; text: string | null; snippet: string }
): void {
  getDb()
    .prepare(
      `UPDATE messages SET body_html = ?, body_text = ?, snippet = ?, body_loaded = 1
       WHERE id = ?`
    )
    .run(body.html, body.text, body.snippet, id)
}

export function replaceAttachments(
  messageId: number,
  items: {
    filename: string
    mime: string
    size: number
    contentId: string | null
    isInline: boolean
    savedPath: string | null
  }[]
): void {
  const db = getDb()
  db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId)
  const stmt = db.prepare(
    `INSERT INTO attachments (message_id, filename, mime, size, content_id, is_inline, saved_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const item of items) {
    stmt.run(
      messageId,
      item.filename,
      item.mime,
      item.size,
      item.contentId,
      toInt(item.isInline),
      item.savedPath
    )
  }
}

export function listAttachments(messageId: number): AttachmentMeta[] {
  const rows = getDb()
    .prepare('SELECT * FROM attachments WHERE message_id = ? ORDER BY id ASC')
    .all(messageId) as unknown as AttachmentRow[]
  return rows.map(mapAttachment)
}

export function findAttachment(id: number): AttachmentMeta | undefined {
  const row = getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(id) as unknown as
    | AttachmentRow
    | undefined
  return row ? mapAttachment(row) : undefined
}

export function setRead(id: number, read: boolean): void {
  getDb().prepare('UPDATE messages SET is_read = ? WHERE id = ?').run(toInt(read), id)
}

export function setStarred(id: number, starred: boolean): void {
  getDb().prepare('UPDATE messages SET is_starred = ? WHERE id = ?').run(toInt(starred), id)
}

export function recomputeFolderCounts(folderId: number): void {
  const db = getDb()
  const total = db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE folder_id = ?')
    .get(folderId) as unknown as { n: number }
  const unread = db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE folder_id = ? AND is_read = 0')
    .get(folderId) as unknown as { n: number }
  db.prepare('UPDATE folders SET total = ?, unread = ? WHERE id = ?').run(
    total?.n ?? 0,
    unread?.n ?? 0,
    folderId
  )
}

export function unreadSummary(): UnreadSummary {
  const rows = getDb()
    .prepare(
      `SELECT m.account_id AS account_id, COUNT(*) AS n
       FROM messages m
       JOIN folders f ON f.id = m.folder_id
       WHERE m.is_read = 0 AND ${INBOX_CLAUSE}
       GROUP BY m.account_id`
    )
    .all() as unknown as { account_id: number; n: number }[]

  const byAccount: Record<number, number> = {}
  let total = 0
  for (const row of rows) {
    byAccount[row.account_id] = row.n
    total += row.n
  }

  const excluded = excludedFolderIds()
  const clause = excluded.length ? `AND folder_id NOT IN (${excluded.map(() => '?').join(',')})` : ''
  const allRow = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE is_read = 0 ${clause}`)
    .get(...excluded) as unknown as { n: number } | undefined

  return { total, byAccount, allFolders: allRow?.n ?? 0 }
}
