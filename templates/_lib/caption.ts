import type {
  Aspect,
  FontSpec,
  ParamSpec,
  TemplateContext,
  TemplateMeta,
  TextLayout,
} from '@shared/template.ts'
import {
  MEDIA_SIZE_PARAMS,
  TEXT_POSITION_PARAMS,
  mediaRect,
  mediaSize,
  textBlockY,
  textLineX,
  textPlacement,
  type Rect,
} from './layout.ts'
import { BACKGROUND_PARAMS, createBackground2D, type Background2D } from './background.ts'
import { STORY_TYPE } from './text.ts'

// The "media + caption" card shared by image-caption (a still) and video-caption (a clip): one
// image or video frame sized by MEDIA_SIZE_PARAMS on a ground (a colour, or a background image /
// video — BACKGROUND_PARAMS, seen around Fit or scaled-down media), a large caption in Mario's
// story type placed by TEXT_POSITION_PARAMS over a soft gradient, and a small label / index in the
// top corners. Canvas 2D; everything is laid out once in setup(), draw() only paints.

export const CAPTION_FAMILY = 'PP Neue Montreal'

export const CAPTION_FONTS: FontSpec[] = [
  { family: CAPTION_FAMILY, file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
  { family: CAPTION_FAMILY, file: 'PPNeueMontreal-Medium.otf', weight: '500' },
]

export const CAPTION_TEXT: NonNullable<TemplateMeta['text']> = {
  caption: {
    label: 'Caption',
    multiline: true,
    max: 140,
    optional: true,
    default: 'A study in light and form, rendered in real time.',
  },
  label: { label: 'Label (top left)', max: 40, optional: true, default: 'Nonlinear' },
  index: { label: 'Date / index (top right)', max: 24, optional: true, default: '(01)' },
}

export const CAPTION_PARAMS = {
  ...MEDIA_SIZE_PARAMS,
  ...TEXT_POSITION_PARAMS,
  typeSize: { type: 'number', label: 'Type size', min: 48, max: 140, step: 2, default: 84 },
  color: { type: 'color', label: 'Text', default: '#ffffff' },
  gradient: { type: 'number', label: 'Gradient', min: 0, max: 1, step: 0.05, default: 0.55 },
  // `background` (the ground colour) keeps its place from MEDIA_SIZE_PARAMS.
  ...BACKGROUND_PARAMS,
} satisfies Record<string, ParamSpec>

// Per-frame state of the type (video-caption animates it; the still draws it set).
export interface CaptionFrame {
  // Per caption line: opacity, and how far it still sits below its mask (1 = hidden, 0 = set).
  lines?: { alpha: number; rise: number }[]
  // Opacity of the corner label / index.
  corners?: number
}

// Grounds the gradient is tinted with: dark under light type, off-white under dark type.
const DARK = [16, 16, 16] as const // #101010
const LIGHT = [242, 241, 236] as const // #f2f1ec

// Corner type (label / index), design px.
const SMALL = { size: 28, lineHeight: 1.2, weight: '500' }

// Margins in design px. Stories keep clear of Instagram's header and reply bar (Mario's 160 px
// bottom margin, mirrored at the top); feed posts have no overlay, so they sit on the 40 px grid.
const MARGINS: Record<Aspect, { side: number; top: number; bottom: number }> = {
  '9:16': { side: STORY_TYPE.side, top: 160, bottom: STORY_TYPE.bottom },
  '4:5': { side: STORY_TYPE.side, top: 40, bottom: 40 },
  '1:1': { side: STORY_TYPE.side, top: 40, bottom: 40 },
}

// Space between the corner type and a caption set below it (design px, to the caption's cap top).
const CORNER_GAP = 48

// Line masks (Rise) hug the glyphs, plus this much of the font size above and below.
const MASK_PAD = 0.05

// How far the gradient reaches past the caption, and below the labels, as a share of the frame
// height (capped in design px) so a square isn't mostly gradient.
const FADE_CAPTION = { share: 0.3, max: 460 }
const FADE_TOP = { share: 0.2, max: 300 }

type RGB = readonly [number, number, number]

function rgb(hex: string): [number, number, number] {
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

const smooth = (u: number) => u * u * (3 - 2 * u)
// Colour-stop offsets must be in [0, 1] (addColorStop throws on float overshoot).
const unit = (u: number) => Math.min(1, Math.max(0, u))
const rgba = (tint: RGB, a: number) => `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${a.toFixed(4)})`

// Eased scrim: a linear two-stop gradient shows a hard edge where it starts, so the alpha follows
// a smoothstep over many stops. `from`/`to` are y positions; alpha goes 0 → max between them and
// the gradient pads `max` past `to`.
function ramp(
  g: OffscreenCanvasRenderingContext2D,
  tint: RGB,
  from: number,
  to: number,
  max: number
) {
  const gradient = g.createLinearGradient(0, from, 0, to)
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    gradient.addColorStop(u, rgba(tint, max * smooth(u)))
  }
  return gradient
}

// A band: clear at a, full from b to c, clear again at d (one gradient — abutting rects seam).
function band(
  g: OffscreenCanvasRenderingContext2D,
  tint: RGB,
  [a, b, c, d]: [number, number, number, number],
  max: number
) {
  const gradient = g.createLinearGradient(0, a, 0, d)
  const span = d - a
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    gradient.addColorStop(unit(((b - a) * u) / span), rgba(tint, max * smooth(u)))
  }
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    gradient.addColorStop(unit((c - a + (d - c) * u) / span), rgba(tint, max * smooth(1 - u)))
  }
  return gradient
}

