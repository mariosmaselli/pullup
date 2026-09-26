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
// `default` is the one template for text, an image or a clip (templates/default).
const PREFERRED = {
  text: ['default'],
  image: ['default'],
  video: ['default'],
  several: ['media-grid'],
}

// ── Templates folded into Default ──────────────────────────────────────────────────────────
// text-story, text-reveal, image-caption and video-caption became templates/default (their code
// is in git history). A frame saved with one of them opens as Default with what it had: its
// settings and labels under Default's keys, and the old template's own look where Default's
// defaults differ (text-reveal's words rising in and lines leaving, video-caption's fade).

type Params = Record<string, unknown>
type Upgrade = (params: Params, text: Record<string, string>) => { params: Params; text: Params }

// Old key → Default's key, for the values that mean the same there.
const rename = (values: Params, keys: Record<string, string>): Params =>
  Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => (keys[key] ? [[keys[key], value]] : []))
  )
const same = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, key]))
const GROUND = same(Object.keys(BACKGROUND_PARAMS))
const TYPE = same(['weight', 'textPosition', 'textAlign'])
const MEDIA = same(['size', 'scale', 'focusX', 'focusY', 'gradient'])
// image-caption / video-caption: the label (top left) and the date / index (top right).
const CORNERS = { label: 'labelTopLeft', index: 'labelTopRight' }

const LEGACY: Record<string, { duration?: number; upgrade: Upgrade }> = {
  // (`size` was the type size there; in Default it is the media size.)
  'text-story': {
    upgrade: (params) => ({
      params: rename(params, { ...GROUND, ...TYPE, color: 'textColor', size: 'textSize' }),
      text: {},
    }),
  },
  'text-reveal': {
    duration: 5,
    upgrade: (params, text) => ({
      params: {
        animation: 'Reveal',
        revealBy: 'Words',
        exit: 'Rise',
        ...rename(params, {
          ...GROUND,
          ...TYPE,
          color: 'textColor',
          size: 'textSize',
          accent: 'accent',
          reveal: 'revealBy',
          exit: 'exit',
        }),
      },
      text: rename(text, { label: 'labelTopLeft' }),
    }),
  },
  'image-caption': {
    upgrade: (params, text) => ({
      params: rename(params, {
        ...GROUND,
        ...TYPE,
        ...MEDIA,
        color: 'textColor',
        typeSize: 'textSize',
      }),
      text: rename(text, CORNERS),
    }),
  },
  'video-caption': {
    upgrade: (params, text) => {
      // Its Rise came out of a mask line by line: Default's Reveal by lines. Its default was Fade.
      const animation = params.animation ?? 'Fade'
      return {
        params: {
          ...rename(params, {
            ...GROUND,
            ...TYPE,
            ...MEDIA,
            color: 'textColor',
            typeSize: 'textSize',
          }),
          ...(animation === 'Rise' ? { animation: 'Reveal', revealBy: 'Lines' } : { animation }),
        },
        text: rename(text, CORNERS),
      }
    },
  },
}

// The template a frame opens with: one folded into Default becomes Default (see LEGACY) — only
// while its own folder is gone and Default exists; anything else is returned as it is.
export function upgradeTemplate<T extends FrameTemplate | null | undefined>(
  template: T
): T | FrameTemplate {
  const legacy = template ? LEGACY[template.id] : undefined
  const meta = templateMeta('default')
  if (!template || !legacy || !meta || templateMeta(template.id)) return template
  const { id: _, params = {}, text = {}, ...rest } = template
  const next = legacy.upgrade(params, text)
  const upgraded: FrameTemplate = { ...rest, id: meta.id }
  if (upgraded.duration === undefined && legacy.duration !== undefined) {
    upgraded.duration = legacy.duration
  }
  // Only settings that differ from Default's (and are still valid there) are kept.
  const kept = Object.fromEntries(
    Object.entries(changedParams(meta, next.params)).filter(([key, value]) => {
      const spec = meta.params![key]!
      return spec.type !== 'select' || spec.options.includes(String(value))
    })
  )
  if (Object.keys(kept).length) upgraded.params = kept
  const labels = Object.fromEntries(
    Object.entries(next.text).filter(([, value]) => typeof value === 'string' && value)
  ) as Record<string, string>
  if (Object.keys(labels).length) upgraded.text = labels
  return upgraded
}

// Where an old studio link (/templates/text-story…) goes: a template folded into Default opens
// Default — under the same conditions as upgradeTemplate(). Null for anything else.
export function foldedInto(id: string): string | null {
  return LEGACY[id] && !templateMeta(id) && templateMeta('default') ? 'default' : null
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

// The frame with its effective template: its own choice (a template folded into Default opens as
// Default) while that template exists and fits the frame's media, otherwise the default.
export function withTemplate(platform: Platform, frame: Segment, kinds: MediaKind[]): Segment {
  const template = upgradeTemplate(frame.template)
  if (template && compatibleTemplates(platform, kinds).some((meta) => meta.id === template.id)) {
    return template === frame.template ? frame : { ...frame, template }
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
  previous: FrameTemplate | null | undefined,
  id: string
): FrameTemplate {
  const current = upgradeTemplate(previous)
  // The same template (e.g. a folded one "switching" to Default): nothing to drop.
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
