import { Menu, Tray, nativeImage } from 'electron'
// 图标很小（<1KB），Vite 会内联成 data URL，因此不必处理开发/打包的路径差异
import trayTemplateIcon from '../../resources/trayTemplate@2x.png'
import trayWindowsIcon from '../../resources/trayWindows@2x.png'

export interface TrayHandlers {
  onOpen: () => void
  onCompose: () => void
  onSync: () => void
  onQuit: () => void
}

let tray: Tray | null = null
let unread = 0
let handlers: TrayHandlers | null = null

function loadIcon(): Electron.NativeImage {
  const isMac = process.platform === 'darwin'
  const source = isMac ? trayTemplateIcon : trayWindowsIcon
  const image = source.startsWith('data:')
    ? nativeImage.createFromDataURL(source)
    : nativeImage.createFromPath(source)
  // 模板图是 macOS 专有能力（系统拿 alpha 当遮罩自动适配深浅色）。
  // Windows 不支持模板图，必须用彩色图标，否则深色任务栏上看不见。
  if (isMac) image.setTemplateImage(true)
  return image
}

function buildMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: unread > 0 ? `${unread} 封未读` : '暂无未读', enabled: false },
    { type: 'separator' },
    { label: '打开 Mail Master', click: () => handlers?.onOpen() },
    { label: '写邮件', click: () => handlers?.onCompose() },
    { label: '立即同步', click: () => handlers?.onSync() },
    { type: 'separator' },
    { label: '退出 Mail Master', click: () => handlers?.onQuit() }
  ])
}

function refresh(): void {
  if (!tray) return
  // setTitle（图标旁显示文字）是 macOS 专有，Windows 上无效
  if (process.platform === 'darwin') {
    tray.setTitle(unread > 0 ? ` ${unread > 99 ? '99+' : unread}` : '')
  }
  tray.setToolTip(unread > 0 ? `Mail Master · ${unread} 封未读` : 'Mail Master')
  tray.setContextMenu(buildMenu())
}

export function isTrayVisible(): boolean {
  return tray !== null
}

export function showTray(next: TrayHandlers): void {
  handlers = next
  if (tray) return
  try {
    tray = new Tray(loadIcon())
    tray.on('click', () => handlers?.onOpen())
    refresh()
  } catch {
    // 菜单栏图标创建失败（如图标资源异常）不应影响应用本身
    tray = null
  }
}

export function hideTray(): void {
  tray?.destroy()
  tray = null
}

export function updateTrayUnread(count: number): void {
  unread = count
  refresh()
}
