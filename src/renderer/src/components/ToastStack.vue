<script setup lang="ts">
import Icon from './Icon.vue'
import { useUiStore } from '../stores/ui'
import type { ToastKind } from '../stores/ui'

const ui = useUiStore()

const STYLES: Record<ToastKind, string> = {
  info: 'border-line bg-panel text-ink2',
  success: 'border-line bg-panel text-ink2',
  error: 'border-warn-line bg-warn-bg text-warn-ink'
}

const ICONS: Record<ToastKind, string> = {
  info: 'info',
  success: 'check',
  error: 'warn'
}
</script>

<template>
  <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[340px] flex-col gap-2">
    <TransitionGroup name="toast">      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg"
        :class="STYLES[toast.kind]"
      >
        <Icon :name="ICONS[toast.kind]" :size="13" class="mt-[2px] shrink-0" />
        <span class="flex-1 text-[12px] leading-relaxed break-words">{{ toast.text }}</span>
        <button
          type="button"
          class="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint hover:text-ink"
          @click="ui.dismissToast(toast.id)"
        >
          <Icon name="close" :size="10" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
