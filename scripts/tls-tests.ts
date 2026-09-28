import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { SMTPServer } from 'smtp-server'
import { connectImap } from '../src/main/mail/imap'
import { verifySmtp } from '../src/main/mail/smtp'
import {
  describeMailError,
  describeNoTlsError,
  isWrongTlsModeError
} from '../src/main/mail/errors'

const root = process.cwd()
const require = createRequire(import.meta.url)

interface FakeServer {
  listen: (port: number, host: string, callback: () => void) => void
  close: (callback: () => void) => void
  server: { address: () => AddressInfo }
}

const hoodiecrow = require('hoodiecrow-imap') as (options: unknown) => FakeServer

const results: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, condition: boolean, detail = ''): void {
  results.push({ name, ok: condition, detail })
}

// 与 mail-tests.ts 相同：自签证书缺失时自动生成（需要 openssl）
function ensureTlsCert(): { key: Buffer; cert: Buffer } {
  const dir = join(root, 'verify', 'tls')
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(dir, { recursive: true })
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath,
        '-days', '365', '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
      ],
      { stdio: 'ignore' }
    )
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) }
}

// ===== 错误识别 =====

const wrongTlsError = new Error(
  '13572:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER:tls_record.cc:127'
)
check(
  'WRONG_VERSION_NUMBER 识别为端口与加密方式不匹配',
  isWrongTlsModeError(wrongTlsError) &&
    describeMailError(wrongTlsError).message.includes('加密方式与端口不匹配'),
  describeMailError(wrongTlsError).message
)

check(
  'tlsFailed 标记识别为需要降级重试',
  isWrongTlsModeError(Object.assign(new Error('Server does not support STARTTLS'), { tlsFailed: true })),
  ''
)

check(
  '普通认证错误不误判为 TLS 模式问题',
  !isWrongTlsModeError(new Error('AUTHENTICATIONFAILED')),
  ''
)

const noTls = describeNoTlsError(
  Object.assign(new Error('Server does not support STARTTLS'), { tlsFailed: true })
)
check(
  '完全不支持加密时给出可操作的提示',
  noTls.message.includes('无法与服务器建立加密连接') && noTls.message.includes('内网'),
  noTls.message
)

const authInTlsStage = Object.assign(
  new Error('Authentication failed, 535 5.7.8 Error: authentication failed'),
  { code: 'EAUTH' }
)
check(
  '加密阶段里的密码错误仍报认证失败，不被包装成加密问题',
  describeNoTlsError(authInTlsStage).message.includes('Authentication failed'),
  ''
)

// ===== IMAP：明文服务器（内网企业邮箱场景，如 imap.example.cn:143） =====

const plainImap = hoodiecrow({
  plugins: ['ID', 'SASL-IR', 'AUTH-PLAIN', 'NAMESPACE', 'IDLE'],
  id: { name: 'hoodiecrow', version: '1.0' },
  storage: { INBOX: { messages: [] } }
})
await new Promise<void>((resolve) => plainImap.listen(0, '127.0.0.1', resolve))
const plainImapPort = plainImap.server.address().port
check('启动明文 IMAP 测试服务器', plainImapPort > 0, `127.0.0.1:${plainImapPort}`)

// 勾了「加密」但对明文端口：SSL 失败 → 尝试 STARTTLS → 服务器不支持 → 明确报错
let forcedTlsError = ''
try {
  await connectImap({
    host: '127.0.0.1',
    port: plainImapPort,
    secure: true,
    user: 'testuser',
    pass: 'testpass'
  })
} catch (error) {
  forcedTlsError = error instanceof Error ? error.message : String(error)
}
check(
  '强加密遇到明文服务器：明确报错而非静默明文',
  forcedTlsError.includes('无法与服务器建立加密连接'),
  forcedTlsError.slice(0, 120)
)

