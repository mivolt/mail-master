import type { ProviderId, ProviderPreset } from './types'

/**
 * 服务商预设。
 *
 * 设计原则：把「用户必须知道但不想学」的知识（IMAP、授权码、两步验证）
 * 全部由产品消化掉，用户只需要照着步骤点。
 *
 * openUrl 只填写可以确定的地址（服务商登录页或官方设置页），
 * 不猜测帮助文档的深层链接；具体点击路径写在 steps 里。
 */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'qq',
    label: 'QQ 邮箱 / Foxmail',
    shortLabel: 'QQ 邮箱',
    secretLabel: '授权码',
    domains: ['qq.com', 'vip.qq.com', 'foxmail.com'],
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    smtpSecure: true,
    hint: '服务器地址已自动填好，无需修改。',
    steps: [
      '点下方按钮打开 QQ 邮箱并登录',
      '点顶部「设置」，再选「账号」',
      '找到「POP3/IMAP/SMTP 服务」，点右侧「开启」',
      '按提示用手机发送一条验证短信',
      '复制生成的 16 位授权码，粘贴到上面的密码栏'
    ],
    codeHint: '授权码形如 abcd efgh ijkl mnop，共 16 位字母，不是你的 QQ 密码',
    openUrl: 'https://mail.qq.com',
    openLabel: '打开 QQ 邮箱'
  },
  {
    id: '163',
    label: '163 / 126 邮箱',
    shortLabel: '163 / 126',
    secretLabel: '授权码',
    domains: ['163.com', '126.com', 'yeah.net'],
    imapHost: 'imap.163.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    smtpSecure: true,
    hint: '服务器地址已自动填好，无需修改。',
    steps: [
      '点下方按钮打开 163 邮箱并登录',
      '点顶部「设置」，再选「POP3/SMTP/IMAP」',
      '开启「IMAP/SMTP 服务」',
      '按提示用手机发送一条验证短信',
      '复制生成的授权码，粘贴到上面的密码栏'
    ],
    codeHint: '授权码是一串字母，不是你的邮箱登录密码',
    openUrl: 'https://mail.163.com',
    openLabel: '打开 163 邮箱'
  },
  {
    id: 'gmail',
    label: 'Gmail',
    shortLabel: 'Gmail',
    secretLabel: '应用专用密码',
    domains: ['gmail.com', 'googlemail.com'],
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    hint: '服务器地址已自动填好，无需修改。',
    steps: [
      '点下方按钮进入「应用专用密码」页面并登录',
      '如果提示需要先开启「两步验证」，按提示开启后回到该页面',
      '在「应用专用密码」中随便起个名字（如 Mail Master）并生成',
      '复制弹出的 16 位密码，粘贴到上面的密码栏'
    ],
    codeHint: '应用专用密码形如 abcd efgh ijkl mnop，共 16 位，不是 Google 账号密码',
    openUrl: 'https://myaccount.google.com/apppasswords',
    openLabel: '打开应用专用密码页面',
    warning:
      '本机需要能够直接访问 Google 服务。若所在网络无法访问，IMAP 会连接超时，这不是配置问题。'
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail',
    shortLabel: 'Outlook',
    secretLabel: '密码',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    hint: '服务器地址已自动填好，无需修改。',
    steps: [
      '企业 / 学校账号：先向管理员确认是否仍开放 IMAP 基础认证',
      '若管理员已关闭基础认证，当前版本无法登录，需要 OAuth2 支持'
    ],
    codeHint: '企业账号使用邮箱密码；个人账号的密码登录已被微软停用',
    openUrl: 'https://account.microsoft.com/security',
    openLabel: '打开微软账号安全页',
    warning:
      '微软已于 2024 年 9 月对个人账号（outlook.com / hotmail.com / live.com）全面停用 IMAP 基础认证，密码或应用专用密码都会失败。这类账号需要 OAuth2 授权，当前版本尚未支持。'
  },
  {
    id: 'custom',
    label: '企业邮箱 / 自定义 IMAP',
    shortLabel: '其他 / 自定义',
    secretLabel: '密码 / 授权码',
    domains: [],
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    hint: '手动填写服务商提供的 IMAP / SMTP 服务器地址与端口。',
    steps: [
      '向邮箱管理员索取 IMAP 与 SMTP 服务器地址、端口',
      '确认是否需要客户端授权码（而非登录密码）',
      '把地址和端口填到下方对应位置',
      'SSL 通常对应 993 / 465，STARTTLS 通常对应 143 / 587'
    ],
    codeHint: '部分企业邮箱使用登录密码，部分需要单独申请授权码，以管理员说明为准'
  }
]

export function presetById(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[PROVIDERS.length - 1]
}

export function detectProvider(email: string): ProviderPreset {
  const domain = email.split('@')[1]?.toLowerCase().trim() ?? ''
  if (!domain) return presetById('custom')
  return PROVIDERS.find((item) => item.domains.includes(domain)) ?? presetById('custom')
}

export const ACCOUNT_COLORS = [
  '#0A84FF',
  '#FF375F',
  '#30D158',
  '#FF9F0A',
  '#BF5AF2',
  '#64D2FF',
  '#FF6482',
  '#5E5CE6'
]
