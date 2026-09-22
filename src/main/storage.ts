import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { StorageInfo } from '@shared/types'
import { closeDatabase, databasePath, getDb } from './db'
import { isEncryptionAvailable } from './security/vault'

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  const walk = (current: string): void => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        try {
          total += statSync(full).size
        } catch {
          /* 跳过无法读取的文件 */
        }
      }
    }
  }
  walk(dir)
  return total
}

function count(sql: string): number {
  try {
    const row = getDb().prepare(sql).get() as unknown as { n: number } | undefined
    return row?.n ?? 0
  } catch {
    return 0
  }
}

/**
 * 把「数据存在哪、存了多少、有没有加密」直接摊开给用户看。
 * 隐私保护如果用户看不见，就等于没做。
 */
export function storageInfo(userDataDir: string, attachmentsDir: string): StorageInfo {
  const dbPath = databasePath(userDataDir)
  return {
    userDataDir,
    databasePath: dbPath,
    attachmentsDir,
    databaseBytes: existsSync(dbPath) ? statSync(dbPath).size : 0,
    attachmentsBytes: dirSize(attachmentsDir),
    accountCount: count('SELECT COUNT(*) AS n FROM accounts'),
    messageCount: count('SELECT COUNT(*) AS n FROM messages'),
    attachmentCount: count('SELECT COUNT(*) AS n FROM attachments'),
    encryptionAvailable: isEncryptionAvailable()
  }
}

/** 清除全部本地数据。调用方负责在此之前停掉同步引擎。 */
export function clearAllData(userDataDir: string, attachmentsDir: string): void {
  const dbPath = databasePath(userDataDir)
  closeDatabase()
  rmSync(attachmentsDir, { recursive: true, force: true })
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
}
