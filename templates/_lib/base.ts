import type {
  FontSpec,
  OutputKind,
  OutputKindInputs,
  ParamSpec,
  TemplateContext,
  TextFieldSpec,
  TextLayout,
} from '@shared/template.ts'
import { parseAccents, type MarkedWord, type Segment } from './accent.ts'
import {
  FRAME_MARGINS,
  MEDIA_SIZE_PARAMS,
  TEXT_POSITION_PARAMS,
  mediaRect,
  mediaSize,
  textBlockY,
  textLineX,
  textPlacement,
  type Rect,
  type TextAlign,
  type TextPosition,
} from './layout.ts'
import { STORY_TYPE } from './text.ts'

// The BASE LAYER: everything a template shows on top of its picture — a caption in Mario's story
// type and four small corner labels — laid out, animated and drawn the same way everywhere, plus
// the legibility gradient where that type sits over media. Canvas 2D; three.js templates
// composite it with createBaseOverlay() (_lib/base-three.ts).
//
//   meta.ts   text: TEXT_FIELDS
//             params: { ...MEDIA_PARAMS, ...TEXT_PARAMS, ...SCRIM_PARAMS, ...BACKGROUND_PARAMS }
//             fonts: BASE_FONTS,  kind: 'auto',  outputKind: baseOutputKind
//   index.ts  setup():  base = await createBase(ctx)            (loads the font, lays out, times)
//             update(t): base.update(t)
//             render():  …ground, media…;  base.draw(g, mediaRect)   (scrim over the media + type)
//
// At the defaults (no labels, animation None) the caption is text-story exactly: 84 px PP Neue
// Montreal, 0.98 line height, −1% tracking, line boxes on the margins (160 px on stories), the
// same line breaks and shrink-to-fit. Reveal + exit Rise is text-reveal's motion (words or lines
// rising out of per-line masks, expo.out; lines leaving through the top of their masks).
// This file stays light at module level: meta.ts files import the field and param groups.

export const BASE_FAMILY = 'PP Neue Montreal'

