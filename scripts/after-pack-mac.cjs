/**
 * electron-builder afterPack 钩子：对打包出的 app 做 ad-hoc 重签名。
 *
 * identity=null 时 electron-builder 不重签 bundle，二进制沿用 Electron 原始的
 * linker 签名（Identifier=Electron），且包内容变化后签名校验直接损坏。
 * macOS 通知中心按签名身份注册应用——标识符不对，应用永远不会出现在
 * 「系统设置 → 通知」里，系统通知静默失败。ad-hoc 重签即可修复，无需开发者账号。
 *
 * 必须挂在 afterPack：此时 app 目录已就绪、DMG 还未打包，签名才能进产物。
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { execFileSync } = require('node:child_process')
  const { join } = require('node:path')
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`ad-hoc 重签：${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', appPath], { stdio: 'inherit' })
}
