<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import type { OutgoingAttachment } from '@shared/api'
import { useAccountsStore } from '../stores/accounts'
import { useUiStore } from '../stores/ui'
import { formatBytes, splitRecipients } from '../lib/format'
import { plain } from '../lib/plain'

const ui = useUiStore()
const accounts = useAccountsStore()

const accountId = ref<number | null>(null)
const to = ref('')
const cc = ref('')
const bcc = ref('')
const subject = ref('')
const body = ref('')
const attachments = ref<OutgoingAttachment[]>([])
const sending = ref(false)
const showCc = ref(false)
const error = ref('')

const canSend = computed(
  () => !sending.value && accountId.value !== null && (to.value.trim() || cc.value.trim())
)

watch(
  () => ui.composeOpen,
  (open) => {
    if (!open) return
    const seed = ui.composeSeed
    error.value = ''
    accountId.value = seed.accountId ?? accounts.list[0]?.id ?? null
    to.value = seed.to ?? ''
    cc.value = seed.cc ?? ''
    bcc.value = ''
    subject.value = seed.subject ?? ''
    body.value = seed.body ?? ''
    attachments.value = []
    showCc.value = Boolean(seed.cc)
    sending.value = false
  }
)

async function pickFiles(): Promise<void> {
  const picked = await window.api.compose.pickFiles()
  const existing = new Set(attachments.value.map((item) => item.path))
  attachments.value = [...attachments.value, ...picked.filter((item) => !existing.has(item.path))]
}

function removeAttachment(path: string): void {
  attachments.value = attachments.value.filter((item) => item.path !== path)
}

async function send(): Promise<void> {
  error.value = ''
  if (accountId.value === null) {
    error.value = '请选择发件账号'
    return
  }
  const toList = splitRecipients(to.value)
  const ccList = splitRecipients(cc.value)
  const bccList = splitRecipients(bcc.value)
  if (!toList.length && !ccList.length && !bccList.length) {
    error.value = '请填写至少一个收件人'
    return
  }

  sending.value = true
  try {
    const result = await window.api.compose.send(
      plain({
        accountId: accountId.value,
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: subject.value,
        text: body.value,
        attachments: attachments.value
      })
    )
    if (!result.ok) {
      error.value = result.error ?? '发送失败'
      return
    }
    ui.toast('success', '邮件已发送')
    ui.closeCompose()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <Modal :open="ui.composeOpen" max-width="760px" @close="ui.closeCompose()">
    <header class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
      <Icon name="compose" :size="14" class="text-muted" />
      <h2 class="flex-1 text-[13px] font-semibold text-ink">写邮件</h2>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        title="关闭"
        @click="ui.closeCompose()"
      >
        <Icon name="close" :size="13" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="flex items-center border-b border-line px-4">
        <span class="w-[68px] shrink-0 text-[12px] text-faint">发件账号</span>
        <select
          v-model.number="accountId"
          class="h-9 flex-1 bg-transparent text-[12.5px] text-ink focus:outline-none"
        >
          <option v-for="account in accounts.list" :key="account.id" :value="account.id">
            {{ account.displayName }} &lt;{{ account.email }}&gt;
          </option>
        </select>
      </div>

      <div class="flex items-center border-b border-line px-4">
        <span class="w-[68px] shrink-0 text-[12px] text-faint">收件人</span>
        <input
          v-model="to"
            data-field="to"
          type="text"
          placeholder="多个地址用逗号分隔"
          class="h-9 flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          v-if="!showCc"
          type="button"
          class="shrink-0 text-[12px] text-accent"
          @click="showCc = true"
        >
          抄送/密送
        </button>
      </div>

      <Transition name="reveal">
        <div v-if="showCc">
          <div class="flex items-center border-b border-line px-4">
            <span class="w-[68px] shrink-0 text-[12px] text-faint">抄送</span>
            <input
              v-model="cc"
            data-field="cc"
              type="text"
              class="h-9 flex-1 bg-transparent text-[12.5px] text-ink focus:outline-none"
            />
          </div>
          <div class="flex items-center border-b border-line px-4">
            <span class="w-[68px] shrink-0 text-[12px] text-faint">密送</span>
            <input
              v-model="bcc"
            data-field="bcc"
              type="text"
              class="h-9 flex-1 bg-transparent text-[12.5px] text-ink focus:outline-none"
            />
          </div>
        </div>
      </Transition>

      <div class="flex items-center border-b border-line px-4">
        <span class="w-[68px] shrink-0 text-[12px] text-faint">主题</span>
        <input
          v-model="subject"
            data-field="subject"
          type="text"
          class="h-9 flex-1 bg-transparent text-[12.5px] text-ink focus:outline-none"
        />
      </div>

      <textarea
        v-model="body"
            data-field="body"
        rows="12"
        placeholder="正文…"
        class="w-full resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
      />

      <Transition name="reveal">
        <div v-if="attachments.length" class="border-t border-line px-4 py-2">
          <div
            v-for="item in attachments"
            :key="item.path"
            class="flex items-center gap-2 py-1 text-[12px] text-ink2"
          >
            <Icon name="paperclip" :size="12" class="text-faint" />
            <span class="flex-1 truncate">{{ item.filename }}</span>
            <span class="text-faint">{{ formatBytes(0) }}</span>
            <button
              type="button"
              class="flex h-5 w-5 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink"
              title="移除"
              @click="removeAttachment(item.path)"
            >
              <Icon name="close" :size="11" />
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <Transition name="reveal">
      <div
        v-if="error"
        class="flex shrink-0 gap-1.5 border-t border-warn-line bg-warn-bg px-4 py-2 text-[11.5px] leading-relaxed text-warn-ink"
      >
        <Icon name="warn" :size="12" class="mt-[3px] shrink-0" />
        <span class="break-words whitespace-pre-wrap">{{ error }}</span>
      </div>
    </Transition>

    <footer class="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        :disabled="!canSend"
        @click="send()"
      >
        <Icon name="send" :size="13" />
        {{ sending ? '发送中…' : '发送' }}
      </button>
      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] text-ink2 hover:bg-hover"
        @click="pickFiles()"
      >
        <Icon name="paperclip" :size="13" />
        添加附件
      </button>
    </footer>
  </Modal>
</template>