export const BASE_FONTS: FontSpec[] = [
  { family: BASE_FAMILY, file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
  { family: BASE_FAMILY, file: 'PPNeueMontreal-Medium.otf', weight: '500' },
]

// ── Text fields ─────────────────────────────────────────────────────────────────────────────
// The caption comes first: in the builder it is the frame's text. The labels start empty (they
// are optional; a post never carries sample copy), and at their defaults the layer is text-story.

export const CAPTION_FIELD = {
  caption: {
    label: 'Text — *accent*',
    multiline: true,
    max: 220,
    optional: true,
    default:
      'Finally got a new phone! 🎉 Better late than never—now I can start thanking everyone for last week.',
  },
} satisfies Record<string, TextFieldSpec>

export const LABEL_FIELDS = {
  labelTopLeft: { label: 'Top left', max: 40, optional: true, default: '' },
  labelTopRight: { label: 'Top right', max: 40, optional: true, default: '' },
  labelBottomLeft: { label: 'Bottom left', max: 40, optional: true, default: '' },
  labelBottomRight: { label: 'Bottom right', max: 40, optional: true, default: '' },
} satisfies Record<string, TextFieldSpec>

export type LabelKey = keyof typeof LABEL_FIELDS
export const LABEL_KEYS = Object.keys(LABEL_FIELDS) as LabelKey[]

export const TEXT_FIELDS = { ...CAPTION_FIELD, ...LABEL_FIELDS } satisfies Record<
  string,
  TextFieldSpec
>

// ── Params ──────────────────────────────────────────────────────────────────────────────────

export const ANIMATIONS = ['None', 'Fade', 'Rise', 'Reveal'] as const
export const EXITS = ['None', 'Fade', 'Rise'] as const
export type Animation = (typeof ANIMATIONS)[number]
export type Exit = (typeof EXITS)[number]

// Type: colour, size, weight, where it sits, accent colour for *words*, how it comes in and
// leaves. Animation: Fade — lines fade in; Rise — lines drift up as they fade in; Reveal — words or
// lines rise out of masks (text-reveal). Exit: Fade — everything fades; Rise — lines leave through
// the top of their masks. Both None (the default) → nothing moves.
export const TEXT_PARAMS = {
  textColor: { type: 'color', label: 'Text', default: '#ffffff' },
  textSize: {
    type: 'number',
    label: 'Text size',
    min: 48,
    max: 160,
    step: 2,
    default: STORY_TYPE.size,
  },
  weight: { type: 'select', label: 'Weight', options: ['Regular', 'Medium'], default: 'Regular' },
  ...TEXT_POSITION_PARAMS,
  accent: { type: 'color', label: 'Accent', default: '#ff5b2e' },
  animation: {
    type: 'select',
    label: 'Text animation',
    options: [...ANIMATIONS],
    default: 'None',
  },
  revealBy: {
    type: 'select',
    label: 'Reveal by',
    options: ['Words', 'Lines'],
    default: 'Words',
    when: { param: 'animation', is: ['Reveal'] },
  },
  exit: { type: 'select', label: 'Exit', options: [...EXITS], default: 'None' },
} satisfies Record<string, ParamSpec>

// Media size / scale / position (_lib/layout.ts), shown once the template has media. The ground
// colour (`background`) comes with BACKGROUND_PARAMS.
export const MEDIA_PARAMS = {
  size: { ...MEDIA_SIZE_PARAMS.size, when: { media: true } },
  scale: { ...MEDIA_SIZE_PARAMS.scale, when: { media: true } },
  focusX: { ...MEDIA_SIZE_PARAMS.focusX, when: { media: true } },
  focusY: { ...MEDIA_SIZE_PARAMS.focusY, when: { media: true } },
} satisfies Record<string, ParamSpec>

// How strong the legibility gradient under the type is (only over media; 0 = none).
export const SCRIM_PARAMS = {
  gradient: {
    type: 'number',
    label: 'Gradient',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.55,
    when: { media: true },
  },
} satisfies Record<string, ParamSpec>

export interface TextSettings {
  color: string
  size: number // design px
  weight: '400' | '500'
  position: TextPosition
  align: TextAlign
  accent: string
  animation: Animation
  revealBy: 'Words' | 'Lines'
  exit: Exit
  gradient: number // 0–1
}

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback
const colour = (v: unknown, fallback: string) =>
  typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback

// Reads the TEXT_PARAMS / SCRIM_PARAMS values, tolerating missing or stale ones.
export function textSettings(params: Record<string, unknown>): TextSettings {
  const { position, align } = textPlacement(params)
  return {
    color: colour(params.textColor, '#ffffff'),
    size: Math.min(400, Math.max(8, num(params.textSize, STORY_TYPE.size))),
    weight: params.weight === 'Medium' ? '500' : '400',
    position,
    align,
    accent: colour(params.accent, '#ff5b2e'),
    animation: pick(params.animation, ANIMATIONS, 'None'),
    revealBy: params.revealBy === 'Lines' ? 'Lines' : 'Words',
    exit: pick(params.exit, EXITS, 'None'),
    gradient: Math.min(1, Math.max(0, num(params.gradient, 0.55))),
  }
}

// Does the type move (an entrance or an exit is set)?
export const baseMoves = (params: Record<string, unknown>) => {
  const { animation, exit } = textSettings(params)
  return animation !== 'None' || exit !== 'None'
}

// meta.outputKind for templates built on the base layer: a still (JPEG) when nothing moves — no
// video media or background, and no type animation (or no type at all) — else a video.
export function baseOutputKind(inputs: OutputKindInputs): OutputKind {
  if (inputs.media.some((m) => m.kind === 'video')) return 'video'
  if (inputs.background?.kind === 'video') return 'video'
  const hasType = ['caption', ...LABEL_KEYS].some((key) => (inputs.text[key] ?? '').trim())
  return hasType && baseMoves(inputs.params) ? 'video' : 'still'
}

// ── Layout constants (design px) ────────────────────────────────────────────────────────────

// Corner labels: text-reveal's label — small, regular, the text colour at 60% on a plain ground.
// Over a picture (the media, or a background image / video) they are drawn at full strength: 60%
// white over a photo turns muddy and stops reading (image-caption's labels were solid).
export const LABEL_TYPE = { size: 32, weight: '400', alpha: 0.6 }
// Least space between a left and a right label on the same row (longer ones are shortened…).
const LABEL_ROW_GAP = 48
// Ink gap between the labels and the caption (label baseline → caption cap top, and caption
// baseline → label cap top).
const LABEL_GAP = 56
// A long caption at a large size shrinks until it fits, down to this size.
const MIN_SIZE = 32
// Longest caption line on a wide (16:9) frame: a full-width measure is too long to read.
const WIDE_MEASURE = 1240
// …and its lines are balanced: the measure narrows (BALANCE_STEP design px at a time) while the
// line count holds, until each paragraph's last line is at least BALANCE of its longest.
const BALANCE = 0.45
const BALANCE_STEP = 8
// Line masks hug the glyphs plus this much of the font size (text-reveal).
const MASK_PAD = 0.06
// Rise: how far (× line height) a line drifts up as it fades in.
const RISE = 0.4
// Legibility gradient: how far it reaches past the caption and past the labels, as a share of
// the frame height, capped (design px) so a square isn't mostly gradient (as image-caption had).
const FADE_CAPTION = { share: 0.3, max: 460 }
const FADE_LABELS = { share: 0.2, max: 300 }
// The labels' own gradient, at the caption's strength: small type needs more contrast, not less
// (at 0.6 a white page stayed ~#c5c5c5 under a white story label, 1.7:1).
const LABEL_SCRIM = 1

// Grounds the gradient is tinted with: dark under light type, off-white under dark type.
const DARK = [16, 16, 16] as const // #101010
const LIGHT = [242, 241, 236] as const // #f2f1ec
type RGB = readonly [number, number, number]

function rgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0')
  const n = parseInt(full.slice(0, 6), 16)
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255]
}

