<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import RichToolbar from './RichToolbar.vue'
import { SETTINGS, SETTING_GROUPS, type AppSettings, type PlatformId } from '@shared/settings'
import type { SignatureStore } from '@shared/types'
import type { StorageInfo } from '@shared/types'
import { useAccountsStore } from '../stores/accounts'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { formatBytes } from '../lib/format'
import { plain } from '../lib/plain'

const ui = useUiStore()
const settings = useSettingsStore()
const accounts = useAccountsStore()

const storage = ref<StorageInfo | null>(null)
const loadingStorage = ref(false)
const clearing = ref(false)

const signatureStore = ref<SignatureStore>({ signatures: [], defaults: {} })
const editingSignature = ref<{ id?: string; name: string; html: string } | null>(null)
const sigEditor = ref<HTMLElement | null>(null)

async function loadSignatures(): Promise<void> {
  try {
    signatureStore.value = await window.api.signatures.getAll()
  } catch {
    signatureStore.value = { signatures: [], defaults: {} }
  }
}

function signatureNameFor(id: string | undefined): string {
  if (!id) return ''
  return signatureStore.value.signatures.find((item) => item.id === id)?.name ?? ''
}

function startSignatureEdit(signature?: { id: string; name: string; html: string }): void {
  editingSignature.value = signature
    ? { id: signature.id, name: signature.name, html: signature.html }
    : { name: '', html: '' }
  void nextTick(() => {
    if (sigEditor.value) {
      sigEditor.value.innerHTML = editingSignature.value?.html ?? ''
      sigEditor.value.focus()
    }
  })
}

function cancelSignatureEdit(): void {
  editingSignature.value = null
}

