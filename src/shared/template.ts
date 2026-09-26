// The template contract. A template is a folder in pullup/templates/<id>/ with:
//   meta.ts   — `export const meta: TemplateMeta` (light: listed in the UI without loading three)
//   index.ts  — `export default (ctx: TemplateContext) => TemplateInstance`
// Templates run inside a Web Worker on an OffscreenCanvas, in two modes:
//   preview — real time, scaled down, may drop frames
//   render  — frame by frame at full size, encoded to MP4 (video) or JPEG (still)
// Pullup owns both loops. A template never loops, waits for time or reads the clock itself.
// What a render produces is the template's `kind`: always a still, always a video, or 'auto' —
// decided per render by meta.outputKind(inputs) (e.g. a JPEG when nothing moves, else an MP4).
//
// RULES (they make every render reproducible and scrubbing exact):
// - Time comes only from `t` in update(). No performance.now, Date, rAF, setTimeout, video.play().
// - update(t, frame) must depend only on t/frame and state built in setup(): scrubbing jumps around.
// - GSAP: build tweens on ctx.timeline() timelines (created paused); Pullup seeks them to t.
//   onUpdate/onComplete callbacks don't fire — tween values and read them in update().
//   DOM plugins (SplitText, ScrollTrigger, Flip…) are unavailable: there is no DOM.
// - Randomness: ctx.random() only in setup(); per-frame noise via ctx.hash(frame, k).
// - Text: load fonts with ctx.font() and lay text out in setup() (ctx.layoutText); per-frame drawing
//   of the laid-out words/lines is fine.
// - Video: call ctx.video(i).seek(localTime) in update(); read `.frame` in render().
// - Background (ctx.background: a colour, image or video): spread BACKGROUND_PARAMS into
//   meta.params and draw it with templates/_lib/background.ts, first.
// - Output is opaque: create WebGL with { alpha: false } / 2D with { alpha: false }, or write alpha 1.
// - Colour: keep the canvas sRGB (three: renderer.outputColorSpace = SRGBColorSpace).
// - Lay out in design units: the design space is 1080 px on the frame's short side (1080 wide
//   for portrait and square frames, 1080 tall for 16:9); multiply by ctx.scale.

import type { gsap } from 'gsap'

// Output formats — the one list everything else derives from (render route, studio, labels).
// Stories/reels 9:16, feed 4:5, square 1:1, wide 16:9 (X, LinkedIn, YouTube, presentations).
export const ASPECTS = ['9:16', '4:5', '1:1', '16:9'] as const
export type Aspect = (typeof ASPECTS)[number]

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
}

export const ASPECT_LABEL: Record<Aspect, string> = {
  '9:16': 'Story 9:16',
  '4:5': 'Feed 4:5',
  '1:1': 'Square',
  '16:9': 'Wide 16:9',
}

// Canvas px per design px for a canvas of this size (design space: 1080 on the short side).
export const designScale = (width: number, height: number) => Math.min(width, height) / 1080

// When a control is shown (it only hides controls that would do nothing; the value still applies):
// `param` — while that param's value is one of `is`; `media` — while the template has (true) or
// has no (false) media. Both must hold when both are set. Data only (meta is sent to workers).
export interface ParamWhen {
  param?: string
  is?: string[]
  media?: boolean
}

export type ParamSpec = (
  | { type: 'color'; label: string; default: string }
  | { type: 'number'; label: string; min: number; max: number; step?: number; default: number }
  | { type: 'select'; label: string; options: string[]; default: string }
  | { type: 'boolean'; label: string; default: boolean }
) & { when?: ParamWhen }

// Is this control shown for these (complete) params and this many media?
export function paramVisible(
  spec: ParamSpec,
  state: { params: Record<string, unknown>; media: number }
): boolean {
  const when = spec.when
  if (!when) return true
  if (when.param && when.is && !when.is.includes(String(state.params[when.param]))) return false
  if (when.media !== undefined && when.media !== state.media > 0) return false
  return true
}

// What one render produces: a JPEG ('still', one frame at t = 0) or an MP4 ('video').
export type OutputKind = 'still' | 'video'

// What meta.outputKind() decides from: the kinds of the media and background, and the text and
// params with the template's defaults filled in.
export interface OutputKindInputs {
  media: readonly { kind: 'image' | 'video' }[]
  background?: { kind: 'image' | 'video' } | null
  text: Record<string, string>
  params: Record<string, unknown>
}

export interface TextFieldSpec {
  label: string
  max?: number
  multiline?: boolean
  optional?: boolean
  default?: string
}

export interface FontSpec {
  family: string
  // A file in the library's fonts/ folder (e.g. 'PPNeueMontreal-Regular.ttf').
  file: string
  weight?: string
  style?: string
}

export interface TemplateMeta {
  id: string
  name: string
  description: string
  // Bump when the output of the same inputs changes; stored with every render.
  version: number
  // 'still' (JPEG), 'video' (MP4), or 'auto': decided per render by outputKind() — read it through
  // resolveOutputKind(), never from `kind` directly.
  kind: OutputKind | 'auto'
  // 'auto' templates: what these inputs render to (a still when nothing moves). Keep it pure and
  // light — it runs on the main thread for every settings change. Missing: 'video'.
  outputKind?: (inputs: OutputKindInputs) => OutputKind
  aspects: Aspect[]
  fps?: 30 | 60
  // Seconds. Videos and 'auto' templates.
  duration?: { default: number; min: number; max: number }
  // Which media the template takes, in order.
  media: { min: number; max: number; kinds: ('image' | 'video')[]; label?: string }
  // Text fields. In the builder the FIRST field is the frame's text; the others are edited in the
  // frame's Options and start empty there (defaults are sample copy for the Templates studio).
  text?: Record<string, TextFieldSpec>
  params?: Record<string, ParamSpec>
  fonts?: FontSpec[]
}

