import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'

/**
 * 未读角标。
 *
 * macOS 用 Dock 角标（支持文字）；Windows 没有对应能力，改用任务栏叠加图标，
 * 而叠加图标只能给图片——主进程没有 canvas，无法运行时绘制文字，
 * 所以数字是预先出图放在 resources/badges/ 下的。
 */
const badgeAssets = import.meta.glob('../../resources/badges/*.png', {
  eager: true,
  import: 'default'
}) as Record<string, string>

function loadImage(source: string): NativeImage {
  return source.startsWith('data:')
    ? nativeImage.createFromDataURL(source)
    : nativeImage.createFromPath(source)
}

function overlayImage(count: number): NativeImage | null {
  const key = count >= 10 ? '9plus' : String(count)
  const entry = Object.entries(badgeAssets).find(([path]) => path.endsWith(`badge-${key}.png`))
  return entry ? loadImage(entry[1]) : null
}

export function applyBadge(window: BrowserWindow | null, count: number): void {
  if (process.platform === 'darwin') {
    app.dock?.setBadge(count > 0 ? String(count) : '')
    return
  }

  if (process.platform === 'win32') {
    if (!window || window.isDestroyed()) return
    if (count <= 0) {
      window.setOverlayIcon(null, '')
      return
    }
    const image = overlayImage(count)
    if (image) window.setOverlayIcon(image, `${count} 封未读`)
  }
}
