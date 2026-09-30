<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import RichToolbar from './RichToolbar.vue'
import type { OutgoingAttachment } from '@shared/api'
import type { SignatureStore } from '@shared/types'
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
const attachments = ref<OutgoingAttachment[]>([])
const sending = ref(false)
const showCc = ref(false)
const error = ref('')

const editor = ref<HTMLElement | null>(null)
const signatureStore = ref<SignatureStore>({ signatures: [], defaults: {} })
const signatureMenuOpen = ref(false)

const currentAccount = computed(
  () => accounts.list.find((item) => item.id === accountId.value) ?? null
)
/** 发件人栏只显示「名称 · 域名」，完整地址信息量重复且占宽度 */
function senderLabel(account: { displayName: string; email: string }): string {
  const domain = account.email.split('@')[1] ?? ''
  return domain ? `${account.displayName} · ${domain}` : account.displayName
}
const defaultSignature = computed(() => {
  if (accountId.value === null) return null
  const id = signatureStore.value.defaults[String(accountId.value)]
  return signatureStore.value.signatures.find((item) => item.id === id) ?? null
})

const canSend = computed(
  () => !sending.value && accountId.value !== null && (to.value.trim() || cc.value.trim())
)

function editorText(): string {
  return editor.value?.innerText?.trim() ?? ''
}

async function refreshSignatures(): Promise<void> {
  try {
    signatureStore.value = await window.api.signatures.getAll()
  } catch {
    signatureStore.value = { signatures: [], defaults: {} }
  }
}

/** 空正文时写入账号默认签名；账号切换后同样生效 */
function applyDefaultSignatureIfEmpty(): void {
  if (!editor.value || editorText()) return
  if (defaultSignature.value?.html) editor.value.innerHTML = defaultSignature.value.html
}

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
    attachments.value = []
    showCc.value = Boolean(seed.cc)
    sending.value = false
    signatureMenuOpen.value = false
    void refreshSignatures().then(() => {
      if (!editor.value) return
      // 回复 / 转发的引用内容优先，不打断；新邮件空正文才放默认签名
      editor.value.innerHTML = seed.body ? escapeToHtml(seed.body) : ''
      applyDefaultSignatureIfEmpty()
    })
  }
)

function onAccountChange(): void {
  applyDefaultSignatureIfEmpty()
}

function escapeToHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML.replace(/\n/g, '<br />')
}

function insertSignature(signature: { html: string } | null): void {
  if (!signature?.html || !editor.value) return
  editor.value.focus()
  const sel = window.getSelection()
  const inEditor = Boolean(sel && editor.value.contains(sel.anchorNode))
  if (inEditor) {
    document.execCommand('insertHTML', false, signature.html)
  } else {
    editor.value.insertAdjacentHTML('beforeend', signature.html)
  }
}

function insertDefaultForAccount(): void {
  insertSignature(defaultSignature.value)
}

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
    const html = editor.value?.innerHTML.trim() ?? ''
    const result = await window.api.compose.send(
      plain({
        accountId: accountId.value,
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: subject.value,
        text: editorText(),
        html: html || undefined,
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

      <!-- 工具栏：作用于下方正文选区 -->
      <div class="flex items-center gap-1 border-b border-line px-3 py-1.5">
        <button
          type="button"
          class="flex h-6 items-center gap-1 rounded px-1.5 text-[11.5px] text-ink2 hover:bg-hover hover:text-ink"
          title="添加附件"
          @click="pickFiles()"
        >
          <Icon name="paperclip" :size="12" />
          附件
        </button>

        <span class="mx-0.5 h-4 w-px bg-line" />

        <RichToolbar />

        <span class="flex-1" />

        <div class="relative">
          <button
            type="button"
            class="flex h-6 items-center gap-1 rounded px-1.5 text-[11.5px]"
            :class="signatureMenuOpen ? 'bg-hover text-ink' : 'text-ink2 hover:bg-hover hover:text-ink'"
            title="插入签名"
            @click="signatureMenuOpen = !signatureMenuOpen"
          >
            <Icon name="compose" :size="11" />
            签名
            <Icon name="chevron-down" :size="10" />
          </button>
          <div
            v-if="signatureMenuOpen"
            class="absolute right-0 top-7 z-10 w-48 rounded-lg border border-line bg-bg py-1 shadow-lg"
          >
            <button
              v-for="signature in signatureStore.signatures"
              :key="signature.id"
              type="button"
              class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-ink2 hover:bg-hover hover:text-ink"
              @click="insertSignature(signature); signatureMenuOpen = false"
            >
              <Icon v-if="signature.id === defaultSignature?.id" name="check" :size="11" class="text-accent" />
              <span class="truncate">{{ signature.name }}</span>
            </button>
            <div v-if="!signatureStore.signatures.length" class="px-3 py-1.5 text-[11.5px] text-faint">
              还没有签名
            </div>
            <div class="mt-1 border-t border-line pt-1">
              <button
                type="button"
                class="w-full px-3 py-1.5 text-left text-[12px] text-accent hover:bg-hover"
                @click="signatureMenuOpen = false; ui.openSettings()"
              >
                管理签名…
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        ref="editor"
        data-field="body"
        contenteditable="true"
        class="min-h-[240px] bg-transparent px-4 py-3 text-[13px] leading-relaxed text-ink focus:outline-none empty:before:content-['正文…'] empty:before:text-faint"
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
      <!-- 发件账号栏放底部：先写内容，最后确认以谁的身份发出 -->
      <label
        class="flex h-8 min-w-0 max-w-[52%] items-center gap-1 rounded-md border border-line px-2 hover:bg-hover"
        title="选择发件账号"
      >
        <span class="shrink-0 text-[11.5px] text-faint">发送</span>
        <select
          v-model.number="accountId"
          data-field="sender"
          class="min-w-0 flex-1 truncate bg-transparent text-[12px] text-ink2 focus:outline-none"
          @change="onAccountChange"
        >
          <option v-for="account in accounts.list" :key="account.id" :value="account.id">
            {{ senderLabel(account) }}
          </option>
        </select>
      </label>
      <button
        v-if="defaultSignature"
        type="button"
        class="flex h-8 items-center rounded-md px-2 text-[11.5px] text-faint hover:bg-hover hover:text-ink"
        title="插入该账号的默认签名"
        @click="insertDefaultForAccount()"
      >
        <Icon name="compose" :size="11" class="mr-1" />
        签名
      </button>

      <span class="flex-1" />

      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        :disabled="!canSend"
        @click="send()"
      >
        <Icon name="send" :size="13" />
        {{ sending ? '发送中…' : '发送' }}
      </button>
    </footer>
  </Modal>
</template>
