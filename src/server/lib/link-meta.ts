import type { LinkMeta } from '@shared/types.ts'

const MAX_HTML_BYTES = 1.5 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (Macintosh) Pullup/0.1 (+link preview)'

const RASTER_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const decode = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim()

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

const absolute = (value: string | undefined, base: string) => {
  if (!value) return null
  try {
    return new URL(value, base).href
  } catch {
    return null
  }
}

// Extracts Open Graph / Twitter / basic HTML metadata. Pure — exported for tests.
export function parseLinkMeta(html: string, url: string): LinkMeta {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length)
  const meta: Record<string, string> = {}
  for (const [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
    const a = attributes(tag)
    const key = (a.property ?? a.name ?? '').toLowerCase()
    if (key && a.content && !(key in meta)) meta[key] = a.content
  }

  let icon: string | undefined
  for (const [tag] of head.matchAll(/<link\s[^>]*>/gi)) {
    const a = attributes(tag)
    if (/\bicon\b/i.test(a.rel ?? '') && a.href) {
      icon = a.href
      break
    }
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]

  return {
    url,
    title: meta['og:title'] ?? meta['twitter:title'] ?? (titleTag ? decode(titleTag) : null),
    description: meta['og:description'] ?? meta['twitter:description'] ?? meta.description ?? null,
    siteName: meta['og:site_name'] ?? new URL(url).hostname.replace(/^www\./, ''),
    image: absolute(meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'], url),
    icon: absolute(icon ?? '/favicon.ico', url),
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  await reader.cancel().catch(() => {})
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export async function fetchLinkMeta(url: string): Promise<LinkMeta> {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
  })
  if (!res.ok) throw new Error(`Fetching link failed: HTTP ${res.status}`)

  const finalUrl = res.url || url
  const type = res.headers.get('content-type') ?? ''
  if (type.startsWith('image/')) {
    await res.body?.cancel()
    const siteName = new URL(finalUrl).hostname.replace(/^www\./, '')
    return { url: finalUrl, title: null, description: null, siteName, image: finalUrl, icon: null }
  }
  return parseLinkMeta(await readCapped(res, MAX_HTML_BYTES), finalUrl)
}

export async function downloadImage(url: string): Promise<{ bytes: Buffer; ext: string } | null> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': USER_AGENT },
  })
  // Raster formats only: an SVG or HTML "image" could carry script.
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  const ext = RASTER_EXT[type]
  if (!res.ok || !ext) {
    await res.body?.cancel()
    return null
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.byteLength > 20 * 1024 * 1024) return null
  return { bytes, ext }
}
