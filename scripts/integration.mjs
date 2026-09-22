import { createRequire } from 'node:module'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright-core'
import MailComposer from 'nodemailer/lib/mail-composer'
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { ImapFlow } from 'imapflow'

const require = createRequire(import.meta.url)
const hoodiecrow = require('hoodiecrow-imap')

const root = process.cwd()
const shotDir = join(root, 'verify')
const profileDir = join(tmpdir(), `mail-master-profile-${Date.now()}`)
mkdirSync(shotDir, { recursive: true })

const results = []
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail })
}

function printResults() {
  const failed = results.filter((item) => !item.ok)
  console.log('')
  for (const item of results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  → ${item.detail}` : ''}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} 通过`)
  if (failed.length > 0) {
    console.log(`失败项：${failed.map((item) => item.name).join('、')}`)
    process.exitCode = 1
  }
}

// 中断时也要把已收集的检查项打出来，否则定位不到失败位置
process.on('uncaughtException', (error) => {
  console.error(`\n测试中断：${error?.message ?? error}`)
  printResults()
  process.exit(1)
})

function buildRaw(options) {
  const composer = new MailComposer(options)
  return new Promise((resolve, reject) => {
    composer.compile().build((error, message) => (error ? reject(error) : resolve(message)))
  })
}

/**
 * 自签证书，供两个假服务器共用。
 *
 * hoodiecrow 自带的那份是 2015 年签发的，**已于 2025-02-09 过期**——
 * 应用侧因为测试时设了 NODE_TLS_REJECT_UNAUTHORIZED=0 才没暴露，
 * 但测试进程自己发起的连接会直接报 CERT_HAS_EXPIRED。
 */
function ensureTlsCert() {
  const dir = join(root, 'verify', 'tls')
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  const valid = (() => {
    if (!existsSync(keyPath) || !existsSync(certPath)) return false
    try {
      execFileSync('openssl', ['x509', '-in', certPath, '-noout', '-checkend', '86400'], {
        stdio: 'ignore'
      })
      return true
    } catch {
      return false
    }
  })()

  if (!valid) {
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

const tls = ensureTlsCert()

const messages = await Promise.all([
  buildRaw({
    from: '"张三" <zhangsan@example.com>',
    to: 'me@example.com',
    subject: '第一封：普通邮件',
    text: '这是第一封邮件的正文。\n第二行内容。'
  }),
  buildRaw({
    from: '"Li Si" <lisi@example.com>',
    to: 'me@example.com',
    subject: '第二封：带附件的邮件',
    text: '第二封邮件正文。',
    attachments: [{ filename: '数据.csv', content: Buffer.from('a,b\n1,2\n') }]
  }),
  buildRaw({
    from: '"王五" <wangwu@example.com>',
    to: 'me@example.com',
    subject: '第三封：中文主题与 HTML 正文',
    html: '<h2>HTML 正文标题</h2><p>这是一段 <b>HTML</b> 正文。</p><img src="https://tracker.example.com/pixel.gif"><script>alert(1)</script><a href="https://example.com">链接</a>',
    text: 'HTML 邮件的纯文本备份'
  })
])

const server = hoodiecrow({
  plugins: ['ID', 'SASL-IR', 'AUTH-PLAIN', 'NAMESPACE', 'IDLE', 'ENABLE', 'LITERALPLUS', 'UNSELECT', 'SPECIAL-USE', 'CREATE-SPECIAL-USE'],
  id: { name: 'hoodiecrow', version: '1.0' },
  secureConnection: true,
  // 用我们自己签的有效证书，替代它自带的那份（2025-02 已过期）
  credentials: tls,
  // 界面添加账号时用户名由邮箱派生，这里两个都接受
  users: {
    testuser: { password: 'testpass' },
    'me@example.com': { password: 'testpass' }
  },
  storage: {
    INBOX: {
      messages: [
        { raw: messages[0].toString('utf8') },
        { raw: messages[1].toString('utf8'), flags: ['\\Seen'] },
        { raw: messages[2].toString('utf8') }
      ]
    },
    '': {
      separator: '/',
      folders: {
        'Sent Mail': { 'special-use': '\\Sent', messages: [{ raw: (await buildRaw({ from: '"我" <me@example.com>', to: 'a@b.com', subject: '已发送的邮件', text: 'x' })).toString('utf8') }] },
        Drafts: { 'special-use': '\\Drafts' },
        Trash: { 'special-use': '\\Trash' }
      }
    }
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const imapPort = server.server.address().port
check('假 IMAP 服务器就绪', imapPort > 0, `127.0.0.1:${imapPort}`)

// 本地 TLS SMTP 服务器：让「通过界面发信」也能真正跑通，
// 从而覆盖写信页里响应式数组跨 IPC 的序列化问题
const sentMessages = []
const smtpServer = new SMTPServer({
  secure: true,
  key: tls.key,
  cert: tls.cert,
  authOptional: false,
  disableReverseLookup: true,
  onAuth(auth, _session, callback) {
    const accepted = ['testuser', 'me@example.com']
    if (accepted.includes(auth.username) && auth.password === 'testpass') {
      callback(null, { user: auth.username })
      return
    }
    callback(new Error('认证失败'))
  },
  onData(stream, _session, callback) {
    const chunks = []
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    stream.on('end', () => {
      sentMessages.push(Buffer.concat(chunks))
      callback()
    })
  }
})
await new Promise((resolve) => smtpServer.listen(0, '127.0.0.1', resolve))
const smtpPort = smtpServer.server.address().port
check('假 SMTP 服务器就绪', smtpPort > 0, `127.0.0.1:${smtpPort}`)

const app = await electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: ['.', `--user-data-dir=${profileDir}`],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production', NODE_TLS_REJECT_UNAUTHORIZED: '0' }
})

const page = await app.firstWindow()
const consoleErrors = []
const pageErrors = []

let appClosed = false
app.on('close', () => {
  appClosed = true
})

const child = app.process()
child.stdout?.on('data', (chunk) => process.stdout.write(`[main-stdout] ${chunk}`))
child.stderr?.on('data', (chunk) => process.stdout.write(`[main-stderr] ${chunk}`))
child.on('exit', (code, signal) => {
  console.log(`[main-exit] code=${code} signal=${signal}`)
})

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('crash', () => console.log('[renderer-crash]'))

await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)

const listSection = () => page.locator('section').first()

async function waitForListHeader(expected, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    text = await listSection().innerText().catch(() => '')
    if (text.includes(expected)) return text
    await page.waitForTimeout(200)
  }
  return text
}

/**
 * 侧栏重渲染（后台同步完成会刷新文件夹）可能让点击落空，
 * 因此点击后轮询等待目标状态，未生效则重试。
 */
async function openSidebarItem(name, expected, attempts = 4) {
  let text = ''
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await page
      .locator('aside button', { hasText: name })
      .first()
      .click({ timeout: 5000 })
      .catch(() => {})
    text = await waitForListHeader(expected, 3000)
    if (text.includes(expected)) return text
  }
  return text
}

