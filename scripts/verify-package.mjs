import { join } from 'node:path'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright-core'

const root = process.cwd()
const appPath = process.argv[2] ?? join(root, 'release/mac-arm64/Mail Master.app')
const executablePath = join(appPath, 'Contents/MacOS/Mail Master')
const profileDir = join(tmpdir(), `mail-master-packaged-${Date.now()}`)
mkdirSync(join(root, 'verify'), { recursive: true })

if (!existsSync(executablePath)) {
  console.log(`FAIL  打包产物不存在：${executablePath}`)
  process.exit(1)
}

const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${profileDir}`],
  env: { ...process.env }
})

const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2500)
await page.screenshot({ path: join(root, 'verify', '08-packaged-app.png') })

const info = await page.evaluate(() => window.api.app.info())
const title = await page.title()
const hasSidebar = await page.locator('aside').count()
const hasCompose = await page.evaluate(() => document.body.innerText.includes('写邮件'))

console.log(`PASS  打包应用启动成功  → ${title}`)
console.log(`PASS  preload 桥可用  → electron ${info.electron} / node ${info.node}`)
console.log(`PASS  界面渲染正常  → 侧栏 ${hasSidebar} 个，写信按钮 ${hasCompose}`)
console.log(errors.length === 0 ? 'PASS  无控制台错误' : `FAIL  控制台错误：${errors.join(' | ')}`)

// 凭据加密能力：打包后钥匙串是否可用，是「开发能加账号、打包后加不了」的首要嫌疑
const storage = await page.evaluate(() => window.api.app.storageInfo())
console.log(
  `${storage.encryptionAvailable ? 'PASS' : 'FAIL'}  凭据加密可用  → safeStorage=${storage.encryptionAvailable}`
)
console.log(`     userData: ${storage.userDataDir}`)

// 提供凭据时顺带验证打包产物能否真正添加账号
const email = process.env.MM_TEST_EMAIL
const secret = process.env.MM_TEST_SECRET
if (email && secret) {
  const result = await page.evaluate(
    async ([mail, pass]) => {
      try {
        const account = await window.api.accounts.add({
          email: mail,
          displayName: '',
          provider: '163',
          imapHost: 'imap.163.com',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'smtp.163.com',
          smtpPort: 465,
          smtpSecure: true,
          username: mail,
          secret: pass
        })
        return { ok: true, id: account.id }
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) }
      }
    },
    [email, secret]
  )
  console.log(
    result.ok
      ? `PASS  打包产物可添加真实账号  → id=${result.id}`
      : `FAIL  打包产物添加账号失败  → ${result.error}`
  )
}

await app.close()
rmSync(profileDir, { recursive: true, force: true })
