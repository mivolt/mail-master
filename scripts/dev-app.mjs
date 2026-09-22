/**
 * 用固定 profile 启动应用，供你手动添加测试邮箱账号。
 *
 * 密码只会进入 macOS 系统钥匙串，不经过对话、不写入任何项目文件。
 * 添加完成后关掉窗口即可，接着跑 `npm run test:live` 做实测。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const profileDir = join(root, 'verify', 'dev-profile')
const executablePath = join(
  root,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
)

if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
  console.error('还没构建。请先执行：npm run build')
  process.exit(1)
}
if (!existsSync(executablePath)) {
  console.error(`找不到 Electron 可执行文件：${executablePath}`)
  console.error('请先执行：node node_modules/electron/install.js')
  process.exit(1)
}

mkdirSync(profileDir, { recursive: true })

console.log('='.repeat(64))
console.log('请在这个窗口里完成以下操作：')
console.log('  1. 点左下角「添加邮箱账号」')
console.log('  2. 填入测试邮箱地址，按界面上的编号步骤拿到授权码')
console.log('  3. 点「测试连接」确认通过，再点「添加账号」')
console.log('  4. 等收件箱同步出邮件，随便点开一封确认正文能正常显示')
console.log('  5. 关掉窗口（Cmd+Q）结束本步骤')
console.log('')
console.log('注意：首次由本脚本打开时，macOS 可能弹出钥匙串访问授权，')
console.log('      请选择「始终允许」，否则后面的实测脚本读不到凭据。')
console.log('')
console.log(`账号数据目录（独立于你的日常使用）：${profileDir}`)
console.log('='.repeat(64))
console.log('')

const child = spawn(executablePath, ['.', `--user-data-dir=${profileDir}`], {
  cwd: root,
  stdio: 'inherit'
})

child.on('exit', (code) => {
  console.log('')
  console.log('窗口已关闭。接下来执行：npm run test:live')
  process.exit(code ?? 0)
})
