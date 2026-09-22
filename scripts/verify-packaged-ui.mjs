/**
 * 按真实界面路径添加账号，验证打包产物（或开发构建）能真正用起来。
 *
 *   MM_TEST_EMAIL=... MM_TEST_SECRET=... node scripts/verify-packaged-ui.mjs [app路径]
 *
 * 不传路径则用开发构建（out/），传 .app 路径则测打包产物。
 * 默认用独立临时 userData；传 MM_USE_REAL_PROFILE=1 则用打包应用的真实数据目录。
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = process.cwd()
const appPath = process.argv[2]
const executablePath = appPath
  ? join(appPath, 'Contents/MacOS/Mail Master')
  : join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')

const email = process.env.MM_TEST_EMAIL
const secret = process.env.MM_TEST_SECRET
if (!email || !secret) {
  console.error('需要 MM_TEST_EMAIL 与 MM_TEST_SECRET')
  process.exit(1)
}

const useRealProfile = process.env.MM_USE_REAL_PROFILE === '1'
const profileDir = useRealProfile
  ? join(process.env.HOME ?? '', 'Library', 'Application Support', 'Mail Master')
  : join(tmpdir(), `mail-master-ui-verify-${Date.now()}`)
if (!useRealProfile) mkdirSync(profileDir, { recursive: true })

console.log(`应用：${appPath ?? '开发构建 out/'}`)
console.log(`userData：${profileDir}${useRealProfile ? '（真实目录）' : '（临时目录）'}`)
if (useRealProfile && existsSync(join(profileDir, 'mail-master.db'))) {
  console.log('提示：该目录已有数据库，若账号已存在会直接报「已存在」')
}

const app = await electron.launch({
  executablePath,
  args: appPath ? [`--user-data-dir=${profileDir}`] : ['.', `--user-data-dir=${profileDir}`],
  cwd: root,
  env: { ...process.env, ...(appPath ? {} : { NODE_ENV: 'production' }) }
})

const page = await app.firstWindow()
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`[pageerror] ${error.message}`))

await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2000)

const existing = await page.evaluate(() => window.api.accounts.list())
console.log(`现有账号：${existing.map((item) => item.email).join(', ') || '(无)'}`)

// 走界面：点「添加邮箱账号」→ 选服务商 → 只填 @ 前面 → 填授权码 → 点「添加账号」
await page.locator('button', { hasText: '添加邮箱账号' }).first().click()
await page.waitForTimeout(700)
await page.locator('.dialog-panel button[data-provider="163"]').click()
await page.waitForTimeout(400)
// 只输入 @ 之前的部分，域名由服务商带出
await page
  .locator('.dialog-panel input[data-field="emailLocal"]')
  .pressSequentially(email.split('@')[0], { delay: 25 })
await page.waitForTimeout(500)
await page.fill('.dialog-panel input[data-field="secret"]', secret)
await page.waitForTimeout(300)

const beforeClick = await page.evaluate(() => {
  const panel = document.querySelector('.dialog-panel')
  return {
    passwordLabel: panel.innerText.includes('授权码') ? '授权码' : '其它',
    guideTrigger: panel.innerText.includes('怎么拿到'),
    username: panel.querySelector('input[data-field="username"]')?.value ?? '(无字段)',
    advancedOpen: [...panel.querySelectorAll('.folder-expand')].map((element) =>
      element.getAttribute('data-open')
    )
  }
})
console.log(`界面状态：密码栏标签=${beforeClick.passwordLabel} 帮助入口=${beforeClick.guideTrigger}`)
console.log(`拼出的用户名=${beforeClick.username}`)
console.log(`折叠区状态：${JSON.stringify(beforeClick.advancedOpen)}`)

await page.locator('.dialog-panel button', { hasText: '添加账号' }).first().click()
await page.waitForTimeout(9000)

const after = await page.evaluate(() => {
  const alert = document.querySelector('.dialog-panel .alert-error')
  const panel = document.querySelector('.dialog-panel')
  return {
    dialogStillOpen: Boolean(document.querySelector('.dialog-panel')),
    errorTitle: alert?.querySelector('.alert-error__title')?.textContent?.trim() ?? '',
    errorBody: alert?.querySelector('.alert-error__body')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    toast: [...document.querySelectorAll('div')]
      .map((element) => element.textContent?.trim() ?? '')
      .filter((text) => text.includes('已添加') || text.includes('失败'))
      .slice(0, 3),
    panelText: panel?.innerText?.replace(/\s+/g, ' ').slice(0, 300) ?? ''
  }
})

console.log('')
console.log('--- 结果 ---')
console.log(`弹窗是否仍打开：${after.dialogStillOpen}`)
if (after.errorTitle) console.log(`错误标题：${after.errorTitle}`)
if (after.errorBody) console.log(`错误内容：${after.errorBody}`)
console.log(`弹窗文本：${after.panelText}`)

const accountsAfter = await page.evaluate(() => window.api.accounts.list())
console.log(`添加后账号：${accountsAfter.map((item) => `${item.email}(id=${item.id})`).join(', ') || '(无)'}`)

// 确认打包产物能真正连上 IMAP 并同步
if (accountsAfter.length > 0) {
  const syncResults = await page.evaluate(() => window.api.mail.sync())
  const syncError = syncResults.find((item) => item.error)?.error
  if (syncError) {
    console.log(`FAIL  同步失败  → ${syncError}`)
  } else {
    const folders = await page.evaluate(() => window.api.accounts.folders(1))
    const list = await page.evaluate(() => window.api.mail.list({ limit: 5 }))
    console.log(`PASS  打包产物同步成功  → 文件夹 ${folders.length} 个，收件箱 ${list.total} 封`)
  }
}

if (consoleErrors.length) console.log(`控制台错误：${consoleErrors.join(' | ')}`)

await page.screenshot({ path: join(root, 'verify', '17-packaged-add.png') })
await app.close()
if (!useRealProfile) rmSync(profileDir, { recursive: true, force: true })
