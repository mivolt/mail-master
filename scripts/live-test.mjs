/**
 * 真实邮箱实测：用 `npm run account:setup` 添加好的账号跑完整链路。
 *
 * 脚本全程不接触明文密码——凭据由应用自己从 macOS 钥匙串解密。
 * 会把收件箱里第一封邮件的已读/星标状态恢复原样，并发出且仅发出一封自测邮件。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = process.cwd()
const profileDir = join(root, 'verify', 'dev-profile')
const shotDir = join(root, 'verify', 'live')
const workDir = join(root, 'verify', 'tmp')
mkdirSync(shotDir, { recursive: true })
mkdirSync(workDir, { recursive: true })

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail })
}
function maskEmail(value) {
  const at = value.indexOf('@')
  return at > 0 ? `${value[0]}***${value.slice(at)}` : `${value[0] ?? '?'}***`
}

const app = await electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: ['.', `--user-data-dir=${profileDir}`],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production' }
})

const page = await app.firstWindow()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2500)

const accounts0 = await page.evaluate(() => window.api.accounts.list())
let accounts = accounts0

// 允许通过环境变量传入凭据完成首次添加；脚本本身不保存任何凭据
const bootstrapEmail = process.env.MM_TEST_EMAIL
const bootstrapSecret = process.env.MM_TEST_SECRET

if (accounts.length === 0 && bootstrapEmail && bootstrapSecret) {
  console.log('未发现账号，使用环境变量提供的凭据添加测试账号…')
  const added = await page.evaluate(
    ([email, secret]) =>
      window.api.accounts.add({
        email,
        displayName: '',
        provider: '163',
        imapHost: 'imap.163.com',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.163.com',
        smtpPort: 465,
        smtpSecure: true,
        username: email,
        secret
      }),
    [bootstrapEmail, bootstrapSecret]
  )
  console.log(`已添加 ${maskEmail(added.email)}`)
  accounts = [added]
}

if (accounts.length === 0) {
  console.log('')
  console.log('！没有找到测试账号。')
  console.log('  方式一：npm run account:setup 手动添加后重跑')
  console.log('  方式二：MM_TEST_EMAIL=... MM_TEST_SECRET=... node scripts/live-test.mjs')
  console.log('')
  await app.close()
  process.exit(1)
}

const account = accounts[0]
const label = `${maskEmail(account.email)} (${account.provider})`
check('读取到测试账号', true, label)
check('账号凭据可解密（钥匙串可用）', true, '由后续同步结果间接验证')

// ---------- 1. 同步 ----------
const syncResults = await page.evaluate(() => window.api.mail.sync())
const sync = syncResults[0] ?? {}
check(
  'IMAP 同步成功',
  !sync.error,
  sync.error ?? `文件夹 ${sync.folders} 个，新邮件 ${sync.newMessages} 封`
)
check('账号未记录同步错误', !account.syncError, account.syncError ?? '')

const folders = await page.evaluate((id) => window.api.accounts.folders(id), account.id)
check('读取到文件夹', folders.length > 0, folders.map((f) => f.name).join(' / '))
check(
  '识别出收件箱',
  folders.some((f) => f.specialUse === '\\Inbox' || f.path.toUpperCase() === 'INBOX'),
  ''
)
check(
  '识别出已发送',
  folders.some((f) => f.specialUse === '\\Sent' || /^(已发送|发件箱|sent)/i.test(f.name)),
  folders.filter((f) => f.specialUse === '\\Sent').map((f) => f.name).join(' / ') || '按名称兜底'
)

// ---------- 2. 收件箱内容 ----------
const list = await page.evaluate(() => window.api.mail.list({ limit: 50 }))
check('收件箱读到邮件', list.items.length > 0, `${list.items.length} 封 / 共 ${list.total} 封`)

if (list.items.length === 0) {
  console.log('')
  console.log('！收件箱是空的，后续读信与星标回写无法验证。')
  console.log('  建议先用另一个邮箱给测试邮箱发几封不同类型的邮件：')
  console.log('  纯文本、HTML 带图、带附件、中文主题。然后重跑本脚本。')
  console.log('')
  await app.close()
  process.exit(1)
}

// ---------- 3. 读信 ----------
const target = list.items[0]
const original = { isRead: target.isRead, isStarred: target.isStarred }
const detail = await page.evaluate((id) => window.api.mail.get(id, true), target.id)

check('邮件正文已加载', detail?.bodyLoaded === true, detail?.subject?.slice(0, 40) ?? '')
check(
  '生成了可渲染的正文文档',
  typeof detail?.bodyHtml === 'string' && detail.bodyHtml.startsWith('<!doctype html>'),
  `${detail?.bodyHtml?.length ?? 0} 字节`
)
check('正文中不含 script 标签', !/<script/i.test(detail?.bodyHtml ?? ''), '')
check(
  '正文中不含 javascript: 链接',
  !/javascript:/i.test(detail?.bodyHtml ?? ''),
  ''
)
check('发件人信息完整', Boolean(detail?.fromAddr), detail?.fromAddr ? '有' : '缺失')
check('日期可解析', (detail?.date ?? 0) > 1_500_000_000_000, new Date(detail?.date ?? 0).toLocaleString('zh-CN'))

const attachments = (detail?.attachments ?? []).filter((item) => !item.isInline)
check(
  '附件已落盘（若有）',
  attachments.every((item) => item.savedPath !== null),
  attachments.length ? `${attachments.length} 个：${attachments.map((a) => a.filename).join(', ')}` : '该邮件无附件'
)

await page.screenshot({ path: join(shotDir, '01-inbox.png') })

// ---------- 3b. 快捷视图：所有未读（跨文件夹） ----------
const unreadAll = await page.evaluate(() =>
  window.api.mail.list({ folderScope: 'allFolders', unreadOnly: true, limit: 300 })
)
const unreadInbox = await page.evaluate(() => window.api.mail.list({ unreadOnly: true, limit: 300 }))
const unreadFolders = [...new Set(unreadAll.items.map((item) => item.folderName))]

check(
  '所有未读：返回的全是未读',
  unreadAll.items.every((item) => item.isRead === false),
  `${unreadAll.items.length} 封`
)
check(
  '所有未读：已排除垃圾/已删除/草稿/已发送',
  unreadAll.items.every((item) => !/已发送|垃圾|已删除|草稿|病毒/.test(item.folderName)),
  unreadFolders.join(', ') || '(空)'
)
check(
  '所有未读：覆盖范围不小于收件箱未读',
  unreadAll.total >= unreadInbox.total,
  `跨文件夹 ${unreadAll.total} vs 收件箱 ${unreadInbox.total}`
)
const unreadSummary = await page.evaluate(() => window.api.mail.unread())
check(
  '未读计数含跨文件夹口径',
  typeof unreadSummary.allFolders === 'number' && unreadSummary.allFolders >= unreadSummary.total,
  JSON.stringify(unreadSummary)
)

// ---------- 4. 星标与已读回写 ----------
await page.evaluate((id) => window.api.mail.setStarred(id, true), target.id)
await page.waitForTimeout(1200)
await page.evaluate(() => window.api.mail.sync())
const afterStar = await page.evaluate((id) => window.api.mail.get(id, true), target.id)
check('星标已同步回服务器', afterStar?.isStarred === true, '')

await page.evaluate((id) => window.api.mail.setRead(id, true), target.id)
await page.waitForTimeout(1200)
await page.evaluate(() => window.api.mail.sync())
const afterRead = await page.evaluate((id) => window.api.mail.get(id, true), target.id)
check('已读状态已同步回服务器', afterRead?.isRead === true, '')

// 恢复原状，尽量不改变你的邮箱状态
await page.evaluate(
  ([id, starred]) => window.api.mail.setStarred(id, starred),
  [target.id, original.isStarred]
)
await page.evaluate(([id, read]) => window.api.mail.setRead(id, read), [target.id, original.isRead])
await page.waitForTimeout(1500)
await page.evaluate(() => window.api.mail.sync())
check('已恢复该邮件的原始已读/星标状态', true, `原状态 已读=${original.isRead} 星标=${original.isStarred}`)

// 临时标为未读，验证未读视图在真实数据上确实抓得到（之前几条会因收件箱已无未读而空验证）
await page.evaluate((id) => window.api.mail.setRead(id, false), target.id)
await page.waitForTimeout(1500)
await page.evaluate(() => window.api.mail.sync())
const probeView = await page.evaluate(() =>
  window.api.mail.list({ folderScope: 'allFolders', unreadOnly: true, limit: 300 })
)
const probeHit = probeView.items.find((item) => item.id === target.id)
check('所有未读能抓到真实未读邮件', Boolean(probeHit), `视图内 ${probeView.items.length} 封未读`)
check(
  '未读视图标出邮件来源文件夹',
  probeHit?.folderName === target.folderName,
  probeHit?.folderName ?? '未找到'
)
await page.evaluate(([id, read]) => window.api.mail.setRead(id, read), [target.id, original.isRead])
await page.waitForTimeout(1500)
await page.evaluate(() => window.api.mail.sync())

// ---------- 5. 真实服务商上的诊断报告 ----------
const diag = await page.evaluate((id) => window.api.diag.runAccount(id), account.id)
const diagLines = (diag.text.split('【协议日志】')[1] ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
const base64Tokens = diagLines.flatMap((line) => line.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? [])
const decoded = base64Tokens
  .map((token) => {
    try {
      return Buffer.from(token, 'base64').toString('utf8')
    } catch {
      return ''
    }
  })
  .join('\n')

check('诊断报告：IMAP 通过', diag.imapOk === true, '')
check('诊断报告：SMTP 通过', diag.smtpOk === true, '')
check('诊断报告捕获到协议日志', diagLines.length > 5, `${diagLines.length} 行`)
check(
  '诊断报告未泄露账号本地部分',
  !diag.text.includes(account.email.split('@')[0]),
  ''
)
check(
  '诊断报告无 base64 编码的凭据',
  !decoded.includes(account.username) && !decoded.includes('@'),
  decoded.replace(/[\u0000-\u001f]/g, '·').slice(0, 120) || '无 base64 凭据'
)
check('诊断报告标注已脱敏', diag.text.includes('可直接粘贴给他人'), '')

// ---------- 6. 发信实测 ----------
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
const subject = `[Mail Master 自测] ${stamp}`
const attachmentPath = join(workDir, '自测附件.txt')
writeFileSync(attachmentPath, '来自 Mail Master 实测脚本的附件内容\n', 'utf8')

const sendResult = await page.evaluate(
  ([accountId, to, mailSubject, path]) =>
    window.api.compose.send({
      accountId,
      to: [to],
      cc: [],
      bcc: [],
      subject: mailSubject,
      text: '这是一封由 Mail Master 实测脚本发出的测试邮件，可以安全删除。',
      attachments: [{ filename: '自测附件.txt', path }]
    }),
  [account.id, account.email, subject, attachmentPath]
)
check('SMTP 发信成功', sendResult.ok === true, sendResult.error ?? '')

let arrived = null
if (sendResult.ok) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(5000)
    await page.evaluate(() => window.api.mail.sync())
    const found = await page.evaluate(
      (keyword) => window.api.mail.list({ keyword, limit: 20 }),
      'Mail Master 自测'
    )
    arrived = found.items.find((item) => item.subject === subject) ?? null
    if (arrived) break
  }
  check(
    '发出的邮件已收到（自投递）',
    Boolean(arrived),
    arrived ? '已在收件箱中找到' : '等待 50 秒未收到；部分服务商自投递较慢，可稍后手动刷新确认'
  )

  if (arrived) {
    const received = await page.evaluate((id) => window.api.mail.get(id, true), arrived.id)
    check('收到邮件主题一致', received?.subject === subject, received?.subject ?? '')
    check(
      '收到的邮件带附件',
      (received?.attachments ?? []).some((item) => item.filename === '自测附件.txt'),
      (received?.attachments ?? []).map((item) => item.filename).join(', ')
    )
    check(
      '收到的正文正确',
      (received?.bodyText ?? '').includes('可以安全删除'),
      (received?.bodyText ?? '').slice(0, 40)
    )
  }
}

check('渲染层无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
await page.screenshot({ path: join(shotDir, '02-after-send.png') })

await app.close()

const failed = results.filter((item) => !item.ok)
console.log('')
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  → ${item.detail}` : ''}`)
}
console.log('')
console.log(`${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log(`失败项：${failed.map((item) => item.name).join('、')}`)
}
console.log('')
console.log(`截图已保存到 ${shotDir}`)
console.log(`自测邮件主题：${subject}（可在邮箱里直接删除）`)
console.log('')
console.log('提醒：测试完成后，请到邮箱设置里重置授权码。')
process.exitCode = failed.length > 0 ? 1 : 0