/** 把侧栏文件夹区设成指定展开状态（不假设初始状态，添加账号后默认是展开的） */
async function setFolderExpanded(open) {
  const readState = () =>
    page.evaluate(() =>
      document.querySelector('aside .folder-expand')?.getAttribute('data-open')
    )
  if ((await readState()) !== (open ? 'true' : 'false')) {
    await page
      .locator('aside button[title="展开文件夹"], aside button[title="收起文件夹"]')
      .first()
      .click({ timeout: 5000 })
      .catch(() => {})
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if ((await readState()) === (open ? 'true' : 'false')) break
    await page.waitForTimeout(100)
  }
  // 等高度过渡结束，否则按钮位置仍在移动，点击会落空
  await page.waitForTimeout(350)
}

// 0. 首次体验：没有账号时应看到欢迎页与产品承诺
const welcomeText = await page.evaluate(() => document.body.innerText)
check('无账号时显示欢迎页', welcomeText.includes('把多个邮箱收进一个窗口'), welcomeText.replace(/\s+/g, ' ').slice(0, 80))
check(
  '欢迎页写明三条承诺',
  welcomeText.includes('没有广告') && welcomeText.includes('不设上限') && welcomeText.includes('只存在本机'),
  ''
)
await page.screenshot({ path: join(shotDir, '11-welcome.png') })

// 0b. 添加账号弹窗：先选服务商，邮箱只填 @ 前面
await page.locator('button', { hasText: '添加邮箱账号' }).first().click()
await page.waitForTimeout(700)

const initialPanel = await page.evaluate(() => {
  const panel = document.querySelector('.dialog-panel')
  // 折叠区里的元素 offsetParent 不为 null（只是被 overflow 裁剪），
  // 因此按「是否位于折叠区内」来判断默认可见的字段数
  const topLevelInputs = [...panel.querySelectorAll('input')].filter(
    (element) => !element.closest('.folder-expand')
  )
  return {
    inputs: topLevelInputs.length,
    hasLocalField: Boolean(panel.querySelector('input[data-field="emailLocal"]')),
    providerChips: panel.querySelectorAll('button[data-provider]').length,
    hasGuideTrigger: panel.innerText.includes('怎么拿到'),
    hasSteps: panel.innerText.includes('打开 QQ 邮箱并登录')
  }
})
check(
  '添加账号弹窗默认只有两个输入框',
  initialPanel.inputs === 2 && initialPanel.hasLocalField,
  `${initialPanel.inputs} 个可见输入框`
)
check('服务商以按钮组形式先选', initialPanel.providerChips === 5, `${initialPanel.providerChips} 个`)
check(
  '未填邮箱时不展示获取步骤（避免过早信息）',
  initialPanel.hasGuideTrigger === false && initialPanel.hasSteps === false,
  ''
)
await page.screenshot({ path: join(shotDir, '12-account-default.png') })

// 选服务商后自动带出域名后缀，密码栏标签随之变化
await page.locator('.dialog-panel button[data-provider="163"]').click()
await page.waitForTimeout(500)
const afterProvider = await page.evaluate(() => {
  const panel = document.querySelector('.dialog-panel')
  return {
    suffixShown: panel.innerText.includes('163.com'),
    passwordLabel: panel.innerText.includes('授权码'),
    trigger: panel.innerText.includes('怎么拿到授权码'),
    expands: [...panel.querySelectorAll('.folder-expand')].map((element) =>
      element.getAttribute('data-open')
    )
  }
})
check('选中服务商后自动带出域名后缀', afterProvider.suffixShown, '')
check('密码栏按服务商标为「授权码」', afterProvider.passwordLabel, '')
check('邮箱未填完时不展示获取步骤', afterProvider.trigger === false, '')

