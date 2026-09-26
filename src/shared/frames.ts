import type { Render } from './template.ts'
import type { Segment } from './types.ts'

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

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

// Does this render still show this frame? Matched by content (template, text, media, settings),
// not by position — reordering frames keeps their renders.
// A frame without a saved template choice (it uses the editor's default) matches a render of
// any template, as long as its text and media match.
export function renderMatchesFrame(render: Render, frame: Segment): boolean {
  if (render.status !== 'ready') return false
  if (frame.template && render.templateId !== frame.template.id) return false
  const inputs = render.inputs
  // Frame text goes into the template's main text field.
  if (frame.text.trim() && !Object.values(inputs.text).includes(frame.text)) return false
  // Same media in the same order: adding, removing or reordering media outdates the render.
  const media = inputs.media.map((m) => m.assetId)
  if (!sameList(media, frameAssetIds(frame))) return false
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