// Relative luminance (WCAG) of an sRGB colour.
function luminance([r, g, b]: RGB) {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// Whichever ground gives the type more contrast (WCAG ratio).
function tintFor(color: string): RGB {
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const l = luminance(rgb(color))
  return contrast(l, luminance(DARK)) >= contrast(l, luminance(LIGHT)) ? DARK : LIGHT
}

const smooth = (u: number) => u * u * (3 - 2 * u)
// Colour-stop offsets must be in [0, 1] (addColorStop throws on float overshoot).
const unit = (u: number) => Math.min(1, Math.max(0, u))

// ── Types ───────────────────────────────────────────────────────────────────────────────────

export interface InkBox {
  top: number
  bottom: number
  left: number
  right: number
}

// Where the frame darkens under the type (canvas px from the top): clear at a, full strength
// (`alpha`, before the scrim level) from b to c, clear again at d — smoothstep between. `ink`: the
// type the band is for (top and bottom y, left and right x), to skip it when no media is there;
// `inks`: the same type piece by piece (the caption, each label) — a top-left and a top-right
// label share a band, but what sits under one isn't under the other (the grid's cells).
export interface ScrimBand {
  band: [number, number, number, number]
  alpha: number
  ink: InkBox
  inks: InkBox[]
}

// How much picture sits under a piece of type (its ink box), 0–1: a label is quiet on the plain
// ground (LABEL_TYPE.alpha) and solid over a picture — for templates whose pictures move under it.
export type LabelGround = (ink: InkBox) => number

export interface BaseLayer {
  readonly settings: TextSettings
  // The caption's ink box (canvas px), null without a caption.
  readonly caption: InkBox | null
  // Each corner label's ink box (canvas px), in the order drawType() draws them.
  readonly labels: InkBox[]
  // Type anchored to the frame's edges, for templates that frame content clear of it (the grid):
  // `top` is the lowest ink of the type at the top (top labels, a Top caption) — 0 when there is
  // none; `bottom` the highest ink of the type at the bottom — the frame height when none. A
  // Middle caption sits over the content and counts for neither.
  readonly edges: { top: number; bottom: number }
  // The legibility gradients (see ScrimBand) and their tint (sRGB 0–1) — for three.js templates
  // that darken their own layer in a shader instead of drawing drawScrim().
  readonly scrims: ScrimBand[]
  readonly tint: [number, number, number]
  // The gradients' current strength, 0–1: they fade in with the type and out with it.
  scrimLevel(): number
  // Changes whenever drawType()/drawScrim() would draw something different (redraw overlays).
  stateKey(): string
  // From the template's update(t) (after Pullup seeked the timelines).
  update(t: number): void
  // The gradients, over `media` only (canvas px rect of the media; null = the whole frame). Bands
  // whose type doesn't sit over the media are skipped.
  drawScrim(g: Ctx2D, media?: Rect | null): void
  // Caption and labels. `media`: the media's rect (null: none) — labels over it, or over a
  // background image / video, are solid; on the plain ground they are quiet. Or a LabelGround:
  // how much picture is under each label (quiet → solid with it). Omitted (three.js overlays):
  // solid whenever the template has media.
  drawType(g: Ctx2D, media?: Rect | null | LabelGround): void
  // drawScrim over `media` (none when media is null/undefined), then drawType.
  draw(g: Ctx2D, media?: Rect | null): void
  dispose(): void
}

type Ctx2D = OffscreenCanvasRenderingContext2D

// Tweened by the timeline; read in update().
interface Piece {
  in: number // Reveal: 0 → 1 rises out of the mask
  out: number // exit Rise: 0 → 1 leaves through the top of the mask
  fade: number // Fade / Rise: opacity 0 → 1
  rise: number // Rise: 0 → 1 drifts up to rest
}

interface Word {
  x: number
  segments: (Segment & { dx: number })[]
  piece: Piece // Reveal by words
  dy: number // derived in update()
}

interface Line {
  y: number // draw y, in the block's text baseline
  clipTop: number
  clipHeight: number
  left: number
  right: number
  words: Word[]
  piece: Piece
  lift: number // Rise distance, canvas px
  // Derived in update():
  alpha: number
  clip: boolean
}

interface Block {
  font: string
  tracking: number
  baseline: CanvasTextBaseline
  alpha: number
  lines: Line[]
}

const rest = (): Piece => ({ in: 1, out: 0, fade: 1, rise: 1 })

// Shortens text to `max` px wide with an ellipsis (whole code points).
function ellipsize(g: Ctx2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = `${chars.slice(0, mid).join('').trimEnd()}…`
    if (g.measureText(candidate).width <= max) lo = mid
    else hi = mid - 1
  }
  return lo ? `${chars.slice(0, lo).join('').trimEnd()}…` : ''
}

// ── The layer ───────────────────────────────────────────────────────────────────────────────