// 只输入 @ 之前的内容，其余由服务商拼出来
await page
  .locator('.dialog-panel input[data-field="emailLocal"]')
  .pressSequentially('someone', { delay: 30 })
await page.waitForTimeout(500)
const composed = await page.evaluate(() => {
  const panel = document.querySelector('.dialog-panel')
  return {
    username: panel.querySelector('input[data-field="username"]')?.value ?? '',
    trigger: panel.innerText.includes('怎么拿到授权码'),
    expands: [...panel.querySelectorAll('.folder-expand')].map((element) =>
      element.getAttribute('data-open')
    )
  }
})
check('只填 @ 前面即可拼出完整邮箱', composed.username === 'someone@163.com', composed.username)
check('邮箱拼完整后出现帮助入口', composed.trigger, '')
check(
  '帮助与高级设置默认都折叠',
  composed.expands.length === 2 && composed.expands.every((state) => state === 'false'),
  JSON.stringify(composed.expands)
)

// 点开帮助才展示步骤
await page.locator('.dialog-panel button', { hasText: '怎么拿到授权码' }).first().click()
await page.waitForTimeout(500)
const openedGuide = await page.evaluate(() => {
  const panel = document.querySelector('.dialog-panel')
  return {
    expanded: panel.querySelector('.folder-expand')?.getAttribute('data-open') === 'true',
    text: panel.innerText
  }
})
check('点击后展开获取步骤', openedGuide.expanded, '')
check('步骤是编号指引且贴合 163', openedGuide.text.includes('打开 163 邮箱并登录'), '')
check('展开后说明授权码形态', openedGuide.text.includes('不是你的邮箱登录密码'), '')
await page.screenshot({ path: join(shotDir, '12-account-guide.png') })

// 认证失败时错误要醒目，并自动展开帮助
await page.locator('.dialog-panel button', { hasText: '高级设置' }).first().click()
await page.waitForTimeout(500)
await page.fill('.dialog-panel input[data-field="imapHost"]', '127.0.0.1')
await page.locator('.dialog-panel input[data-field="imapPort"]').fill(String(imapPort))
await page.fill('.dialog-panel input[data-field="secret"]', 'definitely-wrong')
await page.locator('.dialog-panel button', { hasText: '测试连接' }).click()
await page.waitForTimeout(2500)

const failedState = await page.evaluate(() => {
  const alert = document.querySelector('.dialog-panel .alert-error')
  const panel = document.querySelector('.dialog-panel')
  return {
    hasAlert: Boolean(alert),
    title: alert?.querySelector('.alert-error__title')?.textContent?.trim() ?? '',
    body: alert?.querySelector('.alert-error__body')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    guideExpanded: panel.querySelector('.folder-expand')?.getAttribute('data-open') === 'true',
    hasAction: Boolean(alert?.querySelector('button'))
  }
})
check('认证失败时显示醒目的错误块', failedState.hasAlert, '')
check('错误块有明确标题', failedState.title === '无法完成登录', failedState.title)
check(
  '错误块引用服务器原话并给出下一步',
  failedState.body.includes('认证失败') && failedState.body.includes('授权码'),
  failedState.body.slice(0, 120)
)
check('认证失败时自动展开获取步骤', failedState.guideExpanded, '')
await page.screenshot({ path: join(shotDir, '15-account-error.png') })

