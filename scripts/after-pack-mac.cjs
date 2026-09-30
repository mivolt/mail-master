/**
 * electron-builder afterPack 钩子：裁剪 + ad-hoc 重签。
 *
 * 1) 裁掉用不到的 Chromium 多语言包（16 种 → 只留中英文），
 *    解包约省 20MB、DMG 约省 12MB，应用本体没有任何功能损失。
 * 2) identity=null 时 electron-builder 不重签 bundle，二进制沿用 Electron 原始的
 *    linker 签名（Identifier=Electron），且包内容变化后签名校验直接损坏。
 *    macOS 通知中心按签名身份注册应用——标识符不对，应用永远不会出现在
 *    「系统设置 → 通知」里，系统通知静默失败。ad-hoc 重签即可修复，无需开发者账号。
 *
 * 顺序：先裁剪后签名，保证签名覆盖裁剪后的最终内容；DMG 在本钩子之后才打包。
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { execFileSync } = require('node:child_process')
  const { existsSync, readdirSync, rmSync, statSync } = require('node:fs')
  const { join } = require('node:path')

  // ---- 1) 裁剪多语言包 ----
  const KEEP_LPROJ = new Set(['en.lproj', 'zh_CN.lproj'])
  let removed = 0
  let freed = 0
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name.endsWith('.lproj')) {
          if (!KEEP_LPROJ.has(name)) {
            freed += statSync(full).size
            rmSync(full, { recursive: true, force: true })
            removed += 1
          }
        } else {
          walk(full)
        }
      }
    }
  }
  walk(context.appOutDir)
  console.log(`裁剪多语言包：移除 ${removed} 个 .lproj`)

  // ---- 2) ad-hoc 重签 ----
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!existsSync(appPath)) throw new Error(`未找到应用包：${appPath}`)
  console.log(`ad-hoc 重签：${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', appPath], { stdio: 'inherit' })
}
