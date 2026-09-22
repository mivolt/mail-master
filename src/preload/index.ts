import { contextBridge, ipcRenderer } from 'electron'
import { CH, EV } from '@shared/channels'
import type { MailMasterApi, OutgoingAttachment, Unsubscribe } from '@shared/api'
import type { AppSettings } from '@shared/settings'
import type {
  Account,
  AccountInput,
  AppInfo,
  DiagReport,
  Folder,
  ListQuery,
  MessageDetail,
  MessageMeta,
  NewMailEvent,
  OpenMessageEvent,
  SendInput,
  SendResult,
  StorageInfo,
  SyncProgress,
  SyncResult,
  TestResult,
  UnreadSummary
} from '@shared/types'

/**
 * Vue 的响应式对象是 Proxy，结构化克隆处理不了，直接传进 IPC 会得到
 * "An object could not be cloned."。在桥这一层统一转成普通数据，
 * 免得每个调用点都要记得 toRaw —— 漏一个就是一个只在界面上才暴露的 bug。
 */
function toPlain(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

/**
 * Electron 会把主进程抛出的错误包成
 * "Error invoking remote method '<channel>': Error: <原始信息>"，
 * 直接把 message 展示给用户会带上这串噪音前缀，这里剥掉。
 */
function cleanIpcError(error: unknown, channel: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  const prefix = `Error invoking remote method '${channel}': `
  const withoutPrefix = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  return withoutPrefix.replace(/^Error:\s*/, '')
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer
    .invoke(channel, ...args.map(toPlain))
    .catch((error: unknown) => {
      throw new Error(cleanIpcError(error, channel))
    }) as Promise<T>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: MailMasterApi = {
  app: {
    // 沙箱化 preload 里 process.platform 可用；同步暴露，界面无需 await
    platform: process.platform,
    info: (): Promise<AppInfo> => invoke(CH.appInfo),
    openExternal: (url: string): Promise<void> => invoke(CH.appOpenExternal, url),
    storageInfo: (): Promise<StorageInfo> => invoke(CH.appStorageInfo),
    openDataDir: (): Promise<void> => invoke(CH.appOpenDataDir),
    clearData: (): Promise<boolean> => invoke(CH.appClearData)
  },
  settings: {
    get: (): Promise<AppSettings> => invoke(CH.settingsGet),
    set: (key: string, value: string): Promise<AppSettings> => invoke(CH.settingsSet, key, value)
  },
  diag: {
    run: (input: AccountInput): Promise<DiagReport> => invoke(CH.diagRun, input),
    runAccount: (accountId: number): Promise<DiagReport> => invoke(CH.diagRunAccount, accountId),
    copy: (text: string): Promise<void> => invoke(CH.diagCopy, text)
  },
  accounts: {
    list: (): Promise<Account[]> => invoke(CH.accountsList),
    add: (input: AccountInput): Promise<Account> => invoke(CH.accountsAdd, input),
    update: (id: number, patch: Partial<AccountInput>): Promise<Account> =>
      invoke(CH.accountsUpdate, id, patch),
    remove: (id: number): Promise<void> => invoke(CH.accountsRemove, id),
    test: (input: AccountInput): Promise<TestResult> => invoke(CH.accountsTest, input),
    folders: (accountId: number): Promise<Folder[]> => invoke(CH.foldersList, accountId)
  },
  mail: {
    list: (query: ListQuery): Promise<{ items: MessageMeta[]; total: number }> =>
      invoke(CH.mailList, query),
    get: (id: number, blockImages: boolean): Promise<MessageDetail | null> =>
      invoke(CH.mailGet, id, blockImages),
    setRead: (id: number, read: boolean): Promise<UnreadSummary> =>
      invoke(CH.mailSetRead, id, read),
    setStarred: (id: number, starred: boolean): Promise<boolean> =>
      invoke(CH.mailSetStarred, id, starred),
    sync: (accountId?: number): Promise<SyncResult[]> => invoke(CH.mailSync, accountId),
    syncFolder: (accountId: number, folderId: number): Promise<number> =>
      invoke(CH.mailSyncFolder, accountId, folderId),
    unread: (): Promise<UnreadSummary> => invoke(CH.mailUnread),
    openAttachment: (id: number): Promise<string> => invoke(CH.attachmentOpen, id),
    saveAttachmentAs: (id: number): Promise<string | null> => invoke(CH.attachmentSaveAs, id)
  },
  compose: {
    pickFiles: (): Promise<OutgoingAttachment[]> => invoke(CH.composePickFiles),
    send: (input: SendInput): Promise<SendResult> => invoke(CH.composeSend, input)
  },
  events: {
    onProgress: (cb: (payload: SyncProgress) => void): Unsubscribe => subscribe(EV.progress, cb),
    onNewMail: (cb: (payload: NewMailEvent) => void): Unsubscribe => subscribe(EV.newMail, cb),
    onSyncDone: (cb: (payload: SyncResult) => void): Unsubscribe => subscribe(EV.syncDone, cb),
    onOpenMessage: (cb: (payload: OpenMessageEvent) => void): Unsubscribe =>
      subscribe(EV.openMessage, cb),
    onComposeNew: (cb: () => void): Unsubscribe => subscribe<undefined>(EV.composeNew, () => cb())
  }
}

contextBridge.exposeInMainWorld('api', api)
