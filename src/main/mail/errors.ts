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

/** 对明文端口直接做 TLS 握手时的典型报错（143/25 这类端口） */
const WRONG_TLS_PATTERN = /WRONG_VERSION_NUMBER|wrong version number/i

const WRONG_TLS_HINT =
  '请核对端口（IMAP 常用 993、SMTP 常用 465），或在账号设置里调整「加密」选项。'

const AUTH_HINT =
  '请依次确认：① 密码栏填的是邮箱授权码 / 应用专用密码，不是登录密码；② 邮箱地址没有拼错；③ 已在邮箱设置中开启 IMAP 与 SMTP 服务；④ 授权码没有多复制空格。'

export { AUTH_HINT }

/**
 * 该端口上不是隐式 TLS。用于触发「自动改用 STARTTLS」的降级重试：
 * imapflow 对明文端口做 TLS 握手会抛 WRONG_VERSION_NUMBER；
 * doSTARTTLS:true 而服务器不支持时抛 tlsFailed 标记的错误。
 */
export function isWrongTlsModeError(error: unknown): boolean {
  if (!error) return false
  const details = error as Error & { code?: string; tlsFailed?: boolean }
  if (details.tlsFailed === true) return true
  return WRONG_TLS_PATTERN.test(`${details.message ?? ''} ${details.code ?? ''}`)
}

/**
 * SSL 直连与 STARTTLS 都失败后的最终解释。
 * 典型场景：内网企业邮箱只开放 143/25 且完全不支持加密。
 * 认证类错误原样返回——密码错了就该报密码错，不该被包装成「服务器不支持加密」。
 */
export function describeNoTlsError(error: unknown): Error {
  const details = error as Error & { tlsFailed?: boolean; code?: string }
  const raw = `${details.message ?? ''} ${details.code ?? ''}`
  if (!AUTH_PATTERN.test(raw)) {
    return new Error(
      '无法与服务器建立加密连接（SSL 直连与 STARTTLS 均失败）。' +
        '如果这是公司内网邮箱，关闭账号设置里的「加密」后可以继续使用' +
        '（密码将以明文传输，仅建议内网环境）；否则请核对端口或联系邮箱管理员。' +
        `技术细节：${details.message ?? String(error)}`
    )
  }
  return details
}

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

  if (WRONG_TLS_PATTERN.test(haystack)) {
    return {
      message: `加密方式与端口不匹配：这个端口不是 SSL 端口。${WRONG_TLS_HINT}`,
      authenticationFailed: false
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
