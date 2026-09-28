import { Menu, Tray, nativeImage } from 'electron'
// 图标很小（<1KB），Vite 会内联成 data URL，因此不必处理开发/打包的路径差异。
// 1x 与 2x 必须分别注册为两个表示：只给 2x 图会被当成 32pt 渲染，
// 菜单栏里比邻居图标大一圈（正是「图标太大」反馈的根源）。
import trayTemplate1x from '../../resources/trayTemplate.png'
import trayTemplate2x from '../../resources/trayTemplate@2x.png'
import trayWindows1x from '../../resources/trayWindows.png'
import trayWindows2x from '../../resources/trayWindows@2x.png'

export interface TrayHandlers {
  onOpen: () => void
  onCompose: () => void
  onSync: () => void
  onQuit: () => void
}

let tray: Tray | null = null
let unread = 0
let handlers: TrayHandlers | null = null

function loadImage(one: string, two: string, isTemplate: boolean): Electron.NativeImage {
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 1, dataURL: one })
  image.addRepresentation({ scaleFactor: 2, dataURL: two })
  // 模板图是 macOS 专有能力（系统拿 alpha 当遮罩自动适配深浅色）。
  // Windows / Linux 不支持模板图，必须用彩色图标，否则深色任务栏上看不见。
  if (isTemplate) image.setTemplateImage(true)
  return image
}

function loadIcon(): Electron.NativeImage {
  const isMac = process.platform === 'darwin'
  return isMac
    ? loadImage(trayTemplate1x, trayTemplate2x, true)
    : loadImage(trayWindows1x, trayWindows2x, false)
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
