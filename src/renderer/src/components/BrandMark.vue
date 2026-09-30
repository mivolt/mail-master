<script setup lang="ts">
/**
 * 服务商品牌标识：按服务商渲染可辨识的品牌视觉，全部为程序化矢量，
 * 不依赖外部图片资产。
 * - qq：QQ 邮箱品牌蓝底 + 白色信封（其 app 图标的核心视觉）
 * - 163：网易邮箱绿底 + 白色「163」字标
 * - gmail：白底 + Gmail 标志性红色 M
 * - outlook：微软四色格（Microsoft 365 系视觉）
 * - custom：中性灰 + 白色信封
 */
const props = withDefaults(defineProps<{ provider: string; size?: number }>(), { size: 40 })
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 48 48"
    aria-hidden="true"
    class="shrink-0"
  >
    <template v-if="props.provider === 'qq'">
      <rect width="48" height="48" rx="10" fill="#12B7F5" />
      <rect x="11" y="15.5" width="26" height="18" rx="3" fill="none" stroke="#fff" stroke-width="2.8" />
      <path
        d="M12.5 18 24 26.5 35.5 18"
        fill="none"
        stroke="#fff"
        stroke-width="2.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>

    <template v-else-if="props.provider === '163'">
      <rect width="48" height="48" rx="10" fill="#52A447" />
      <text
        x="24"
        y="31"
        text-anchor="middle"
        font-family="-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif"
        font-size="17"
        font-weight="700"
        fill="#fff"
      >
        163
      </text>
    </template>

    <template v-else-if="props.provider === 'gmail'">
      <rect width="48" height="48" rx="10" fill="#fff" />
      <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="9.25" fill="none" stroke="#E8EAED" stroke-width="1.5" />
      <rect x="11" y="14" width="4.5" height="21" fill="#EA4335" />
      <path
        d="M12 16.5 24 26l12-9.5"
        fill="none"
        stroke="#EA4335"
        stroke-width="4.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M36 15v20h4V16z" fill="#4285F4" opacity="0" />
    </template>

    <template v-else-if="props.provider === 'outlook'">
      <rect width="48" height="48" rx="10" fill="#fff" />
      <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="9.25" fill="none" stroke="#E8EAED" stroke-width="1.5" />
      <rect x="13" y="13" width="10.4" height="10.4" fill="#F25022" />
      <rect x="24.6" y="13" width="10.4" height="10.4" fill="#7FBA00" />
      <rect x="13" y="24.6" width="10.4" height="10.4" fill="#00A4EF" />
      <rect x="24.6" y="24.6" width="10.4" height="10.4" fill="#FFB900" />
    </template>

    <template v-else>
      <rect width="48" height="48" rx="10" fill="#8E8E93" />
      <rect x="11" y="15.5" width="26" height="18" rx="3" fill="none" stroke="#fff" stroke-width="2.8" />
      <path
        d="M12.5 18 24 26.5 35.5 18"
        fill="none"
        stroke="#fff"
        stroke-width="2.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </template>
  </svg>
</template>