// 从面板内部拖拽选中文字、在遮罩上松开：这是「复制」的常规动作，
// 不应被 @click.self 误判成「点了背景」而关闭弹窗
const dragField = page.locator('.dialog-panel input[data-field="emailLocal"]')
await dragField.scrollIntoViewIfNeeded()
const dragBox = await dragField.boundingBox()
await page.mouse.move(dragBox.x + 6, dragBox.y + dragBox.height / 2)
await page.mouse.down()
await page.mouse.move(dragBox.x + dragBox.width - 6, dragBox.y + dragBox.height / 2, { steps: 8 })
await page.mouse.move(24, 24, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(700)
check(
  '面板内拖拽选中并在遮罩松开不会误关弹窗',
  await page.evaluate(() => Boolean(document.querySelector('.dialog-panel'))),
  ''
)

// 但真正点击遮罩仍应关闭
await page.mouse.click(24, 24)
await page.waitForTimeout(700)
check(
  '点击遮罩仍能正常关闭弹窗',
  await page.evaluate(() => !document.querySelector('.dialog-panel')),
  ''
)

// 0c. 关于：只保留叙事与隐私声明
await page.locator('aside button', { hasText: '关于' }).first().click()
await page.waitForTimeout(600)
const aboutText = await page.evaluate(() => document.body.innerText)
check('关于面板打开', aboutText.includes('关于 Mail Master'), '')
check('写明无广告承诺', aboutText.includes('界面里没有任何广告位'), '')
check('写明不上传什么', aboutText.includes('不会上传的东西'), '')
check('关于里不再混入数据管理操作', !aboutText.includes('清除全部本地数据'), '')
await page.screenshot({ path: join(shotDir, '13-about.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
check(
  '关闭关于后没有残留弹窗',
  await page.evaluate(() => document.querySelectorAll('.dialog-panel').length === 0),
  ''
)

// 0d. 设置：行为配置与数据管理
await page.locator('aside button', { hasText: '设置' }).first().click()
await page.waitForSelector('.dialog-panel select[data-setting="syncWindow"]', { timeout: 8000 })
await page.waitForTimeout(300)
const settingsText = await page.evaluate(() => document.body.innerText)
check('设置面板打开', settingsText.includes('每个文件夹保留邮件数'), '')
check('设置含同步项', settingsText.includes('自动下载正文'), '')
check('设置含隐私项', settingsText.includes('默认不加载远程图片'), '')
check('设置含通用项', settingsText.includes('开机时自动启动'), '')
check('数据管理在设置里', settingsText.includes('清除全部本地数据'), '')
check('数据位置在设置里', settingsText.includes('打开数据目录'), '')
check('凭据加密状态在设置里', /已由系统钥匙串加密|明文存储/.test(settingsText), '')

const settingsBefore = await page.evaluate(() => window.api.settings.get())
await page.selectOption('.dialog-panel select[data-setting="syncWindow"]', '500')
await page.waitForTimeout(600)
const settingsAfter = await page.evaluate(() => window.api.settings.get())
check(
  '修改设置后立即持久化',
  settingsBefore.syncWindow !== 500 && settingsAfter.syncWindow === 500,
  `${settingsBefore.syncWindow} → ${settingsAfter.syncWindow}`
)

await page.locator('.dialog-panel button[data-setting="blockRemoteImages"]').click()
await page.waitForTimeout(600)
const toggled = await page.evaluate(() => window.api.settings.get())
check(
  '开关类设置也能持久化',
  toggled.blockRemoteImages !== settingsAfter.blockRemoteImages,
  `blockRemoteImages=${toggled.blockRemoteImages}`
)

// 通过界面还原，保证 store 与数据库一致（否则后续读信会不拦图片）
await page.locator('.dialog-panel button[data-setting="blockRemoteImages"]').click()
await page.selectOption('.dialog-panel select[data-setting="syncWindow"]', '300')
await page.waitForTimeout(600)
const restored = await page.evaluate(() => window.api.settings.get())
check(
  '设置可还原',
  restored.blockRemoteImages === true && restored.syncWindow === 300,
  JSON.stringify(restored)
)
await page.screenshot({ path: join(shotDir, '16-settings.png') })
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 1. 添加账号：必须走真实界面路径。
//    直接调 window.api 传普通对象字面量会绕过「响应式 Proxy 跨 IPC」的序列化问题，
//    之前正是因此漏掉了「打包后添加账号报 An object could not be cloned」。
await page.locator('button', { hasText: '添加邮箱账号' }).first().click()
await page.waitForTimeout(700)
// 自定义服务商：域名也由用户填；本地部分逐字输入
await page.locator('.dialog-panel button[data-provider="custom"]').click()
await page.waitForTimeout(500)
await page
  .locator('.dialog-panel input[data-field="emailLocal"]')
  .pressSequentially('me', { delay: 40 })
await page.fill('.dialog-panel input[data-field="emailDomain"]', 'example.com')
await page.waitForTimeout(500)
const typedUsername = await page.locator('.dialog-panel input[data-field="username"]').inputValue()
check('本地部分 + 域名拼出完整用户名', typedUsername === 'me@example.com', typedUsername)

// 服务商指向假服务器
await page.fill('.dialog-panel input[data-field="displayName"]', '测试账号')
await page.fill('.dialog-panel input[data-field="imapHost"]', '127.0.0.1')
await page.fill('.dialog-panel input[data-field="imapPort"]', String(imapPort))
await page.fill('.dialog-panel input[data-field="smtpHost"]', '127.0.0.1')
await page.fill('.dialog-panel input[data-field="smtpPort"]', String(smtpPort))
await page.fill('.dialog-panel input[data-field="secret"]', 'testpass')
await page.locator('.dialog-panel button', { hasText: '添加账号' }).first().click()

let addError = ''
for (let attempt = 0; attempt < 40; attempt += 1) {
  await page.waitForTimeout(500)
  const stillOpen = await page.evaluate(() => Boolean(document.querySelector('.dialog-panel')))
  if (!stillOpen) break
  addError = await page.evaluate(
    () => document.querySelector('.dialog-panel .alert-error__body')?.textContent?.trim() ?? ''
  )
}
const account = await page.evaluate(async () => (await window.api.accounts.list())[0] ?? null)
check('通过界面添加账号成功', Boolean(account), account ? `${account.email} (id=${account.id})` : addError)
check(
  '账号用户名与邮箱一致（未被输入过程截断）',
  account?.username === 'me@example.com',
  account?.username ?? '(无账号)'
)
check(
  '添加账号未出现 IPC 序列化错误',
  !addError.includes('could not be cloned'),
  addError.slice(0, 140) || '（无错误）'
)

// 2. 等待后台同步把邮件写进本地库
let listed = { items: [], total: 0 }
for (let attempt = 0; attempt < 40; attempt += 1) {
  if (appClosed) break
  try {
    await page.waitForTimeout(500)
    listed = await page.evaluate(() => window.api.mail.list({ limit: 50 }))
  } catch (error) {
    console.log(`[sync-poll] ${error?.message ?? error}`)
    break
  }
  if (listed.items.length >= 3) break
}
check('同步后收件箱有 3 封邮件', listed.items.length === 3, `${listed.items.length} 封`)
check(
  '同步结果包含中文主题',
  listed.items.some((item) => item.subject === '第三封：中文主题与 HTML 正文'),
  listed.items.map((item) => item.subject).join(' | ')
)
check(
  '附件标记正确',
  listed.items.find((item) => item.subject.includes('带附件'))?.hasAttachments === true,
  ''
)
check(
  '已读标记正确',
  listed.items.find((item) => item.subject.includes('带附件'))?.isRead === true,
  ''
)

const folders = await page.evaluate(() => window.api.accounts.folders(1))
check('文件夹已同步到本地', folders.length >= 4, folders.map((item) => item.path).join(', '))

const unread = await page.evaluate(() => window.api.mail.unread())
check('未读计数正确', unread.total === 2, JSON.stringify(unread))

// 2b. 连接自检必须各用各的配置：SMTP 不能连到 IMAP 服务器上
const probePayload = (port, secret) => ({
  email: 'probe@example.com',
  displayName: 'probe',
  provider: 'custom',
  imapHost: '127.0.0.1',
  imapPort: port,
  imapSecure: true,
  smtpHost: '127.0.0.1',
  smtpPort: 1,
  smtpSecure: true,
  username: 'testuser',
  secret
})

const probe = await page.evaluate(
  async ([port, payload]) => window.api.accounts.test(payload),
  [imapPort, probePayload(imapPort, 'testpass')]
)
check('连接自检：IMAP 通过', probe.imapOk === true, JSON.stringify(probe).slice(0, 220))
check('连接自检：SMTP 失败', probe.smtpOk === false, '')
check(
  '连接自检：SMTP 用的是 SMTP 配置（未误连 IMAP 服务器）',
  !/IMAP4rev1|Server Ready|hoodiecrow|Invalid greeting/i.test(probe.error ?? ''),
  (probe.error ?? '').replace(/\s+/g, ' ').slice(0, 220)
)

// 2c. 认证失败要透出服务器原话，而不是裸的 Command failed
const authProbe = await page.evaluate(
  async ([port, payload]) => window.api.accounts.test(payload),
  [imapPort, probePayload(imapPort, 'definitely-wrong')]
)
check('认证失败被标记', authProbe.authFailed === true, JSON.stringify(authProbe).slice(0, 220))
check(
  '认证失败给出可操作提示',
  (authProbe.error ?? '').includes('授权码'),
  (authProbe.error ?? '').replace(/\s+/g, ' ').slice(0, 220)
)
check(
  '错误信息不再是裸的 Command failed',
  !/IMAP：Command failed\s*$/m.test(authProbe.error ?? ''),
  (authProbe.error ?? '').replace(/\s+/g, ' ').slice(0, 220)
)

// 2d. 一键诊断：报告要完整、可读、且已脱敏
const diag = await page.evaluate(
  async ([port]) =>
    window.api.diag.run({
      email: 'secret.user@example.com',
      displayName: '诊断探针',
      provider: 'custom',
      imapHost: '127.0.0.1',
      imapPort: port,
      imapSecure: true,
      smtpHost: '127.0.0.1',
      smtpPort: 1,
      smtpSecure: true,
      username: 'testuser',
      secret: 'testpass'
    }),
  [imapPort]
)
check('诊断报告有标题与版本信息', diag.text.includes('Mail Master 诊断报告') && diag.text.includes('应用版本'), '')
check('诊断报告记录了 IMAP 成功', diag.imapOk === true, '')
check('诊断报告记录了 SMTP 失败', diag.smtpOk === false, '')
const diagLogLines = (diag.text.split('【协议日志】')[1] ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
check(
  '诊断报告含完整协议日志',
  diagLogLines.some((line) => /CAPABILITY/i.test(line)) &&
    diagLogLines.some((line) => /LOGIN|AUTHENTICATE/i.test(line)),
  `共 ${diagLogLines.length} 行`
)

// 最关键的一条：日志里不能出现任何可还原出凭据的内容。
// imapflow 在 SASL-IR 下会把凭据 base64 内联，只按字面匹配密码是抓不到的。
const base64Tokens = diagLogLines.flatMap((line) => line.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? [])
const decodedTokens = base64Tokens
  .map((token) => {
    try {
      return Buffer.from(token, 'base64').toString('utf8')
    } catch {
      return ''
    }
  })
  .join('\n')
check(
  '协议日志中没有 base64 编码的凭据',
  !decodedTokens.includes('testpass') && !decodedTokens.includes('testuser'),
  decodedTokens.replace(/[\u0000-\u001f]/g, '·').slice(0, 160)
)
check(
  '协议日志中不含明文凭据',
  !diag.text.includes('testpass') && !diag.text.includes('testuser'),
  ''
)
check(
  '诊断报告脱敏邮箱本地部分',
  diag.text.includes('s***@example.com') && !diag.text.includes('secret.user@example.com'),
  ''
)
check('诊断报告不含明文密码', !diag.text.includes('testpass'), '')
check('诊断报告标明已脱敏', diag.text.includes('可直接粘贴给他人'), '')

// 2e. 数据透明：存储统计
const storage = await page.evaluate(() => window.api.app.storageInfo())
check('存储信息包含账号数', storage.accountCount === 1, JSON.stringify(storage).slice(0, 160))
check(
  '存储信息包含邮件数（收件箱 3 + 已发送 1）',
  storage.messageCount === 4,
  String(storage.messageCount)
)
check('存储信息包含附件数', storage.attachmentCount >= 1, String(storage.attachmentCount))
check('存储信息标明凭据加密状态', typeof storage.encryptionAvailable === 'boolean', '')
check('存储信息给出数据目录', storage.userDataDir.includes(profileDir), storage.userDataDir)

// 2f. 文件夹导航：折叠态不可点、展开态可点
await setFolderExpanded(false)
const collapsedInert = await page.evaluate(() => {
  const wrap = document.querySelector('aside .folder-expand')
  return wrap ? wrap.hasAttribute('inert') : null
})
check('折叠状态下文件夹区域被标记 inert', collapsedInert === true, String(collapsedInert))

await setFolderExpanded(true)
await page.screenshot({ path: join(shotDir, '09-sidebar-expanded.png') })

const expandedInert = await page.evaluate(() => {
  const wrap = document.querySelector('aside .folder-expand')
  return wrap ? wrap.hasAttribute('inert') : null
})
check('展开后 inert 被移除（文件夹可点击）', expandedInert === false, String(expandedInert))

const sentHeader = await openSidebarItem('Sent Mail', 'Sent Mail')
check('点击文件夹后列表切换到该文件夹', sentHeader.includes('Sent Mail'), sentHeader.slice(0, 90))
check(
  '已发送文件夹内容已同步',
  sentHeader.includes('已发送的邮件'),
  sentHeader.replace(/\s+/g, ' ').slice(0, 140)
)
await page.screenshot({ path: join(shotDir, '10-sent-folder.png') })

// 2g. 快捷视图：所有未读（跨文件夹聚合，并排除已发送/垃圾/已删除/草稿）
const unreadViewHeader = (await openSidebarItem('所有未读', '所有未读')).replace(/\s+/g, ' ')
check('所有未读视图标题正确', unreadViewHeader.includes('所有未读'), unreadViewHeader.slice(0, 50))

const unreadViewDots = await page.locator('span[aria-label="未读"]').count()
check(
  '所有未读只列出未读邮件（收件箱 2 封）',
  unreadViewDots === 2,
  `${unreadViewDots} 封`
)
const unreadViewBody = await page.evaluate(() => document.body.innerText)
check(
  '所有未读排除了已发送文件夹（该文件夹里的邮件也是未读态）',
  !unreadViewBody.includes('已发送的邮件'),
  ''
)
check('跨文件夹视图标出邮件来源文件夹', unreadViewBody.includes('INBOX'), '')

const unreadBadge = await page.evaluate(() => {
  const row = [...document.querySelectorAll('aside button')].find((button) =>
    button.textContent?.includes('所有未读')
  )
  return row?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
})
check('所有未读带计数徽标', /所有未读\s*\d+/.test(unreadBadge), unreadBadge)
check(
  '所有未读视图隐藏了列表内的筛选条',
  !unreadViewHeader.includes('星标'),
  unreadViewHeader.slice(0, 60)
)
await page.screenshot({ path: join(shotDir, '14-unread-view.png') })

// 回到所有收件箱，继续后面的读信流程
await openSidebarItem('所有收件箱', '所有收件箱')

// 3. 刷新界面并截图列表
await page.evaluate(() => window.api.mail.list({ limit: 50 }))
await page.reload()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2200)
await page.screenshot({ path: join(shotDir, '02-inbox.png') })

const sidebarText = (await page.locator('aside').first().innerText()).replace(/\s+/g, ' ').trim()
check('侧栏显示账号', sidebarText.includes('测试账号'), sidebarText)
check('侧栏显示未读数', sidebarText.includes('2'), sidebarText)

// 同步收尾时会重新打开 INBOX 触发 imapflow 的 exists 事件，不应被误判成新邮件
await page.waitForTimeout(3800)
const bodyAfterSync = await page.evaluate(() => document.body.innerText)
check('同步后没有误报「收到新邮件」', !bodyAfterSync.includes('收到'), bodyAfterSync.replace(/\s+/g, ' ').slice(0, 80))

const readerSection = () => page.locator('section').nth(1)

async function waitForReaderSubject(expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    text = await readerSection().innerText().catch(() => '')
    if (text.includes(expected)) return text
    await page.waitForTimeout(200)
  }
  return text
}

async function waitForFrameText(predicate, timeoutMs = 10000) {
  const frame = page.frameLocator('iframe[title="邮件正文"]')
  const deadline = Date.now() + timeoutMs
  let text = ''
  while (Date.now() < deadline) {
    text = await frame.locator('body').innerText().catch(() => '')
    if (predicate(text)) return text
    await page.waitForTimeout(250)
  }
  return text
}

async function openRow(subject) {
  await page.locator('button', { hasText: subject }).first().click()
}

// 4. 打开一封 HTML 邮件
await openRow('第三封：中文主题与 HTML 正文')
const readerTextHtml = await waitForReaderSubject('第三封：中文主题与 HTML 正文')
check('阅读区显示正确的邮件主题', readerTextHtml.includes('第三封：中文主题与 HTML 正文'), readerTextHtml.replace(/\s+/g, ' ').slice(0, 90))

const frameText = await waitForFrameText((text) => text.includes('HTML 正文标题'))
check('邮件正文在 iframe 中渲染', frameText.includes('HTML 正文标题'), frameText.replace(/\s+/g, ' ').slice(0, 90))
// 截图放在正文渲染完成之后，否则会拍到空白阅读区
await page.screenshot({ path: join(shotDir, '03-reader-html.png') })
check('正文中的 script 未执行（无 alert 报错）', pageErrors.length === 0, pageErrors.join(' | '))

const blocked = await page.evaluate(() => document.body.innerText.includes('显示图片'))
check('远程图片拦截提示可见', blocked, '')

const unreadAfter = await page.evaluate(() => window.api.mail.unread())
check('打开邮件后未读数减为 1', unreadAfter.total === 1, JSON.stringify(unreadAfter))

const accountRowText = await page.evaluate(() => {
  const row = [...document.querySelectorAll('aside button')].find((button) =>
    button.textContent?.includes('测试账号')
  )
  return row?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
})
check(
  '侧栏账号未读徽标同步更新为 1',
  accountRowText.includes('1') && !accountRowText.includes('2'),
  accountRowText
)

const unreadDots = await page.locator('span[aria-label="未读"]').count()
check('列表中只剩 1 个未读标识', unreadDots === 1, `${unreadDots} 个`)

// 5. 显示图片
const errorsBeforeImages = consoleErrors.length
await page.locator('button', { hasText: '显示图片' }).first().click()
await page.waitForTimeout(1500)
const shown = await page.evaluate(() => document.body.innerText.includes('显示图片'))
check('点击后拦截提示消失', shown === false, '')
const imageRequestMade = consoleErrors
  .slice(errorsBeforeImages)
  .some((text) => text.includes('tracker.example.com') || text.includes('ERR_NAME_NOT_RESOLVED'))
check('点击后确实发起了远程图片请求（CSP 未拦截）', imageRequestMade, consoleErrors.slice(errorsBeforeImages).join(' | '))
await page.screenshot({ path: join(shotDir, '04-images-shown.png') })

// 6. 打开带附件的邮件
await openRow('第二封：带附件的邮件')
const readerText = await waitForReaderSubject('第二封：带附件的邮件')
check('阅读区显示正确的邮件主题', readerText.includes('第二封：带附件的邮件'), readerText.replace(/\s+/g, ' ').slice(0, 90))
check('附件出现在阅读区', readerText.includes('数据.csv'), readerText.replace(/\s+/g, ' ').slice(0, 200))
const frameText2 = await waitForFrameText((text) => text.includes('第二封邮件正文'))
check('附件邮件正文渲染', frameText2.includes('第二封邮件正文'), frameText2.replace(/\s+/g, ' ').slice(0, 90))
await page.screenshot({ path: join(shotDir, '05-reader-attachment.png') })

// 7. 写信：走界面真实发送，覆盖写信页里响应式数组跨 IPC 的序列化
await page.locator('button', { hasText: '写邮件' }).first().click()
await page.waitForTimeout(700)
const composeVisible = await page.evaluate(() => document.body.innerText.includes('发件账号'))
check('写信弹窗打开', composeVisible, '')
await page.fill('.dialog-panel input[data-field="to"]', 'peer@example.com')
await page.fill('.dialog-panel input[data-field="subject"]', '界面发信测试')
await page.fill('.dialog-panel textarea[data-field="body"]', '这封邮件是从界面发出的。')
await page.screenshot({ path: join(shotDir, '06-compose.png') })

const sentBefore = sentMessages.length
await page.locator('.dialog-panel button', { hasText: '发送' }).first().click()
for (let attempt = 0; attempt < 20; attempt += 1) {
  await page.waitForTimeout(500)
  if (sentMessages.length > sentBefore) break
}
const sentOk = sentMessages.length > sentBefore
const composeDialogText = await page.evaluate(
  () => document.querySelector('.dialog-panel')?.innerText?.replace(/\s+/g, ' ') ?? ''
)
check(
  '通过界面发信成功',
  sentOk,
  sentOk ? '本地 SMTP 服务器已收到' : composeDialogText.slice(0, 160)
)
check(
  '发信未出现 IPC 序列化错误',
  !composeDialogText.includes('could not be cloned'),
  composeDialogText.slice(0, 160) || '（弹窗已关闭）'
)

if (sentOk) {
  const received = await simpleParser(sentMessages[sentMessages.length - 1])
  check('发信主题正确', received.subject === '界面发信测试', received.subject ?? '')
  check(
    '发信正文正确',
    (received.text ?? '').includes('这封邮件是从界面发出的'),
    (received.text ?? '').slice(0, 40)
  )
  check(
    '发信收件人正确',
    received.to?.value?.[0]?.address === 'peer@example.com',
    JSON.stringify(received.to?.value)
  )
}
await page.waitForTimeout(600)

// 8. 账号设置弹窗
await page.locator('button[title="账号设置"]').first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: join(shotDir, '07-account-dialog.png') })
const dialogText = await page.evaluate(() => document.body.innerText)
check('账号设置弹窗打开', dialogText.includes('账号设置'), '')
const imapHostValue = await page.locator('input[data-field="imapHost"]').first().inputValue()
check('设置中回填 IMAP 地址', imapHostValue === '127.0.0.1', imapHostValue)
const localValue = await page.locator('.dialog-panel input[data-field="emailLocal"]').inputValue()
const domainValue = await page.locator('.dialog-panel input[data-field="emailDomain"]').inputValue()
check(
  '设置中回填邮箱地址（拆成两段）',
  `${localValue}@${domainValue}` === 'me@example.com',
  `${localValue}@${domainValue}`
)

const unexpectedErrors = consoleErrors.filter(
  (text) => !text.includes('tracker.example.com') && !text.includes('ERR_NAME_NOT_RESOLVED')
)
check('渲染层无非预期控制台错误', unexpectedErrors.length === 0, unexpectedErrors.join(' | '))
check('渲染层无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))

// 9. 菜单栏图标 / 系统通知 / Dock 角标
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.locator('aside button', { hasText: '设置' }).first().click()
await page.waitForSelector('.dialog-panel select[data-setting="syncWindow"]', { timeout: 8000 })

const settingsPanel = await page.evaluate(() => document.querySelector('.dialog-panel').innerText)
check('设置里有「新邮件时发送系统通知」', settingsPanel.includes('新邮件时发送系统通知'), '')
check('设置里有「在菜单栏常驻图标」', settingsPanel.includes('在菜单栏常驻图标'), '')
// 打个标记，用于判断渲染层是否被重载（重载会清掉它）
await page.evaluate(() => {
  window.__trayMarker = 'alive'
})

await page.locator('.dialog-panel button[data-setting="showTrayIcon"]').click()
await page.waitForTimeout(800)
const traySetting = await page.evaluate(() => window.api.settings.get())
check('菜单栏图标开关可持久化', traySetting.showTrayIcon === true, JSON.stringify(traySetting))

check(
  '系统通知在当前平台可用',
  (await app.evaluate(({ Notification }) => Notification.isSupported())) === true,
  ''
)

const unreadNow = await page.evaluate(() => window.api.mail.unread())
const badge = await app.evaluate(({ app }) => app.dock.getBadge())
check('Dock 角标等于未读总数', badge === String(unreadNow.total), `角标=${badge} 未读=${unreadNow.total}`)

const afterTrayState = await page.evaluate(() => ({
  marker: window.__trayMarker ?? '(丢失)',
  dialogs: document.querySelectorAll('.dialog-panel').length,
  hasToggle: Boolean(document.querySelector('.dialog-panel button[data-setting="showTrayIcon"]'))
}))
check(
  '开启菜单栏图标后渲染层未重载',
  afterTrayState.marker === 'alive',
  afterTrayState.marker
)
check(
  '开启菜单栏图标后设置弹窗仍打开',
  afterTrayState.hasToggle === true,
  `弹窗数=${afterTrayState.dialogs}`
)

// 关掉菜单栏图标，避免影响后续（也验证能关）
await page.locator('.dialog-panel button[data-setting="showTrayIcon"]').click()
await page.waitForTimeout(600)
check(
  '菜单栏图标开关可关闭',
  (await page.evaluate(() => window.api.settings.get())).showTrayIcon === false,
  ''
)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 10. 真实新邮件：用 IMAP APPEND 投一封，验证 IDLE 侦测、角标与提示
const beforeNewMail = (await page.evaluate(() => window.api.mail.unread())).total
const appendedRaw = await buildRaw({
  from: '"新邮件发件人" <newcomer@example.com>',
  to: 'me@example.com',
  subject: '新到的邮件',
  text: '这是一封刚刚投递进来的邮件。'
})

const appendClient = new ImapFlow({
  host: '127.0.0.1',
  port: imapPort,
  secure: true,
  auth: { user: 'me@example.com', pass: 'testpass' },
  // 测试进程没有 Electron 那侧的 NODE_TLS_REJECT_UNAUTHORIZED=0，
  // 这里只对这条连接放行自签证书
  tls: { rejectUnauthorized: false },
  logger: false
})
await appendClient.connect()
await appendClient.append('INBOX', appendedRaw, ['\\Unseen'])
await appendClient.logout()

let afterNewMail = beforeNewMail
for (let attempt = 0; attempt < 30; attempt += 1) {
  await page.waitForTimeout(1000)
  afterNewMail = (await page.evaluate(() => window.api.mail.unread())).total
  if (afterNewMail > beforeNewMail) break
}
check(
  '新邮件被 IDLE 侦测到并完成增量同步',
  afterNewMail > beforeNewMail,
  `未读 ${beforeNewMail} → ${afterNewMail}`
)

const badgeAfterNewMail = await app.evaluate(({ app }) => app.dock.getBadge())
check(
  'Dock 角标随新邮件更新',
  badgeAfterNewMail === String(afterNewMail),
  `角标=${badgeAfterNewMail} 未读=${afterNewMail}`
)

const newMailToast = await page.evaluate(() => document.body.innerText)
check('新邮件在应用内出现提示', newMailToast.includes('收到'), '')
await page.screenshot({ path: join(shotDir, '19-new-mail.png') })

await app.close()
await new Promise((resolve) => server.close(resolve))
await new Promise((resolve) => smtpServer.close(resolve))

const profileFiles = existsSync(profileDir) ? readdirSync(profileDir).length : 0
check('测试使用独立 profile，未污染真实数据', profileFiles > 0, profileDir)
rmSync(profileDir, { recursive: true, force: true })

printResults()
