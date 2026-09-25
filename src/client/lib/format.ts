import type { Asset } from '@shared/types.ts'

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

export function relativeTime(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

export function duration(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export const hostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// Display title: what you typed, else the best thing the source gives us.
export function assetTitle(asset: Asset): string {
  if (asset.title) return asset.title
  if (asset.kind === 'link') return asset.link?.meta?.title ?? hostname(asset.link?.url ?? '')
  if (asset.kind === 'note') return asset.body?.split('\n')[0]?.slice(0, 80) ?? 'Note'
  return asset.file?.originalName ?? 'Untitled'
}

export const isUrl = (text: string) => /^https?:\/\/[^\s]+$/i.test(text.trim())
