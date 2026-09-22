import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { simpleParser } from 'mailparser'
import MailComposer from 'nodemailer/lib/mail-composer'
import { SMTPServer } from 'smtp-server'
import {
  buildCidMap,
  buildEmailDocument,
  parseMessageSource,
  sanitizeEmailHtml
} from '../src/main/mail/parser'
import { sendMail } from '../src/main/mail/smtp'
import { describeMailError, withTimeout } from '../src/main/mail/errors'

const root = process.cwd()
const workDir = join(root, 'verify', 'tmp')
mkdirSync(workDir, { recursive: true })

// 本地 SMTP 测试服务器使用自签证书，证书缺失时自动生成（需要 openssl）
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

const results: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, condition: boolean, detail = ''): void {
  results.push({ name, ok: condition, detail })
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const HTML_BODY = `<p>你好，<b>这是一封测试邮件</b>。</p>
<script>alert('xss')</script>
<img src="https://tracker.example.com/pixel.gif" alt="track" />
<img src="cid:logo@example.com" alt="logo" />
<a href="javascript:alert(1)">危险链接</a>
<a href="https://example.com/page">正常链接</a>`

async function testErrorReporting(): Promise<void> {
  // imapflow 在服务器返回 NO 时统一抛 "Command failed"，
  // 真实原因挂在 responseText / executedCommand / authenticationFailed 上。
  const imapAuthError = Object.assign(new Error('Command failed'), {
    responseStatus: 'NO',
    responseText: 'LOGIN Login error or password error',
    executedCommand: '3 LOGIN "someone@163.com" "(* value hidden *)"',
    authenticationFailed: true
  })
  const imapAuthInfo = describeMailError(imapAuthError)
  check('识别 IMAP 认证失败', imapAuthInfo.authenticationFailed === true, '')
  check(
    '保留服务器返回的原始文本',
    imapAuthInfo.message.includes('Login error or password error'),
    imapAuthInfo.message
  )
  check('认证失败附带可操作提示', imapAuthInfo.message.includes('授权码'), imapAuthInfo.message)
  const withoutHint = describeMailError(imapAuthError, { withHint: false })
  check(
    '可关闭提示（多服务同时失败时只提示一次）',
    !withoutHint.message.includes('请确认密码栏') &&
      withoutHint.message.includes('Login error or password error'),
    withoutHint.message
  )
  check(
    '不再输出裸的 Command failed',
    !/^Command failed$/.test(imapAuthInfo.message),
    imapAuthInfo.message
  )

  const smtpAuthError = Object.assign(
    new Error('Invalid login: 535 Error: authentication failed'),
    { code: 'EAUTH' }
  )
  check('识别 nodemailer EAUTH', describeMailError(smtpAuthError).authenticationFailed === true, '')

  const commandError = Object.assign(new Error('Command failed'), {
    responseStatus: 'BAD',
    responseText: 'Unknown command',
    executedCommand: '5 FOO'
  })
  const commandInfo = describeMailError(commandError)
  check('非认证类错误保留失败命令', commandInfo.message.includes('5 FOO'), commandInfo.message)
  check('非认证类错误不误判为认证失败', commandInfo.authenticationFailed === false, '')

  const plain = describeMailError(new Error('connect ECONNREFUSED 127.0.0.1:465'))
  check('普通网络错误原样透出', plain.message.includes('ECONNREFUSED'), plain.message)

  const timeoutInfo = await withTimeout(
    new Promise(() => {}),
    120,
    'IMAP 连接'
  ).catch((error) => describeMailError(error))
  check('超时给出可读提示', timeoutInfo.message.includes('超时'), timeoutInfo.message)
}

async function testParser(): Promise<void> {
  const composer = new MailComposer({
    from: '"测试发件人" <sender@example.com>',
    to: 'rcpt@example.com, second@example.com',
    cc: 'cc@example.com',
    subject: '中文主题测试 🎉',
    text: '你好，这是一封测试邮件。\n第二行内容。',
    html: HTML_BODY,
    attachments: [
      { filename: '报告.pdf', content: Buffer.from('%PDF-1.4 fake pdf') },
      { filename: 'logo.png', content: TINY_PNG, cid: 'logo@example.com' }
    ]
  })

  const raw: Buffer = await new Promise((resolve, reject) => {
    composer.compile().build((error, message) => {
      if (error) reject(error)
      else resolve(message)
    })
  })

  writeFileSync(join(workDir, 'fixture.eml'), raw)
  check('生成 MIME 报文', raw.length > 500, `${raw.length} 字节`)

  const parsed = await parseMessageSource(raw)

  check('解析主题（UTF-8 解码）', parsed.subject === '中文主题测试 🎉', parsed.subject)
  check('解析发件人地址', parsed.fromAddr === 'sender@example.com', parsed.fromAddr)
  check('解析发件人显示名', parsed.fromName === '测试发件人', parsed.fromName)
  check('解析收件人数量', parsed.to.length === 2, JSON.stringify(parsed.to))
  check('解析抄送', parsed.cc[0]?.address === 'cc@example.com', JSON.stringify(parsed.cc))
  check('解析日期为有效时间戳', parsed.date > 1_600_000_000_000, String(parsed.date))
  check(
    '解析纯文本正文',
    parsed.text.includes('你好，这是一封测试邮件'),
    parsed.text.slice(0, 40)
  )
  check('生成摘要', parsed.snippet.includes('你好'), parsed.snippet.slice(0, 40))
  check('解析附件数量为 2', parsed.attachments.length === 2, String(parsed.attachments.length))

  const pdf = parsed.attachments.find((item) => item.filename === '报告.pdf')
  check('附件文件名解码', Boolean(pdf), pdf?.filename ?? '未找到')
  check('附件内容完整', pdf?.content.toString() === '%PDF-1.4 fake pdf', String(pdf?.content.length))

  const logo = parsed.attachments.find((item) => item.contentId === 'logo@example.com')
  check('内联图片 contentId 解析', Boolean(logo), logo?.contentId ?? '未找到')
  check('内联图片标记为 inline', logo?.isInline === true, String(logo?.isInline))

  const cidMap = buildCidMap(parsed.attachments)
  check('构建 cid 映射表', cidMap.has('logo@example.com'), `${cidMap.size} 项`)

  const sanitized = sanitizeEmailHtml(parsed.html ?? '', {
    blockRemoteImages: true,
    cidMap
  })

  check('剥离 script 标签', !sanitized.toLowerCase().includes('<script'), '')
  check('剥离 javascript: 链接', !sanitized.includes('javascript:'), '')
  check(
    '远程图片 src 换成占位图',
    // 负向后顾排除 data-blocked-src 里的 "src=" 子串
    !/(?<!-)src="https?:\/\/tracker\.example\.com/.test(sanitized),
    ''
  )
  check(
    '远程图片原地址保留在 data-blocked-src',
    sanitized.includes('data-blocked-src="https://tracker.example.com/pixel.gif"'),
    ''
  )
  check(
    '未匹配 cid 的图片移除 src',
    !/<img[^>]*\ssrc="cid:/.test(sanitized),
    ''
  )
  check('cid 内联图转为 data URL', sanitized.includes('src="data:image/png;base64,'), '')
  check('保留正常链接', sanitized.includes('https://example.com/page'), '')
  check('保留正文文本', sanitized.includes('这是一封测试邮件'), '')

  const doc = buildEmailDocument(sanitized, true)
  check('生成可渲染文档', doc.startsWith('<!doctype html>') && doc.includes('mm-blocked-banner'), '')
  check('文档带 base target=_blank', doc.includes('<base target="_blank" />'), '')
}

async function testSmtp(): Promise<void> {
  const attachmentPath = join(workDir, 'attachment.txt')
  writeFileSync(attachmentPath, 'hello from attachment', 'utf8')

  let captured: Buffer | null = null
  let authAttempt: { user?: string; pass?: string } = {}
  let envelopeRcpt: string[] = []

  const tls = ensureTlsCert()

  const server = new SMTPServer({
    secure: true,
    key: tls.key,
    cert: tls.cert,
    authOptional: false,
    disableReverseLookup: true,
    onAuth(auth, _session, callback) {
      authAttempt = { user: auth.username, pass: auth.password }
      if (auth.username === 'test@example.com' && auth.password === 'secret') {
        callback(null, { user: auth.username })
        return
      }
      callback(new Error('认证失败'))
    },
    onData(stream, session, callback) {
      envelopeRcpt = (session.envelope.rcptTo ?? []).map((item) => item.address)
      const chunks: Buffer[] = []
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      stream.on('end', () => {
        captured = Buffer.concat(chunks)
        callback()
      })
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.server.address() as AddressInfo).port
  check('启动本地 SMTP 测试服务器', port > 0, `127.0.0.1:${port}`)

  const config = {
    host: '127.0.0.1',
    port,
    secure: true,
    user: 'test@example.com',
    pass: 'secret'
  }

  await sendMail(
    config,
    {
      accountId: 1,
      to: ['to@example.com'],
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
      subject: '发送测试邮件',
      text: '这是纯文本正文',
      html: '<p>这是 <b>HTML</b> 正文</p>',
      attachments: [{ filename: 'attachment.txt', path: attachmentPath }]
    },
    { name: '测试发件人', address: 'test@example.com' }
  )

  check('SMTP 认证使用的用户名正确', authAttempt.user === 'test@example.com', authAttempt.user ?? '')
  check('服务器收到完整报文', Boolean(captured), `${captured?.length ?? 0} 字节`)

  if (captured) {
    const received = await simpleParser(captured)
    check('发送后主题正确', received.subject === '发送测试邮件', received.subject ?? '')
    check(
      '发送后收件人正确',
      received.to?.value?.[0]?.address === 'to@example.com',
      JSON.stringify(received.to?.value)
    )
    check(
      '发送后抄送正确',
      received.cc?.value?.[0]?.address === 'cc@example.com',
      JSON.stringify(received.cc?.value)
    )
    check(
      '密送进入 SMTP 信封收件人',
      envelopeRcpt.includes('bcc@example.com'),
      envelopeRcpt.join(', ')
    )
    check(
      '密送地址未出现在报文头部（隐私要求）',
      !captured.includes('Bcc:') && !captured.includes('bcc@example.com'),
      ''
    )
    check(
      '发件人显示名正确编码',
      received.from?.value?.[0]?.name === '测试发件人',
      received.from?.value?.[0]?.name ?? ''
    )
    check(
      '纯文本正文正确',
      (received.text ?? '').includes('这是纯文本正文'),
      (received.text ?? '').slice(0, 30)
    )
    check(
      'HTML 正文正确',
      typeof received.html === 'string' && received.html.includes('<b>HTML</b>'),
      ''
    )
    check(
      '附件正确送达',
      received.attachments?.[0]?.filename === 'attachment.txt',
      received.attachments?.[0]?.filename ?? '未找到'
    )
    check(
      '附件内容完整',
      received.attachments?.[0]?.content?.toString() === 'hello from attachment',
      ''
    )
  }

  let rejected = false
  try {
    await sendMail({ ...config, pass: 'wrong-password' }, {
      accountId: 1,
      to: ['to@example.com'],
      cc: [],
      bcc: [],
      subject: 'x',
      text: 'x',
      attachments: []
    }, { name: 't', address: 'test@example.com' })
  } catch {
    rejected = true
  }
  check('错误密码被服务器拒绝', rejected, '')

  await new Promise<void>((resolve) => server.close(() => resolve()))
}

await testErrorReporting()
await testParser()
await testSmtp()

const failed = results.filter((item) => !item.ok)
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  → ${item.detail}` : ''}`)
}
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log(`失败项：${failed.map((item) => item.name).join('、')}`)
  process.exitCode = 1
}
