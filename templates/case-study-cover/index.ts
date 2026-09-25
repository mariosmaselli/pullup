import type { Aspect, LayoutTextOptions, TemplateFactory } from '@shared/template.ts'

// Case study cover — a still, drawn with canvas 2D.
//
// Everything sits on a 12-column grid (40 px margins, 20 px gutters at 1080 wide). Column 7 is the
// key line: the header label, the meta values and the half-width image block all start on it.
// Text is placed by baselines measured from the font's real metrics (cap height, descenders) and
// aligned by its ink edge, not its advance box, so gaps and margins are optical, not em-box guesses.
// All geometry is planned in setup(); render() only composites the result.

const FAMILY = 'PP Neue Montreal'
const WEIGHTS: Record<string, string> = { Regular: '400', Medium: '500', SemiBold: '600' }

// Grid, in design px.
const MARGIN = 40
const GUTTER = 20
const COL = (1080 - 2 * MARGIN - 11 * GUTTER) / 12 // 65
const colX = (c: number) => MARGIN + (c - 1) * (COL + GUTTER)
const spanW = (n: number) => n * COL + (n - 1) * GUTTER
const KEY = 7

// Top/bottom margins per format. Stories keep clear of Instagram's own UI (profile bar, reply bar).
const FRAME: Record<Aspect, { top: number; bottom: number; title: number }> = {
  '4:5': { top: 40, bottom: 40, title: 1 },
  '1:1': { top: 40, bottom: 40, title: 0.84 },
  '9:16': { top: 200, bottom: 160, title: 1 },
}

const SMALL = { size: 26, lineHeight: 1.2 } // header + meta rows
const DESC = { size: 40, lineHeight: 1.12, tracking: -0.01, span: 10 }
const TITLE = { lineHeight: 0.9, tracking: -0.03, maxLines: 3 }
const ROW = { padTop: 18, padBottom: 22 } // meta row padding around its text
const GAP = { stage: 48, descMeta: 64, titleDesc: 34 } // visible gaps

const PALETTE = {
  Dark: { bg: '#101010', fg: '#ffffff', muted: 0.5, rule: 0.22 },
  Light: { bg: '#f2f1ec', fg: '#101010', muted: 0.52, rule: 0.2 },
}

interface Run {
  text: string
  x: number // where the ink starts (left) or ends (right)
  y: number // baseline
  font: string
  tracking: number // px
  alpha: number
  align: 'left' | 'right'
}

interface Plan {
  bg: string
  // Type, rules and the studio mark, drawn once in setup() on a transparent layer: on an opaque 2D
  // canvas Chrome antialiases text with LCD subpixels, which leaves colour fringes on the glyphs.
  ink: OffscreenCanvas
  block: { bitmap: ImageBitmap; x: number; y: number } | null
  bleed: {
    bitmap: ImageBitmap
    headerBase: number
    topFade: number
    bottomFrom: number
    titleTop: number
  } | null
}

// Crop `src` to the w×h aspect (centred, like object-fit: cover) and resample it to exactly w×h.
function cover(src: ImageBitmap, w: number, h: number) {
  const a = src.width / src.height
  const b = w / h
  let sw = src.width
  let sh = src.height
  if (a > b) sw = sh * b
  else sh = sw / b
  const sx = (src.width - sw) / 2
  const sy = (src.height - sh) / 2
  return createImageBitmap(src, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh), {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high',
  })
}

