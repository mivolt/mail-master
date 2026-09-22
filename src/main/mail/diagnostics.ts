import { app } from 'electron'
import { release, arch } from 'node:os'
import type { AccountInput, DiagReport } from '@shared/types'
import { presetById } from '@shared/presets'
import { describeMailError, withTimeout } from './errors'
import { createImapClient, listRemoteFolders } from './imap'
import { createTransport } from './smtp'

const MAX_LOG_LINES = 120
const CONNECT_TIMEOUT_MS = 25000

/** 邮箱本地部分打码，保留域名以便判断服务商 */
export function maskEmail(value: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return '(空)'
  const at = trimmed.indexOf('@')
  if (at <= 0) return `${trimmed[0]}***`
  return `${trimmed[0]}***${trimmed.slice(at)}`
}

function maskSecrets(line: string, secrets: string[]): string {
  let out = line
  for (const secret of secrets) {
    if (secret && secret.length >= 3) out = out.split(secret).join('(已隐藏)')
  }
  return out
}

function formatTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function flag(secure: boolean): string {
  return secure ? 'SSL' : 'STARTTLS'
}

/**
 * 走一遍真实连接并记录完整协议交互，产出可一键复制的脱敏报告。
 * 目的是让用户不必自己描述技术细节，把「说不清」这件事从反馈流程里去掉。
 */
export async function runDiagnostics(input: AccountInput): Promise<DiagReport> {
  const log: string[] = []
  // 用户名与密码都要脱敏：imapflow 会隐藏密码，但用户名会出现在 LOGIN 命令里。
  // 邮箱本地部分单独加一遍兜底——显示名等字段常常就是从它派生的。
  const localParts = [input.email, input.username]
    .map((value) => (value ?? '').split('@')[0])
    .filter((part) => part.length >= 3)
  const secrets = [input.secret, input.username, ...localParts].filter(Boolean)

  const push = (line: string): void => {
    if (log.length >= MAX_LOG_LINES) return
    log.push(maskSecrets(line, secrets))
  }

  // 凭据必须以协议语义脱敏，不能靠字符串匹配：
  // 服务器广告 SASL-IR 时 imapflow 会走 AUTHENTICATE PLAIN，把凭据 base64 内联，
  // 而 base64 里既搜不到明文密码也搜不到用户名。
  let awaitingSaslPayload = false

  const redactProtocolLine = (src: string | undefined, line: string): string => {
    if (src !== 'c') {
      // 服务器返回非续行响应说明没有后续凭据，放弃等待
      if (line.trim() !== '+') awaitingSaslPayload = false
      return line
    }

    if (awaitingSaslPayload) {
      awaitingSaslPayload = false
      return '(凭据已隐藏)'
    }

    const login = line.match(/^(\S+\s+LOGIN\s+).+$/i)
    if (login) return `${login[1]}(凭据已隐藏)`

    const authenticate = line.match(/^(\S+\s+AUTHENTICATE\s+\S+)(?:\s+(.+))?$/i)
    if (authenticate) {
      if (authenticate[2]) return `${authenticate[1]} (凭据已隐藏)`
      awaitingSaslPayload = true
      return authenticate[1]
    }

    return line
  }

  const capture = (entry: unknown): void => {
    if (typeof entry === 'string') {
      push(entry)
      return
    }
    const record = entry as { src?: string; msg?: string }
    if (!record?.msg) return
    const arrow = record.src === 'c' ? '→' : record.src === 's' ? '←' : '·'
    push(`${arrow} ${redactProtocolLine(record.src, record.msg)}`)
  }
  const logger = { debug: capture, info: capture, warn: capture, error: capture }

  let imapOk = false
  let imapReason = ''
  let smtpOk = false
  let smtpReason = ''
  let authFailed = false

  const client = createImapClient(
    {
      host: input.imapHost,
      port: input.imapPort,
      secure: input.imapSecure,
      user: input.username,
      pass: input.secret
    },
    logger
  )

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS, 'IMAP 连接')
    const folders = await listRemoteFolders(client)
    imapOk = true
    imapReason = `连接成功，读取到 ${folders.length} 个文件夹`
    push(
      `文件夹：${folders
        .map((item) => `${item.path}${item.specialUse ? ` ${item.specialUse}` : ''}`)
        .join(' | ')}`
    )
  } catch (error) {
    const info = describeMailError(error)
    imapReason = info.message
    authFailed = authFailed || info.authenticationFailed
    push(`IMAP 错误：${info.message}`)
  } finally {
    try {
      await Promise.race([client.logout(), new Promise((resolve) => setTimeout(resolve, 3000))])
    } catch {
      /* noop */
    }
  }

  const transport = createTransport({
    host: input.smtpHost,
    port: input.smtpPort,
    secure: input.smtpSecure,
    user: input.username,
    pass: input.secret
  })
  try {
    await withTimeout(transport.verify(), CONNECT_TIMEOUT_MS, 'SMTP 连接')
    smtpOk = true
    smtpReason = '连接成功，认证通过'
  } catch (error) {
    const info = describeMailError(error)
    smtpReason = info.message
    authFailed = authFailed || info.authenticationFailed
  } finally {
    transport.close()
  }

  const preset = presetById(input.provider)
  const lines: string[] = [
    'Mail Master 诊断报告',
    `生成时间：${formatTime(new Date())}`,
    `应用版本：${app.getVersion()}`,
    `系统：${process.platform} ${release()} (${arch()})`,
    `运行环境：Electron ${process.versions.electron} / Chrome ${process.versions.chrome} / Node ${process.versions.node}`,
    '',
    '【账号配置】',
    `邮箱：${maskEmail(input.email)}`,
    `服务商：${preset.label}`,
    `用户名：${maskEmail(input.username)}${
      input.username.trim() !== input.email.trim() ? '  ← 与邮箱地址不一致' : ''
    }`,
    `IMAP：${input.imapHost}:${input.imapPort} (${flag(input.imapSecure)})`,
    `SMTP：${input.smtpHost}:${input.smtpPort} (${flag(input.smtpSecure)})`,
    '',
    `【IMAP 结果】${imapOk ? '成功' : '失败'}`,
    `原因：${imapReason}`,
    '',
    `【SMTP 结果】${smtpOk ? '成功' : '失败'}`,
    `原因：${smtpReason}`,
    '',
    '【协议日志】'
  ]

  lines.push(...(log.length ? log : ['(无日志)']))
  lines.push('', '—— 以上内容已脱敏（密码、邮箱本地部分已打码），可直接粘贴给他人 ——')

  return {
    text: lines.join('\n'),
    imapOk,
    smtpOk,
    authFailed
  }
}
