<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { useMailStore } from '../stores/mail'
import { useUiStore } from '../stores/ui'
import {
  avatarColor,
  formatBytes,
  formatFullDate,
  initialOf,
  parseAddresses,
  senderLabel
} from '../lib/format'

const mail = useMailStore()
const ui = useUiStore()

const message = computed(() => mail.active)

const recipientLine = computed(() => {
  const current = message.value
  if (!current) return ''
  const to = parseAddresses(current.toJson).map((item) => item.name || item.address)
  const cc = parseAddresses(current.ccJson).map((item) => item.name || item.address)
  const parts: string[] = []
  if (to.length) parts.push(`收件人：${to.join('、')}`)
  if (cc.length) parts.push(`抄送：${cc.join('、')}`)
  return parts.join('　')
})

const attachments = computed(() =>
  (message.value?.attachments ?? []).filter((item) => !item.isInline)
)

function reply(): void {
  const current = message.value
  if (!current) return
  ui.openCompose({
    accountId: current.accountId,
    to: current.fromAddr,
    subject: /^re:/i.test(current.subject) ? current.subject : `Re: ${current.subject}`
  })
}

function forward(): void {
  const current = message.value
  if (!current) return
  const header = [
    '',
    '',
    '---------- 转发邮件 ----------',
    `发件人：${senderLabel(current.fromName, current.fromAddr)} <${current.fromAddr}>`,
    `时间：${formatFullDate(current.date)}`,
    `主题：${current.subject}`,
    recipientLine.value,
    ''
  ]
    .filter((line) => line !== '')
    .join('\n')
  ui.openCompose({
    accountId: current.accountId,
    subject: /^fwd:/i.test(current.subject) ? current.subject : `Fwd: ${current.subject}`,
    body: current.bodyText ? `${header}\n${current.bodyText}` : header
  })
}

async function openAttachment(id: number): Promise<void> {
  try {
    await window.api.mail.openAttachment(id)
  } catch (error) {
    ui.toast('error', error instanceof Error ? error.message : String(error))
  }
}

async function saveAttachment(id: number): Promise<void> {
  try {
    const saved = await window.api.mail.saveAttachmentAs(id)
    if (saved) ui.toast('success', `已保存到 ${saved}`)
  } catch (error) {
    ui.toast('error', error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <section class="flex min-w-0 flex-1 flex-col bg-panel">
    <div
      v-if="message"
      :key="message.id"
      class="content-in flex h-full min-h-0 flex-col"
    >
      <header class="shrink-0 border-b border-line px-5 pt-4 pb-3">
        <div class="flex items-start gap-3">
          <h2 class="min-w-0 flex-1 text-[17px] leading-snug font-semibold break-words text-ink">
            {{ message.subject || '(无主题)' }}
          </h2>
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover"
              :class="message.isStarred ? 'text-[#ff9f0a]' : 'text-muted'"
              :title="message.isStarred ? '取消星标' : '加星标'"
              @click="mail.toggleStar(message)"
            >
              <Icon name="star" :size="14" :filled="message.isStarred" />
            </button>
            <button
              type="button"
              class="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink2 hover:bg-hover"
              @click="reply()"
            >
              <Icon name="reply" :size="13" />
              回复
            </button>
            <button
              type="button"
              class="flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] text-ink2 hover:bg-hover"
              @click="forward()"
            >
              <Icon name="forward" :size="13" />
              转发
            </button>
          </div>
        </div>

        <div class="mt-3 flex items-start gap-2.5">
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            :style="{ background: avatarColor(message.fromAddr || message.fromName) }"
          >
            {{ initialOf(message.fromName, message.fromAddr) }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <span class="truncate text-[13px] font-medium text-ink">
                {{ senderLabel(message.fromName, message.fromAddr) }}
              </span>
              <span class="truncate text-[12px] text-faint">&lt;{{ message.fromAddr }}&gt;</span>
              <span class="ml-auto shrink-0 text-[12px] text-faint">
                {{ formatFullDate(message.date) }}
              </span>
            </div>
            <div class="mt-0.5 flex items-center gap-2">
              <span class="truncate text-[12px] text-faint">{{ recipientLine }}</span>
              <span
                class="shrink-0 rounded px-1.5 py-px text-[11px]"
                :style="{
                  background: `color-mix(in srgb, ${message.accountColor} 14%, transparent)`,
                  color: message.accountColor
                }"
              >
                {{ message.accountEmail }}
              </span>
            </div>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            v-if="message.hasBlockedImages"
            type="button"
            class="flex h-6 items-center gap-1.5 rounded-md border border-warn-line bg-warn-bg px-2 text-[12px] text-warn-ink"
            @click="mail.showImages()"
          >
            <Icon name="image" :size="12" />
            显示图片
          </button>

          <div v-for="item in attachments" :key="item.id" class="flex items-center gap-1">
            <button
              type="button"
              class="flex h-6 items-center gap-1.5 rounded-md border border-line bg-bg px-2 text-[12px] text-ink2 hover:bg-hover"
              :title="item.savedPath ? '打开附件' : '附件未下载'"
              @click="openAttachment(item.id)"
            >
              <Icon name="paperclip" :size="12" />
              <span class="max-w-[220px] truncate">{{ item.filename }}</span>
              <span class="text-faint">{{ formatBytes(item.size) }}</span>
            </button>
            <button
              type="button"
              class="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
              title="另存为"
              @click="saveAttachment(item.id)"
            >
              <Icon name="download" :size="12" />
            </button>
          </div>
        </div>
      </header>

      <div class="relative min-h-0 flex-1">
        <div
          v-if="mail.activeLoading"
          class="absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-accent"
        />
        <iframe
          v-if="message.bodyHtml"
          :srcdoc="message.bodyHtml"
          sandbox="allow-popups"
          referrerpolicy="no-referrer"
          class="h-full w-full border-0 bg-transparent px-5"
          title="邮件正文"
        />
        <div
          v-else
          class="flex h-full items-center justify-center px-8 text-center text-[12.5px] text-faint"
        >
          正文尚未下载，同步完成后会自动加载
        </div>
      </div>
    </div>

    <div
      v-else
      class="content-in flex h-full flex-col items-center justify-center gap-3 px-8 text-center"
    >
      <Icon name="mail" :size="30" class="text-faint" />
      <p class="text-[12.5px] leading-relaxed text-faint">
        从左侧列表选择一封邮件阅读<br />选中后会自动标记为已读
      </p>
    </div>
  </section>
</template>