export interface BaseOptions {
  // The caption's text field (default 'caption').
  captionKey?: string
  // Design px; default FRAME_MARGINS for the aspect.
  margins?: { side: number; top: number; bottom: number }
}

// Lays the type out and builds its timeline. Call in setup(); the template's meta must declare
// BASE_FONTS (the font is loaded here).
export async function createBase(
  ctx: TemplateContext,
  options: BaseOptions = {}
): Promise<BaseLayer> {
  await ctx.font(BASE_FAMILY)
  const st = textSettings(ctx.params)
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  const m = options.margins ?? FRAME_MARGINS[ctx.aspect] ?? FRAME_MARGINS['4:5']
  const side = m.side * s
  const marginTop = m.top * s
  const marginBottom = m.bottom * s
  const measure = new OffscreenCanvas(8, 8).getContext('2d')!
  const animated = ctx.kind === 'video' && ctx.duration > 0
  const entrance: Animation = animated ? st.animation : 'None'
  const exit: Exit = animated ? st.exit : 'None'
  const byWords = st.revealBy === 'Words'
  const reveal = entrance === 'Reveal'

  // ── Labels ───────────────────────────────────────────────────────────────────────────────
  // One line each. Top labels' cap tops sit on the top margin, bottom labels' baselines on the
  // bottom margin; a left and a right label that would meet are shortened with an ellipsis.
  const labelSize = LABEL_TYPE.size * s
  const labelFont = `${LABEL_TYPE.weight} ${labelSize}px "${BASE_FAMILY}"`
  measure.font = labelFont
  measure.letterSpacing = '0px'
  measure.textBaseline = 'alphabetic'
  const labelCap = measure.measureText('H').actualBoundingBoxAscent
  const labelRef = measure.measureText('ÅÉÎÇgjpqy|')
  const labelPad = labelSize * MASK_PAD
  const labelText = (key: LabelKey) => (ctx.text[key] ?? '').replace(/\s+/g, ' ').trim()
  const room = W - side * 2
  const labelLines: Line[] = []
  const topBaseline = marginTop + labelCap
  const bottomBaseline = H - marginBottom
  let hasTop = false
  let hasBottom = false
  for (const [leftKey, rightKey, baseline] of [
    ['labelTopLeft', 'labelTopRight', topBaseline],
    ['labelBottomLeft', 'labelBottomRight', bottomBaseline],
  ] as const) {
    let left = labelText(leftKey)
    let right = labelText(rightKey)
    const gap = LABEL_ROW_GAP * s
    const wl = left ? measure.measureText(left).width : 0
    const wr = right ? measure.measureText(right).width : 0
    if (left && right && wl + wr + gap > room) {
      const half = (room - gap) / 2
      const maxL = wr <= half ? room - gap - wr : wl <= half ? wl : half
      const maxR = room - gap - Math.min(wl, maxL)
      left = ellipsize(measure, left, maxL)
      right = ellipsize(measure, right, maxR)
    } else {
      if (left) left = ellipsize(measure, left, room)
      if (right) right = ellipsize(measure, right, room)
    }
    for (const [text, isRight] of [
      [left, false],
      [right, true],
    ] as const) {
      if (!text) continue
      const width = measure.measureText(text).width
      const x = isRight ? W - side - width : side
      labelLines.push({
        y: baseline,
        clipTop: baseline - labelRef.actualBoundingBoxAscent - labelPad,
        clipHeight:
          labelRef.actualBoundingBoxAscent + labelRef.actualBoundingBoxDescent + labelPad * 2,
        left: x,
        right: x + width,
        words: [{ x, segments: [{ text, accent: false, dx: 0 }], piece: rest(), dy: 0 }],
        piece: rest(),
        lift: labelSize * 1.1 * RISE,
        alpha: 1,
        clip: false,
      })
      if (baseline === topBaseline) hasTop = true
      else hasBottom = true
    }
  }
  const labels: Block = {
    font: labelFont,
    tracking: 0,
    baseline: 'alphabetic',
    alpha: LABEL_TYPE.alpha,
    lines: labelLines,
  }

  // ── Caption ──────────────────────────────────────────────────────────────────────────────
  // Line boxes on the margins (text-story); with labels on an edge, the caption keeps LABEL_GAP of
  // ink clear of them. Shrinks (×0.95) while it doesn't fit, down to MIN_SIZE.
  const { text: captionText, words: marked } = parseAccents(
    ctx.text[options.captionKey ?? 'caption'] ?? ''
  )
  const maxWidth = Math.min(room, ctx.aspect === '16:9' ? WIDE_MEASURE * s : Infinity)
  let layout: TextLayout | null = null
  let size = 0
  let tracking = 0
  let captionTop = 0
  if (captionText.trim()) {
    size = st.size * s
    let limits = { top: marginTop, bottom: marginBottom }
    for (let i = 0; i < 60; i++) {
      tracking = STORY_TYPE.tracking * size
      layout = ctx.layoutText(captionText, {
        family: BASE_FAMILY,
        weight: st.weight,
        size,
        lineHeight: STORY_TYPE.lineHeight,
        maxWidth,
        letterSpacing: tracking,
      })
      measure.font = layout.font
      measure.letterSpacing = `${tracking}px`
      measure.textBaseline = 'top'
      const h = measure.measureText('H')
      const capOffset = -h.actualBoundingBoxAscent // line top → cap top
      const baseOffset = h.actualBoundingBoxDescent // line top → baseline
      const gap = LABEL_GAP * s
      limits = {
        top: hasTop ? topBaseline + gap - capOffset : marginTop,
        bottom: hasBottom
          ? H - (bottomBaseline - labelCap - gap) - (layout.lineHeight - baseOffset)
          : marginBottom,
      }
      if (layout.height <= H - limits.top - limits.bottom || size <= MIN_SIZE * s) break
      size *= 0.95
    }
    // 16:9 only (a new format, no breaks to keep): greedy breaks on the wide measure leave a
    // word or two alone on the last line. Stories, feed and square keep text-story's breaks.
    if (ctx.aspect === '16:9') {
      const count = layout!.lines.length
      for (
        let w = maxWidth - BALANCE_STEP * s;
        !balancedLines(captionText, layout!);
        w -= BALANCE_STEP * s
      ) {
        const next = ctx.layoutText(captionText, {
          family: BASE_FAMILY,
          weight: st.weight,
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: w,
          letterSpacing: tracking,
        })
        if (next.lines.length !== count || w <= 0) break
        layout = next
      }
    }
    captionTop = textBlockY(H, layout!.height, st.position, limits)
  }

  const caption: Block = {
    font: layout?.font ?? '',
    tracking,
    baseline: 'top',
    alpha: 1,
    lines: [],
  }
  if (layout) {
    measure.font = layout.font
    measure.letterSpacing = `${tracking}px`
    measure.textBaseline = 'top'
    const ref = measure.measureText('ÅÉÎÇgjpqy|')
    const pad = layout.size * MASK_PAD
    let k = 0
    caption.lines = layout.lines.map((line): Line => {
      const mt = line.text ? measure.measureText(line.text) : ref
      const top = Math.min(-ref.actualBoundingBoxAscent, -mt.actualBoundingBoxAscent) - pad
      const bottom = Math.max(ref.actualBoundingBoxDescent, mt.actualBoundingBoxDescent) + pad
      const y = captionTop + line.y
      const x = textLineX(W, line.width, st.align, side)
      return {
        y,
        clipTop: y + top,
        clipHeight: bottom - top,
        left: x + line.x,
        right: x + line.x + line.width,
        piece: rest(),
        lift: layout!.lineHeight * RISE,
        alpha: 1,
        clip: false,
        words: line.words.map((word): Word => {
          const mark: MarkedWord | undefined = marked[k++]
          const segs =
            mark && mark.text === word.text ? mark.segments : [{ text: word.text, accent: false }]
          let dx = 0
          const segments = segs.map((seg) => {
            const placed = { ...seg, dx }
            dx += measure.measureText(seg.text).width
            return placed
          })
          return { x: x + line.x + word.x, segments, piece: rest(), dy: 0 }
        }),
      }
    })
  }
  const captionLines = caption.lines.filter((l) => l.words.length)

  // ── Ink boxes, edges, gradients ──────────────────────────────────────────────────────────
  const inkOf = (lines: Line[]): InkBox | null =>
    lines.length
      ? {
          top: Math.min(...lines.map((l) => l.clipTop)),
          bottom: Math.max(...lines.map((l) => l.clipTop + l.clipHeight)),
          left: Math.min(...lines.map((l) => l.left)),
          right: Math.max(...lines.map((l) => l.right)),
        }
      : null
  const captionInk = inkOf(captionLines)
  const topLines = labelLines.filter((l) => l.y === topBaseline)
  const bottomLines = labelLines.filter((l) => l.y === bottomBaseline)
  const topInk = inkOf(topLines)
  const bottomInk = inkOf(bottomLines)
  const topInks = topLines.map((l) => inkOf([l])!)
  const bottomInks = bottomLines.map((l) => inkOf([l])!)
  const edges = {
    top: Math.max(topInk?.bottom ?? 0, captionInk && st.position === 'Top' ? captionInk.bottom : 0),
    bottom: Math.min(
      bottomInk?.top ?? H,
      captionInk && st.position === 'Bottom' ? captionInk.top : H
    ),
  }

  const scrims: ScrimBand[] = []
  const fadeCaption = Math.min(FADE_CAPTION.max * s, FADE_CAPTION.share * H)
  const fadeLabels = Math.min(FADE_LABELS.max * s, FADE_LABELS.share * H)
  let topCovered = false
  let bottomCovered = false
  if (layout && captionInk) {
    const lh = layout.lineHeight
    const cTop = captionTop
    const cBottom = captionTop + layout.height
    if (st.position === 'Bottom') {
      // Full strength by the middle of the first line, held to the bottom edge (it covers the
      // bottom labels too).
      scrims.push({
        band: [Math.floor(Math.max(0, cTop - fadeCaption)), cTop + lh * 0.5, H + 1, H + 2],
        alpha: 1,
        ink: bottomInk ? mergeInk(captionInk, bottomInk) : captionInk,
        inks: [captionInk, ...bottomInks],
      })
      bottomCovered = true
    } else if (st.position === 'Top') {
      scrims.push({
        band: [-2, -1, cBottom - lh * 0.5, Math.ceil(Math.min(H, cBottom + fadeCaption))],
        alpha: 1,
        ink: topInk ? mergeInk(captionInk, topInk) : captionInk,
        inks: [captionInk, ...topInks],
      })
      topCovered = true
    } else {
      const b = cTop + lh * 0.5
      scrims.push({
        band: [
          Math.floor(Math.max(0, cTop - fadeCaption)),
          b,
          Math.max(b, cBottom - lh * 0.5),
          Math.ceil(Math.min(H, cBottom + fadeCaption)),
        ],
        alpha: 1,
        ink: captionInk,
        inks: [captionInk],
      })
    }
  }
  // Labels: full strength from the frame's edge through the label's ink (a story label sits 160 px
  // in), fading out past it.
  if (topInk && !topCovered) {
    scrims.push({
      band: [-2, -1, topInk.bottom, Math.ceil(topInk.bottom + fadeLabels)],
      alpha: LABEL_SCRIM,
      ink: topInk,
      inks: topInks,
    })
  }
  if (bottomInk && !bottomCovered) {
    scrims.push({
      band: [Math.floor(bottomInk.top - fadeLabels), bottomInk.top, H + 1, H + 2],
      alpha: LABEL_SCRIM,
      ink: bottomInk,
      inks: bottomInks,
    })
  }
  const tintRGB = tintFor(st.color)

  // ── Timeline ─────────────────────────────────────────────────────────────────────────────
  const T = ctx.duration
  const scrimIn = { v: 1 }
  const scrimOut = { v: 0 }
  const fadeOut = { v: 0 }
  const labelPieces = labelLines.map((l) => l.piece)
  if (entrance !== 'None' || exit !== 'None') {
    const tl = ctx.timeline()
    const late = { immediateRender: false }
    let settled = 0
    let first = 0
    if (entrance === 'Reveal') {
      // text-reveal: words (or whole lines) rise out of their line's mask, staggered; the
      // stagger shrinks for long texts so the reveal never takes more than ~a fifth of the clip.
      const pieces = byWords
        ? captionLines.flatMap((l) => l.words.map((w) => w.piece))
        : captionLines.map((l) => l.piece)
      const n = pieces.length
      const start = 0.2
      const inDur = byWords ? 1.1 : 1.3
      const stagger = n > 1 ? Math.min(byWords ? 0.055 : 0.12, (0.2 * T) / (n - 1)) : 0
      labelPieces.forEach((pc) =>
        tl.fromTo(pc, { in: 0 }, { in: 1, duration: 1.1, ease: 'expo.out' }, 0.1)
      )
      pieces.forEach((pc, i) =>
        tl.fromTo(pc, { in: 0 }, { in: 1, duration: inDur, ease: 'expo.out' }, start + i * stagger)
      )
      first = labelPieces.length ? 0.1 : start
      settled = start + Math.max(0, n - 1) * stagger + inDur * 0.6
    } else if (entrance === 'Fade' || entrance === 'Rise') {
      // Line by line (video-caption); the labels come in with the first line.
      const start = 0.3
      const stagger = 0.08
      const rise = entrance === 'Rise'
      const come = (pc: Piece, at: number) => {
        tl.fromTo(pc, { fade: 0 }, { fade: 1, duration: rise ? 0.8 : 0.9, ease: 'power2.out' }, at)
        if (rise) tl.fromTo(pc, { rise: 0 }, { rise: 1, duration: 1.2, ease: 'expo.out' }, at)
      }
      labelPieces.forEach((pc) => come(pc, start))
      captionLines.forEach((l, i) => come(l.piece, start + i * stagger))
      first = start
      settled = start + Math.max(0, captionLines.length - 1) * stagger + 0.9 * 0.6
    }
    if (entrance !== 'None') {
      tl.fromTo(
        scrimIn,
        { v: 0 },
        { v: 1, duration: 0.9, ease: 'power2.out' },
        Math.max(0, first - 0.1)
      )
    }

    // The exit ends a beat before the last frame, so a looping reel starts and ends on the ground.
    const end = T - 0.25
    if (exit === 'Rise') {
      // Whole lines leave through the top of their masks, top line first, the labels with it.
      const outDur = 0.6
      const L = captionLines.length
      const outStagger = L > 1 ? Math.min(0.07, 0.5 / (L - 1)) : 0
      const outStart = Math.max(settled, end - outDur - Math.max(0, L - 1) * outStagger)
      labelPieces.forEach((pc) =>
        tl.fromTo(
          pc,
          { out: 0 },
          { out: 1, duration: outDur, ease: 'power3.in', ...late },
          outStart
        )
      )
      captionLines.forEach((l, i) =>
        tl.fromTo(
          l.piece,
          { out: 0 },
          { out: 1, duration: outDur, ease: 'power3.in', ...late },
          outStart + i * outStagger
        )
      )
      tl.fromTo(
        scrimOut,
        { v: 0 },
        {
          v: 1,
          duration: outDur + Math.max(0, L - 1) * outStagger,
          ease: 'power2.inOut',
          ...late,
        },
        outStart
      )
    } else if (exit === 'Fade') {
      const outDur = 0.7
      tl.fromTo(
        fadeOut,
        { v: 0 },
        { v: 1, duration: outDur, ease: 'power2.inOut', ...late },
        Math.max(settled, end - outDur)
      )
    }
  }

  // ── Frame state ──────────────────────────────────────────────────────────────────────────
  const derive = (block: Block, words: boolean) => {
    for (const line of block.lines) {
      const h = line.clipHeight
      const lp = line.piece
      line.alpha = lp.fade
      const lift = line.lift * (1 - lp.rise)
      let masked = lp.out > 0
      for (const word of line.words) {
        const rise = reveal ? (words ? word.piece.in : lp.in) : 1
        if (rise < 1) masked = true
        word.dy = h * (1 - rise) - h * lp.out + lift
      }
      line.clip = masked
    }
  }
  const level = () => scrimIn.v * (1 - scrimOut.v) * (1 - fadeOut.v)

  const drawBlock = (
    g: Ctx2D,
    block: Block,
    alpha: number,
    strength: (line: Line) => number = () => block.alpha
  ) => {
    if (!block.lines.length || alpha <= 0) return
    g.save()
    g.font = block.font
    g.letterSpacing = `${block.tracking}px`
    g.textBaseline = block.baseline
    for (const line of block.lines) {
      const a = alpha * strength(line) * line.alpha
      if (!line.words.length || a <= 0) continue
      if (line.clip) {
        g.save()
        g.beginPath()
        g.rect(0, line.clipTop, W, line.clipHeight)
        g.clip()
      }
      g.globalAlpha = a
      for (const word of line.words) {
        if (line.clip && Math.abs(word.dy) >= line.clipHeight) continue
        for (const seg of word.segments) {
          g.fillStyle = seg.accent ? st.accent : st.color
          g.fillText(seg.text, word.x + seg.dx, line.y + word.dy)
        }
      }
      if (line.clip) g.restore()
    }
    g.restore()
  }

  const drawScrim = (g: Ctx2D, media?: Rect | null) => {
    const strength = st.gradient * level()
    if (strength <= 0 || !scrims.length) return
    // The part of the frame the media covers (null: all of it).
    const area = media
      ? {
          x0: Math.max(0, media.x),
          y0: Math.max(0, media.y),
          x1: Math.min(W, media.x + media.w),
          y1: Math.min(H, media.y + media.h),
        }
      : { x0: 0, y0: 0, x1: W, y1: H }
    if (area.x1 <= area.x0 || area.y1 <= area.y0) return
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.globalCompositeOperation = 'source-over'
    if (media) {
      g.beginPath()
      g.rect(area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0)
      g.clip()
    }
    // Only where the type sits over the media. Bands whose fades run into each other (a label's
    // and a Middle caption's on a square) are one band, held between them: two gradients meeting
    // leave a light stripe across the frame.
    const bands: { band: [number, number, number, number]; alpha: number }[] = []
    const over = scrims
      .filter(({ ink }) => ink.bottom > area.y0 && ink.top < area.y1)
      .filter(({ ink }) => ink.right > area.x0 && ink.left < area.x1)
      .sort((p, q) => p.band[0] - q.band[0])
    for (const { band, alpha } of over) {
      const last = bands[bands.length - 1]
      if (last && band[0] < last.band[3]) {
        const [a, b, c, d] = last.band
        last.band = [a, Math.min(b, band[1]), Math.max(c, band[2]), Math.max(d, band[3])]
        last.alpha = Math.max(last.alpha, alpha)
      } else bands.push({ band: [...band], alpha })
    }
    for (const { band, alpha } of bands) {
      const [a, , , d] = band
      g.fillStyle = bandGradient(g, tintRGB, band, strength * alpha)
      g.fillRect(0, a, W, d - a)
    }
    g.restore()
  }

  // A label's strength: solid over a picture, quiet (LABEL_TYPE.alpha) on the plain ground.
  const labelStrength = (media: Rect | null | LabelGround | undefined) => (line: Line) => {
    if (ctx.background) return 1
    if (media === undefined) return ctx.media.length ? 1 : labels.alpha
    if (typeof media === 'function') {
      const under = Math.min(1, Math.max(0, media(inkOf([line])!)))
      return labels.alpha + (1 - labels.alpha) * under
    }
    if (!media) return labels.alpha
    const over =
      line.right > media.x &&
      line.left < media.x + media.w &&
      line.clipTop + line.clipHeight > media.y &&
      line.clipTop < media.y + media.h
    return over ? 1 : labels.alpha
  }

  const drawType = (g: Ctx2D, media?: Rect | null | LabelGround) => {
    const alpha = 1 - fadeOut.v
    drawBlock(g, caption, alpha)
    drawBlock(g, labels, alpha, labelStrength(media))
  }

  // Before the first update(): the settled state (and the timeline's start values once seeked).
  derive(caption, byWords)
  derive(labels, false)

  return {
    settings: st,
    caption: captionInk,
    labels: labelLines.map((l) => inkOf([l])!),
    edges,
    scrims,
    tint: [tintRGB[0] / 255, tintRGB[1] / 255, tintRGB[2] / 255],
    scrimLevel: level,
    stateKey() {
      const parts: number[] = [scrimIn.v, scrimOut.v, fadeOut.v]
      for (const block of [caption, labels]) {
        for (const line of block.lines) {
          parts.push(line.alpha, line.clip ? 1 : 0)
          for (const word of line.words) parts.push(word.dy)
        }
      }
      return parts.map((v) => v.toFixed(3)).join(',')
    },
    update() {
      derive(caption, byWords)
      derive(labels, false)
    },
    drawScrim,
    drawType,
    draw(g, media) {
      if (media) drawScrim(g, media)
      drawType(g, media ?? null)
    },
    dispose() {},
  }
}

