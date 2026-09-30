import { getRawSetting, writeSetting } from './db/settings'
import type { Signature, SignatureStore } from '@shared/types'

const KEY_SIGNATURES = 'signatures'
const KEY_DEFAULTS = 'signatureDefaults'

/** 签名是用户手输的富文本，限制大小防止把数据库当网盘 */
const MAX_HTML_LENGTH = 100_000
const MAX_NAME_LENGTH = 60
const MAX_SIGNATURES = 20

function sanitizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : ''
}

function sanitizeHtml(html: unknown): string {
  return typeof html === 'string' ? html.slice(0, MAX_HTML_LENGTH) : ''
}

function parseSignatures(raw: string | null): Signature[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: Signature[] = []
    for (const item of parsed) {
      const record = item as Partial<Signature>
      const name = sanitizeName(record?.name)
      if (!name || typeof record?.id !== 'string' || !record.id) continue
      out.push({
        id: record.id,
        name,
        html: sanitizeHtml(record?.html),
        updatedAt: typeof record?.updatedAt === 'number' ? record.updatedAt : 0
      })
    }
    return out
  } catch {
    return []
  }
}

function parseDefaults(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (/^\d+$/.test(key) && typeof value === 'string' && value) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

export function loadSignatureStore(): SignatureStore {
  const signatures = parseSignatures(getRawSetting(KEY_SIGNATURES))
  const known = new Set(signatures.map((item) => item.id))
  const stored = parseDefaults(getRawSetting(KEY_DEFAULTS))
  const defaults: Record<string, string> = {}
  for (const [accountId, signatureId] of Object.entries(stored)) {
    // 引用了已删除签名的绑定视为失效
    if (known.has(signatureId)) defaults[accountId] = signatureId
  }
  return { signatures, defaults }
}

export function saveSignature(input: { id?: string; name: string; html: string }): Signature {
  const name = sanitizeName(input?.name)
  if (!name) throw new Error('请填写签名名称')
  const html = sanitizeHtml(input?.html)
  const store = loadSignatureStore()
  const now = Date.now()

  const existing = input?.id ? store.signatures.find((item) => item.id === input.id) : undefined
  if (existing) {
    existing.name = name
    existing.html = html
    existing.updatedAt = now
    writeSetting(KEY_SIGNATURES, JSON.stringify(store.signatures))
    return { ...existing }
  }

  if (store.signatures.length >= MAX_SIGNATURES) {
    throw new Error(`最多保存 ${MAX_SIGNATURES} 个签名，请先删除不用的`)
  }
  const created: Signature = {
    id: `sig_${now.toString(36)}`,
    name,
    html,
    updatedAt: now
  }
  store.signatures.push(created)
  writeSetting(KEY_SIGNATURES, JSON.stringify(store.signatures))
  return { ...created }
}

export function deleteSignature(id: string): void {
  const store = loadSignatureStore()
  const next = store.signatures.filter((item) => item.id !== id)
  if (next.length === store.signatures.length) return
  writeSetting(KEY_SIGNATURES, JSON.stringify(next))
  const defaults = { ...store.defaults }
  let changed = false
  for (const [accountId, signatureId] of Object.entries(defaults)) {
    if (signatureId === id) {
      delete defaults[accountId]
      changed = true
    }
  }
  if (changed) writeSetting(KEY_DEFAULTS, JSON.stringify(defaults))
}

export function setSignatureDefault(accountId: number | null, signatureId: string | null): void {
  const store = loadSignatureStore()
  const defaults = { ...store.defaults }
  if (accountId === null) {
    writeSetting(KEY_DEFAULTS, JSON.stringify({}))
    return
  }
  if (signatureId === null || !store.signatures.some((item) => item.id === signatureId)) {
    delete defaults[String(accountId)]
  } else {
    defaults[String(accountId)] = signatureId
  }
  writeSetting(KEY_DEFAULTS, JSON.stringify(defaults))
}
