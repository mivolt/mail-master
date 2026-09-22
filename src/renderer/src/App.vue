<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AboutDialog from './components/AboutDialog.vue'
import AccountDialog from './components/AccountDialog.vue'
import ComposeDialog from './components/ComposeDialog.vue'
import MessageList from './components/MessageList.vue'
import MessageReader from './components/MessageReader.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import Sidebar from './components/Sidebar.vue'
import TitleBar from './components/TitleBar.vue'
import ToastStack from './components/ToastStack.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import { useAccountsStore } from './stores/accounts'
import { useMailStore } from './stores/mail'
import { useSettingsStore } from './stores/settings'
import { useUiStore } from './stores/ui'

const accounts = useAccountsStore()
const mail = useMailStore()
const settings = useSettingsStore()
const ui = useUiStore()

let disposers: (() => void)[] = []

function onKeydown(event: KeyboardEvent): void {
  const meta = event.metaKey || event.ctrlKey

  if (event.key === 'Escape') {
    if (ui.composeOpen) {
      ui.closeCompose()
      event.preventDefault()
      return
    }
    if (ui.accountDialogOpen) {
      ui.closeAccountDialog()
      event.preventDefault()
      return
    }
    if (ui.aboutOpen) {
      ui.closeAbout()
      event.preventDefault()
      return
    }
    if (ui.settingsOpen) {
      ui.closeSettings()
      event.preventDefault()
      return
    }
  }

  if (!meta) return

  if (event.key === ',') {
    event.preventDefault()
    ui.openSettings()
    return
  }

  if (event.key === 'n') {
    event.preventDefault()
    ui.openCompose()
    return
  }

  if (event.key === 'r') {
    event.preventDefault()
    void mail.syncCurrent()
    return
  }

  if (event.key === 'j' || event.key === 'k') {
    event.preventDefault()
    const index = mail.items.findIndex((item) => item.id === mail.activeId)
    const nextIndex = event.key === 'j' ? index + 1 : index - 1
    const target = mail.items[nextIndex]
    if (target) void mail.openMessage(target)
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)

  await settings.load()
  await accounts.load()
  await mail.refresh()

  disposers = [
    window.api.events.onProgress((progress) => {
      mail.progress = progress
      if (progress.phase === 'done' || progress.phase === 'error') {
        mail.syncing = false
      } else {
        mail.syncing = true
      }
    }),
    window.api.events.onSyncDone(async (result) => {
      mail.syncing = false
      await accounts.load()
      await mail.refresh()
      if (result.error) ui.toast('error', `同步失败：${result.error}`)
    }),
    window.api.events.onNewMail(async (event) => {
      const account = accounts.accountById(event.accountId)
      ui.toast('info', `${account?.displayName ?? '账号'} 收到 ${event.count} 封新邮件`)
      await accounts.refreshUnread()
      await mail.refresh()
    }),
    // 系统通知被点击：切到该账号收件箱并打开那封邮件
    window.api.events.onOpenMessage(async (payload) => {
      const account = accounts.accountById(payload.accountId)
      await mail.setSelection({
        kind: 'inbox',
        accountId: payload.accountId,
        folderId: null,
        label: account?.displayName || account?.email || '收件箱'
      })
      await mail.openMessageById(payload.messageId)
    }),
    // 菜单栏图标里点了「写邮件」
    window.api.events.onComposeNew(() => ui.openCompose())
  ]
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  for (const dispose of disposers) dispose()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-bg">
    <TitleBar />
    <div class="flex min-h-0 flex-1">
      <Sidebar />
      <WelcomeScreen v-if="accounts.isEmpty" />
      <template v-else-if="accounts.initialized">
        <MessageList />
        <MessageReader />
      </template>
    </div>

    <ComposeDialog />
    <AccountDialog />
    <SettingsDialog />
    <AboutDialog />
    <ToastStack />
  </div>
</template>
