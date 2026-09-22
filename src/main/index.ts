import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { applyLaunchAtLogin } from './autostart'
import { closeDatabase, initDatabase } from './db'
import { readSettings } from './db/settings'
import { attachEngineHooks, attachmentsDirFor, registerIpc } from './ipc'
import { MailEngine } from './mail/engine'
import { initVault } from './security/vault'

let mainWindow: BrowserWindow | null = null
let engine: MailEngine | null = null
let quitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
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
      attachmentsDir
    }
    registerIpc(ctx)
    attachEngineHooks(ctx)

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

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
      await engine?.stopAll()
    } finally {
      closeDatabase()
      app.quit()
    }
  })()
})
