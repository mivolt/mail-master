import { app } from 'electron'

/**
 * 开机自启。
 *
 * 开发环境不注册：此时登录项会指向 node_modules 里的 Electron 二进制，
 * 在用户机器上留下一个指向开发目录的登录项既没用也不好清理。
 * 打包后才会真正写入。
 */
export function applyLaunchAtLogin(enabled: boolean): void {
  if (process.platform !== 'darwin') return
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } catch {
    // 写入登录项失败不应影响应用本身
  }
}
