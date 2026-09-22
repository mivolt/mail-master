<script setup lang="ts">
import { ref } from 'vue'

withDefaults(defineProps<{ open: boolean; maxWidth?: string }>(), { maxWidth: '580px' })

const emit = defineEmits<{ close: [] }>()

/**
 * 只在「按下」和「松开」都发生在遮罩上时才关闭。
 *
 * 只用 @click.self 会有个经典缺陷：从面板内部拖拽选中文字、在遮罩上松开鼠标时，
 * 浏览器产生的 click 事件 target 是遮罩，于是被误判成「点了背景」而关掉弹窗。
 * 而拖拽选中恰恰是「复制」的常规动作，用户会以为是自己粘贴把窗口弄没了。
 */
const pressedOnBackdrop = ref(false)

function onMouseDown(event: MouseEvent): void {
  pressedOnBackdrop.value = event.target === event.currentTarget
}

function onClick(event: MouseEvent): void {
  const onBackdrop = event.target === event.currentTarget
  if (onBackdrop && pressedOnBackdrop.value) emit('close')
  pressedOnBackdrop.value = false
}
</script>

<template>
  <Transition name="dialog">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/25 px-6 py-10"
      @mousedown="onMouseDown"
      @click="onClick"
    >
      <div
        class="dialog-panel flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        :style="{ maxWidth }"
      >
        <slot />
      </div>
    </div>
  </Transition>
</template>
