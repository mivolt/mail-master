<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { useMailStore } from '../stores/mail'
import { useUiStore } from '../stores/ui'

const mail = useMailStore()
const ui = useUiStore()

// macOS 隐藏了系统标题栏，红绿灯浮在左侧，需要留出内边距并自己提供拖拽区。
// Windows 保留系统标题栏，这行就是一个普通工具条。
const isMac = window.api.app.platform === 'darwin'

const statusText = computed(() => {
  if (mail.syncing) return mail.progress?.message ?? '正在同步…'
  if (mail.progress?.phase === 'error') return mail.progress.message
  return ''
})
</script>

<template>
  <header
    class="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-bg pr-3"
    :class="isMac ? 'drag-region pl-[86px]' : 'pl-3'"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <Icon name="mail" :size="14" class="text-faint" />
      <span class="truncate text-[12px] font-medium text-muted">Mail Master</span>
      <span v-if="statusText" class="truncate text-[12px] text-faint">· {{ statusText }}</span>
    </div>

    <div class="flex items-center gap-1" :class="isMac ? 'no-drag' : ''">
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
        :disabled="mail.syncing"
        title="同步全部账号"
        @click="mail.syncCurrent()"
      >
        <Icon name="refresh" :size="14" :class="mail.syncing ? 'animate-spin' : ''" />
      </button>
      <button
        type="button"
        class="flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        @click="ui.openCompose()"
      >
        <Icon name="compose" :size="13" />
        写邮件
      </button>
    </div>
  </header>
</template>
