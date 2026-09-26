import type { Platform } from '@shared/constants.ts'
import type { Asset, FrameTemplate, Segment } from '@shared/types.ts'
import {
  resolveOutputKind,
  type Aspect,
  type MediaInput,
  type OutputKind,
  type TemplateInputs,
  type TemplateMeta,
  type TextFieldSpec,
} from '@shared/template.ts'
import { frameAssetIds } from '@shared/frames.ts'
import { templateMeta, templateMetas } from '../render/templates.ts'
import { BACKGROUND_PARAMS, takesBackground } from '../../../templates/_lib/background.ts'

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
// `default` (templates/default) is the one template for text, an image or a clip.
const PREFERRED = {
  text: ['default', 'text-story'],
  image: ['default', 'image-caption'],
  video: ['default', 'video-caption'],
  several: ['media-grid'],
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
  const template = frame.template
  if (template && compatibleTemplates(platform, kinds).some((meta) => meta.id === template.id)) {
    return frame
  }
  return { ...frame, template: defaultTemplate(platform, kinds) }
}

// The template's text fields the frame edits in its Options: all but the first (that one is the
// frame's own text) — e.g. the corner labels.
export function extraTextFields(meta: TemplateMeta): [string, TextFieldSpec][] {
  return Object.entries(meta.text ?? {}).slice(1)
}

// A new template choice keeps what still applies: the background — the image/video and how it
// sits — when the new template takes one too, and the text fields it shares (the labels).
// Everything else starts from the new template's defaults.
export function switchTemplate(
  current: FrameTemplate | null | undefined,
  id: string
): FrameTemplate {
  if (current?.id === id) return current
  const next = templateMeta(id)
  const template: FrameTemplate = { id }
  if (!next || !current) return template
  if (current.background && takesBackground(next)) {
    template.background = current.background
    const params = Object.fromEntries(
      Object.entries(current.params ?? {}).filter(([key]) => key in BACKGROUND_PARAMS)
    )
    if (Object.keys(params).length) template.params = params
  }
  const fields = new Set(extraTextFields(next).map(([key]) => key))
  const text = Object.fromEntries(
    Object.entries(current.text ?? {}).filter(([key, value]) => fields.has(key) && value)
  )
  if (Object.keys(text).length) template.text = text
  return template
}

// The frame's other text fields with one set (an empty value is removed, not stored).
export function withFrameText(template: FrameTemplate, key: string, value: string): FrameTemplate {
  const { text: _, ...rest } = template
  const { [key]: __, ...others } = template.text ?? {}
  const text = value ? { ...others, [key]: value } : others
  return Object.keys(text).length ? { ...rest, text } : rest
}

// What the frame renders to with this template — a still or a video ('auto' templates decide
// from the media, the background and the settings: e.g. a JPEG when nothing moves).
export function frameOutputKind(
  platform: Platform,
  frame: Segment,
  meta: TemplateMeta,
  kinds: MediaKind[],
  backgroundKind: MediaKind | null
): OutputKind {
  const inputs = frameInputs(platform, frame, meta, [])
  return resolveOutputKind(meta, {
    media: kinds.map((kind) => ({ kind })),
    background: backgroundKind ? { kind: backgroundKind } : null,
    text: inputs.text,
    params: inputs.params,
  })
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
  // The frame's text fills the template's first field; the others come from the frame's Options
  // (template.text) and are otherwise empty: their defaults are sample copy for the Templates
  // studio ("Echo Labs", "(01)"), and a post must never carry details Mario didn't write.
  const textKey = Object.keys(meta.text ?? {})[0]
  const extra = frame.template?.text ?? {}
  const text = Object.fromEntries(
    Object.keys(meta.text ?? {}).map((key) => [key, extra[key] ?? ''])
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
