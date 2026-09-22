import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Account, AccountInput, Folder, UnreadSummary } from '@shared/types'
import { plain } from '../lib/plain'

export const useAccountsStore = defineStore('accounts', () => {
  const list = ref<Account[]>([])
  const folders = ref<Record<number, Folder[]>>({})
  const unread = ref<UnreadSummary>({ total: 0, byAccount: {}, allFolders: 0 })
  const expanded = ref<Record<number, boolean>>({})
  const loading = ref(false)
  /** 首次加载完成前不渲染空状态，避免闪一下三栏布局再跳到欢迎页 */
  const initialized = ref(false)

  const isEmpty = computed(() => initialized.value && list.value.length === 0)

  function accountById(id: number | null): Account | undefined {
    if (id === null) return undefined
    return list.value.find((account) => account.id === id)
  }

  async function load(): Promise<void> {
    loading.value = true
    try {
      list.value = await window.api.accounts.list()
      const entries = await Promise.all(
        list.value.map(
          async (account) =>
            [account.id, await window.api.accounts.folders(account.id)] as const
        )
      )
      folders.value = Object.fromEntries(entries)
      unread.value = await window.api.mail.unread()
      for (const account of list.value) {
        if (expanded.value[account.id] === undefined) expanded.value[account.id] = false
      }
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  async function reloadFolders(accountId: number): Promise<void> {
    folders.value[accountId] = await window.api.accounts.folders(accountId)
  }

  async function refreshUnread(): Promise<void> {
    unread.value = await window.api.mail.unread()
  }

  async function add(input: AccountInput): Promise<Account> {
    // input 可能是表单的响应式对象，必须转普通数据再跨 IPC
    const account = await window.api.accounts.add(plain(input))
    await load()
    expanded.value[account.id] = true
    return account
  }

  async function update(id: number, patch: Partial<AccountInput>): Promise<Account> {
    const account = await window.api.accounts.update(id, plain(patch))
    await load()
    return account
  }

  async function remove(id: number): Promise<void> {
    await window.api.accounts.remove(id)
    delete expanded.value[id]
    await load()
  }

  function toggleExpanded(id: number): void {
    expanded.value[id] = !expanded.value[id]
  }

  function unreadOf(accountId: number): number {
    return unread.value.byAccount[accountId] ?? 0
  }

  return {
    list,
    folders,
    unread,
    expanded,
    loading,
    initialized,
    isEmpty,
    accountById,
    load,
    reloadFolders,
    refreshUnread,
    add,
    update,
    remove,
    toggleExpanded,
    unreadOf
  }
})
