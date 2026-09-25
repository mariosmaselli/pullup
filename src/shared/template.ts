// The template contract. A template is a folder in pullup/templates/<id>/ with:
//   meta.ts   — `export const meta: TemplateMeta` (light: listed in the UI without loading three)
//   index.ts  — `export default (ctx: TemplateContext) => TemplateInstance`
// Templates run inside a Web Worker on an OffscreenCanvas, in two modes:
//   preview — real time, scaled down, may drop frames
//   render  — frame by frame at full size, encoded to MP4 (video) or JPEG (still)
// Pullup owns both loops. A template never loops, waits for time or reads the clock itself.
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
// - Output is opaque: create WebGL with { alpha: false } / 2D with { alpha: false }, or write alpha 1.
// - Colour: keep the canvas sRGB (three: renderer.outputColorSpace = SRGBColorSpace).
// - Lay out in design units: the design space is 1080 px wide; multiply by ctx.scale.

import type { gsap } from 'gsap'

export type Aspect = '9:16' | '4:5' | '1:1'

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
  '1:1': { width: 1080, height: 1080 },
}

export type ParamSpec =
  | { type: 'color'; label: string; default: string }
  | { type: 'number'; label: string; min: number; max: number; step?: number; default: number }
  | { type: 'select'; label: string; options: string[]; default: string }
  | { type: 'boolean'; label: string; default: boolean }

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
  kind: 'still' | 'video'
  aspects: Aspect[]
  fps?: 30 | 60
  // Seconds. Videos only.
  duration?: { default: number; min: number; max: number }
  // Which media the template takes, in order.
  media: { min: number; max: number; kinds: ('image' | 'video')[]; label?: string }
  text?: Record<
    string,
    { label: string; max?: number; multiline?: boolean; optional?: boolean; default?: string }
  >
  params?: Record<string, ParamSpec>
  fonts?: FontSpec[]
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
  // Canvas pixels per design pixel (design space is 1080 wide).
  scale: number
  aspect: Aspect
  fps: number
  duration: number
  frames: number
  text: Record<string, string>
  params: Record<string, unknown>
  media: MediaInput[]
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
