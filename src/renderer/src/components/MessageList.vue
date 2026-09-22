<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useMailStore } from '../stores/mail'
import { avatarColor, formatListDate, initialOf, senderLabel } from '../lib/format'

const mail = useMailStore()

const scrollEl = ref<HTMLElement | null>(null)
const searchInput = ref('')
let debounceTimer: number | undefined

// 跨账号视图（所有收件箱 / 所有未读）用左侧色条标出来源账号
const showStripe = computed(() => mail.selection.accountId === null)

// 切换文件夹 / 筛选条件时让列表整体淡入并回到顶部；
// 单纯刷新（同 key）不重放动画，避免每次同步都闪一下。
const listKey = computed(() =>
  [
    mail.selection.accountId ?? 'all',
    mail.selection.folderId ?? 'inbox',
    mail.unreadOnly ? 'unread' : '',
    mail.starredOnly ? 'starred' : ''
  ].join('|')
)

watch(listKey, () => {
  if (scrollEl.value) scrollEl.value.scrollTop = 0
})

const filters = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'starred', label: '星标' }
] as const

const activeFilter = computed(() => {
  if (mail.unreadOnly) return 'unread'
  if (mail.starredOnly) return 'starred'
  return 'all'
})

watch(searchInput, (value) => {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    mail.keyword = value
    void mail.applyFilters()
  }, 260)
})

onBeforeUnmount(() => window.clearTimeout(debounceTimer))

function setFilter(key: (typeof filters)[number]['key']): void {
  mail.unreadOnly = key === 'unread'
  mail.starredOnly = key === 'starred'
  void mail.applyFilters()
}

function onScroll(): void {
  const el = scrollEl.value
  if (!el) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 260) void mail.loadMore()
}

async function toggleStar(id: number): Promise<void> {
  const item = mail.items.find((entry) => entry.id === id)
  if (item) await mail.toggleStar(item)
}
</script>

<template>
  <section class="flex w-[360px] shrink-0 flex-col border-r border-line bg-panel">
    <div class="shrink-0 border-b border-line px-3 pt-3 pb-2">
      <div class="flex items-baseline gap-2">
        <h1 class="truncate text-[15px] font-semibold text-ink">{{ mail.selection.label }}</h1>
        <span class="shrink-0 text-[12px] text-faint">{{ mail.total }}</span>
      </div>

      <div class="mt-2 flex items-center gap-2">
        <div class="relative flex-1">
          <Icon
            name="search"
            :size="13"
            class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint"
          />
          <input
            v-model="searchInput"
            type="text"
            placeholder="搜索发件人、主题、正文"
            class="h-7 w-full rounded-md border border-line bg-bg pr-2 pl-7 text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
          :disabled="mail.loading"
          title="刷新列表"
          @click="mail.refresh()"
        >
          <Icon name="refresh" :size="13" :class="mail.loading ? 'animate-spin' : ''" />
        </button>
      </div>

      <div v-if="mail.selection.kind !== 'unread'" class="mt-2 flex items-center gap-1">
        <button
          v-for="filter in filters"
          :key="filter.key"
          type="button"
          class="rounded-md px-2 py-[3px] text-[12px]"
          :class="
            activeFilter === filter.key
              ? 'bg-accent/12 font-medium text-accent-ink'
              : 'text-muted hover:bg-hover hover:text-ink'
          "
          @click="setFilter(filter.key)"
        >
          {{ filter.label }}
        </button>
      </div>
    </div>

    <div ref="scrollEl" class="flex-1 overflow-y-auto" @scroll.passive="onScroll">
      <div :key="listKey" class="content-in flex min-h-full flex-col">
        <div
          v-if="mail.loading && !mail.items.length"
          class="px-4 py-10 text-center text-[12px] text-faint"
        >
          正在加载…
        </div>

        <div
          v-else-if="!mail.items.length"
          class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
        >
          <Icon name="inbox" :size="26" class="text-faint" />
          <p class="text-[12.5px] text-faint">
            {{
              mail.keyword
                ? '没有匹配的邮件'
                : mail.selection.kind === 'unread'
                  ? '没有未读邮件'
                  : '这个文件夹还没有邮件'
            }}
          </p>
        </div>

        <div v-for="item in mail.items" :key="item.id" class="group relative border-b border-line">
        <span
          v-if="showStripe"
          class="absolute top-0 bottom-0 left-0 w-[3px]"
          :style="{ background: item.accountColor }"
          aria-hidden="true"
        />

        <button
          type="button"
          class="no-press flex w-full gap-2.5 px-3 py-2.5 text-left"
          :class="mail.activeId === item.id ? 'bg-selected' : 'hover:bg-hover'"
          @click="mail.openMessage(item)"
        >
          <span
            class="mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
            :style="{ background: avatarColor(item.fromAddr || item.fromName) }"
          >
            {{ initialOf(item.fromName, item.fromAddr) }}
          </span>

          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span
                class="truncate text-[13px]"
                :class="item.isRead ? 'text-ink2' : 'font-semibold text-ink'"
              >
                {{ senderLabel(item.fromName, item.fromAddr) }}
              </span>
              <span
                v-if="mail.spansFolders"
                class="max-w-[84px] shrink-0 truncate rounded bg-hover px-1 py-px text-[10.5px] text-faint"
              >
                {{ item.folderName }}
              </span>
              <span class="ml-auto shrink-0 text-[11px] text-faint">
                {{ formatListDate(item.date) }}
              </span>
            </span>

            <span class="mt-0.5 flex items-center gap-1.5">
              <span
                v-if="!item.isRead"
                class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                aria-label="未读"
              />
              <span
                class="truncate text-[12.5px]"
                :class="item.isRead ? 'text-ink2' : 'font-medium text-ink'"
              >
                {{ item.subject || '(无主题)' }}
              </span>
              <Icon
                v-if="item.hasAttachments"
                name="paperclip"
                :size="11"
                class="shrink-0 text-faint"
              />
              <Icon
                v-if="item.isStarred"
                name="star"
                :size="11"
                filled
                class="shrink-0 text-[#ff9f0a]"
              />
            </span>

            <span class="mt-0.5 block truncate text-[12px] text-faint">
              {{ item.snippet || '（暂无正文预览）' }}
            </span>
          </span>
        </button>

        <button
          type="button"
          class="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded"
          :class="
            item.isStarred
              ? 'text-[#ff9f0a] opacity-100'
              : 'text-faint opacity-0 group-hover:opacity-100 hover:text-ink'
          "
          :title="item.isStarred ? '取消星标' : '加星标'"
          @click.stop="toggleStar(item.id)"
        >
          <Icon name="star" :size="13" :filled="item.isStarred" />
        </button>
      </div>

      <div v-if="mail.loadingMore" class="px-4 py-4 text-center text-[12px] text-faint">
        正在加载更多…
      </div>
      <div
        v-else-if="mail.items.length && !mail.hasMore"
        class="px-4 py-4 text-center text-[12px] text-faint"
      >
        已到底部
      </div>
      </div>
    </div>
  </section>
</template>
