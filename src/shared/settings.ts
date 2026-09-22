/**
 * 可配置项定义。
 *
 * 划分原则：「关于」放只读叙事（版本、承诺、隐私声明），「设置」放用户能改的行为。
 * 这里每一项都必须真的影响运行时行为，否则不该出现在界面上。
 */

export type SettingGroup = 'sync' | 'privacy' | 'general'

export interface SettingOption {
  value: string
  label: string
}

export interface SettingDefinition {
  key: string
  group: SettingGroup
  label: string
  /** 一句话说清「改了会怎样」，而不是复述选项名 */
  description: string
  type: 'select' | 'toggle'
  options?: SettingOption[]
  default: string
}

export const SETTING_GROUPS: { id: SettingGroup; label: string }[] = [
  { id: 'sync', label: '同步' },
  { id: 'privacy', label: '隐私' },
  { id: 'general', label: '通用' }
]

export const SETTINGS: SettingDefinition[] = [
  {
    key: 'syncWindow',
    group: 'sync',
    label: '每个文件夹保留邮件数',
    description: '本地缓存最近多少封邮件。调大能离线翻看更多历史，代价是占用更多磁盘、首次同步更慢。',
    type: 'select',
    options: [
      { value: '100', label: '最近 100 封' },
      { value: '300', label: '最近 300 封' },
      { value: '500', label: '最近 500 封' },
      { value: '1000', label: '最近 1000 封' }
    ],
    default: '300'
  },
  {
    key: 'bodyPrefetch',
    group: 'sync',
    label: '自动下载正文',
    description: '同步时顺手把最新几封邮件的正文下载好，点开就能看。设为不预取可以省流量，但点开每封都要等一下。',
    type: 'select',
    options: [
      { value: '0', label: '不预取，省流量' },
      { value: '20', label: '最近 20 封' },
      { value: '40', label: '最近 40 封' },
      { value: '80', label: '最近 80 封' }
    ],
    default: '40'
  },
  {
    key: 'blockRemoteImages',
    group: 'privacy',
    label: '默认不加载远程图片',
    description:
      '很多营销邮件靠图片回执判断你什么时候打开了邮件。保持开启可避免被追踪，单封邮件上可以临时放行。',
    type: 'toggle',
    default: 'true'
  },
  {
    key: 'launchAtLogin',
    group: 'general',
    label: '开机时自动启动',
    description: '登录后自动在后台启动，以便及时收信。关掉不影响手动打开。',
    type: 'toggle',
    default: 'false'
  }
]

export interface AppSettings {
  syncWindow: number
  bodyPrefetch: number
  blockRemoteImages: boolean
  launchAtLogin: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  syncWindow: 300,
  bodyPrefetch: 40,
  blockRemoteImages: true,
  launchAtLogin: false
}

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), min), max)
}

/** 把数据库里的字符串键值解析成带类型的配置，非法值一律回落到默认值 */
export function parseSettings(raw: Record<string, string>): AppSettings {
  return {
    syncWindow: clampNumber(raw.syncWindow, DEFAULT_SETTINGS.syncWindow, 50, 5000),
    bodyPrefetch: clampNumber(raw.bodyPrefetch, DEFAULT_SETTINGS.bodyPrefetch, 0, 500),
    blockRemoteImages:
      raw.blockRemoteImages === undefined
        ? DEFAULT_SETTINGS.blockRemoteImages
        : raw.blockRemoteImages === 'true',
    launchAtLogin:
      raw.launchAtLogin === undefined
        ? DEFAULT_SETTINGS.launchAtLogin
        : raw.launchAtLogin === 'true'
  }
}