// Every paragraph that wraps ends on a line at least BALANCE of its longest (layoutText lays each
// paragraph out in turn, one line for an empty one).
export function balancedLines(text: string, layout: Pick<TextLayout, 'lines'>): boolean {
  let i = 0
  for (const paragraph of text.split('\n')) {
    let words = paragraph.split(/\s+/).filter(Boolean).length
    const lines: number[] = []
    do {
      const line = layout.lines[i++]
      if (!line) break
      lines.push(line.width)
      words -= line.words.length
    } while (words > 0)
    if (lines.length > 1 && lines[lines.length - 1]! < BALANCE * Math.max(...lines)) return false
  }
  return true
}

const mergeInk = (a: InkBox, b: InkBox): InkBox => ({
  top: Math.min(a.top, b.top),
  bottom: Math.max(a.bottom, b.bottom),
  left: Math.min(a.left, b.left),
  right: Math.max(a.right, b.right),
})

// One gradient for a band (abutting rects would seam): alpha eases in over a → b and out over
// c → d (smoothstep, many stops — a two-stop linear gradient shows a hard edge where it starts).
function bandGradient(
  g: Ctx2D,
  tint: RGB,
  [a, b, c, d]: [number, number, number, number],
  max: number
) {
  const gradient = g.createLinearGradient(0, a, 0, d)
  const span = d - a || 1
  const rgba = (alpha: number) => `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha.toFixed(4)})`
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    gradient.addColorStop(unit(((b - a) * u) / span), rgba(max * smooth(u)))
  }
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    gradient.addColorStop(unit((c - a + (d - c) * u) / span), rgba(max * smooth(1 - u)))
  }
  return gradient
}

