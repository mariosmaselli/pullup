import type { Platform } from '@shared/constants.ts'
import type { Asset, FrameTemplate, Segment } from '@shared/types.ts'
import type { Aspect, MediaInput, TemplateInputs, TemplateMeta } from '@shared/template.ts'
import { frameAssetIds } from '@shared/frames.ts'
import { templateMetas } from '../render/templates.ts'

// How Instagram frames map onto templates.

export type MediaKind = 'image' | 'video'

export const frameAspect = (platform: Platform): Aspect => (platform === 'ig_feed' ? '4:5' : '9:16')

// The kind of each media on the frame, in order. The segment only records the first one's kind,
// so the rest come from the asset list (an asset not loaded yet counts as an image).
export function frameMediaKinds(frame: Segment, byId: Map<string, Asset>): MediaKind[] {
  return frameAssetIds(frame).map((id, i) => {
    const kind = byId.get(id)?.kind ?? (i === 0 ? frame.kind : null)
    return kind === 'video' ? 'video' : 'image'
  })
}

// Templates that can render a frame with this media: right format, and they take this many
// media of these kinds (a text frame needs a template without media).
export function compatibleTemplates(platform: Platform, kinds: MediaKind[]): TemplateMeta[] {
  const aspect = frameAspect(platform)
  return templateMetas.filter((meta) => {
    if (!meta.aspects.includes(aspect)) return false
    if (!kinds.length) return meta.media.min === 0
    return (
      meta.media.min <= kinds.length &&
      kinds.length <= meta.media.max &&
      kinds.every((kind) => meta.media.kinds.includes(kind))
    )
  })
}

// First choice per kind of frame; missing templates are skipped, then any compatible one is used.
const PREFERRED = {
  text: ['text-story', 'text-reveal'],
  image: ['image-caption'],
  video: ['video-caption'],
  several: [], // no multi-media template until the new ones land
}

export function defaultTemplate(platform: Platform, kinds: MediaKind[]): FrameTemplate | null {
  const options = compatibleTemplates(platform, kinds)
  const preferred =
    kinds.length === 0
      ? PREFERRED.text
      : kinds.length > 1
        ? PREFERRED.several
        : PREFERRED[kinds[0]!]
  const id = preferred.find((p) => options.some((o) => o.id === p)) ?? options[0]?.id
  return id ? { id } : null
}

// The frame with its effective template: its own choice while that template exists and fits the
// frame's media, otherwise the default.
export function withTemplate(platform: Platform, frame: Segment, kinds: MediaKind[]): Segment {
  if (
    frame.template &&
    compatibleTemplates(platform, kinds).some((meta) => meta.id === frame.template!.id)
  ) {
    return frame
  }
  return { ...frame, template: defaultTemplate(platform, kinds) }
}

// Settings the frame changed from the template's defaults (only these are stored on the frame).
export function changedParams(
  meta: TemplateMeta,
  params: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([key, value]) => {
      const spec = meta.params?.[key]
      if (!spec) return false
      if (spec.type === 'color') return String(value).toLowerCase() !== spec.default.toLowerCase()
      return JSON.stringify(value) !== JSON.stringify(spec.default)
    })
  )
}

// `media` is every media of the frame, resolved in order (see frameAssetIds).
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
