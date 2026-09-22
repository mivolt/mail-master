<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from './Icon.vue'
import Modal from './Modal.vue'
import type { AppInfo } from '@shared/types'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
const info = ref<AppInfo | null>(null)

const PROMISES = [
  {
    title: '无广告',
    text: '界面里没有任何广告位，也不会为了推荐去分析你的邮件。'
  },
  {
    title: '不限账号',
    text: '账号数量不设上限，所有功能默认可用，没有会员墙。'
  },
  {
    title: '数据留在本机',
    text: '邮件正文与密码只存在这台电脑上，不经过任何第三方服务器。'
  }
]

const PRIVACY = [
  '邮件正文、附件与收发件人，只在你的电脑与邮箱服务器之间传输',
  '邮箱密码 / 授权码经系统钥匙串加密后存本地，我们无法读取',
  '没有埋点统计，没有崩溃上报，没有用户画像'
]

watch(
  () => ui.aboutOpen,
  async (open) => {
    if (!open || info.value) return
    try {
      info.value = await window.api.app.info()
    } catch {
      info.value = null
    }
  }
)
</script>

<template>
  <Modal :open="ui.aboutOpen" max-width="480px" @close="ui.closeAbout()">
    <header class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
      <Icon name="mail" :size="14" class="text-muted" />
      <h2 class="flex-1 text-[13px] font-semibold text-ink">关于 Mail Master</h2>
      <button
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
        title="关闭"
        @click="ui.closeAbout()"
      >
        <Icon name="close" :size="13" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <p class="text-[13px] leading-relaxed text-ink2">
        把多个邮箱收进一个窗口。所有收件箱、所有未读、本地缓存、IMAP 直连，
        不用在浏览器标签之间来回切。
      </p>

      <p class="mt-5 mb-2 text-[11px] font-medium tracking-wide text-faint">我们的三条承诺</p>
      <div class="space-y-2">
        <div
          v-for="item in PROMISES"
          :key="item.title"
          class="flex gap-2.5 rounded-lg border border-line bg-hover/50 px-3 py-2.5"
        >
          <Icon name="check" :size="13" class="mt-[2px] shrink-0 text-accent" />
          <div class="min-w-0">
            <p class="text-[12.5px] font-medium text-ink">{{ item.title }}</p>
            <p class="mt-0.5 text-[11.5px] leading-relaxed text-muted">{{ item.text }}</p>
          </div>
        </div>
      </div>

      <p class="mt-5 mb-2 text-[11px] font-medium tracking-wide text-faint">不会上传的东西</p>
      <ul class="space-y-1.5">
        <li
          v-for="item in PRIVACY"
          :key="item"
          class="flex gap-2 text-[11.5px] leading-relaxed text-ink2"
        >
          <Icon name="check" :size="11" class="mt-[3px] shrink-0 text-accent" />
          <span>{{ item }}</span>
        </li>
      </ul>

      <p class="mt-4 rounded-lg border border-line px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
        数据保存在本机，你可以在
        <button
          type="button"
          class="text-accent-ink underline underline-offset-2"
          @click="
            () => {
              ui.closeAbout()
              ui.openSettings()
            }
          "
        >
          设置
        </button>
        里查看占用、打开数据目录或一键清除。
      </p>
    </div>

    <footer class="shrink-0 border-t border-line px-4 py-2.5">
      <p v-if="info" class="text-[11px] text-faint">
        Mail Master {{ info.version }}　·　Electron {{ info.electron }}　·　Chrome
        {{ info.chrome }}
      </p>
    </footer>
  </Modal>
</template>