// ── Media ───────────────────────────────────────────────────────────────────────────────────

export interface Media2D {
  readonly kind: 'image' | 'video' | null
  // Where it is drawn (canvas px, may run past the frame); null without media.
  readonly rect: Rect | null
  // It covers the whole frame.
  readonly covers: boolean
  // It covers the frame and is opaque (a video): skip drawing — and decoding — the background.
  readonly hidesGround: boolean
  // Seeks a video (held on its last frame). From update().
  update(t: number): void
  // Draws it (nothing until a video's first frame is decoded).
  draw(g: Ctx2D): void
  dispose(): void
}

// The template's media `index` (an image or a video) sized by MEDIA_PARAMS (Fill / Fit, scale,
// position). Call in setup().
export async function createMedia2D(ctx: TemplateContext, index = 0): Promise<Media2D> {
  const input = ctx.media[index]
  const W = ctx.width
  const H = ctx.height
  if (!input) {
    return {
      kind: null,
      rect: null,
      covers: false,
      hidesGround: false,
      update() {},
      draw() {},
      dispose() {},
    }
  }
  const image = input.kind === 'image' ? await ctx.image(index) : null
  const video = input.kind === 'video' ? ctx.video(index) : null
  const w = image?.width ?? video?.width ?? input.width
  const h = image?.height ?? video?.height ?? input.height
  const rect = mediaRect(W, H, w, h, mediaSize(ctx.params))
  const eps = 0.5
  const covers =
    rect.x <= eps && rect.y <= eps && rect.x + rect.w >= W - eps && rect.y + rect.h >= H - eps
  return {
    kind: input.kind,
    rect,
    covers,
    hidesGround: covers && !!video,
    update(t) {
      if (video) video.seek(Math.min(t, video.duration))
    },
    draw(g) {
      const source = image ?? video?.frame ?? null
      if (!source) return
      g.save()
      g.globalAlpha = 1
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(source, rect.x, rect.y, rect.w, rect.h)
      g.restore()
    },
    dispose() {},
  }
}
