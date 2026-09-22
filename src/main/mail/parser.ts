import { simpleParser } from 'mailparser'
import { parse as parseHtml, type HTMLElement } from 'node-html-parser'

export interface AddressItem {
  name: string
  address: string
}

export interface ParsedAttachment {
  filename: string
  mime: string
  size: number
  contentId: string | null
  isInline: boolean
  content: Buffer
}

export interface ParsedMessage {
  subject: string
  fromName: string
  fromAddr: string
  to: AddressItem[]
  cc: AddressItem[]
  date: number
  text: string
  html: string | null
  snippet: string
  attachments: ParsedAttachment[]
}

function normalizeAddresses(input: unknown): AddressItem[] {
  const object = input as { value?: { name?: string; address?: string }[] } | undefined
  if (!object?.value?.length) return []
  return object.value
    .filter((item) => Boolean(item.address))
    .map((item) => ({ name: item.name ?? '', address: item.address ?? '' }))
}

export function makeSnippet(text: string, max = 180): string {
  const flat = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max)}…`
}

export async function parseMessageSource(source: Buffer | string): Promise<ParsedMessage> {
  const mail = await simpleParser(source)
  const from = normalizeAddresses(mail.from)[0]
  const text = (mail.text ?? '').trim()
  const html = typeof mail.html === 'string' ? mail.html : null

  const attachments: ParsedAttachment[] = (mail.attachments ?? []).map((item) => ({
    filename: item.filename ?? '未命名附件',
    mime: item.contentType ?? 'application/octet-stream',
    size: item.size ?? item.content?.length ?? 0,
    contentId: item.contentId ? item.contentId.replace(/^<|>$/g, '') : null,
    isInline: item.contentDisposition === 'inline' || Boolean(item.related),
    content: Buffer.isBuffer(item.content) ? item.content : Buffer.alloc(0)
  }))

  const dateValue = mail.date instanceof Date ? mail.date.getTime() : Date.now()

  return {
    subject: (mail.subject ?? '').trim(),
    fromName: from?.name ?? '',
    fromAddr: from?.address ?? '',
    to: normalizeAddresses(mail.to),
    cc: normalizeAddresses(mail.cc),
    date: dateValue,
    text,
    html,
    snippet: makeSnippet(text || (html ? stripTags(html) : '')),
    attachments
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
}

const DROP_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'noscript',
  'template',
  'frame',
  'frameset'
]

const UNSAFE_URL = /^\s*(javascript|vbscript|data:text\/html)/i

export interface SanitizeOptions {
  blockRemoteImages: boolean
  cidMap?: Map<string, string>
}

export function sanitizeEmailHtml(input: string, options: SanitizeOptions): string {
  let root: HTMLElement
  try {
    root = parseHtml(input, { comment: false })
  } catch {
    return escapeHtml(input).replace(/\n/g, '<br />')
  }

  for (const tag of DROP_TAGS) {
    for (const node of root.querySelectorAll(tag)) node.remove()
  }

  for (const node of root.querySelectorAll('*')) {
    for (const name of Object.keys(node.attributes ?? {})) {
      const lower = name.toLowerCase()
      if (lower.startsWith('on')) {
        node.removeAttribute(name)
        continue
      }
      if (lower === 'href' || lower === 'src' || lower === 'action' || lower === 'srcset') {
        const value = node.getAttribute(name) ?? ''
        if (UNSAFE_URL.test(value)) node.removeAttribute(name)
      }
    }
  }

  for (const img of root.querySelectorAll('img')) {
    const src = (img.getAttribute('src') ?? '').trim()
    if (!src) continue

    if (src.toLowerCase().startsWith('cid:')) {
      const key = src.slice(4).replace(/^<|>$/g, '')
      const dataUrl = options.cidMap?.get(key)
      if (dataUrl) {
        img.setAttribute('src', dataUrl)
      } else {
        img.removeAttribute('src')
      }
      continue
    }

    if (options.blockRemoteImages && /^(https?:)?\/\//i.test(src)) {
      img.setAttribute('data-blocked-src', src)
      img.setAttribute(
        'src',
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      )
      img.setAttribute('data-blocked', '1')
    }
  }

  for (const node of root.querySelectorAll('[data-blocked="1"]')) {
    node.removeAttribute('data-blocked')
  }

  return root.toString()
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const EMAIL_DOC_STYLE = `
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.62;
    color: #1d1d1f;
    word-break: break-word;
    overflow-wrap: anywhere;
    padding: 4px 0 24px;
    background: transparent;
  }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; }
  pre { white-space: pre-wrap; word-break: break-word; }
  a { color: #0a84ff; }
  blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid #e5e5e7;
    color: #6e6e73;
  }
  .mm-blocked-banner {
    font-family: -apple-system, "PingFang SC", sans-serif;
    font-size: 12px;
    color: #8a5a16;
    background: #fdf3e7;
    border: 1px solid #f0d6b0;
    border-radius: 6px;
    padding: 6px 10px;
    margin-bottom: 12px;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #f2f2f7; }
    blockquote { border-left-color: #3a3a3c; color: #a1a1a6; }
    a { color: #64d2ff; }
    .mm-blocked-banner { color: #f0c07a; background: #3a2f1c; border-color: #5a4520; }
  }
`

export function buildEmailDocument(bodyHtml: string, blockedImages: boolean): string {
  const banner = blockedImages
    ? '<div class="mm-blocked-banner">远程图片已被拦截，以保护隐私。点击上方「显示图片」可加载。</div>'
    : ''
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="referrer" content="no-referrer" />
<base target="_blank" />
<style>${EMAIL_DOC_STYLE}</style></head><body>${banner}${bodyHtml}</body></html>`
}

export function buildPlainTextDocument(text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="referrer" content="no-referrer" />
<base target="_blank" />
<style>${EMAIL_DOC_STYLE}
  pre { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif; }
  </style></head><body><pre>${escapeHtml(text)}</pre></body></html>`
}

export function buildCidMap(
  attachments: ParsedAttachment[],
  maxBytes = 1024 * 1024
): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of attachments) {
    if (!item.contentId) continue
    if (!item.mime.startsWith('image/')) continue
    if (item.content.length === 0 || item.content.length > maxBytes) continue
    map.set(item.contentId, `data:${item.mime};base64,${item.content.toString('base64')}`)
  }
  return map
}
