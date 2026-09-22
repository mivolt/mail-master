<script setup lang="ts">
import Icon from './Icon.vue'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()

const PROMISES = [
  '没有广告，也不会为了推荐去分析你的邮件',
  '账号数量不设上限，所有功能默认可用',
  '邮件正文与密码只存在本机，不经过任何第三方'
]
</script>

<template>
  <section class="flex min-w-0 flex-1 items-center justify-center overflow-y-auto bg-panel px-10">
    <div class="content-in w-full max-w-[440px] py-10">
      <div
        class="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
        style="background: color-mix(in srgb, var(--c-accent) 12%, transparent)"
      >
        <Icon name="mail" :size="26" class="text-accent" />
      </div>

      <h1 class="text-[22px] leading-tight font-semibold text-ink">Mail Master</h1>
      <p class="mt-2 text-[13px] leading-relaxed text-muted">
        把多个邮箱收进一个窗口。所有收件箱、所有未读、本地缓存、IMAP 直连，不用在浏览器标签之间来回切。
      </p>

      <ul class="mt-6 space-y-2.5">
        <li v-for="item in PROMISES" :key="item" class="flex gap-2.5 text-[12.5px] leading-relaxed text-ink2">
          <Icon name="check" :size="13" class="mt-[3px] shrink-0 text-accent" />
          <span>{{ item }}</span>
        </li>
      </ul>

      <div class="mt-7 flex items-center gap-2.5">
        <button
          type="button"
          class="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-medium text-white hover:opacity-90"
          @click="ui.openAccountDialog(null)"
        >
          <Icon name="plus" :size="14" />
          添加邮箱账号
        </button>
        <button
          type="button"
          class="flex h-9 items-center gap-2 rounded-lg border border-line px-4 text-[13px] text-ink2 hover:bg-hover"
          @click="ui.openAbout()"
        >
          了解隐私
        </button>
      </div>

      <p class="mt-6 text-[11.5px] leading-relaxed text-faint">
        支持 QQ 邮箱、163 / 126、Gmail、企业自建邮箱等一切标准 IMAP / SMTP 服务。
        添加时会一步步告诉你怎么拿到授权码。
      </p>
    </div>
  </section>
</template>