// 用户显式关闭「加密」：尽力加密，无 STARTTLS 就明文
const plainResult = await connectImap({
  host: '127.0.0.1',
  port: plainImapPort,
  secure: false,
  user: 'testuser',
  pass: 'testpass'
})
check(
  '关闭加密时明文服务器可连接（用户显式选择）',
  plainResult.client.usable === true && plainResult.tls === 'plain',
  `tls=${plainResult.tls}`
)
await plainResult.client.logout()

// ===== IMAP：TLS 服务器（回归：常规 SSL 直连不受影响） =====

const tlsImap = hoodiecrow({
  plugins: ['ID', 'SASL-IR', 'AUTH-PLAIN', 'NAMESPACE', 'IDLE'],
  id: { name: 'hoodiecrow', version: '1.0' },
  secureConnection: true,
  storage: { INBOX: { messages: [] } }
})
await new Promise<void>((resolve) => tlsImap.listen(0, '127.0.0.1', resolve))
const tlsImapPort = tlsImap.server.address().port

const sslResult = await connectImap({
  host: '127.0.0.1',
  port: tlsImapPort,
  secure: true,
  user: 'testuser',
  pass: 'testpass'
})
check(
  'SSL 直连路径不受降级逻辑影响',
  sslResult.client.usable === true && sslResult.tls === 'ssl',
  `tls=${sslResult.tls}`
)
await sslResult.client.logout()

// ===== SMTP：只支持明文（内网 SMTP:25 常见） =====

function startSmtp(options: Record<string, unknown>): Promise<{ server: SMTPServer; port: number }> {
  return new Promise((resolve) => {
    const server = new SMTPServer({
      authOptional: false,
      disableReverseLookup: true,
      ...options,
      onAuth(auth, _session, callback) {
        if (auth.username === 'test@example.com' && auth.password === 'secret') {
          callback(null, { user: auth.username })
          return
        }
        callback(new Error('认证失败'))
      }
    })
    void server.listen(0, '127.0.0.1', () => {
      const port = (server.server as unknown as { address: () => AddressInfo }).address().port
      resolve({ server, port })
    })
  })
}

const plainSmtp = await startSmtp({ disabledCommands: ['STARTTLS'] })
const plainSmtpConfig = {
  host: '127.0.0.1',
  port: plainSmtp.port,
  secure: true,
  user: 'test@example.com',
  pass: 'secret'
}

let plainSmtpError = ''
try {
  await verifySmtp(plainSmtpConfig)
} catch (error) {
  plainSmtpError = error instanceof Error ? error.message : String(error)
}
check(
  'SMTP 强加密遇到明文服务器：明确报错而非静默明文',
  plainSmtpError.includes('无法与服务器建立加密连接'),
  plainSmtpError.slice(0, 120)
)

const plainAutoMode = await verifySmtp({ ...plainSmtpConfig, secure: false })
check(
  'SMTP 关闭加密时明文服务器可验证（自动模式）',
  plainAutoMode === 'auto',
  `mode=${plainAutoMode}`
)
plainSmtp.server.close()

// ===== SMTP：明文端口 + STARTTLS（自动升级） =====

const tls = ensureTlsCert()
const starttlsSmtp = await startSmtp({ key: tls.key, cert: tls.cert })
const starttlsMode = await verifySmtp({
  host: '127.0.0.1',
  port: starttlsSmtp.port,
  secure: true,
  user: 'test@example.com',
  pass: 'secret'
})
check(
  'SMTP 勾选加密但端口是 STARTTLS：自动降级成功且确有加密',
  starttlsMode === 'starttls',
  `mode=${starttlsMode}`
)
starttlsSmtp.server.close()

plainImap.close(() => undefined)
tlsImap.close(() => undefined)

// ===== 输出 =====

const failedItems = results.filter((item) => !item.ok)
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  → ${item.detail}` : ''}`)
}
console.log(`\n${results.length - failedItems.length}/${results.length} 通过`)
if (failedItems.length > 0) {
  console.log(`\n未通过：${failedItems.map((item) => item.name).join('、')}`)
  process.exitCode = 1
}
