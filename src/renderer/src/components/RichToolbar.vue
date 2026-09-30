<script setup lang="ts">
/**
 * 富文本工具栏：基于 document.execCommand，作用于当前选区。
 * 按钮用 mousedown.prevent，避免点击时编辑器失焦丢选区。
 * 供写信正文与签名编辑器共用。
 */

const FONT_SIZES = [
  { label: '小', value: '2' },
  { label: '标准', value: '3' },
  { label: '大', value: '5' },
  { label: '特大', value: '6' }
]

function exec(command: string, value?: string): void {
  document.execCommand(command, false, value)
}

function onFontSize(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  exec('fontSize', value)
}

function onColor(event: Event): void {
  exec('foreColor', (event.target as HTMLInputElement).value)
}

async function onLink(): Promise<void> {
  const url = window.prompt('链接地址（https://…）')
  if (!url) return
  if (!/^https?:\/\//i.test(url)) {
    exec('createLink', `https://${url}`)
    return
  }
  exec('createLink', url)
}

const itemClass =
  'flex h-6 min-w-6 items-center justify-center rounded px-1 text-[12px] text-ink2 hover:bg-hover hover:text-ink'
</script>

<template>
  <div class="flex flex-wrap items-center gap-0.5">
    <button type="button" :class="itemClass" class="font-bold" title="加粗" @mousedown.prevent @click="exec('bold')">
      B
    </button>
    <button type="button" :class="itemClass" class="italic" title="斜体" @mousedown.prevent @click="exec('italic')">
      I
    </button>
    <button type="button" :class="itemClass" class="underline" title="下划线" @mousedown.prevent @click="exec('underline')">
      U
    </button>
    <button type="button" :class="itemClass" class="line-through" title="删除线" @mousedown.prevent @click="exec('strikeThrough')">
      S
    </button>

    <span class="mx-0.5 h-4 w-px bg-line" />

    <select
      title="字号"
      class="h-6 rounded bg-transparent px-0.5 text-[11.5px] text-ink2 hover:bg-hover focus:outline-none"
      @mousedown.prevent
      @click.stop
      @change="onFontSize"
    >
      <option v-for="item in FONT_SIZES" :key="item.value" :value="item.value">{{ item.label }}</option>
    </select>

    <label
      class="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded hover:bg-hover"
      title="文字颜色"
      @mousedown.prevent
    >
      <span class="h-3.5 w-3.5 rounded-sm border border-line-strong bg-[#e03131]" />
      <input type="color" class="absolute inset-0 cursor-pointer opacity-0" @click.stop @input="onColor" />
    </label>

    <span class="mx-0.5 h-4 w-px bg-line" />

    <button type="button" :class="itemClass" title="无序列表" @mousedown.prevent @click="exec('insertUnorderedList')">
      ≡
    </button>
    <button type="button" :class="itemClass" title="有序列表" @mousedown.prevent @click="exec('insertOrderedList')">
      1.
    </button>

    <span class="mx-0.5 h-4 w-px bg-line" />

    <button type="button" :class="itemClass" title="左对齐" @mousedown.prevent @click="exec('justifyLeft')">
      ⇤
    </button>
    <button type="button" :class="itemClass" title="居中" @mousedown.prevent @click="exec('justifyCenter')">
      ↔
    </button>
    <button type="button" :class="itemClass" title="右对齐" @mousedown.prevent @click="exec('justifyRight')">
      ⇥
    </button>

    <span class="mx-0.5 h-4 w-px bg-line" />

    <button type="button" :class="itemClass" title="插入链接" @mousedown.prevent @click="onLink()">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
        <path d="M6.6 9.4 9.4 6.6 M7.3 4.6 8.9 3a2.6 2.6 0 0 1 3.7 3.7l-1.6 1.6 M8.7 11.4 7.1 13a2.6 2.6 0 0 1-3.7-3.7l1.6-1.6" />
      </svg>
    </button>
    <button type="button" :class="itemClass" title="清除格式" @mousedown.prevent @click="exec('removeFormat')">
      ✕
    </button>
  </div>
</template>
