import type { Render } from './template.ts'
import type { Segment } from './types.ts'

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
  const media = inputs.media.map((m) => m.assetId)
  const wanted = frame.assetId ? [frame.assetId] : []
  if (media.length !== wanted.length || media.some((id, i) => id !== wanted[i])) return false
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
