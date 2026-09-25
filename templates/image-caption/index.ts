import type { Aspect, TemplateFactory, TextLayout } from '@shared/template.ts'
import { drawLayout, STORY_TYPE } from '../_lib/text.ts'

// A still: one image (cover), a large caption bottom-left in Mario's story type, a small label
// top-left and a date/index top-right. Canvas 2D; everything is laid out once in setup().

const FAMILY = 'PP Neue Montreal'

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

// How far above the caption the bottom gradient starts, and below the labels the top one ends,
// as a share of the frame height (capped in design px) so a square isn't mostly gradient.
const FADE_BOTTOM = { share: 0.3, max: 460 }
const FADE_TOP = { share: 0.2, max: 300 }

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0')
  const n = parseInt(full.slice(0, 6), 16)
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255]
}

// Relative luminance (WCAG) of an sRGB colour.
function luminance([r, g, b]: [number, number, number]) {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// Eased scrim: a linear two-stop gradient shows a hard edge where it starts, so the alpha follows
// a smoothstep over many stops. `from`/`to` are y positions; alpha goes 0 → max between them.
function scrim(
  g: OffscreenCanvasRenderingContext2D,
  tint: readonly [number, number, number],
  from: number,
  to: number,
  max: number
) {
  const gradient = g.createLinearGradient(0, from, 0, to)
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const a = max * u * u * (3 - 2 * u)
    gradient.addColorStop(u, `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${a.toFixed(4)})`)
  }
  return gradient
}

const imageCaption: TemplateFactory = (ctx) => {
  const p = ctx.params as {
    gradient: number
    color: string
    size: number
    focusX: number
    focusY: number
  }
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  const m = MARGINS[ctx.aspect] ?? MARGINS['4:5']
  const side = m.side * s
  const top = m.top * s
  const bottom = m.bottom * s
  const fadeBottom = Math.min(FADE_BOTTOM.max * s, FADE_BOTTOM.share * H)
  const fadeTop = Math.min(FADE_TOP.max * s, FADE_TOP.share * H)

  const caption = (ctx.text.caption ?? '').trim()
  const label = (ctx.text.label ?? '').trim()
  const index = (ctx.text.index ?? '').trim()

  let g: OffscreenCanvasRenderingContext2D
  let bitmap: ImageBitmap
  let crop = { sx: 0, sy: 0, sw: 1, sh: 1 }
  let captionLayout: TextLayout | null = null
  let captionTracking = 0
  let captionTop = 0
  let labelLayout: TextLayout | null = null
  let smallFont = ''
  let smallCap = 0 // cap height of the corner type, to align cap tops with the margin
  let cornerBottom = 0 // lowest pixel of the corner type
  const textColor = rgb(p.color)
  // Whichever ground gives the type more contrast (WCAG ratio) — an accent colour like orange
  // reads better on dark, a near-black on light.
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const lText = luminance(textColor)
  const tint =
    contrast(lText, luminance([...DARK])) >= contrast(lText, luminance([...LIGHT])) ? DARK : LIGHT
  const strength = Math.min(1, Math.max(0, p.gradient))

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      bitmap = await ctx.image(0)
      await ctx.font(FAMILY)

      // Cover crop in source pixels, anchored by the focus params.
      const cover = Math.max(W / bitmap.width, H / bitmap.height)
      const sw = W / cover
      const sh = H / cover
      const fx = Math.min(1, Math.max(0, p.focusX))
      const fy = Math.min(1, Math.max(0, p.focusY))
      crop = { sx: (bitmap.width - sw) * fx, sy: (bitmap.height - sh) * fy, sw, sh }

      // Corner type: cap tops sit exactly on the top margin.
      const smallSize = SMALL.size * s
      const measure = new OffscreenCanvas(8, 8).getContext('2d')!
      smallFont = `${SMALL.weight} ${smallSize}px "${FAMILY}"`
      measure.font = smallFont
      measure.textBaseline = 'alphabetic'
      smallCap = measure.measureText('H').actualBoundingBoxAscent
      const indexWidth = index ? measure.measureText(index).width : 0
      if (label) {
        labelLayout = ctx.layoutText(label, {
          family: FAMILY,
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

      // Caption in Mario's story type. Shrinks (rarely) if a long caption would reach the labels.
      if (caption) {
        const available = H - bottom - (cornerBottom ? cornerBottom + 80 * s : top)
        let size = p.size * s
        for (;;) {
          captionTracking = STORY_TYPE.tracking * size
          captionLayout = ctx.layoutText(caption, {
            family: FAMILY,
            weight: '400',
            size,
            lineHeight: STORY_TYPE.lineHeight,
            maxWidth: W - side * 2,
            letterSpacing: captionTracking,
          })
          if (captionLayout.height <= available || size <= 32 * s) break
          size *= 0.94
        }
        captionTop = H - bottom - captionLayout.height
      }
    },

    update() {},

    render() {
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H)

      if (strength > 0) {
        if (captionLayout) {
          // Full strength by the caption's first line, held to the bottom edge. One rect on whole
          // pixels: the gradient pads its last stop past `to` (two abutting rects leave a seam).
          const from = Math.floor(Math.max(0, captionTop - fadeBottom))
          const to = captionTop + captionLayout.lineHeight * 0.5
          g.fillStyle = scrim(g, tint, from, to, strength)
          g.fillRect(0, from, W, H - from)
        }
        if (cornerBottom) {
          // Lighter: the corner type is small, it only needs a hint of ground.
          const to = Math.ceil(cornerBottom + fadeTop)
          g.fillStyle = scrim(g, tint, to, 0, strength * 0.6)
          g.fillRect(0, 0, W, to)
        }
      }

      const color = p.color
      if (captionLayout) {
        drawLayout(g, captionLayout, side, captionTop, { color, letterSpacing: captionTracking })
      }

      g.save()
      g.font = smallFont
      g.fillStyle = color
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
    },

    dispose() {},
  }
}

export default imageCaption
