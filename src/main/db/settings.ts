import { getDb } from './index'
import { DEFAULT_SETTINGS, parseSettings, type AppSettings } from '@shared/settings'

export function readSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as unknown as {
    key: string
    value: string
  }[]
  const raw: Record<string, string> = {}
  for (const row of rows) raw[row.key] = row.value
  return parseSettings(raw)
}

export function writeSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}

/** 读取未纳入 AppSettings 结构的自由键（签名等 JSON 数据） */
export function getRawSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as unknown as { value: string } | undefined
  return row?.value ?? null
}

export function currentOrDefault(): AppSettings {
  try {
    return readSettings()
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}
