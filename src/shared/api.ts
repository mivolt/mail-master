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
} from './types'
import type { AppSettings } from './settings'

export interface OutgoingAttachment {
  filename: string
  path: string
}

export type Unsubscribe = () => void

export interface MailMasterApi {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    storageInfo(): Promise<StorageInfo>
    openDataDir(): Promise<void>
    clearData(): Promise<boolean>
  }
  settings: {
    get(): Promise<AppSettings>
    set(key: string, value: string): Promise<AppSettings>
  }
  diag: {
    run(input: AccountInput): Promise<DiagReport>
    runAccount(accountId: number): Promise<DiagReport>
    copy(text: string): Promise<void>
  }
  accounts: {
    list(): Promise<Account[]>
    add(input: AccountInput): Promise<Account>
    update(id: number, patch: Partial<AccountInput>): Promise<Account>
    remove(id: number): Promise<void>
    test(input: AccountInput): Promise<TestResult>
    folders(accountId: number): Promise<Folder[]>
  }
  mail: {
    list(query: ListQuery): Promise<{ items: MessageMeta[]; total: number }>
    get(id: number, blockImages: boolean): Promise<MessageDetail | null>
    setRead(id: number, read: boolean): Promise<UnreadSummary>
    setStarred(id: number, starred: boolean): Promise<boolean>
    sync(accountId?: number): Promise<SyncResult[]>
    syncFolder(accountId: number, folderId: number): Promise<number>
    unread(): Promise<UnreadSummary>
    openAttachment(id: number): Promise<string>
    saveAttachmentAs(id: number): Promise<string | null>
  }
  compose: {
    pickFiles(): Promise<OutgoingAttachment[]>
    send(input: SendInput): Promise<SendResult>
  }
  events: {
    onProgress(cb: (payload: SyncProgress) => void): Unsubscribe
    onNewMail(cb: (payload: NewMailEvent) => void): Unsubscribe
    onSyncDone(cb: (payload: SyncResult) => void): Unsubscribe
    /** 系统通知被点击：要求打开指定邮件 */
    onOpenMessage(cb: (payload: OpenMessageEvent) => void): Unsubscribe
    /** 菜单栏图标里点了「写邮件」 */
    onComposeNew(cb: () => void): Unsubscribe
  }
}
