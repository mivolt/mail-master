import { safeStorage } from 'electron'

const PLAIN_PREFIX = Buffer.from('MMPLAIN1:', 'utf8')

let encryptionAvailable = false

export function initVault(): boolean {
  encryptionAvailable = safeStorage.isEncryptionAvailable()
  return encryptionAvailable
}

export function isEncryptionAvailable(): boolean {
  return encryptionAvailable
}

export function encryptSecret(plain: string): Uint8Array {
  if (encryptionAvailable) {
    return new Uint8Array(safeStorage.encryptString(plain))
  }
  return new Uint8Array(Buffer.concat([PLAIN_PREFIX, Buffer.from(plain, 'utf8')]))
}

export function decryptSecret(blob: Uint8Array | null): string | null {
  if (!blob || blob.length === 0) return null
  const buf = Buffer.from(blob)
  if (buf.subarray(0, PLAIN_PREFIX.length).equals(PLAIN_PREFIX)) {
    return buf.subarray(PLAIN_PREFIX.length).toString('utf8')
  }
  try {
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}