// Params with the template's defaults filled in (stored inputs may lack newer keys).
export function withDefaultParams(
  meta: TemplateMeta,
  params: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...params,
    ...Object.fromEntries(
      Object.entries(meta.params ?? {}).map(([key, spec]) => [key, params[key] ?? spec.default])
    ),
  }
}

// What these inputs render to. 'auto' asks the template (with defaults filled in); a template
// whose outputKind() throws renders a video (it can show anything a still can).
export function resolveOutputKind(
  meta: TemplateMeta,
  inputs: Partial<OutputKindInputs> = {}
): OutputKind {
  if (meta.kind !== 'auto') return meta.kind
  if (!meta.outputKind) return 'video'
  const text = Object.fromEntries(
    Object.entries(meta.text ?? {}).map(([key, spec]) => [
      key,
      inputs.text?.[key] ?? spec.default ?? '',
    ])
  )
  try {
    return meta.outputKind({
      media: inputs.media ?? [],
      background: inputs.background ?? null,
      text,
      params: withDefaultParams(meta, inputs.params),
    }) === 'still'
      ? 'still'
      : 'video'
  } catch {
    return 'video'
  }
}

// Does the template ever render a video (it has a duration to set)?
export const canAnimate = (meta: TemplateMeta) => meta.kind !== 'still'

// The stored render kind for an output kind.
export const renderKindOf = (kind: OutputKind): Render['kind'] =>
  kind === 'still' ? 'image' : 'video'

// The meta without its functions — what is posted to a render worker (functions don't clone).
export function metaData(meta: TemplateMeta): TemplateMeta {
  const { outputKind: _, ...data } = meta
  return data
}

export interface MediaInput {
  assetId: string
  kind: 'image' | 'video'
  // Image: the original (or its JPEG preview for HEIC). Video: the render proxy.
  url: string
  width: number
  height: number
  duration?: number
}

export interface TemplateInputs {
  aspect: Aspect
  duration: number
  media: MediaInput[]
  text: Record<string, string>
  params: Record<string, unknown>
  seed: number
  // An image or video from the library drawn behind everything (templates/_lib/background.ts).
  // Absent / null: the plain `background` colour.
  background?: MediaInput | null
}

export interface VideoLayer {
  readonly duration: number
  readonly width: number
  readonly height: number
  // Request the frame shown at this local time (seconds). Resolved by Pullup before render().
  seek(localTime: number): void
  // The resolved frame (closed by Pullup when replaced). Null until the first frame decodes.
  readonly frame: VideoFrame | null
  // Increments whenever `frame` changes — re-upload textures when it does.
  readonly version: number
}

// TemplateInputs.background, resolved like media: an image as an upright sRGB bitmap (at most
// 2160 px on the short side; Pullup closes it — don't), a video as a layer (seek it only when the
// background is drawn). Draw it with templates/_lib/background.ts rather than by hand.
export interface BackgroundSource {
  kind: 'image' | 'video'
  // Display size of the bitmap / video, for placing it.
  width: number
  height: number
  image?: ImageBitmap
  video?: VideoLayer
}

export interface TextLine {
  text: string
  x: number
  y: number
  width: number
  words: { text: string; x: number; width: number }[]
}

export interface TextLayout {
  font: string
  size: number
  lineHeight: number
  lines: TextLine[]
  width: number
  height: number
}

export interface LayoutTextOptions {
  family: string
  weight?: string
  size: number
  lineHeight?: number
  maxWidth: number
  letterSpacing?: number
}

export interface TemplateContext {
  canvas: OffscreenCanvas
  mode: 'preview' | 'render'
  width: number
  height: number
  // Canvas pixels per design pixel (design space is 1080 on the short side).
  scale: number
  aspect: Aspect
  // What this render produces (resolved from meta.kind / meta.outputKind). A still has
  // duration 0 and one frame at t = 0: draw the settled state.
  kind: OutputKind
  fps: number
  duration: number
  frames: number
  text: Record<string, string>
  params: Record<string, unknown>
  media: MediaInput[]
  // The background image/video, loaded before setup(). Null without one.
  background: BackgroundSource | null
  seed: number
  // Seeded PRNG in [0,1). setup() only.
  random(): number
  // Stateless noise in [0,1) for a frame and channel — safe in update().
  hash(frame: number, k?: number): number
  // Upright (EXIF-applied), sRGB image, at most 2160 px on the long side.
  image(i: number): Promise<ImageBitmap>
  video(i: number): VideoLayer
  font(family: string): Promise<void>
  // Word-wraps text with canvas metrics (in canvas pixels). setup() only.
  layoutText(text: string, options: LayoutTextOptions): TextLayout
  timeline(vars?: gsap.TimelineVars): gsap.core.Timeline
  gsap: typeof gsap
  signal: AbortSignal
}

export interface TemplateInstance {
  setup(): Promise<void>
  update(t: number, frame: number): void
  render(): void
  dispose(): void
}

export type TemplateFactory = (ctx: TemplateContext) => TemplateInstance

// ── Renders (server ↔ client) ────────────────────────────────────────────────────────────────

export interface Render {
  id: string
  templateId: string
  templateVersion: number
  kind: 'video' | 'image'
  aspect: Aspect
  width: number
  height: number
  fps: number | null
  durationMs: number | null
  inputs: TemplateInputs
  status: 'pending' | 'ready' | 'failed'
  error: string | null
  warnings: string[]
  url: string | null
  posterUrl: string | null
  sizeBytes: number | null
  elapsedMs: number | null
  postId: string | null
  segmentIndex: number | null
  createdAt: string
}
