/**
 * 针对真实服务商的连接诊断：打印 imapflow 的完整协议交互，
 * 用于定位「Command failed」这类被包装过的报错。
 *
 *   node scripts/diag-provider.mjs <imapHost> <smtpHost> <user> <password>
 *   node scripts/diag-provider.mjs imap.163.com smtp.163.com me@163.com <授权码>
 */
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

const [imapHost, smtpHost, user, pass] = process.argv.slice(2)

if (!imapHost || !smtpHost || !user || !pass) {
  console.log('用法: node scripts/diag-provider.mjs <imapHost> <smtpHost> <user> <password>')
  process.exit(1)
}

function dumpError(label, error) {
  console.log(`\n--- ${label} ---`)
  console.log('message        :', error?.message)
  for (const key of [
    'code',
    'responseStatus',
    'responseText',
    'executedCommand',
    'authenticationFailed'
  ]) {
    if (error?.[key] !== undefined) console.log(`${key.padEnd(15)}:`, String(error[key]).slice(0, 300))
  }
  if (error?.response?.attributes) {
    console.log('response attrs :', JSON.stringify(error.response.attributes).slice(0, 400))
  }
}

const logger = {
  debug: (entry) => console.log('[debug]', typeof entry === 'string' ? entry : JSON.stringify(entry)),
  info: (entry) => console.log('[info ]', typeof entry === 'string' ? entry : JSON.stringify(entry)),
  warn: (entry) => console.log('[warn ]', typeof entry === 'string' ? entry : JSON.stringify(entry)),
  error: (entry) => console.log('[error]', typeof entry === 'string' ? entry : JSON.stringify(entry))
}

console.log(`================ IMAP ${imapHost}:993 ================`)
const client = new ImapFlow({
  host: imapHost,
  port: 993,
  secure: true,
  auth: { user, pass },
  clientInfo: { name: 'MailMaster', version: '0.1.0', vendor: 'MailMaster' },
  logger,
  greetingTimeout: 20000,
  socketTimeout: 30000
})

try {
  await client.connect()
  console.log('connect() 成功')
  const list = await client.list()
  console.log('list() 成功，文件夹数', list.length)
  for (const item of list) {
    console.log(`  ${item.path}  specialUse=${item.specialUse ?? 'null'}`)
  }
} catch (error) {
  dumpError('IMAP 结果', error)
}
try {
  await client.logout()
} catch {
  /* noop */
}

console.log(`\n================ SMTP ${smtpHost}:465 ================`)
try {
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 20000,
    greetingTimeout: 20000
  })
  await transport.verify()
  console.log('verify() 成功')
  transport.close()
} catch (error) {
  dumpError('SMTP 结果', error)
}

process.exit(0)
