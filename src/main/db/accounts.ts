import { getDb, toBool, toInt } from './index'
import type { Account, AccountInput, Folder, ProviderId } from '@shared/types'

interface AccountRow {
  id: number
  email: string
  display_name: string
  provider: string
  imap_host: string
  imap_port: number
  imap_secure: number
  smtp_host: string
  smtp_port: number
  smtp_secure: number
  username: string
  color: string
  created_at: number
  last_sync_at: number | null
  sync_error: string | null
}

interface FolderRow {
  id: number
  account_id: number
  path: string
  name: string
  delimiter: string
  special_use: string | null
  unread: number
  total: number
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    provider: row.provider as ProviderId,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: toBool(row.imap_secure),
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: toBool(row.smtp_secure),
    username: row.username,
    color: row.color,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at,
    syncError: row.sync_error
  }
}

function mapFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    accountId: row.account_id,
    path: row.path,
    name: row.name,
    delimiter: row.delimiter,
    specialUse: row.special_use,
    unread: row.unread,
    total: row.total
  }
}

export function listAccounts(): Account[] {
  const rows = getDb().prepare('SELECT * FROM accounts ORDER BY id ASC').all() as unknown as AccountRow[]
  return rows.map(mapAccount)
}

export function findAccount(id: number): Account | undefined {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as
    | AccountRow
    | undefined
  return row ? mapAccount(row) : undefined
}

export function findAccountByEmail(email: string): Account | undefined {
  const row = getDb().prepare('SELECT * FROM accounts WHERE email = ?').get(email) as unknown as
    | AccountRow
    | undefined
  return row ? mapAccount(row) : undefined
}

export function getAccountSecretEnc(id: number): Uint8Array | null {
  const row = getDb().prepare('SELECT secret_enc FROM accounts WHERE id = ?').get(id) as unknown as
    | { secret_enc: Uint8Array }
    | undefined
  return row ? row.secret_enc : null
}

export function createAccount(input: AccountInput, secretEnc: Uint8Array, color: string): number {
  const result = getDb()
    .prepare(
      `INSERT INTO accounts
        (email, display_name, provider, imap_host, imap_port, imap_secure,
         smtp_host, smtp_port, smtp_secure, username, secret_enc, color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.email,
      input.displayName,
      input.provider,
      input.imapHost,
      input.imapPort,
      toInt(input.imapSecure),
      input.smtpHost,
      input.smtpPort,
      toInt(input.smtpSecure),
      input.username,
      secretEnc,
      color,
      Date.now()
    )
  return Number(result.lastInsertRowid)
}

export function updateAccountSecret(id: number, secretEnc: Uint8Array): void {
  getDb().prepare('UPDATE accounts SET secret_enc = ? WHERE id = ?').run(secretEnc, id)
}

export function updateAccountFields(
  id: number,
  patch: Partial<Omit<AccountInput, 'secret'>>
): void {
  const fields: string[] = []
  const values: (string | number)[] = []
  const push = (col: string, value: string | number): void => {
    fields.push(`${col} = ?`)
    values.push(value)
  }

  if (patch.email !== undefined) push('email', patch.email)
  if (patch.displayName !== undefined) push('display_name', patch.displayName)
  if (patch.provider !== undefined) push('provider', patch.provider)
  if (patch.imapHost !== undefined) push('imap_host', patch.imapHost)
  if (patch.imapPort !== undefined) push('imap_port', patch.imapPort)
  if (patch.imapSecure !== undefined) push('imap_secure', toInt(patch.imapSecure))
  if (patch.smtpHost !== undefined) push('smtp_host', patch.smtpHost)
  if (patch.smtpPort !== undefined) push('smtp_port', patch.smtpPort)
  if (patch.smtpSecure !== undefined) push('smtp_secure', toInt(patch.smtpSecure))
  if (patch.username !== undefined) push('username', patch.username)
  if (patch.color !== undefined) push('color', patch.color)

  if (!fields.length) return
  values.push(id)
  getDb()
    .prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values)
}

export function deleteAccount(id: number): void {
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

export function markSynced(id: number, error: string | null): void {
  getDb()
    .prepare('UPDATE accounts SET last_sync_at = ?, sync_error = ? WHERE id = ?')
    .run(Date.now(), error, id)
}

export interface RemoteFolder {
  path: string
  name: string
  delimiter: string
  specialUse: string | null
}

export function upsertFolders(accountId: number, folders: RemoteFolder[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO folders (account_id, path, name, delimiter, special_use)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, path) DO UPDATE SET
       name = excluded.name,
       delimiter = excluded.delimiter,
       special_use = COALESCE(excluded.special_use, folders.special_use)`
  )
  for (const f of folders) {
    stmt.run(accountId, f.path, f.name, f.delimiter, f.specialUse)
  }
}

export function listFolders(accountId: number): Folder[] {
  const rows = getDb()
    .prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY id ASC')
    .all(accountId) as unknown as FolderRow[]
  return rows.map(mapFolder)
}

export function findFolder(accountId: number, path: string): Folder | undefined {
  const row = getDb()
    .prepare('SELECT * FROM folders WHERE account_id = ? AND path = ?')
    .get(accountId, path) as unknown as FolderRow | undefined
  return row ? mapFolder(row) : undefined
}

export function findFolderById(id: number): Folder | undefined {
  const row = getDb().prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown as
    | FolderRow
    | undefined
  return row ? mapFolder(row) : undefined
}

export function setFolderState(
  folderId: number,
  state: { unread: number; total: number; uidValidity?: number | null; uidNext?: number | null }
): void {
  getDb()
    .prepare(
      `UPDATE folders SET unread = ?, total = ?,
         uid_validity = COALESCE(?, uid_validity),
         uid_next = COALESCE(?, uid_next)
       WHERE id = ?`
    )
    .run(state.unread, state.total, state.uidValidity ?? null, state.uidNext ?? null, folderId)
}
