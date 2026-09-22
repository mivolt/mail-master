import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import MailComposer from 'nodemailer/lib/mail-composer'
import {
  createImapClient,
  fetchFolderMetadata,
  fetchMessageSources,
  folderStatus,
  isInbox,
  isSentLike,
  listRemoteFolders,
  setFlaggedFlag,
  setSeenFlag
} from '../src/main/mail/imap'
import { parseMessageSource } from '../src/main/mail/parser'
import { describeMailError } from '../src/main/mail/errors'
import { isExcludedFromUnread } from '../src/shared/folders'

const require = createRequire(import.meta.url)

interface FakeServer {
  listen: (port: number, host: string, callback: () => void) => void
  close: (callback: () => void) => void
  server: { address: () => AddressInfo }
}

const hoodiecrow = require('hoodiecrow-imap') as (options: unknown) => FakeServer

const results: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, condition: boolean, detail = ''): void {
  results.push({ name, ok: condition, detail })
}

function buildRaw(options: Record<string, unknown>): Promise<Buffer> {
  const composer = new MailComposer(options)
  return new Promise((resolve, reject) => {
    composer.compile().build((error, message) => {
      if (error) reject(error)
      else resolve(message)
    })
  })
}

const message1 = await buildRaw({
  from: '"张三" <zhangsan@example.com>',
  to: 'me@example.com',
  subject: '第一封：普通邮件',
  text: '这是第一封邮件的正文。'
})

const message2 = await buildRaw({
  from: '"Li Si" <lisi@example.com>',
  to: 'me@example.com',
  subject: '第二封：带附件',
  text: '第二封邮件正文。',
  attachments: [{ filename: '数据.csv', content: Buffer.from('a,b\n1,2\n') }]
})

const message3 = await buildRaw({
  from: '"王五" <wangwu@example.com>',
  to: 'me@example.com',
  subject: '第三封：中文主题测试',
  html: '<p>HTML 正文</p>',
  text: '纯文本正文'
})

const sentMessage = await buildRaw({
  from: '"我" <me@example.com>',
  to: 'someone@example.com',
  subject: '已发送的邮件',
  text: '已发送正文'
})

