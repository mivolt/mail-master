<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { useAccountsStore } from '../stores/accounts'
import { useMailStore, type Selection } from '../stores/mail'
import { useUiStore } from '../stores/ui'
import { folderIconName, folderRank } from '../lib/format'
import type { Folder } from '@shared/types'

const accounts = useAccountsStore()
const mail = useMailStore()
const ui = useUiStore()

const unifiedCount = computed(() => accounts.unread.total)
const unreadAllCount = computed(() => accounts.unread.allFolders)

function sortedFolders(accountId: number): Folder[] {
  const list = accounts.folders[accountId] ?? []
  return [...list].sort((a, b) => {
    const rank = folderRank(a.specialUse, a.path) - folderRank(b.specialUse, b.path)
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

function isActive(target: Partial<Selection>): boolean {
  const current = mail.selection
  // 所有收件箱与所有未读的 accountId / folderId 都是 null，必须靠 kind 区分
  if (target.kind && target.kind !== current.kind) return false
  if (target.folderId) return current.folderId === target.folderId
  if (target.accountId) {
    return current.accountId === target.accountId && current.folderId === null
  }
  return current.accountId === null && current.folderId === null
}

async function selectUnified(): Promise<void> {
  await mail.setSelection({
    kind: 'unified',
    accountId: null,
    folderId: null,
    label: '所有收件箱'
  })
}

async function selectUnread(): Promise<void> {
  await mail.setSelection({
    kind: 'unread',
    accountId: null,
    folderId: null,
    label: '所有未读'
  })
}

async function selectAccountInbox(accountId: number, label: string): Promise<void> {
  await mail.setSelection({ kind: 'inbox', accountId, folderId: null, label })
}

async function selectFolder(folder: Folder): Promise<void> {
  await mail.setSelection({
    kind: 'folder',
    accountId: folder.accountId,
    folderId: folder.id,
    label: folder.name
  })
  await mail.syncFolderIfEmpty()
}
</script>

<template>
  <aside class="flex w-[236px] shrink-0 flex-col border-r border-line bg-sidebar">
    <div class="flex-1 overflow-y-auto px-2 pt-2 pb-3">
      <p class="px-2 pt-1 pb-1.5 text-[11px] font-medium text-faint">快捷视图</p>

      <button
        type="button"
        class="no-press mb-1 flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left"
        :class="isActive({ kind: 'unified' }) ? 'bg-selected text-accent-ink' : 'text-ink hover:bg-hover'"
        @click="selectUnified()"
      >
        <Icon name="inbox" :size="15" />
        <span class="flex-1 truncate text-[13px]" :class="unifiedCount ? 'font-semibold' : ''">
          所有收件箱
        </span>
        <span
          v-if="unifiedCount"
          class="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white"
        >
          {{ unifiedCount > 99 ? '99+' : unifiedCount }}
        </span>
      </button>

      <button
        type="button"
        class="no-press mb-1 flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left"
        :class="isActive({ kind: 'unread' }) ? 'bg-selected text-accent-ink' : 'text-ink hover:bg-hover'"
        @click="selectUnread()"
      >
        <Icon name="mail" :size="15" />
        <span class="flex-1 truncate text-[13px]" :class="unreadAllCount ? 'font-semibold' : ''">
          所有未读
        </span>
        <span
          v-if="unreadAllCount"
          class="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent-ink"
        >
          {{ unreadAllCount > 99 ? '99+' : unreadAllCount }}
        </span>
      </button>

      <div v-if="accounts.list.length" class="my-2 border-t border-line" />

      <div v-for="account in accounts.list" :key="account.id" class="mb-0.5">
        <div class="group flex items-center rounded-md pr-1 hover:bg-hover">
          <button
            type="button"
            class="flex h-7 w-6 shrink-0 items-center justify-center text-faint hover:text-ink"
            :title="accounts.expanded[account.id] ? '收起文件夹' : '展开文件夹'"
            @click="accounts.toggleExpanded(account.id)"
          >
            <Icon
              :name="accounts.expanded[account.id] ? 'chevron-down' : 'chevron-right'"
              :size="12"
            />
          </button>

          <button
            type="button"
            class="no-press flex min-w-0 flex-1 items-center gap-2 py-[7px] text-left"
            :class="isActive({ accountId: account.id }) ? 'text-accent-ink' : 'text-ink'"
            @click="selectAccountInbox(account.id, account.displayName || account.email)"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :style="{ background: account.color }"
              aria-hidden="true"
            />
            <span
              class="flex-1 truncate text-[12.5px]"
              :class="accounts.unreadOf(account.id) ? 'font-semibold' : ''"
            >
              {{ account.displayName || account.email }}
            </span>
            <span
              v-if="accounts.unreadOf(account.id)"
              class="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold text-accent-ink"
            >
              {{ accounts.unreadOf(account.id) }}
            </span>
          </button>

          <button
            type="button"
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 group-hover:opacity-100 hover:text-ink"
            title="账号设置"
            @click="ui.openAccountDialog(account)"
          >
            <Icon name="settings" :size="12" />
          </button>
        </div>

        <div
          class="folder-expand"
          :data-open="accounts.expanded[account.id] ? 'true' : 'false'"
          :inert="!accounts.expanded[account.id]"
        >
          <div>
            <div class="mt-0.5 mb-1.5 ml-6 space-y-px">
              <button
                v-for="folder in sortedFolders(account.id)"
                :key="folder.id"
                type="button"
                class="no-press flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left"
                :class="
                  isActive({ folderId: folder.id })
                    ? 'bg-selected text-accent-ink'
                    : 'text-ink2 hover:bg-hover'
                "
                @click="selectFolder(folder)"
              >
                <Icon :name="folderIconName(folder.specialUse, folder.path)" :size="13" />
                <span
                  class="flex-1 truncate text-[12.5px]"
                  :class="folder.unread ? 'font-medium' : ''"
                >
                  {{ folder.name }}
                </span>
                <span v-if="folder.unread" class="text-[11px] text-faint">{{ folder.unread }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="!accounts.loading && !accounts.list.length"
        class="px-3 py-6 text-center text-[12px] leading-relaxed text-faint"
      >
        还没有邮箱账号
      </div>
    </div>

    <div class="shrink-0 border-t border-line p-2">
      <button
        type="button"
        class="no-press flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-ink2 hover:bg-hover hover:text-ink"
        @click="ui.openAccountDialog(null)"
      >
        <Icon name="plus" :size="14" />
        <span class="text-[12.5px]">添加邮箱账号</span>
      </button>
      <button
        type="button"
        class="no-press flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-muted hover:bg-hover hover:text-ink"
        title="同步范围、隐私、开机启动等"
        @click="ui.openSettings()"
      >
        <Icon name="settings" :size="14" />
        <span class="text-[12.5px]">设置</span>
      </button>
      <button
        type="button"
        class="no-press flex w-full items-center gap-2 rounded-md px-2 py-[7px] text-left text-muted hover:bg-hover hover:text-ink"
        title="版本、产品承诺与隐私说明"
        @click="ui.openAbout()"
      >
        <Icon name="info" :size="14" />
        <span class="text-[12.5px]">关于</span>
      </button>
    </div>
  </aside>
</template>
