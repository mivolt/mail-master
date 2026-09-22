import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { EV } from '@shared/channels'
import { applyLaunchAtLogin } from './autostart'
import { closeDatabase, initDatabase } from './db'
import { readSettings } from './db/settings'
import { attachEngineHooks, attachmentsDirFor, refreshUnreadIndicators, registerIpc } from './ipc'
import { MailEngine } from './mail/engine'
import { initVault } from './security/vault'
import { hideTray, showTray } from './tray'

let mainWindow: BrowserWindow | null = null
let engine: MailEngine | null = null
let quitting = false

/** 从菜单栏或通知唤回主窗口；窗口已被关闭时重新创建 */
function openMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function applyTraySetting(): void {
  if (!readSettings().showTrayIcon) {
    hideTray()
    return
  }
  showTray({
    onOpen: openMainWindow,
    onCompose: () => {
      openMainWindow()
      mainWindow?.webContents.send(EV.composeNew)
    },
    onSync: () => {
      void engine?.syncAll()
    },
    onQuit: () => app.quit()
  })
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    // macOS 隐藏系统标题栏，用窗口内的自定义标题栏（红绿灯浮在左侧）。
    // Windows 保留系统标题栏：最小化/最大化/关闭由系统提供，行为最可预期，
    // 也免去自己实现窗口控制按钮的坑。
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (url === current) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (is.dev) optimizer.watchWindowShortcuts(mainWindow)

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function bootstrap(): void {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.mailmaster.desktop')

    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false)
    })

    const userDataDir = app.getPath('userData')
    initDatabase(userDataDir)
    initVault()
    applyLaunchAtLogin(readSettings().launchAtLogin)

    const attachmentsDir = attachmentsDirFor(userDataDir)
    engine = new MailEngine(attachmentsDir)
    const ctx = {
      engine,
      getWindow: (): BrowserWindow | null => mainWindow,
      userDataDir,
      attachmentsDir,
      onSettingsChanged: (key: string): void => {
        if (key !== 'showTrayIcon') return
        applyTraySetting()
        refreshUnreadIndicators(mainWindow)
      }
    }
    registerIpc(ctx)
    attachEngineHooks(ctx)

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    applyTraySetting()
    refreshUnreadIndicators(mainWindow)
    engine.startAll()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  bootstrap()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void (async () => {
    try {
      hideTray()
      await engine?.stopAll()
    } finally {
      closeDatabase()
      app.quit()
    }
  })()
})
