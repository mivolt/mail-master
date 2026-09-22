<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import { PROVIDERS, detectProvider, presetById } from '@shared/presets'
import type { AccountInput, ProviderId } from '@shared/types'
import { useAccountsStore } from '../stores/accounts'
import { useUiStore } from '../stores/ui'
import { plain } from '../lib/plain'

const ui = useUiStore()
const accounts = useAccountsStore()

function blankForm(): AccountInput {
  const preset = presetById('qq')
  return {
    email: '',
    displayName: '',
    provider: 'qq',
    imapHost: preset.imapHost,
    imapPort: preset.imapPort,
    imapSecure: preset.imapSecure,
    smtpHost: preset.smtpHost,
    smtpPort: preset.smtpPort,
    smtpSecure: preset.smtpSecure,
    username: '',
    secret: ''
  }
}

const form = ref<AccountInput>(blankForm())
// 邮箱拆成两段输入：只填 @ 前面，域名由服务商带出。
// 这样邮箱永远是「完整本地部分 + 完整域名」拼出来的，
// 不存在逐字输入中途被当成最终值的情况。
const localPart = ref('')
const domain = ref('')
const usernameTouched = ref(false)
const testing = ref(false)
const saving = ref(false)
const removing = ref(false)
const diagRunning = ref(false)
const advancedOpen = ref(false)
const guideOpen = ref(false)
const feedback = ref<{ kind: 'ok' | 'error'; text: string; authFailed: boolean } | null>(null)

const isEdit = computed(() => ui.editingAccount !== null)
const preset = computed(() => presetById(form.value.provider))
const domains = computed(() => preset.value.domains)
const isCustom = computed(() => preset.value.id === 'custom')
const secretPlaceholder = computed(() =>
  isEdit.value ? '留空表示不修改' : `请输入${preset.value.secretLabel}`
)
// 邮箱拼完整后再给帮助入口，避免一打开就堆教程
const canGuide = computed(() => form.value.email.includes('@'))
const errorText = computed(() => (feedback.value?.kind === 'error' ? feedback.value.text : ''))

function syncEmail(): void {
  const local = localPart.value.trim()
  const host = domain.value.trim()
  form.value.email = local && host ? `${local}@${host}` : ''
  if (!usernameTouched.value) form.value.username = form.value.email
}

function applyPreset(id: ProviderId): void {
  form.value.provider = id
  const target = presetById(id)
  if (id === 'custom') {
    advancedOpen.value = true
    return
  }
  form.value.imapHost = target.imapHost
  form.value.imapPort = target.imapPort
  form.value.imapSecure = target.imapSecure
  form.value.smtpHost = target.smtpHost
  form.value.smtpPort = target.smtpPort
  form.value.smtpSecure = target.smtpSecure
}

function selectProvider(id: ProviderId): void {
  form.value.provider = id
  applyPreset(id)
  const target = presetById(id)
  if (id === 'custom') {
    domain.value = ''
  } else if (!target.domains.includes(domain.value)) {
    // 换服务商时同步换域名，除非用户填的域名正好属于新服务商
    domain.value = target.domains[0] ?? ''
  }
  syncEmail()
  feedback.value = null
}

function onLocalInput(): void {
  // 允许直接粘贴完整邮箱：拆出域名，并尽量匹配到对应服务商
  const raw = localPart.value
  const at = raw.indexOf('@')
  if (at > 0) {
    const local = raw.slice(0, at)
    const host = raw.slice(at + 1).trim()
    localPart.value = local
    domain.value = host
    const matched = detectProvider(`probe@${host}`)
    if (matched.id !== 'custom') applyPreset(matched.id)
  }
  syncEmail()
  if (!form.value.displayName) form.value.displayName = localPart.value.trim()
}

function onDomainInput(): void {
  syncEmail()
}

watch(
  () => ui.accountDialogOpen,
  (open) => {
    if (!open) return
    feedback.value = null
    testing.value = false
    saving.value = false
    diagRunning.value = false
    usernameTouched.value = false
    guideOpen.value = false

    const account = ui.editingAccount
    if (account) {
      form.value = {
        email: account.email,
        displayName: account.displayName,
        provider: account.provider,
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        imapSecure: account.imapSecure,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpSecure: account.smtpSecure,
        username: account.username,
        secret: ''
      }
      const at = account.email.indexOf('@')
      localPart.value = at > 0 ? account.email.slice(0, at) : account.email
      domain.value = at > 0 ? account.email.slice(at + 1) : ''
      usernameTouched.value = true
      advancedOpen.value = true
    } else {
      form.value = blankForm()
      localPart.value = ''
      domain.value = presetById('qq').domains[0] ?? ''
      advancedOpen.value = false
      syncEmail()
    }
  }
)