const server = hoodiecrow({
  plugins: [
    'ID',
    'SASL-IR',
    'AUTH-PLAIN',
    'NAMESPACE',
    'IDLE',
    'ENABLE',
    'LITERALPLUS',
    'UNSELECT',
    'SPECIAL-USE',
    'CREATE-SPECIAL-USE'
  ],
  id: { name: 'hoodiecrow', version: '1.0' },
  secureConnection: true,
  storage: {
    INBOX: {
      messages: [
        { raw: message1.toString('utf8') },
        { raw: message2.toString('utf8'), flags: ['\\Seen'] },
        { raw: message3.toString('utf8') }
      ]
    },
    '': {
      separator: '/',
      folders: {
        'Sent Mail': { 'special-use': '\\Sent', messages: [{ raw: sentMessage.toString('utf8') }] },
        Drafts: { 'special-use': '\\Drafts' },
        Trash: { 'special-use': '\\Trash' }
      }
    }
  }
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.server.address().port
check('启动 IMAP 测试服务器', port > 0, `127.0.0.1:${port}`)

const client = createImapClient({
  host: '127.0.0.1',
  port,
  secure: true,
  user: 'testuser',
  pass: 'testpass'
})

try {
  await client.connect()
  check('IMAP 连接与登录成功', client.usable === true, `state=${client.state}`)

  const folders = await listRemoteFolders(client)
  const paths = folders.map((item) => item.path)
  check('列出文件夹', folders.length >= 4, paths.join(', '))
  check('包含 INBOX', paths.includes('INBOX'), paths.join(', '))
  check(
    'INBOX 被识别为收件箱',
    folders.some((item) => isInbox(item)),
    folders.map((item) => `${item.path}:${item.specialUse ?? 'null'}`).join(' | ')
  )
  check(
    '已发送文件夹被识别（special-use）',
    folders.some((item) => isSentLike(item)),
    folders.find((item) => isSentLike(item))?.path ?? '未识别'
  )

  // 部分 Coremail 部署不给「已发送」打 \Sent，需按名称兜底
  check(
    '已发送识别：按名称兜底（中文）',
    isSentLike({ name: '已发送', specialUse: null }) === true,
    ''
  )
  check(
    '已发送识别：按名称兜底（英文）',
    isSentLike({ name: 'Sent Items', specialUse: null }) === true,
    ''
  )
  check(
    '已发送识别：普通文件夹不误判',
    isSentLike({ name: '工作', specialUse: null }) === false,
    ''
  )
  check(
    '已发送识别：不误判「已发送的草稿」类名称',
    isSentLike({ name: '已发送备份', specialUse: null }) === false,
    ''
  )

  // 「所有未读」视图要排除垃圾/已删除/草稿/已发送，部分服务器不上报 special-use
  check(
    '未读视图排除：按 special-use',
    isExcludedFromUnread({ name: '随便', path: 'X', specialUse: '\\Junk' }) === true &&
      isExcludedFromUnread({ name: '随便', path: 'X', specialUse: '\\Trash' }) === true &&
      isExcludedFromUnread({ name: '随便', path: 'X', specialUse: '\\Drafts' }) === true &&
      isExcludedFromUnread({ name: '随便', path: 'X', specialUse: '\\Sent' }) === true,
    ''
  )
  check(
    '未读视图排除：按中文名称兜底（163 场景）',
    isExcludedFromUnread({ name: '垃圾邮件', path: '垃圾邮件', specialUse: null }) === true &&
      isExcludedFromUnread({ name: '已删除', path: '已删除', specialUse: null }) === true &&
      isExcludedFromUnread({ name: '草稿箱', path: '草稿箱', specialUse: null }) === true &&
      isExcludedFromUnread({ name: '已发送', path: '已发送', specialUse: null }) === true &&
      isExcludedFromUnread({ name: '病毒文件夹', path: '病毒文件夹', specialUse: null }) === true,
    ''
  )
  check(
    '未读视图排除：按英文名称兜底',
    isExcludedFromUnread({ name: 'Spam', path: 'Spam', specialUse: null }) === true &&
      isExcludedFromUnread({ name: 'Deleted Items', path: 'Deleted Items', specialUse: null }) ===
        true &&
      isExcludedFromUnread({ name: 'Drafts', path: 'Drafts', specialUse: null }) === true,
    ''
  )
  check(
    '未读视图排除：正常文件夹与广告/订阅类保留',
    isExcludedFromUnread({ name: 'INBOX', path: 'INBOX', specialUse: null }) === false &&
      isExcludedFromUnread({ name: '广告邮件', path: '广告邮件', specialUse: null }) === false &&
      isExcludedFromUnread({ name: '订阅邮件', path: '订阅邮件', specialUse: null }) === false &&
      isExcludedFromUnread({ name: '工作', path: '工作', specialUse: null }) === false,
    ''
  )

  const meta = await fetchFolderMetadata(client, 'INBOX', 50)
  check('读取收件箱元数据', meta.messages.length === 3, `${meta.messages.length} 封`)
  check('读取邮件总数', meta.total === 3, String(meta.total))
  check('读取 uidValidity', meta.uidValidity > 0, String(meta.uidValidity))

  const bySubject = new Map(meta.messages.map((item) => [item.subject, item]))

  const first = bySubject.get('第一封：普通邮件')
  check('解析信封主题', Boolean(first), [...bySubject.keys()].join(' | '))
  check('解析发件人显示名', first?.fromName === '张三', first?.fromName ?? '')
  check('解析发件人地址', first?.fromAddr === 'zhangsan@example.com', first?.fromAddr ?? '')
  check('解析收件人 JSON', (first?.toJson ?? '').includes('me@example.com'), first?.toJson ?? '')
  check('解析日期为有效时间戳', (first?.date ?? 0) > 1_600_000_000_000, String(first?.date))
  check('解析邮件大小', (first?.size ?? 0) > 0, String(first?.size))
  check('未读状态解析正确', first?.isRead === false, String(first?.isRead))
  check('无附件判定正确', first?.hasAttachments === false, String(first?.hasAttachments))

  const second = bySubject.get('第二封：带附件')
  check('已读标记解析正确（\\Seen）', second?.isRead === true, String(second?.isRead))
  check('附件检测（BODYSTRUCTURE）', second?.hasAttachments === true, String(second?.hasAttachments))

  const third = bySubject.get('第三封：中文主题测试')
  check('中文主题解析正确', Boolean(third), third?.subject ?? '未找到')

  const sources = await fetchMessageSources(
    client,
    'INBOX',
    meta.messages.map((item) => item.uid)
  )
  check('批量拉取原文', sources.size === 3, `${sources.size} 封`)

  const secondUid = meta.messages.find((item) => item.subject === '第二封：带附件')?.uid ?? 0
  const rawSecond = sources.get(secondUid)
  check('拿到指定邮件的原文', Boolean(rawSecond), `${rawSecond?.length ?? 0} 字节`)

  if (rawSecond) {
    const parsed = await parseMessageSource(rawSecond)
    check('原文可被完整解析', parsed.subject === '第二封：带附件', parsed.subject)
    check(
      '解析出的附件文件名正确',
      parsed.attachments[0]?.filename === '数据.csv',
      parsed.attachments[0]?.filename ?? '未找到'
    )
    check(
      '解析出的附件内容正确',
      parsed.attachments[0]?.content.toString() === 'a,b\n1,2\n',
      JSON.stringify(parsed.attachments[0]?.content.toString())
    )
  }

  const statuses = await folderStatus(client, ['INBOX', 'Sent Mail'])
  check('查询 INBOX 状态', statuses.get('INBOX')?.messages === 3, JSON.stringify(statuses.get('INBOX')))
  check('查询 INBOX 未读数', statuses.get('INBOX')?.unseen === 2, String(statuses.get('INBOX')?.unseen))
  check(
    '查询已发送状态',
    statuses.get('Sent Mail')?.messages === 1,
    JSON.stringify(statuses.get('Sent Mail'))
  )

  const sentMeta = await fetchFolderMetadata(client, 'Sent Mail', 20)
  check('读取已发送文件夹邮件', sentMeta.messages[0]?.subject === '已发送的邮件', sentMeta.messages[0]?.subject ?? '')

  await setSeenFlag(client, 'INBOX', first?.uid ?? 0, true)
  const afterSeen = await fetchFolderMetadata(client, 'INBOX', 50)
  const firstAfter = afterSeen.messages.find((item) => item.uid === first?.uid)
  check('标记已读同步到服务器', firstAfter?.isRead === true, String(firstAfter?.isRead))

  await setFlaggedFlag(client, 'INBOX', first?.uid ?? 0, true)
  const afterFlag = await fetchFolderMetadata(client, 'INBOX', 50)
  const firstFlagged = afterFlag.messages.find((item) => item.uid === first?.uid)
  check('加星标同步到服务器', firstFlagged?.isStarred === true, String(firstFlagged?.isStarred))

  await setFlaggedFlag(client, 'INBOX', first?.uid ?? 0, false)
  const afterUnflag = await fetchFolderMetadata(client, 'INBOX', 50)
  const firstUnflagged = afterUnflag.messages.find((item) => item.uid === first?.uid)
  check('取消星标同步到服务器', firstUnflagged?.isStarred === false, String(firstUnflagged?.isStarred))

  // 认证失败的错误形状：imapflow 抛的是通用 "Command failed"，
  // 必须能从附带的字段还原出「认证失败」这一事实。
  const badClient = createImapClient({
    host: '127.0.0.1',
    port,
    secure: true,
    user: 'testuser',
    pass: 'definitely-wrong-password'
  })
  let authError: unknown = null
  try {
    await badClient.connect()
  } catch (error) {
    authError = error
  }
  check('错误密码导致连接失败', authError !== null, '')
  const authInfo = describeMailError(authError)
  check('错误密码被识别为认证失败', authInfo.authenticationFailed === true, authInfo.message)
  check(
    '认证失败信息不是裸的 Command failed',
    authInfo.message !== 'Command failed' && authInfo.message.length > 12,
    authInfo.message
  )
  try {
    await badClient.logout()
  } catch {
    /* noop */
  }
} catch (error) {
  check('IMAP 测试执行未抛异常', false, error instanceof Error ? error.message : String(error))
} finally {
  try {
    await client.logout()
  } catch {
    /* noop */
  }
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

const failed = results.filter((item) => !item.ok)
for (const item of results) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  → ${item.detail}` : ''}`)
}
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log(`失败项：${failed.map((item) => item.name).join('、')}`)
  process.exitCode = 1
}
