import type { Render } from './template.ts'
import type { Segment } from './types.ts'

// A frame's background image/video (templates/_lib/background.ts), chosen in its Options and kept
// with its template choice — `template.background` on FrameTemplate (declared here, next to the
// helpers that read it).
export interface FrameBackground {
  assetId: string
}

declare module './types.ts' {
  interface FrameTemplate {
    background?: FrameBackground | null
    // The template's other text fields — all but the first, which is the frame's own text — e.g.
    // the corner labels, edited in the frame's Options. Only non-empty values are kept; a field
    // without one renders empty (never the template's sample copy).
    text?: Record<string, string>
  }
}

// Most images/videos one Instagram frame may hold (a slideshow of up to 20).
export const MAX_FRAME_MEDIA = 20

// The frame's media, in order. Older revisions and the AI only set `assetId` (one media). If the
// two disagree (an empty list, or a writer that only knows `assetId` changed it), `assetId` still
// counts as the first media: a frame's media is never dropped silently.
export function frameAssetIds(segment: Segment): string[] {
  const ids = segment.assetIds ?? []
  const first = segment.assetId
  return first && !ids.includes(first) ? [first, ...ids] : ids
}

// The frame's background image/video, if it has one.
export function frameBackgroundId(segment: Segment): string | null {
  const id = segment.template?.background?.assetId
  return typeof id === 'string' && id ? id : null
}

// Every asset the frame shows: its media, then its background. This is the frame's media for
// privacy (post_media rows, the private-media check before a post goes public).
export function frameMediaIds(segment: Segment): string[] {
  const ids = frameAssetIds(segment)
  const background = frameBackgroundId(segment)
  return background && !ids.includes(background) ? [...ids, background] : ids
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

// Does this render still show this frame? Matched by content (template, text fields, media,
// background, settings), not by position — reordering frames keeps their renders.
// A frame without a saved template choice (it uses the editor's default) matches a render of
// any template, as long as its text and media match.
export function renderMatchesFrame(render: Render, frame: Segment): boolean {
  if (render.status !== 'ready') return false
  if (frame.template && render.templateId !== frame.template.id) return false
  const inputs = render.inputs
  // The frame's text went into the template's first text field (renders keep the template's field
  // order), the other fields came from template.text — empty when the frame has none.
  const [mainKey, ...otherKeys] = Object.keys(inputs.text)
  if (mainKey !== undefined && inputs.text[mainKey] !== frame.text) return false
  const extra = frame.template?.text ?? {}
  if (otherKeys.some((key) => (inputs.text[key] ?? '') !== (extra[key] ?? ''))) return false
  // Same media in the same order: adding, removing or reordering media outdates the render.
  const media = inputs.media.map((m) => m.assetId)
  if (!sameList(media, frameAssetIds(frame))) return false
  if ((inputs.background?.assetId ?? null) !== frameBackgroundId(frame)) return false
  if (frame.template?.duration !== undefined && inputs.duration !== frame.template.duration) {
    return false
  }
  return Object.entries(frame.template?.params ?? {}).every(
    ([key, value]) => JSON.stringify(inputs.params[key]) === JSON.stringify(value)
  )
}

// The newest render that matches, else the newest render made for this position (outdated).
export function renderForFrame(
  renders: Render[],
  frame: Segment,
  index: number
): { render: Render | null; current: boolean } {
  const sorted = [...renders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const match = sorted.find((r) => renderMatchesFrame(r, frame))
  if (match) return { render: match, current: true }
  const previous = sorted.find((r) => r.segmentIndex === index && r.status === 'ready')
  return { render: previous ?? null, current: false }
}

// An AI revision returns one `assetId` per frame. Give each returned frame the media list and
// template of the frame it came from (same first media, preferring the same position), so a
// text-only revision keeps slideshows and template choices. A frame whose first media changed
// (the AI picked other visuals) starts fresh.
export function carryOverFrames(previous: Segment[], next: Segment[]): Segment[] {
  const used = new Set<number>()
  const firstOf = (s: Segment) => frameAssetIds(s)[0] ?? null
  return next.map((frame, i) => {
    if (frame.assetIds?.length) return frame
    const first = frame.assetId ?? null
    const matches = (j: number) => !used.has(j) && previous[j] && firstOf(previous[j]!) === first
    // Text frames only match the text frame at the same position; media frames follow their media.
    const from = matches(i) ? i : first ? previous.findIndex((_, j) => matches(j)) : -1
    if (from < 0) return frame
    used.add(from)
    const source = previous[from]!
    const carried: Segment = { ...frame }
    const ids = frameAssetIds(source)
    if (ids.length > 1) carried.assetIds = ids
    if (!frame.template && source.template) carried.template = source.template
    return carried
  })
}
