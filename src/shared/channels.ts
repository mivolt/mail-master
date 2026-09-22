export const CH = {
  accountsList: 'accounts:list',
  accountsAdd: 'accounts:add',
  accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove',
  accountsTest: 'accounts:test',
  foldersList: 'folders:list',
  mailList: 'mail:list',
  mailGet: 'mail:get',
  mailSetRead: 'mail:setRead',
  mailSetStarred: 'mail:setStarred',
  mailSync: 'mail:sync',
  mailSyncFolder: 'mail:syncFolder',
  mailUnread: 'mail:unread',
  attachmentOpen: 'attachment:open',
  attachmentSaveAs: 'attachment:saveAs',
  composePickFiles: 'compose:pickFiles',
  composeSend: 'compose:send',
  appInfo: 'app:info',
  appOpenExternal: 'app:openExternal',
  appStorageInfo: 'app:storageInfo',
  appOpenDataDir: 'app:openDataDir',
  appClearData: 'app:clearData',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  diagRun: 'diag:run',
  diagRunAccount: 'diag:runAccount',
  diagCopy: 'diag:copy'
} as const

export const EV = {
  progress: 'ev:sync-progress',
  newMail: 'ev:new-mail',
  syncDone: 'ev:sync-done'
} as const
