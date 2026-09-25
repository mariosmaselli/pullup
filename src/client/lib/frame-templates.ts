import type { Platform } from '@shared/constants.ts'
import type { FrameTemplate, Segment } from '@shared/types.ts'
import type { Aspect, MediaInput, TemplateInputs, TemplateMeta } from '@shared/template.ts'
import { templateMeta, templateMetas } from '../render/templates.ts'

// How Instagram frames map onto templates.

export const frameAspect = (platform: Platform): Aspect => (platform === 'ig_feed' ? '4:5' : '9:16')

// Templates that can render this frame: right format, and they take (or don't need) its media.
export function compatibleTemplates(platform: Platform, frame: Segment): TemplateMeta[] {
  const aspect = frameAspect(platform)
  return templateMetas.filter((meta) => {
    if (!meta.aspects.includes(aspect)) return false
    if (!frame.assetId) return meta.media.min === 0
    const kind = frame.kind === 'video' ? 'video' : 'image'
    return meta.media.max >= 1 && meta.media.min <= 1 && meta.media.kinds.includes(kind)
  })
}

const PREFERRED: Record<'text' | 'image' | 'video', string[]> = {
  text: ['text-story', 'text-reveal', 'case-study-cover'],
  image: ['image-caption', 'slow-zoom', 'device-frame'],
  video: ['slow-zoom', 'device-frame'],
}

export function defaultTemplate(platform: Platform, frame: Segment): FrameTemplate | null {
  const options = compatibleTemplates(platform, frame)
  const kind = !frame.assetId ? 'text' : frame.kind === 'video' ? 'video' : 'image'
  const id = PREFERRED[kind].find((p) => options.some((o) => o.id === p)) ?? options[0]?.id
  return id ? { id } : null
}

// The frame with its effective template (its own choice, or the default).
export function withTemplate(platform: Platform, frame: Segment): Segment {
  if (frame.template && templateMeta(frame.template.id)) return frame
  return { ...frame, template: defaultTemplate(platform, frame) }
}

export function frameInputs(
  platform: Platform,
  frame: Segment,
  meta: TemplateMeta,
  media: MediaInput[]
): TemplateInputs {
  // The frame's text fills the template's main field. Optional fields start empty: their defaults
  // are sample copy for the Templates studio ("Echo Labs", "(01)"), and a post must never carry
  // details Mario didn't write.
  const textKey = Object.keys(meta.text ?? {})[0]
  const text = Object.fromEntries(
    Object.entries(meta.text ?? {}).map(([key, spec]) => [
      key,
      spec.optional ? '' : (spec.default ?? ''),
    ])
  )
  if (textKey) text[textKey] = frame.text
  const params = Object.fromEntries(
    Object.entries(meta.params ?? {}).map(([key, spec]) => [key, spec.default])
  )
  return {
    aspect: frameAspect(platform),
    duration: frame.template?.duration ?? meta.duration?.default ?? 0,
    media,
    text,
    params: { ...params, ...(frame.template?.params ?? {}) },
    seed: 1,
  }
}