async function saveSignatureEdit(): Promise<void> {
  const draft = editingSignature.value
  if (!draft) return
  if (!draft.name.trim()) {
    ui.toast('error', '请先给签名起个名字')
    return
  }
  try {
    await window.api.signatures.save(
      plain({ id: draft.id, name: draft.name.trim(), html: sigEditor.value?.innerHTML ?? '' })
    )
    editingSignature.value = null
    await loadSignatures()
    ui.toast('success', '签名已保存')
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

async function removeSignature(id: string, name: string): Promise<void> {
  try {
    await window.api.signatures.remove(id)
    await loadSignatures()
    ui.toast('info', `已删除签名「${name}」`)
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

async function onDefaultChange(accountId: number, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  try {
    await window.api.signatures.setDefault(accountId, value || null)
    await loadSignatures()
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

const grouped = computed(() =>
  SETTING_GROUPS.map((group) => ({
    ...group,
    items: SETTINGS.filter(
      (item) =>
        item.group === group.id &&
        (!item.platforms ||
          item.platforms.includes(window.api.app.platform as PlatformId))
    )
  })).filter((group) => group.items.length > 0)
)

function valueOf(key: string): string | boolean {
  const value = settings.values[key as keyof AppSettings]
  // 数值型配置（同步窗口等）在 select 里按字符串比较
  return typeof value === 'number' ? String(value) : value
}

async function onToggle(key: string, next: boolean): Promise<void> {
  try {
    await settings.update(key as keyof AppSettings, next)
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

async function onSelect(key: string, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value
  try {
    await settings.update(key as keyof AppSettings, value)
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

async function loadStorage(): Promise<void> {
  loadingStorage.value = true
  try {
    storage.value = await window.api.app.storageInfo()
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  } finally {
    loadingStorage.value = false
  }
}

watch(
  () => ui.settingsOpen,
  (open) => {
    if (open) {
      void loadStorage()
      void loadSignatures()
    }
  }
)

async function openDataDir(): Promise<void> {
  try {
    await window.api.app.openDataDir()
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

async function testNotification(): Promise<void> {
  try {
    await window.api.app.testNotification()
    ui.toast('info', '测试通知已发出；若没看到，请检查「系统设置 → 通知」里是否允许 Mail Master')
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  }
}

async function clearData(): Promise<void> {
  clearing.value = true
  try {
    const done = await window.api.app.clearData()
    if (!done) ui.toast('info', '已取消')
  } catch (cause) {
    ui.toast('error', cause instanceof Error ? cause.message : String(cause))
  } finally {
    clearing.value = false
  }
}
</script>

<template>
  <Modal :open="ui.settingsOpen" max-width="560px" @close="ui.closeSettings()">
    <header class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
      <Icon name="settings" :size="14" class="text-muted" />
      <h2 class="flex-1 text-[13px] font-semibold text-ink">设置</h2>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        title="关闭"
        @click="ui.closeSettings()"
      >
        <Icon name="close" :size="13" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
      <template v-for="group in grouped" :key="group.id">
        <p class="mb-2 text-[11px] font-medium tracking-wide text-faint">{{ group.label }}</p>
        <div class="mb-4 divide-y divide-line rounded-lg border border-line">
          <div v-for="item in group.items" :key="item.key" class="flex gap-4 px-3 py-2.5">
            <div class="min-w-0 flex-1">
              <p class="text-[12.5px] text-ink">{{ item.label }}</p>
              <p class="mt-0.5 text-[11.5px] leading-relaxed text-faint">{{ item.description }}</p>
            </div>

            <div class="flex shrink-0 items-center pt-0.5">
              <select
                v-if="item.type === 'select'"
                :value="valueOf(item.key)"
                :data-setting="item.key"
                class="h-7 rounded-md border border-line bg-bg px-2 text-[12px] text-ink2 focus:border-accent focus:outline-none"
                @change="onSelect(item.key, $event)"
              >
                <option v-for="option in item.options" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>

              <button
                v-else
                type="button"
                :data-setting="item.key"
                class="relative h-5 w-9 shrink-0 rounded-full"
                :class="valueOf(item.key) ? 'bg-accent' : 'bg-line-strong'"
                :title="valueOf(item.key) ? '点击关闭' : '点击开启'"
                @click="onToggle(item.key, !valueOf(item.key))"
              >
                <span
                  class="absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white transition-transform duration-150"
                  :class="valueOf(item.key) ? 'translate-x-[18px]' : 'translate-x-0.5'"
                />
              </button>
            </div>
          </div>
        </div>
      </template>

      <p class="mb-2 text-[11px] font-medium tracking-wide text-faint">通知</p>
      <div class="mb-4 rounded-lg border border-line px-3 py-2.5">
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-[12px] text-ink">测试系统通知</p>
            <p class="mt-0.5 text-[11px] leading-relaxed text-faint">
              点一下应该弹出通知，应用也会出现在「系统设置 → 通知」列表里。没弹就说明被系统拦了。
            </p>
          </div>
          <button
            type="button"
            data-action="test-notification"
            class="flex h-7 shrink-0 items-center rounded-md border border-line px-2.5 text-[11.5px] text-ink2 hover:bg-hover hover:text-ink"
            @click="testNotification()"
          >
            发送测试
          </button>
        </div>
      </div>

      <p class="mb-2 text-[11px] font-medium tracking-wide text-faint">签名</p>
      <div class="mb-4 rounded-lg border border-line px-3 py-2.5">
        <template v-if="editingSignature">
          <input
            v-model="editingSignature.name"
            data-field="signatureName"
            type="text"
            placeholder="签名名称，如：工作签名"
            class="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[12.5px] focus:border-accent focus:outline-none"
          />
          <div class="mt-2 rounded-md border border-line px-1.5 py-1">
            <RichToolbar />
          </div>
          <div
            ref="sigEditor"
            data-field="signatureBody"
            contenteditable="true"
            class="mt-1.5 min-h-[72px] rounded-md border border-line bg-bg px-2.5 py-2 text-[12.5px] leading-relaxed text-ink empty:before:content-['签名内容…支持加粗、颜色、链接等格式'] empty:before:text-faint focus:border-accent focus:outline-none"
          />
          <div class="mt-2 flex justify-end gap-2">
            <button
              type="button"
              class="flex h-7 items-center rounded-md border border-line px-2.5 text-[11.5px] text-ink2 hover:bg-hover"
              @click="cancelSignatureEdit()"
            >
              取消
            </button>
            <button
              type="button"
              data-action="signature-save"
              class="flex h-7 items-center rounded-md bg-accent px-3 text-[11.5px] font-medium text-white hover:opacity-90"
              @click="saveSignatureEdit()"
            >
              保存签名
            </button>
          </div>
        </template>

        <template v-else>
          <div
            v-for="signature in signatureStore.signatures"
            :key="signature.id"
            class="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0"
          >
            <Icon name="compose" :size="12" class="shrink-0 text-faint" />
            <span class="min-w-0 flex-1 truncate text-[12px] text-ink">{{ signature.name }}</span>
            <button
              type="button"
              class="shrink-0 rounded px-1.5 text-[11.5px] text-muted hover:bg-hover hover:text-ink"
              @click="startSignatureEdit(signature)"
            >
              编辑
            </button>
            <button
              type="button"
              class="shrink-0 rounded px-1.5 text-[11.5px] text-danger hover:bg-danger-bg"
              @click="removeSignature(signature.id, signature.name)"
            >
              删除
            </button>
          </div>
          <p v-if="!signatureStore.signatures.length" class="py-1.5 text-[11.5px] text-faint">
            还没有签名。创建后写信时会自动带上。
          </p>

          <div
            v-if="accounts.list.length && signatureStore.signatures.length"
            class="mt-2 space-y-1 border-t border-line pt-2"
          >
            <div
              v-for="account in accounts.list"
              :key="account.id"
              class="flex items-center gap-2"
            >
              <span class="min-w-0 flex-1 truncate text-[11.5px] text-ink2" :title="account.email">
                {{ account.email }}
              </span>
              <select
                :value="signatureStore.defaults[String(account.id)] ?? ''"
                :data-field="'signatureDefault'"
                :data-account="account.id"
                class="h-7 max-w-[55%] rounded-md border border-line bg-bg px-1.5 text-[11.5px] text-ink2 focus:outline-none"
                @change="onDefaultChange(account.id, $event)"
              >
                <option value="">不使用签名</option>
                <option v-for="signature in signatureStore.signatures" :key="signature.id" :value="signature.id">
                  {{ signature.name }}
                </option>
              </select>
            </div>
            <p class="pt-0.5 text-[10.5px] leading-relaxed text-faint">
              写新邮件时，正文为空会自动填入该账号的默认签名。
            </p>
          </div>

          <button
            v-if="!editingSignature"
            type="button"
            data-action="signature-new"
            class="mt-2 flex h-7 items-center gap-1 rounded-md border border-line px-2.5 text-[11.5px] text-ink2 hover:bg-hover hover:text-ink"
            @click="startSignatureEdit()"
          >
            <Icon name="plus" :size="11" />
            新建签名
          </button>
        </template>
      </div>

      <p class="mb-2 text-[11px] font-medium tracking-wide text-faint">数据</p>
      <div class="rounded-lg border border-line px-3 py-2.5">
        <div v-if="loadingStorage" class="py-2 text-center text-[11.5px] text-faint">读取中…</div>

        <template v-else-if="storage">
          <p class="mb-2 rounded-md bg-hover px-2 py-1.5 font-mono text-[11px] break-all text-ink2">
            {{ storage.userDataDir }}
          </p>

          <dl class="space-y-1 text-[11.5px]">
            <div class="flex gap-2">
              <dt class="w-[64px] shrink-0 text-faint">账号</dt>
              <dd class="text-ink2">{{ storage.accountCount }} 个</dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[64px] shrink-0 text-faint">邮件缓存</dt>
              <dd class="text-ink2">
                {{ storage.messageCount }} 封 · {{ formatBytes(storage.databaseBytes) }}
              </dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[64px] shrink-0 text-faint">附件</dt>
              <dd class="text-ink2">
                {{ storage.attachmentCount }} 个 · {{ formatBytes(storage.attachmentsBytes) }}
              </dd>
            </div>
            <div class="flex gap-2">
              <dt class="w-[64px] shrink-0 text-faint">密码</dt>
              <dd :class="storage.encryptionAvailable ? 'text-ink2' : 'text-warn-ink'">
                {{
                  storage.encryptionAvailable
                    ? '已由系统钥匙串加密'
                    : '系统钥匙串不可用，当前为明文存储'
                }}
              </dd>
            </div>
          </dl>

          <div class="mt-2.5 flex gap-2">
            <button
              type="button"
              class="flex h-7 items-center rounded-md border border-line px-2.5 text-[11.5px] text-ink2 hover:bg-hover"
              @click="openDataDir()"
            >
              打开数据目录
            </button>
            <button
              type="button"
              class="flex h-7 items-center rounded-md border border-danger-line px-2.5 text-[11.5px] text-danger hover:bg-danger-bg disabled:opacity-40"
              :disabled="clearing"
              @click="clearData()"
            >
              {{ clearing ? '清除中…' : '清除全部本地数据' }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <footer class="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
      <span class="text-[11.5px] text-faint">设置会自动保存</span>
      <span class="flex-1" />
      <button
        type="button"
        class="flex h-8 items-center rounded-md border border-line px-3.5 text-[12.5px] text-ink2 hover:bg-hover"
        @click="ui.closeSettings()"
      >
        完成
      </button>
    </footer>
  </Modal>
</template>