export function captionCard(ctx: TemplateContext) {
  const p = ctx.params as { typeSize: number; color: string; gradient: number; background: string }
  const media = mediaSize(ctx.params)
  const { position, align } = textPlacement(ctx.params)
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  const m = MARGINS[ctx.aspect] ?? MARGINS['4:5']
  const side = m.side * s
  const top = m.top * s
  const bottom = m.bottom * s
  const fadeCaption = Math.min(FADE_CAPTION.max * s, FADE_CAPTION.share * H)
  const fadeTop = Math.min(FADE_TOP.max * s, FADE_TOP.share * H)
  const typeSize = Number.isFinite(p.typeSize) ? p.typeSize : 84

  const caption = (ctx.text.caption ?? '').trim()
  const label = (ctx.text.label ?? '').trim()
  const index = (ctx.text.index ?? '').trim()

  const textColor = rgb(p.color)
  // Whichever ground gives the type more contrast (WCAG ratio) — an accent colour like orange
  // reads better on dark, a near-black on light.
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const lText = luminance(textColor)
  const tint = contrast(lText, luminance(DARK)) >= contrast(lText, luminance(LIGHT)) ? DARK : LIGHT
  const strength = Number.isFinite(p.gradient) ? Math.min(1, Math.max(0, p.gradient)) : 0.55

  let rect: Rect = { x: 0, y: 0, w: W, h: H }
  let covers = true // the media covers the whole frame (no ground shows, no clipping needed)
  let background: Background2D | null = null
  // The media hides the background completely (it covers the frame and has no transparency):
  // a background video then isn't decoded at all.
  let hidden = false
  let captionLayout: TextLayout | null = null
  let captionTracking = 0
  let captionY = 0 // top of the caption's first line box
  let lineX: number[] = []
  let mask = { top: 0, bottom: 0 } // a line's glyph band relative to its line top (Rise)
  let labelLayout: TextLayout | null = null
  let smallFont = ''
  let smallCap = 0 // cap height of the corner type, to align cap tops with the margin
  let cornerBottom = 0 // lowest pixel of the corner type

  const drawScrims = (g: OffscreenCanvasRenderingContext2D) => {
    if (strength <= 0) return
    g.save()
    if (!covers && !background?.media) {
      // Only the media needs darkening: the plain ground already sets the type off.
      g.beginPath()
      g.rect(rect.x, rect.y, rect.w, rect.h)
      g.clip()
    }
    let cornersCovered = false
    if (captionLayout) {
      const lh = captionLayout.lineHeight
      const captionBottom = captionY + captionLayout.height
      if (position === 'Bottom') {
        // Full strength by the caption's first line, held to the bottom edge. One rect on whole
        // pixels: the gradient pads its last stop past `to` (two abutting rects leave a seam).
        const from = Math.floor(Math.max(0, captionY - fadeCaption))
        g.fillStyle = ramp(g, tint, from, captionY + lh * 0.5, strength)
        g.fillRect(0, from, W, H - from)
      } else if (position === 'Top') {
        // Mirrored: full from the top edge to the caption's last line, clear below it. It covers
        // the corner type too, so that gets no gradient of its own.
        const to = Math.ceil(Math.min(H, captionBottom + fadeCaption))
        g.fillStyle = ramp(g, tint, to, captionBottom - lh * 0.5, strength)
        g.fillRect(0, 0, W, to)
        cornersCovered = true
      } else {
        const a = Math.floor(Math.max(0, captionY - fadeCaption))
        const d = Math.ceil(Math.min(H, captionBottom + fadeCaption))
        const b = captionY + lh * 0.5
        const c = Math.max(b, captionBottom - lh * 0.5)
        g.fillStyle = band(g, tint, [a, b, c, d], strength)
        g.fillRect(0, a, W, d - a)
      }
    }
    if (cornerBottom && !cornersCovered) {
      // Lighter: the corner type is small, it only needs a hint of ground.
      const to = Math.ceil(cornerBottom + fadeTop)
      g.fillStyle = ramp(g, tint, to, 0, strength * 0.6)
      g.fillRect(0, 0, W, to)
    }
    g.restore()
  }

  const drawCaption = (g: OffscreenCanvasRenderingContext2D, frame?: CaptionFrame) => {
    if (!captionLayout) return
    g.save()
    g.font = captionLayout.font
    g.letterSpacing = `${captionTracking}px`
    g.textBaseline = 'top'
    g.fillStyle = p.color
    const maskH = mask.bottom - mask.top
    captionLayout.lines.forEach((line, i) => {
      const state = frame?.lines?.[i]
      const alpha = state?.alpha ?? 1
      const rise = state?.rise ?? 0
      if (alpha <= 0 || rise >= 1) return
      const x = lineX[i]!
      const y = captionY + line.y
      g.save()
      if (rise > 0) {
        g.beginPath()
        g.rect(0, y + mask.top, W, maskH)
        g.clip()
      }
      g.globalAlpha = alpha
      for (const word of line.words) g.fillText(word.text, x + word.x, y + rise * maskH)
      g.restore()
    })
    g.restore()
  }

  const drawCorners = (g: OffscreenCanvasRenderingContext2D, alpha: number) => {
    if (alpha <= 0 || (!labelLayout && !index)) return
    g.save()
    g.globalAlpha = alpha
    g.font = smallFont
    g.fillStyle = p.color
    g.textBaseline = 'alphabetic'
    const baseline = top + smallCap
    if (labelLayout) {
      g.textAlign = 'left'
      labelLayout.lines.forEach((line, i) => {
        g.fillText(line.text, side, baseline + i * labelLayout!.lineHeight)
      })
    }
    if (index) {
      g.textAlign = 'right'
      g.fillText(index, W - side, baseline)
    }
    g.restore()
  }

  return {
    // Lines of the laid-out caption (0 without one) — for per-line animation.
    get lines() {
      return captionLayout?.lines.length ?? 0
    },

    // Fonts must be loaded (ctx.font) first. mediaW/H: the source's display size; `opaque`: the
    // source never has transparency (video).
    setup(mediaW: number, mediaH: number, options: { opaque?: boolean } = {}) {
      rect = mediaRect(W, H, mediaW, mediaH, media)
      const eps = 0.5
      covers =
        rect.x <= eps && rect.y <= eps && rect.x + rect.w >= W - eps && rect.y + rect.h >= H - eps
      hidden = covers && !!options.opaque
      background = createBackground2D(ctx)

      const measure = new OffscreenCanvas(8, 8).getContext('2d')!

      // Corner type: cap tops sit exactly on the top margin.
      const smallSize = SMALL.size * s
      smallFont = `${SMALL.weight} ${smallSize}px "${CAPTION_FAMILY}"`
      measure.font = smallFont
      measure.textBaseline = 'alphabetic'
      smallCap = measure.measureText('H').actualBoundingBoxAscent
      const indexWidth = index ? measure.measureText(index).width : 0
      if (label) {
        labelLayout = ctx.layoutText(label, {
          family: CAPTION_FAMILY,
          weight: SMALL.weight,
          size: smallSize,
          lineHeight: SMALL.lineHeight,
          // Leave room for the index on the right.
          maxWidth: W - side * 2 - (index ? indexWidth + 48 * s : 0),
        })
      }
      const labelLines = label ? labelLayout!.lines.length : index ? 1 : 0
      cornerBottom = labelLines
        ? top + smallCap + (labelLines - 1) * SMALL.lineHeight * smallSize + 8 * s
        : 0

      if (!caption) return
      // The caption's cap top never rises above this: the top margin, or below the corner type.
      const minCap = cornerBottom ? cornerBottom + CORNER_GAP * s : top
      // Placed by its ink (cap top of the first line → baseline of the last), so Top sits on the
      // margin optically and Middle centres what you see. Shrinks (rarely) if a long caption
      // wouldn't fit between the corner type and the bottom margin.
      let size = typeSize * s
      let capOffset = 0 // line top → cap top
      let baseOffset = 0 // line top → baseline
      for (;;) {
        captionTracking = STORY_TYPE.tracking * size
        captionLayout = ctx.layoutText(caption, {
          family: CAPTION_FAMILY,
          weight: '400',
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: W - side * 2,
          letterSpacing: captionTracking,
        })
        measure.font = captionLayout.font
        measure.letterSpacing = `${captionTracking}px`
        measure.textBaseline = 'top'
        const h = measure.measureText('H')
        capOffset = -h.actualBoundingBoxAscent
        baseOffset = h.actualBoundingBoxDescent
        const inkH = captionLayout.height - captionLayout.lineHeight + baseOffset - capOffset
        const room = H - (bottom + captionLayout.lineHeight - baseOffset) - minCap
        if (inkH <= room || size <= 32 * s) break
        size *= 0.94
      }
      const lh = captionLayout.lineHeight
      const inkH = captionLayout.height - lh + baseOffset - capOffset
      // Bottom keeps the last line box on the bottom margin (Mario's story type).
      captionY =
        textBlockY(H, inkH, position, { top: minCap, bottom: bottom + lh - baseOffset }) - capOffset
      lineX = captionLayout.lines.map((line) => textLineX(W, line.width, align, side))

      const ink = measure.measureText(`H${caption.replace(/\s+/g, '')}`)
      mask = {
        top: -ink.actualBoundingBoxAscent - MASK_PAD * size,
        bottom: ink.actualBoundingBoxDescent + MASK_PAD * size,
      }
    },

    // Seeks a background video (from update()).
    update(t: number) {
      if (!hidden) background?.update(t)
    },

    // Paints the whole frame: ground, media (null = not decoded yet), gradient, type.
    draw(
      g: OffscreenCanvasRenderingContext2D,
      source: CanvasImageSource | null,
      frame?: CaptionFrame
    ) {
      // The ground shows around Fit media (and under transparent PNGs).
      g.globalAlpha = 1
      if (background && !hidden) {
        background.draw(g)
      } else {
        g.fillStyle = p.background
        g.fillRect(0, 0, W, H)
      }
      if (source) {
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'high'
        g.drawImage(source, rect.x, rect.y, rect.w, rect.h)
      }
      drawScrims(g)
      drawCaption(g, frame)
      drawCorners(g, frame?.corners ?? 1)
    },

    dispose() {
      background?.dispose()
    },
  }
}
