import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { SendInput } from '@shared/types'
import { describeNoTlsError, isWrongTlsModeError } from './errors'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

export type SmtpTlsMode = 'ssl' | 'starttls' | 'auto'

export const SMTP_TLS_LABEL: Record<SmtpTlsMode, string> = {
  ssl: 'SSL 直连',
  starttls: 'STARTTLS',
  auto: '自动（优先 STARTTLS，服务器不支持时明文）'
}

function makeTransport(
  config: SmtpConfig,
  mode: { secure: boolean; requireTLS: boolean }
): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: mode.secure,
    auth: { user: config.user, pass: config.pass },
    requireTLS: mode.requireTLS,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 90000
  })
}

/**
 * 与 connectImap 同一套语义：「加密」开 = 强加密——隐式 TLS 失败自动改走
 * 强制 STARTTLS，仍不行就明确报错；关 = 尽力加密——有 STARTTLS 就升级，
 * 没有就明文（用户显式选择）。
 */
export async function withSmtpFallback<T>(
  config: SmtpConfig,
  run: (transport: Transporter, tls: SmtpTlsMode) => Promise<T>
): Promise<T> {
  const attempt = async (
    mode: { secure: boolean; requireTLS: boolean },
    tls: SmtpTlsMode
  ): Promise<T> => {
    const transport = makeTransport(config, mode)
    try {
      return await run(transport, tls)
    } finally {
      transport.close()
    }
  }

  if (config.secure) {
    try {
      return await attempt({ secure: true, requireTLS: false }, 'ssl')
    } catch (first) {
      if (!isWrongTlsModeError(first)) throw first
    }
    try {
      return await attempt({ secure: false, requireTLS: true }, 'starttls')
    } catch (second) {
      throw describeNoTlsError(second)
    }
  }

  return attempt({ secure: false, requireTLS: false }, 'auto')
}

export async function verifySmtp(config: SmtpConfig): Promise<SmtpTlsMode> {
  let tls: SmtpTlsMode = 'ssl'
  await withSmtpFallback(config, async (transport, mode) => {
    tls = mode
    await transport.verify()
  })
  return tls
}

export async function sendMail(
  config: SmtpConfig,
  input: SendInput,
  from: { name: string; address: string }
): Promise<void> {
  await withSmtpFallback(config, async (transport) => {
    await transport.sendMail({
      from: from.name ? { name: from.name, address: from.address } : from.address,
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      bcc: input.bcc.length ? input.bcc : undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments.map((item) => ({
        filename: item.filename,
        path: item.path
      }))
    })
  })
}
