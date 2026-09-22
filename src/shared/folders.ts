/**
 * 文件夹分类规则。
 *
 * 放在 shared 是因为「哪些文件夹不该进未读视图」这条规则既要在主进程建查询，
 * 也要能被测试直接验证。部分服务器（如 163 的 Coremail）不上报 special-use，
 * 所以必须在标记之外再做名称兜底。
 */

const EXCLUDED_SPECIAL_USE = new Set(['\\Junk', '\\Trash', '\\Drafts', '\\Sent'])

/** 垃圾 / 已删除 / 草稿 / 已发送，以及 163 的病毒文件夹 */
const EXCLUDED_NAME =
  /^(junk|junk e-?mail|spam|bulk ?mail|trash|deleted|deleted items|deleted messages|bin|drafts?|已发送|发件箱|寄件备份|草稿|草稿箱|垃圾邮件|垃圾箱|已删除|已删除邮件|回收站|病毒文件夹)$/i

export interface FolderLike {
  name: string
  path: string
  specialUse: string | null
}

/** 是否应从「所有未读」中排除 */
export function isExcludedFromUnread(folder: FolderLike): boolean {
  if (folder.specialUse && EXCLUDED_SPECIAL_USE.has(folder.specialUse)) return true
  return EXCLUDED_NAME.test(folder.name.trim())
}
