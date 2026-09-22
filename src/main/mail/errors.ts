interface MailErrorDetails {
  code?: string
  responseText?: string
  responseStatus?: string
  executedCommand?: string
  authenticationFailed?: boolean
  responseCode?: string
}

export interface MailErrorInfo {
  message: string
  authenticationFailed: boolean
}

const AUTH_PATTERN =
  /AUTHENTICATIONFAILED|authentication failed|invalid login|login error|password error|unsafe login|auth(entication)? required|bad credentials/i

const AUTH_HINT =
  '请依次确认：① 密码栏填的是邮箱授权码 / 应用专用密码，不是登录密码；② 邮箱地址没有拼错；③ 已在邮箱设置中开启 IMAP 与 SMTP 服务；④ 授权码没有多复制空格。'

export { AUTH_HINT }

/**
 * imapflow 在服务器返回 NO/BAD 时统一抛 `Command failed`，真正的信息在
 * responseText / executedCommand 上；nodemailer 则用 code 区分。
 * 这里把它们还原成用户能看懂、能据此行动的信息。
 *
 * `withHint: false` 用于同时校验 IMAP 与 SMTP 的场景——两边都失败时提示只该出现一次。
 */
export function describeMailError(
  error: unknown,
  options: { withHint?: boolean } = {}
): MailErrorInfo {
  const withHint = options.withHint !== false

  if (!(error instanceof Error)) {
    return { message: String(error), authenticationFailed: false }
  }

  const details = error as Error & MailErrorDetails
  const responseText = details.responseText?.trim()
  const haystack = `${responseText ?? ''} ${details.message ?? ''} ${details.code ?? ''}`

  const authenticationFailed =
    details.authenticationFailed === true ||
    details.code === 'EAUTH' ||
    AUTH_PATTERN.test(haystack)

  if (authenticationFailed) {
    const detail = responseText || details.message || '服务器拒绝了登录'
    return {
      message: withHint ? `认证失败：${detail}。${AUTH_HINT}` : `认证失败：${detail}`,
      authenticationFailed: true
    }
  }

  if (responseText) {
    // executedCommand 里的密码已被 imapflow 以 (* value hidden *) 遮蔽
    const command = details.executedCommand?.trim()
    return {
      message: command ? `${responseText}（失败命令：${command}）` : responseText,
      authenticationFailed: false
    }
  }

  return { message: details.message || '未知错误', authenticationFailed: false }
}

/** 防止服务器无响应时界面一直转圈 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒无响应）`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
