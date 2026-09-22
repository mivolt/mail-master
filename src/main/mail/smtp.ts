import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { SendInput } from '@shared/types'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

export function createTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    requireTLS: !config.secure,
    tls: { minVersion: 'TLSv1.2' },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 90000
  })
}

export async function verifySmtp(config: SmtpConfig): Promise<void> {
  const transport = createTransport(config)
  try {
    await transport.verify()
  } finally {
    transport.close()
  }
}

export async function sendMail(
  config: SmtpConfig,
  input: SendInput,
  from: { name: string; address: string }
): Promise<void> {
  const transport = createTransport(config)
  try {
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
  } finally {
    transport.close()
  }
}
