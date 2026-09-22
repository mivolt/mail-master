import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Account } from '@shared/types'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

export interface ComposeSeed {
  accountId?: number
  to?: string
  cc?: string
  subject?: string
  body?: string
}

export const useUiStore = defineStore('ui', () => {
  const composeOpen = ref(false)
  const composeSeed = ref<ComposeSeed>({})
  const accountDialogOpen = ref(false)
  const editingAccount = ref<Account | null>(null)
  const aboutOpen = ref(false)
  const settingsOpen = ref(false)
  const toasts = ref<Toast[]>([])
  let toastSeq = 0

  function toast(kind: ToastKind, text: string, timeout = 4200): void {
    toastSeq += 1
    const id = toastSeq
    toasts.value = [...toasts.value, { id, kind, text }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((item) => item.id !== id)
    }, timeout)
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }

  function openCompose(seed: ComposeSeed = {}): void {
    composeSeed.value = seed
    composeOpen.value = true
  }

  function closeCompose(): void {
    composeOpen.value = false
    composeSeed.value = {}
  }

  function openAccountDialog(account: Account | null = null): void {
    editingAccount.value = account
    accountDialogOpen.value = true
  }

  function closeAccountDialog(): void {
    accountDialogOpen.value = false
    editingAccount.value = null
  }

  function openAbout(): void {
    aboutOpen.value = true
  }

  function closeAbout(): void {
    aboutOpen.value = false
  }

  function openSettings(): void {
    settingsOpen.value = true
  }

  function closeSettings(): void {
    settingsOpen.value = false
  }

  return {
    composeOpen,
    composeSeed,
    accountDialogOpen,
    editingAccount,
    aboutOpen,
    settingsOpen,
    toasts,
    toast,
    dismissToast,
    openCompose,
    closeCompose,
    openAccountDialog,
    closeAccountDialog,
    openAbout,
    closeAbout,
    openSettings,
    closeSettings
  }
})
