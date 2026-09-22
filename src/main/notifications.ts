import { Notification } from 'electron'
import type { NewMailEvent } from '@shared/types'

export interface NewMailNotifyOptions {
  accountName: string
  event: NewMailEvent
  onClick: () => void
}

/**
 * 新邮件的系统通知。
 *
 * 只在窗口不在前台时调用——窗口就在眼前时应用内提示已经够了，
 * 再弹一个系统通知属于重复打扰。
 */
export function notifyNewMail(options: NewMailNotifyOptions): void {
  if (!Notification.isSupported()) return

  const { accountName, event } = options
  const title =
    event.count > 1
      ? `${accountName} 收到 ${event.count} 封新邮件`
      : `${event.latestFrom || '新邮件'} · ${accountName}`

  try {
    const notification = new Notification({
      title,
      body: event.latestSubject ?? '',
      silent: false
    })
    notification.on('click', options.onClick)
    notification.show()
  } catch {
    // 系统通知属于系统集成，失败不应影响收信本身
  }
}
