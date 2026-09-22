import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = process.cwd()
const shotDir = join(root, 'verify')
mkdirSync(shotDir, { recursive: true })

const executablePath = join(
  root,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
)

const app = await electron.launch({
  executablePath,
  args: ['.'],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'production' }
})

const page = await app.firstWindow()
const consoleErrors = []
const pageErrors = []

page.on('console', (message) => {
  const type = message.type()
  if (type === 'error' || type === 'warning') {
    consoleErrors.push(`[${type}] ${message.text()}`)
  }
})
page.on('pageerror', (error) => {
  pageErrors.push(error.message)
})

await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(2500)

const report = {
  title: await page.title(),
  hasApi: await page.evaluate(() => typeof window.api === 'object'),
  hasAccountsApi: await page.evaluate(() => typeof window.api?.accounts?.list === 'function'),
  sidebarText: (await page.locator('aside').first().innerText()).replace(/\s+/g, ' ').trim(),
  topbarText: (await page.locator('header').first().innerText()).replace(/\s+/g, ' ').trim(),
  listHeader: (await page.locator('section').first().innerText()).replace(/\s+/g, ' ').trim(),
  readerText: (await page.locator('section').nth(1).innerText()).replace(/\s+/g, ' ').trim(),
  appInfo: await page.evaluate(() => window.api.app.info()),
  consoleErrors,
  pageErrors
}

await page.screenshot({ path: join(shotDir, '01-empty-state.png') })

console.log(JSON.stringify(report, null, 2))

await app.close()