async function openProviderPage(): Promise<void> {
  if (!preset.value.openUrl) return
  try {
    await window.api.app.openExternal(preset.value.openUrl)
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

async function test(): Promise<void> {
  syncEmail()
  testing.value = true
  feedback.value = null
  try {
    const result = await window.api.accounts.test(plain({ ...form.value }))
    if (result.ok) {
      feedback.value = { kind: 'ok', text: 'IMAP 与 SMTP 均连接成功', authFailed: false }
      return
    }
    feedback.value = {
      kind: 'error',
      text: result.error ?? '连接失败',
      authFailed: result.authFailed === true
    }
    if (result.authFailed) guideOpen.value = true
  } catch (cause) {
    feedback.value = {
      kind: 'error',
      text: cause instanceof Error ? cause.message : String(cause),
      authFailed: false
    }
  } finally {
    testing.value = false
  }
}

async function copyDiagnostics(): Promise<void> {
  diagRunning.value = true
  try {
    syncEmail()
    const report =
      isEdit.value && ui.editingAccount && !form.value.secret
        ? await window.api.diag.runAccount(ui.editingAccount.id)
        : await window.api.diag.run(plain({ ...form.value }))
    await window.api.diag.copy(report.text)
    ui.toast('success', '诊断信息已复制（已脱敏），可直接粘贴给他人')
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  } finally {
    diagRunning.value = false
  }
}

async function save(): Promise<void> {
  syncEmail()
  feedback.value = null
  saving.value = true
  try {
    if (isEdit.value && ui.editingAccount) {
      const patch: Partial<AccountInput> = { ...form.value }
      if (!patch.secret) delete patch.secret
      await accounts.update(ui.editingAccount.id, plain(patch))
      ui.toast('success', '账号已更新')
    } else {
      await accounts.add(form.value)
      ui.toast('success', '账号已添加，正在后台同步邮件…')
    }
    ui.closeAccountDialog()
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : String(cause)
    feedback.value = { kind: 'error', text, authFailed: /认证失败|授权码|密码/.test(text) }
    if (feedback.value.authFailed) guideOpen.value = true
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  const account = ui.editingAccount
  if (!account) return
  removing.value = true
  try {
    await accounts.remove(account.id)
    ui.toast('info', `已移除账号 ${account.email}`)
    ui.closeAccountDialog()
  } catch (cause) {
    feedback.value = {
      kind: 'error',
      text: cause instanceof Error ? cause.message : String(cause),
      authFailed: false
    }
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <Modal :open="ui.accountDialogOpen" max-width="460px" @close="ui.closeAccountDialog()">
    <header class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
      <Icon name="account" :size="14" class="text-muted" />
      <h2 class="flex-1 text-[13px] font-semibold text-ink">
        {{ isEdit ? '账号设置' : '添加邮箱账号' }}
      </h2>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        title="关闭"
        @click="ui.closeAccountDialog()"
      >
        <Icon name="close" :size="13" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
      <!-- 先选服务商，邮箱只需要填 @ 前面 -->
      <div class="mb-1 text-[12px] text-muted">服务商</div>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="item in PROVIDERS"
          :key="item.id"
          type="button"
          :data-provider="item.id"
          class="h-7 rounded-md px-2.5 text-[12px]"
          :class="
            form.provider === item.id
              ? 'bg-accent font-medium text-white'
              : 'border border-line text-ink2 hover:bg-hover'
          "
          @click="selectProvider(item.id)"
        >
          {{ item.shortLabel }}
        </button>
      </div>

      <label class="mt-3 block">
        <span class="mb-1 block text-[12px] text-muted">邮箱地址</span>
        <div class="flex items-stretch">
          <input
            v-model="localPart"
            data-field="emailLocal"
            type="text"
            :placeholder="isCustom ? 'you' : '只填 @ 前面，如 zhangsan'"
            autocomplete="off"
            class="h-9 min-w-0 flex-1 rounded-l-md border border-r-0 border-line bg-bg px-2.5 text-[13px] focus:border-accent focus:outline-none"
            @input="onLocalInput"
          />
          <div
            class="flex shrink-0 items-center gap-0.5 rounded-r-md border border-line bg-hover px-2 text-[13px] text-muted"
          >
            <span>@</span>
            <select
              v-if="domains.length > 1"
              v-model="domain"
              data-field="emailDomain"
              class="max-w-[110px] bg-transparent text-[13px] text-ink2 focus:outline-none"
              @change="onDomainInput"
            >
              <option v-for="item in domains" :key="item" :value="item">{{ item }}</option>
            </select>
            <span v-else-if="domains.length === 1" class="text-ink2">{{ domains[0] }}</span>
            <input
              v-else
              v-model="domain"
              data-field="emailDomain"
              type="text"
              placeholder="example.com"
              class="w-[118px] bg-transparent text-[13px] text-ink2 placeholder:text-faint focus:outline-none"
              @input="onDomainInput"
            />
          </div>
        </div>
      </label>

      <label class="mt-3 block">
        <span class="mb-1 block text-[12px] text-muted">
          {{ preset.secretLabel }}
          <span v-if="isEdit" class="text-faint">（{{ secretPlaceholder }}）</span>
        </span>
        <input
          v-model="form.secret"
          data-field="secret"
          type="password"
          autocomplete="new-password"
          :placeholder="secretPlaceholder"
          class="h-9 w-full rounded-md border border-line bg-bg px-2.5 text-[13px] focus:border-accent focus:outline-none"
        />
      </label>

      <!-- 帮助默认只占一行，点开才展开步骤 -->
      <button
        v-if="canGuide"
        type="button"
        class="hint-trigger mt-1"
        :title="`展开「怎么拿到${preset.secretLabel}」的分步说明`"
        @click="guideOpen = !guideOpen"
      >
        <Icon name="info" :size="12" class="shrink-0" />
        <span class="flex-1 truncate">怎么拿到{{ preset.secretLabel }}</span>
        <Icon :name="guideOpen ? 'chevron-down' : 'chevron-right'" :size="11" class="shrink-0" />
      </button>

      <div
        v-if="canGuide"
        class="folder-expand"
        :data-open="guideOpen ? 'true' : 'false'"
        :inert="!guideOpen"
      >
        <div>
          <div class="mt-1 rounded-lg border border-line bg-hover/50 px-3 py-2.5">
            <div class="mb-2 flex items-center gap-2">
              <span class="text-[11.5px] font-medium text-muted">
                获取{{ preset.secretLabel }}的步骤
              </span>
              <span class="flex-1" />
              <button
                v-if="preset.openUrl"
                type="button"
                class="flex h-6 items-center gap-1 rounded-md border border-line bg-bg px-2 text-[11.5px] text-accent-ink hover:bg-hover"
                @click="openProviderPage()"
              >
                {{ preset.openLabel }}
                <Icon name="forward" :size="11" />
              </button>
            </div>

            <ol class="space-y-1.5">
              <li
                v-for="(step, index) in preset.steps"
                :key="index"
                class="flex gap-2 text-[11.5px] leading-relaxed text-ink2"
              >
                <span
                  class="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[10px] font-semibold text-accent-ink"
                >
                  {{ index + 1 }}
                </span>
                <span>{{ step }}</span>
              </li>
            </ol>

            <p class="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-faint">
              {{ preset.codeHint }}
            </p>

            <p
              v-if="preset.warning"
              class="mt-2 flex gap-1.5 border-t border-warn-line pt-2 text-[11.5px] leading-relaxed text-warn-ink"
            >
              <Icon name="warn" :size="12" class="mt-[2px] shrink-0" />
              <span>{{ preset.warning }}</span>
            </p>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="hint-trigger mt-1"
        title="显示名称、登录用户名与收发服务器地址"
        @click="advancedOpen = !advancedOpen"
      >
        <Icon name="settings" :size="12" class="shrink-0" />
        <span class="flex-1 truncate">
          高级设置<span class="text-faint"> · 显示名称与服务器地址</span>
        </span>
        <Icon :name="advancedOpen ? 'chevron-down' : 'chevron-right'" :size="11" class="shrink-0" />
      </button>

      <div class="folder-expand" :data-open="advancedOpen ? 'true' : 'false'" :inert="!advancedOpen">
        <div>
          <div class="space-y-3 pt-1">
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="mb-1 block text-[12px] text-muted">显示名称</span>
                <input
                  v-model="form.displayName"
                  data-field="displayName"
                  type="text"
                  class="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-[12px] text-muted">
                  用户名
                  <span class="text-faint">（一般同邮箱）</span>
                </span>
                <input
                  v-model="form.username"
                  data-field="username"
                  type="text"
                  class="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
                  @input="usernameTouched = true"
                />
              </label>
            </div>

            <div class="rounded-lg border border-line px-3 py-2.5">
              <p class="mb-2 text-[11.5px] font-medium text-muted">接收服务器（IMAP）</p>
              <div class="grid grid-cols-[1fr_76px_auto] items-center gap-2">
                <input
                  v-model="form.imapHost"
                  data-field="imapHost"
                  type="text"
                  placeholder="imap.example.com"
                  class="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
                />
                <input
                  v-model.number="form.imapPort"
                  data-field="imapPort"
                  type="number"
                  class="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
                />
                <label class="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-ink2">
                  <input v-model="form.imapSecure" type="checkbox" />
                  SSL
                </label>
              </div>
            </div>

            <div class="rounded-lg border border-line px-3 py-2.5">
              <p class="mb-2 text-[11.5px] font-medium text-muted">发送服务器（SMTP）</p>
              <div class="grid grid-cols-[1fr_76px_auto] items-center gap-2">
                <input
                  v-model="form.smtpHost"
                  data-field="smtpHost"
                  type="text"
                  placeholder="smtp.example.com"
                  class="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
                />
                <input
                  v-model.number="form.smtpPort"
                  data-field="smtpPort"
                  type="number"
                  class="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
                />
                <label class="flex items-center gap-1.5 text-[12px] whitespace-nowrap text-ink2">
                  <input v-model="form.smtpSecure" type="checkbox" />
                  SSL
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Transition name="reveal">
        <div
          v-if="feedback?.kind === 'ok'"
          class="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted"
        >
          <Icon name="check" :size="12" class="shrink-0 text-accent" />
          <span>{{ feedback.text }}</span>
        </div>
      </Transition>
    </div>

    <!-- 阻断性错误固定在按钮上方，滚动时也一定看得见 -->
    <Transition name="reveal">
      <div v-if="errorText" class="alert-error mx-4 mt-3 shrink-0">
        <Icon name="warn" :size="14" class="mt-[1px] shrink-0 text-danger" />
        <div class="min-w-0 flex-1">
          <p class="alert-error__title">无法完成登录</p>
          <p class="alert-error__body">{{ errorText }}</p>
          <button
            v-if="canGuide && !guideOpen"
            type="button"
            class="mt-1.5 text-[11.5px] font-medium text-danger underline underline-offset-2"
            @click="guideOpen = true"
          >
            查看获取{{ preset.secretLabel }}的步骤
          </button>
        </div>
      </div>
    </Transition>

    <footer class="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
      <button
        type="button"
        class="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        :disabled="saving || testing"
        @click="save()"
      >
        <Icon name="check" :size="13" />
        {{ saving ? '保存中…' : isEdit ? '保存修改' : '添加账号' }}
      </button>
      <button
        type="button"
        class="flex h-8 items-center rounded-md border border-line px-2.5 text-[12.5px] text-ink2 hover:bg-hover disabled:opacity-40"
        :disabled="saving || testing"
        title="先验证 IMAP 与 SMTP 能否登录，再决定是否保存"
        @click="test()"
      >
        {{ testing ? '测试中…' : '测试连接' }}
      </button>

      <span class="flex-1" />

      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink disabled:opacity-40"
        :disabled="diagRunning"
        title="把连接过程记录下来并复制（已脱敏），方便排查或反馈"
        @click="copyDiagnostics()"
      >
        <Icon name="info" :size="13" />
      </button>
      <button
        v-if="isEdit"
        type="button"
        class="flex h-8 items-center rounded-md border border-danger-line px-2.5 text-[12.5px] text-danger hover:bg-danger-bg disabled:opacity-40"
        :disabled="removing || saving"
        @click="remove()"
      >
        {{ removing ? '移除中…' : '移除账号' }}
      </button>
    </footer>
  </Modal>
</template>
