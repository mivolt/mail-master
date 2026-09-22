import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ListQuery, MessageDetail, MessageMeta, SyncProgress } from '@shared/types'
import { useAccountsStore } from './accounts'
import { useSettingsStore } from './settings'
import { plain } from '../lib/plain'

export type SelectionKind = 'unified' | 'inbox' | 'folder' | 'unread'

export interface Selection {
  kind: SelectionKind
  accountId: number | null
  folderId: number | null
  label: string
}

const PAGE_SIZE = 60

export const useMailStore = defineStore('mail', () => {
  const selection = ref<Selection>({
    kind: 'unified',
    accountId: null,
    folderId: null,
    label: '所有收件箱'
  })
  const items = ref<MessageMeta[]>([])
  const total = ref(0)
  const keyword = ref('')
  const unreadOnly = ref(false)
  const starredOnly = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const active = ref<MessageDetail | null>(null)
  const activeLoading = ref(false)
  const blockImages = ref(true)
  const progress = ref<SyncProgress | null>(null)
  const syncing = ref(false)

  const hasMore = computed(() => items.value.length < total.value)
  const activeId = computed(() => active.value?.id ?? null)

  /** 当前视图是否跨文件夹——跨文件夹时要标出每封邮件来自哪个文件夹 */
  const spansFolders = computed(() => selection.value.kind === 'unread')

  function buildQuery(offset: number): ListQuery {
    const trimmed = keyword.value.trim()
    const current = selection.value
    const isUnreadView = current.kind === 'unread'
    return {
      accountId: current.accountId,
      folderId: current.folderId,
      folderScope: isUnreadView ? 'allFolders' : 'inbox',
      keyword: trimmed || undefined,
      // 「所有未读」视图本身就限定未读，不叠加列表内的筛选条件
      unreadOnly: isUnreadView ? true : unreadOnly.value || undefined,
      starredOnly: isUnreadView ? undefined : starredOnly.value || undefined,
      limit: PAGE_SIZE,
      offset
    }
  }

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const result = await window.api.mail.list(plain(buildQuery(0)))
      items.value = result.items
      total.value = result.total
      if (active.value && !result.items.some((item) => item.id === active.value?.id)) {
        active.value = null
      }
    } finally {
      loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const result = await window.api.mail.list(plain(buildQuery(items.value.length)))
      const seen = new Set(items.value.map((item) => item.id))
      items.value = [...items.value, ...result.items.filter((item) => !seen.has(item.id))]
      total.value = result.total
    } finally {
      loadingMore.value = false
    }
  }

  async function setSelection(next: Selection): Promise<void> {
    selection.value = next
    active.value = null
    await refresh()
  }

  async function applyFilters(): Promise<void> {
    await refresh()
  }

  async function openMessage(meta: MessageMeta): Promise<void> {
    const wasUnread = !meta.isRead
    activeLoading.value = true
    // 默认是否加载远程图片跟随设置，单封邮件上仍可临时放行
    blockImages.value = useSettingsStore().blockRemoteImages
    try {
      const detail = await window.api.mail.get(meta.id, true)
      active.value = detail
      const row = items.value.find((item) => item.id === meta.id)
      if (row && detail) {
        row.isRead = true
        row.hasAttachments = detail.attachments.length > 0
      }
      if (wasUnread) {
        await useAccountsStore().refreshUnread()
      }
    } finally {
      activeLoading.value = false
    }
  }

  async function reloadActive(): Promise<void> {
    if (!active.value) return
    activeLoading.value = true
    try {
      const detail = await window.api.mail.get(active.value.id, blockImages.value)
      if (detail) active.value = detail
    } finally {
      activeLoading.value = false
    }
  }

  async function showImages(): Promise<void> {
    if (!active.value) return
    blockImages.value = false
    activeLoading.value = true
    try {
      const detail = await window.api.mail.get(active.value.id, false)
      if (detail) active.value = detail
    } finally {
      activeLoading.value = false
    }
  }

  async function toggleStar(meta: MessageMeta): Promise<void> {
    const next = !meta.isStarred
    meta.isStarred = next
    await window.api.mail.setStarred(meta.id, next)
    if (active.value?.id === meta.id) active.value = { ...active.value, isStarred: next }
    if (starredOnly.value && !next) {
      items.value = items.value.filter((item) => item.id !== meta.id)
      total.value = Math.max(0, total.value - 1)
    }
  }

  async function markRead(meta: MessageMeta, read: boolean): Promise<void> {
    meta.isRead = read
    if (active.value?.id === meta.id) active.value = { ...active.value, isRead: read }
    const summary = await window.api.mail.setRead(meta.id, read)
    useAccountsStore().unread = summary
    if (unreadOnly.value && read) {
      items.value = items.value.filter((item) => item.id !== meta.id)
      total.value = Math.max(0, total.value - 1)
    }
  }

  function clearActive(): void {
    active.value = null
  }

  async function syncCurrent(): Promise<void> {
    syncing.value = true
    try {
      await window.api.mail.sync(selection.value.accountId ?? undefined)
      await refresh()
    } finally {
      syncing.value = false
      progress.value = null
    }
  }

  async function syncFolderIfEmpty(): Promise<void> {
    const { accountId, folderId } = selection.value
    if (accountId === null || folderId === null) return
    if (items.value.length > 0) return
    await window.api.mail.syncFolder(accountId, folderId)
    await refresh()
  }

  return {
    selection,
    items,
    total,
    keyword,
    unreadOnly,
    starredOnly,
    loading,
    loadingMore,
    active,
    activeId,
    activeLoading,
    blockImages,
    progress,
    syncing,
    hasMore,
    spansFolders,
    refresh,
    loadMore,
    setSelection,
    applyFilters,
    openMessage,
    reloadActive,
    showImages,
    toggleStar,
    markRead,
    clearActive,
    syncCurrent,
    syncFolderIfEmpty
  }
})