const caseStudyCover: TemplateFactory = (ctx) => {
  const p = ctx.params as {
    layout: 'Type only' | 'Image block' | 'Full bleed'
    theme: 'Dark' | 'Light'
    accent: string
    weight: 'Regular' | 'Medium' | 'SemiBold'
    size: number
    dim: number
  }
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  let g: OffscreenCanvasRenderingContext2D
  let plan: Plan

  const font = (weight: string, size: number) => `${weight} ${size}px "${FAMILY}"`

  // Word wrap with balanced lines (like CSS text-wrap: balance): keep the greedy line count, then
  // find the narrowest measure that still gives it. No dangling "in" or orphan last word, and
  // phrases like "Creative development" stay together more often. Manual line breaks still apply.
  const layoutBalanced = (str: string, o: LayoutTextOptions) => {
    const greedy = ctx.layoutText(str, o)
    if (greedy.lines.length < 2) return greedy
    let lo = 0
    let hi = o.maxWidth
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (ctx.layoutText(str, { ...o, maxWidth: mid }).lines.length > greedy.lines.length) lo = mid
      else hi = mid
    }
    return ctx.layoutText(str, { ...o, maxWidth: hi })
  }

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      await ctx.font(FAMILY)

      const ink = new OffscreenCanvas(W, H)
      // willReadFrequently keeps this layer on the CPU rasteriser: large glyphs drawn by the GPU
      // path renderer differed by a few pixels between identical runs.
      const k = ink.getContext('2d', { willReadFrequently: true })!
      const text = (key: string) => (ctx.text[key] ?? '').trim()
      const source = ctx.media[0]?.kind === 'image' ? await ctx.image(0) : null
      const layout = source ? p.layout : 'Type only'
      const bleed = layout === 'Full bleed'
      // Full bleed always sets white type on the darkened image.
      const palette = bleed || p.theme !== 'Light' ? PALETTE.Dark : PALETTE.Light
      const frame = FRAME[ctx.aspect]
      const left = colX(1) * s
      const right = W - MARGIN * s
      const key = colX(KEY) * s
      const hair = Math.max(1, Math.round(1.5 * s))

      const measure = (f: string, str: string, tracking = 0) => {
        k.font = f
        k.letterSpacing = `${tracking}px`
        k.textAlign = 'left'
        return k.measureText(str)
      }
      const cap = (f: string) => measure(f, 'H').actualBoundingBoxAscent

      const runs: Run[] = []
      const rules: { x: number; y: number; w: number }[] = []
      const run = (r: Partial<Run> & Pick<Run, 'text' | 'x' | 'y' | 'font'>) =>
        runs.push({ tracking: 0, alpha: 1, align: 'left', ...r })

      // ── Header: studio mark · label (key line) · number ────────────────────────────────────
      const smallSize = SMALL.size * s
      const small = font('400', smallSize)
      const smallMedium = font('500', smallSize)
      const smallCap = cap(small)
      const headerBase = frame.top * s + smallCap
      let mark: { x: number; y: number; size: number } | null = null
      const studio = text('studio')
      if (studio) {
        mark = { x: left, y: headerBase - smallCap, size: smallCap }
        run({
          text: studio,
          x: left + smallCap + smallSize * 0.4,
          y: headerBase,
          font: smallMedium,
        })
      }
      if (text('label')) run({ text: text('label'), x: key, y: headerBase, font: small })
      if (text('index')) {
        run({ text: text('index'), x: right, y: headerBase, font: small, align: 'right' })
      }

      // ── Meta rows, from the bottom margin up ───────────────────────────────────────────────
      const rows = (
        [
          ['Client', text('client')],
          ['Year', text('year')],
          ['Services', text('services')],
          ['Role', text('role')],
        ] as const
      ).filter(([, v]) => v)
      let base = H - frame.bottom * s // baseline of the lowest line of the current row
      let metaTop = base // top rule of the meta block (the bottom margin when there are no rows)
      for (let i = rows.length - 1; i >= 0; i--) {
        const [label, value] = rows[i]!
        const v = layoutBalanced(value, {
          family: FAMILY,
          size: smallSize,
          lineHeight: SMALL.lineHeight,
          maxWidth: right - key,
        })
        const first = base - (v.lines.length - 1) * v.lineHeight
        run({ text: label, x: left, y: first, font: small, alpha: palette.muted })
        v.lines.forEach((line, j) =>
          run({ text: line.text, x: key, y: first + j * v.lineHeight, font: small })
        )
        metaTop = first - smallCap - ROW.padTop * s
        rules.push({ x: left, y: metaTop, w: right - left })
        base = metaTop - ROW.padBottom * s
      }
      // The visible bottom edge available to the blocks above.
      let anchor = rows.length ? metaTop - GAP.descMeta * s : metaTop

      // ── Description ───────────────────────────────────────────────────────────────────────
      const description = text('description')
      if (description) {
        const size = DESC.size * s
        const f = font('400', size)
        const tracking = DESC.tracking * size
        const d = layoutBalanced(description, {
          family: FAMILY,
          size,
          lineHeight: DESC.lineHeight,
          maxWidth: spanW(DESC.span) * s,
          letterSpacing: tracking,
        })
        // The last baseline sits on the anchor (descenders hang into the gap, as in print).
        const first = anchor - (d.lines.length - 1) * d.lineHeight
        d.lines.forEach((line, j) =>
          run({ text: line.text, x: left, y: first + j * d.lineHeight, font: f, tracking })
        )
        anchor = first - cap(f) - GAP.titleDesc * s
      }

      // ── Title: as large as the size param allows, shrunk until it fits the grid ────────────
      const weight = WEIGHTS[p.weight] ?? '500'
      const maxWidth = spanW(12) * s
      const titleOptions = (size: number): LayoutTextOptions => ({
        family: FAMILY,
        weight,
        size,
        lineHeight: TITLE.lineHeight,
        maxWidth,
        letterSpacing: TITLE.tracking * size,
      })
      let size = p.size * frame.title * s
      let fit = ctx.layoutText(text('title'), titleOptions(size))
      for (let i = 0; i < 40 && (fit.width > maxWidth || fit.lines.length > TITLE.maxLines); i++) {
        size *= 0.95
        fit = ctx.layoutText(text('title'), titleOptions(size))
      }
      // Place the (balanced) title above the anchor. Descenders on the last line push it up so
      // the visible gap stays the same.
      const place = (size: number) => {
        const t = layoutBalanced(text('title'), titleOptions(size))
        const f = font(weight, size)
        const last = t.lines.at(-1)?.text ?? ''
        const descent = last
          ? Math.max(0, measure(f, last, TITLE.tracking * size).actualBoundingBoxDescent)
          : 0
        const lastBase = anchor - descent
        const firstBase = lastBase - (t.lines.length - 1) * t.lineHeight
        return { t, f, size, firstBase, top: last ? firstBase - cap(f) : lastBase }
      }
      let placed = place(size)
      // An image block needs room: shrink the title (to 60% at most) until the stage between
      // header and title is at least ~a quarter (26%) of the frame height.
      if (source && layout === 'Image block') {
        const minSize = size * 0.6
        const stageOf = (top: number) => top - headerBase - 2 * GAP.stage * s
        while (stageOf(placed.top) < 0.26 * H && placed.size * 0.95 >= minSize) {
          placed = place(placed.size * 0.95)
        }
      }
      const { t, firstBase: titleFirst } = placed
      const titleFont = placed.f
      const titleTracking = TITLE.tracking * placed.size
      t.lines.forEach((line, j) => {
        if (line.text) {
          run({
            text: line.text,
            x: left,
            y: titleFirst + j * t.lineHeight,
            font: titleFont,
            tracking: titleTracking,
          })
        }
      })
      const titleTop = placed.top

      // ── Image ──────────────────────────────────────────────────────────────────────────────
      let block: Plan['block'] = null
      let bleedPlan: Plan['bleed'] = null
      if (source && bleed) {
        bleedPlan = {
          bitmap: await cover(source, W, H),
          headerBase,
          topFade: headerBase + 240 * s,
          bottomFrom: Math.max(H * 0.2, titleTop - 340 * s),
          titleTop,
        }
      } else if (source && layout === 'Image block') {
        // The stage is the space between the header and the title. The block sits on the full
        // grid (cols 1–12) or the right half (cols 7–12), whichever shows the most image with the
        // least cropping. To fill the stage it may trim up to CROP of the image's width, no more.
        const CROP = 0.2
        const stageTop = headerBase + GAP.stage * s
        const stageBottom = titleTop - GAP.stage * s
        const stage = stageBottom - stageTop
        const aspect = source.width / source.height
        let best = { score: -1, span: 12, w: 0, h: 0 }
        for (const span of [12, 6]) {
          const w = spanW(span) * s
          const h = Math.min(stage, w / (aspect * (1 - CROP)))
          const b = w / h
          const shown = Math.min(b / aspect, aspect / b)
          const score = w * h * shown * shown
          if (score > best.score) best = { score, span, w, h }
        }
        if (best.h >= 120 * s) {
          const x = Math.round(best.span === 12 ? left : key)
          const w = Math.round(best.w)
          const h = Math.round(best.h)
          block = { bitmap: await cover(source, w, h), x, y: Math.round(stageBottom) - h }
        }
      }

      // ── Draw the ink layer ────────────────────────────────────────────────────────────────
      k.fillStyle = palette.fg
      k.globalAlpha = palette.rule
      for (const r of rules) k.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), hair)
      k.globalAlpha = 1
      if (mark) {
        k.fillStyle = p.accent
        k.fillRect(
          Math.round(mark.x),
          Math.round(mark.y),
          Math.round(mark.size),
          Math.round(mark.size)
        )
      }
      k.fillStyle = palette.fg
      k.textBaseline = 'alphabetic'
      for (const r of runs) {
        const m = measure(r.font, r.text, r.tracking)
        // Shift by the side bearing so the ink edge (not the advance box) lands on the grid line.
        // (measure() uses textAlign 'left': ink spans x - boxLeft … x + boxRight.)
        const x =
          r.align === 'left' ? r.x + m.actualBoundingBoxLeft : r.x - m.actualBoundingBoxRight
        k.globalAlpha = r.alpha
        k.fillText(r.text, x, r.y)
      }
      k.globalAlpha = 1

      plan = { bg: palette.bg, ink, block, bleed: bleedPlan }
    },

    update() {},

    render() {
      g.globalAlpha = 1
      g.fillStyle = plan.bg
      g.fillRect(0, 0, W, H)

      if (plan.bleed) {
        const { bitmap, headerBase, topFade, bottomFrom, titleTop } = plan.bleed
        g.drawImage(bitmap, 0, 0)
        const shade = (a: number) => `rgba(16, 16, 16, ${a})`
        g.fillStyle = shade(p.dim)
        g.fillRect(0, 0, W, H)
        // Shades behind the header and under the type block, cosine-eased so no edge or band
        // shows. The top one holds full strength down to the header baseline (in stories the
        // header sits low, under Instagram's UI), the bottom one reaches full strength a little
        // below the title's cap line.
        const ease = (x: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, x)))) / 2
        const top = g.createLinearGradient(0, 0, 0, topFade)
        const hold = headerBase / topFade
        const bottom = g.createLinearGradient(0, bottomFrom, 0, H)
        const full = Math.max(0.15, (titleTop - bottomFrom) / (H - bottomFrom) + 0.22)
        for (let i = 0; i <= 16; i++) {
          const u = i / 16
          top.addColorStop(u, shade(0.45 * (1 - ease((u - hold) / (1 - hold)))))
          bottom.addColorStop(u, shade(0.8 * ease(u / full)))
        }
        g.fillStyle = top
        g.fillRect(0, 0, W, topFade)
        g.fillStyle = bottom
        g.fillRect(0, bottomFrom, W, H - bottomFrom)
      }

      if (plan.block) g.drawImage(plan.block.bitmap, plan.block.x, plan.block.y)
      g.drawImage(plan.ink, 0, 0)
    },

    dispose() {
      // The source bitmap belongs to Pullup; the cropped copies are ours.
      plan?.block?.bitmap.close()
      plan?.bleed?.bitmap.close()
      if (plan) plan.ink.width = plan.ink.height = 0 // release the layer's backing store now
    },
  }
}

export default caseStudyCover
