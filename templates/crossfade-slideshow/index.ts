import type { TemplateFactory, TextLayout, TextLine, VideoLayer } from '@shared/template.ts'
import { mediaSize, textBlockY, textLineX, textPlacement } from '../_lib/layout.ts'
import { STORY_TYPE } from '../_lib/text.ts'

// A slideshow drawn with canvas 2D: every frame is two cover-fitted draws (the outgoing and the
// incoming slide) blended with globalAlpha — an sRGB dissolve, like an editor's crossfade — plus
// type drawn straight onto the canvas with per-line masks.
// Media size 'Fill' runs the slides full bleed; 'Fit' puts them in one fixed window on the ground
// colour (whole website recordings instead of a centre crop), with the type beside it; 'Auto'
// picks between them from the media's shapes.
// Scale and Position (the shared MEDIA_SIZE_PARAMS keys) work within that choice: Fill sizes each
// slide at cover × scale on the ground, placed (or, when it overflows, cropped) by Position; Fit
// scales the window, moves it through the room the type leaves, or crops it to that room. The Ken
// Burns drift always runs inside the part of a slide that shows (its clip).
// The type (title, caption, counter) moves as one group with Text position: Bottom (the classic
// look), Top (mirrored: the caption / counter row on the top margin, the title below it) or Middle
// (centred; in Fit the window sits just above it and the pair is centred). Text align centres
// the lines; the counter then gets its own centred row.

const FAMILY = 'PP Neue Montreal'
// Caption and counter type, in design px.
const SMALL = { size: 36, lineHeight: 1.15 }
// Design px: title ↔ caption row, type ↔ Fit window, counter ↔ caption (inline).
const TITLE_GAP = 40
const WINDOW_GAP = 56
const COUNTER_GAP = 64
// The smallest title size (design px, the param's minimum) a long title shrinks to in Fit so the
// window keeps at least this share of the frame's height.
const TITLE_MIN = 48
const WINDOW_MIN = 0.3
// Legibility gradient (Fill): reaches this far past the type, full strength this far inside it.
const SCRIM_REACH = 400
const SCRIM_INSET = 24
// Line masks hug the glyphs (measured), plus this much of the font size above and below.
const MASK_PAD = 0.05

interface Slide {
  bitmap: ImageBitmap | null
  layer: VideoLayer | null
  resized: boolean // bitmap made here, closed in dispose()
  w: number // canvas px at zoom 1 (cover × scale)
  h: number
  clip: Rect // where it shows (canvas px): the whole canvas, or the part its frame / window covers
  clipped: boolean // clip is smaller than the canvas
  dx: number // its centre relative to the clip's centre (Position), canvas px
  dy: number
  start: number // visible window (s), crossfades included
  end: number
  zoom: [number, number]
  pan: [number, number, number, number] // x0, y0 → x1, y1 in fractions of the clip
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// A line's mask band, relative to its top (textBaseline 'top'), in canvas px.
interface Band {
  top: number
  bottom: number
}

// Where the ink of a line sits in its line box (canvas px): line top → cap top, baseline → box
// bottom. Top / Middle place the group by its ink so it sits optically on the margin.
interface Ink {
  cap: number
  base: number
}

interface Placement {
  slide: number
  alpha: number
  x: number
  y: number
  w: number
  h: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
// Position 0 → lo, 0.5 → mid (exactly: the default placement), 1 → hi.
const between = (lo: number, mid: number, hi: number, f: number) =>
  f < 0.5 ? lo + (mid - lo) * f * 2 : mid + (hi - mid) * (f - 0.5) * 2
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
const pad = (i: number) => String(i).padStart(2, '0')

const crossfadeSlideshow: TemplateFactory = (ctx) => {
  const p = ctx.params as {
    crossfade: number
    motion: number
    titleSize: number
    weight: 'Regular' | 'Medium'
    counter: boolean
    framing: 'Auto' | 'Fill' | 'Fit'
    background: string
    color: string
    dim: number
  }
  const { position, align } = textPlacement(ctx.params)
  const { scale, focusX, focusY } = mediaSize(ctx.params)
  const center = align === 'Center'
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  const n = ctx.media.length
  const D = ctx.duration
  const slot = D / n
  const fade = Math.min(p.crossfade, slot * 0.6)
  const side = STORY_TYPE.side * s
  // Stories keep clear of Instagram's header and reply bar (Mario's 160 px); feed formats 56 px.
  const bottom = (ctx.aspect === '9:16' ? STORY_TYPE.bottom : 56) * s
  const top = bottom
  // Auto: full bleed when every slide is close to the frame's shape; otherwise (a landscape site
  // recording in a story) Fit, so the crop doesn't cut the site's own type and the title can't
  // land on it. Same 1.4× tolerance as shader-transition.
  const frameAspect = W / H
  const fit =
    p.framing === 'Fit' ||
    (p.framing === 'Auto' &&
      ctx.media.some((m) => Math.abs(Math.log(m.width / m.height / frameAspect)) > Math.log(1.4)))
  // Fit: the window every slide covers (scaled and placed, may overflow its room) and the part of
  // it that shows, both set in setup().
  const win: Rect = { x: 0, y: 0, w: W, h: H }
  const winClip: Rect = { x: 0, y: 0, w: W, h: H }

  const dissolve = ctx.gsap.parseEase('sine.inOut')
  const roll = ctx.gsap.parseEase('power3.inOut')

  let g: OffscreenCanvasRenderingContext2D
  const slides: Slide[] = []

  // Type, laid out in setup().
  const titleText = ctx.text.title?.trim() ?? ''
  const captionText = ctx.text.caption?.trim() ?? ''
  let titleSize = p.titleSize * s // may shrink in Fit (setup)
  let titleTracking = STORY_TYPE.tracking * titleSize
  const smallSize = SMALL.size * s
  const smallRow = smallSize * SMALL.lineHeight
  let title: TextLayout | null = null
  let caption: TextLayout | null = null
  let titleTop = 0
  let footerTop = 0 // top of the caption / counter block
  let footerH = 0
  let captionTop = 0
  let counterTop = 0
  let counterRight = 0
  let titleX: number[] = []
  let captionX: number[] = []
  let suffix = ''
  let suffixW = 0
  const digitW: number[] = []
  let cell = 0 // digits sit centred in equal cells (tabular), so only changed digits roll
  let titleBand: Band = { top: 0, bottom: 0 }
  let captionBand: Band = { top: 0, bottom: 0 }
  let counterBand: Band = { top: 0, bottom: 0 }

  // Tweened by the timeline (seeked by Pullup): 1 = hidden below its mask, 0 = set, -1 = gone above.
  const titleLines: { y: number }[] = []
  const captionLines: { y: number }[] = []
  const counterIn = { y: 1 }

  // Frame state, written by update() and drawn by render().
  const view = {
    layers: [] as Placement[],
    title: [] as number[],
    caption: [] as number[],
    counter: { y: 1, from: 0, to: 0, q: 0 },
    // Legibility gradient: clear at a, full from b to c, clear again at d. Bottom uses a → b (full
    // to the bottom edge), Top c → d (full from the top edge), Middle all four.
    scrim: { a: H, b: H, c: 0, d: 0, alpha: 0 },
  }

  const place = (index: number, t: number, alpha: number): Placement => {
    const sl = slides[index]!
    const u = clamp01((t - sl.start) / (sl.end - sl.start))
    const z = sl.zoom[0] + (sl.zoom[1] - sl.zoom[0]) * u
    const px = sl.pan[0] + (sl.pan[2] - sl.pan[0]) * u
    const py = sl.pan[1] + (sl.pan[3] - sl.pan[1]) * u
    const w = sl.w * z
    const h = sl.h * z
    const cx = sl.clip.x + sl.clip.w * (0.5 + px) + sl.dx
    const cy = sl.clip.y + sl.clip.h * (0.5 + py) + sl.dy
    return { slide: index, alpha, x: cx - w / 2, y: cy - h / 2, w, h }
  }

  // The ink extent of `sample` in the current font, padded: the mask a line rises through.
  const band = (sample: string, size: number): Band => {
    g.textBaseline = 'top'
    const m = g.measureText(sample)
    return {
      top: -m.actualBoundingBoxAscent - MASK_PAD * size,
      bottom: m.actualBoundingBoxDescent + MASK_PAD * size,
    }
  }

  // Ink offsets of a line of type in the current font (see Ink).
  const ink = (lineHeight: number): Ink => {
    g.textBaseline = 'top'
    const m = g.measureText('H')
    return { cap: -m.actualBoundingBoxAscent, base: lineHeight - m.actualBoundingBoxDescent }
  }

  // Draws inside a mask band at `top`, slid by `offset` × the band height (1 = just hidden
  // below, -1 = just hidden above).
  const masked = (b: Band, top: number, offset: number, draw: (dy: number) => void) => {
    if (offset <= -1 || offset >= 1) return
    const h = b.bottom - b.top
    g.save()
    g.beginPath()
    g.rect(0, top + b.top, W, h)
    g.clip()
    draw(offset * h)
    g.restore()
  }

  // One slide, clipped to the part of it that shows.
  const drawSlide = (l: Placement) => {
    const sl = slides[l.slide]!
    const source = sl.bitmap ?? sl.layer?.frame
    if (!source || l.alpha <= 0) return
    g.save()
    if (sl.clipped) {
      g.beginPath()
      g.rect(sl.clip.x, sl.clip.y, sl.clip.w, sl.clip.h)
      g.clip()
    }
    g.globalAlpha = l.alpha
    g.drawImage(source, l.x, l.y, l.w, l.h)
    g.restore()
  }

  const drawLine = (line: TextLine, x: number, y: number, b: Band, offset: number) =>
    masked(b, y + line.y, offset, (dy) => {
      for (const word of line.words) g.fillText(word.text, x + line.x + word.x, y + line.y + dy)
    })

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'

      // ── Type: sizes ──────────────────────────────────────────────────────────────────
      await ctx.font(FAMILY)
      const counter = p.counter && n > 1
      // Left: the counter sits on the caption's outer line, at the right margin. Center: it gets a
      // centred row of its own (on the outer side of the caption).
      const inline = counter && !center
      g.font = `400 ${smallSize}px "${FAMILY}"`
      g.letterSpacing = '0px'
      suffix = `/${pad(n)}`
      suffixW = g.measureText(suffix).width
      counterBand = band('0123456789/', smallSize)
      for (let d = 0; d <= 9; d++) digitW[d] = g.measureText(String(d)).width
      cell = Math.max(...digitW)
      const counterW = suffixW + cell * 2
      const smallInk = ink(smallRow)

      if (captionText) {
        caption = ctx.layoutText(captionText, {
          family: FAMILY,
          size: smallSize,
          lineHeight: SMALL.lineHeight,
          maxWidth: W - side * 2 - (inline ? counterW + COUNTER_GAP * s : 0),
        })
        captionBand = band(`H${captionText.replace(/\s+/g, '')}`, smallSize)
      }
      const footer = !!caption || counter
      // Without a caption or counter this is a phantom row the gradient settles on.
      footerH = caption ? caption.height + (counter && center ? smallRow : 0) : smallRow

      let titleInk: Ink = { cap: 0, base: 0 }
      const layoutTitle = (size: number) => {
        titleSize = size
        titleTracking = STORY_TYPE.tracking * size
        title = ctx.layoutText(titleText, {
          family: FAMILY,
          weight: p.weight === 'Medium' ? '500' : '400',
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: W - side * 2,
          letterSpacing: titleTracking,
        })
        g.font = title.font
        g.letterSpacing = `${titleTracking}px`
        titleInk = ink(title.lineHeight)
        titleBand = band(`H${titleText.replace(/\s+/g, '')}`, size)
      }
      const hasText = !!titleText || footer
      const groupHeight = () =>
        (title ? title.height : 0) + (title && footer ? TITLE_GAP * s : 0) + (footer ? footerH : 0)
      // Height left for the Fit window once the type and its gap are set.
      const room = () => H - top - bottom - (hasText ? groupHeight() + WINDOW_GAP * s : 0)
      if (titleText) {
        layoutTitle(titleSize)
        // Fit: a long title shrinks (like a caption card's) rather than run into the window.
        while (fit && room() < H * WINDOW_MIN && titleSize > TITLE_MIN * s) {
          layoutTitle(Math.max(TITLE_MIN * s, titleSize * 0.94))
        }
      }
      const groupH = groupHeight()

      // Rows inside the group. Bottom / Middle: title, then the caption / counter block. Top:
      // mirrored, so the small row sits on the top margin and survives the title's exit there.
      const topFirst = position === 'Top'
      const placeGroup = (edge: number) => {
        if (topFirst) {
          footerTop = edge // edge = the group's top
          titleTop = footer ? footerTop + footerH + TITLE_GAP * s : edge
        } else {
          footerTop = edge - footerH // edge = the group's bottom
          if (title) titleTop = (footer ? footerTop - TITLE_GAP * s : edge) - title.height
        }
        const counterFirst = topFirst && counter && center
        captionTop = counterFirst ? footerTop + smallRow : footerTop
        if (inline) {
          // On the caption's outer line: the last at Bottom / Middle, the first at Top.
          counterTop = topFirst ? footerTop : footerTop + footerH - smallRow
        } else {
          counterTop = counterFirst ? footerTop : footerTop + (caption ? caption.height : 0)
        }
      }
      // The group placed on its own: its ink (cap top of the first line → baseline of the last)
      // by textBlockY; Bottom keeps the last line box on the bottom margin, as it always has.
      const inkFirst = topFirst ? (footer ? smallInk : titleInk) : title ? titleInk : smallInk
      const inkLast = topFirst ? (title ? titleInk : smallInk) : footer ? smallInk : titleInk
      const inkH = groupH - inkFirst.cap - inkLast.base
      const inkTop = textBlockY(H, inkH, position, { top, bottom: bottom + inkLast.base })
      if (position === 'Bottom') placeGroup(H - bottom)
      else if (topFirst) placeGroup(inkTop - inkFirst.cap)
      else placeGroup(inkTop - inkFirst.cap + groupH)

      // Lines: on the side margin, or each centred on the frame; the counter follows.
      titleX = title ? title.lines.map((l) => textLineX(W, l.width, align, side)) : []
      captionX = caption ? caption.lines.map((l) => textLineX(W, l.width, align, side)) : []
      counterRight = center ? (W + counterW) / 2 : W - side

      // ── Frame: full bleed, or one window for every slide (Fit) ───────────────────────
      const sources: { bitmap: ImageBitmap | null; layer: VideoLayer | null; aspect: number }[] = []
      for (let k = 0; k < n; k++) {
        if (ctx.media[k]!.kind === 'video') {
          const layer = ctx.video(k)
          sources.push({ bitmap: null, layer, aspect: layer.width / layer.height })
        } else {
          const bitmap = await ctx.image(k)
          sources.push({ bitmap, layer: null, aspect: bitmap.width / bitmap.height })
        }
      }
      if (fit) {
        // One window shape for all slides (their geometric-mean aspect) so crossfades line up.
        const aspect = Math.exp(sources.reduce((sum, x) => sum + Math.log(x.aspect), 0) / n)
        const textTop = title ? titleTop : footer ? footerTop : H
        const textBottom = !hasText
          ? top
          : topFirst && title
            ? titleTop + title.height
            : footerTop + footerH
        const floor = Math.min(textTop - WINDOW_GAP * s, H - bottom)
        const ceiling = Math.max(textBottom + WINDOW_GAP * s, top)
        // The window takes the height the type leaves (a long title shrank above to leave enough).
        const avail =
          position === 'Top' ? H - bottom - ceiling : position === 'Middle' ? room() : floor - top
        const w = Math.min(W - side * 2, Math.max(avail, H * WINDOW_MIN) * aspect)
        const h = w / aspect
        // Scale sizes the window (the slides cover it at any size). Position moves it through the
        // room the type leaves (0.5 = the classic placement); a window bigger than that room is
        // cropped to it, and Position picks the part that shows.
        const sw = w * scale
        const sh = h * scale
        const boxW = W - side * 2
        win.w = sw
        win.h = sh
        win.x = (W - sw) / 2 + (boxW - sw) * (focusX - 0.5)
        winClip.x = sw <= boxW ? win.x : side
        winClip.w = Math.min(sw, boxW)
        if (position === 'Middle' && hasText) {
          // Window and type stacked (window above) and centred as a pair; Position moves the pair.
          const vh = Math.min(sh, Math.max(room(), h))
          const pair = vh + WINDOW_GAP * s + groupH
          const mid = textBlockY(H, pair, 'Middle', { top, bottom })
          winClip.y = between(top, mid, Math.max(mid, H - bottom - pair), focusY)
          winClip.h = vh
          win.y = winClip.y + (vh - sh) * focusY
          placeGroup(winClip.y + vh + WINDOW_GAP * s + groupH)
        } else {
          // The window's room: below the type (Top) or above it, inside the margins. Optically
          // centred on the canvas by default, kept clear of the type.
          const y0 = position === 'Top' ? Math.min(ceiling, H - bottom - h) : top
          const y1 = position === 'Top' ? H - bottom : Math.max(floor, top + h)
          if (sh <= y1 - y0 + 0.5) {
            const hi = Math.max(y0, y1 - sh)
            win.y = between(y0, clamp((H - sh) / 2, y0, hi), hi, focusY)
            winClip.y = win.y
            winClip.h = sh
          } else {
            win.y = y0 + (y1 - y0 - sh) * focusY
            winClip.y = y0
            winClip.h = y1 - y0
          }
        }
      }

      // ── Slides: timing, cover size, Ken Burns path ───────────────────────────────────
      for (let k = 0; k < n; k++) {
        const start = k === 0 ? 0 : k * slot - fade / 2
        const end = k === n - 1 ? D : (k + 1) * slot + fade / 2

        // Same drift speed whatever the slot length (within limits), alternating direction.
        const delta = p.motion * Math.min(1.6, Math.max(0.35, (end - start) / 3.2))
        const pan = 0.3 * delta // half-range in fractions of the clip
        const zLow = 1 + 2.1 * pan // always enough overscan for the pan
        const zHigh = zLow + delta
        const dir = k % 2 === 0 ? 1 : -1
        const lift = ctx.random() - 0.5

        let { bitmap } = sources[k]!
        const { layer, aspect } = sources[k]!
        // The slide at zoom 1: covering the Fit window, or the canvas × Scale (Fill), placed by
        // Position. Its clip is the part of that which shows.
        const box = fit ? win : { x: 0, y: 0, w: W, h: H }
        const wide = aspect > box.w / box.h
        const coverW = wide ? box.h * aspect : box.w
        const coverH = wide ? box.h : box.w / aspect
        const w = fit ? coverW : coverW * scale
        const h = fit ? coverH : coverH * scale
        let clip: Rect = winClip
        let cx = win.x + win.w / 2
        let cy = win.y + win.h / 2
        if (!fit) {
          cx = W / 2 + (W - w) * (focusX - 0.5)
          cy = H / 2 + (H - h) * (focusY - 0.5)
          const x0 = Math.max(0, cx - w / 2)
          const y0 = Math.max(0, cy - h / 2)
          const x1 = Math.min(W, cx + w / 2)
          const y1 = Math.min(H, cy + h / 2)
          // Within a hair of the canvas counts as the canvas (no clip, the classic full bleed).
          const full = x0 < 0.01 && y0 < 0.01 && x1 > W - 0.01 && y1 > H - 0.01
          clip = full ? { x: 0, y: 0, w: W, h: H } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        }

        // Downscale big images once (high-quality filter), to the smallest size they are drawn
        // at: every frame then magnifies by at most zHigh/zLow (~8%). Minifying fine detail at a
        // slowly changing scale each frame makes it shimmer (and balloons the bitrate).
        let resized = false
        const targetW = Math.ceil(w * zLow)
        if (bitmap && bitmap.width > targetW * 1.02) {
          bitmap = await createImageBitmap(bitmap, {
            resizeWidth: targetW,
            resizeHeight: Math.ceil(h * zLow),
            resizeQuality: 'high',
          })
          resized = true
        }

        slides.push({
          bitmap,
          layer,
          resized,
          w,
          h,
          clip,
          clipped: clip.x > 0 || clip.y > 0 || clip.w < W || clip.h < H,
          dx: cx - (clip.x + clip.w / 2),
          dy: cy - (clip.y + clip.h / 2),
          start,
          end,
          zoom: k % 2 === 0 ? [zLow, zHigh] : [zHigh, zLow],
          pan: [-dir * pan, -lift * pan, dir * pan, lift * pan],
        })
      }

      // ── Motion: type reveals on one paused timeline ──────────────────────────────────
      const tl = ctx.timeline()
      const reveal = { duration: 1.1, ease: 'expo.out', immediateRender: false }
      let at = 0.25
      title?.lines.forEach((_, i) => {
        const line = { y: 1 }
        titleLines.push(line)
        tl.fromTo(line, { y: 1 }, { y: 0, ...reveal }, at + i * 0.08)
      })
      if (title) {
        // Out through the top of the masks, gone by the middle of the first crossfade.
        const lines = title.lines.length
        const exitDur = 0.55
        // expo.out has done its visible work ~0.6 s in; hold at least half a second after that.
        const settled = at + (lines - 1) * 0.08 + 0.6
        const exitAt = Math.max(slot - exitDur - (lines - 1) * 0.04, settled + 0.5)
        if (exitAt + exitDur + (lines - 1) * 0.04 < D - 0.3) {
          titleLines.forEach((line, i) => {
            tl.fromTo(
              line,
              { y: 0 },
              { y: -1, duration: exitDur, ease: 'power3.in', immediateRender: false },
              exitAt + i * 0.04
            )
          })
        }
        at += lines * 0.08 + 0.04
      }
      caption?.lines.forEach((_, i) => {
        const line = { y: 1 }
        captionLines.push(line)
        tl.fromTo(line, { y: 1 }, { y: 0, ...reveal }, at + i * 0.06)
      })
      if (counter) {
        const last = Math.max(0, (caption?.lines.length ?? 1) - 1)
        tl.fromTo(counterIn, { y: 1 }, { y: 0, ...reveal }, at + last * 0.06)
      } else {
        counterIn.y = 2 // never drawn
      }
    },

    update(t) {
      // Which slides are on screen: one, or two while crossfading at a slot boundary.
      const k = Math.min(n - 1, Math.max(0, Math.floor(t / slot)))
      let from = k
      let to = -1
      let q = 0
      if (k > 0 && t < k * slot + fade / 2) {
        from = k - 1
        to = k
        q = (t - (k * slot - fade / 2)) / fade
      } else if (k < n - 1 && t > (k + 1) * slot - fade / 2) {
        to = k + 1
        q = (t - ((k + 1) * slot - fade / 2)) / fade
      }
      q = clamp01(q)
      view.layers = [place(from, t, 1)]
      if (to >= 0) view.layers.push(place(to, t, dissolve(q)))

      // Counter rolls to the next number with the crossfade.
      view.counter.y = counterIn.y
      view.counter.from = from + 1
      view.counter.to = to >= 0 ? to + 1 : from + 1
      view.counter.q = to >= 0 ? roll(q) : 0

      view.title = titleLines.map((l) => l.y)
      view.caption = captionLines.map((l) => l.y)

      // Legibility gradient: tall while the title is up, settles to the caption row after.
      const sc = view.scrim
      if (title || caption || counterIn.y < 2) {
        const gone = view.title.length
          ? view.title.reduce((sum, y) => sum + Math.max(0, -y), 0) / view.title.length
          : 1
        sc.alpha = 1
        if (position === 'Top') {
          // Mirrored: full from the top edge, its lower edge rises from the title to the row.
          const footerBottom = footerTop + footerH
          const textBottom = title
            ? titleTop + title.height + (footerBottom - titleTop - title.height) * gone
            : footerBottom
          sc.c = textBottom - SCRIM_INSET * s
          sc.d = Math.min(H, textBottom + SCRIM_REACH * s)
        } else {
          const textTop = title ? titleTop + (footerTop - titleTop) * gone : footerTop
          if (position === 'Middle') {
            const textBottom =
              caption || counterIn.y < 2 ? footerTop + footerH : titleTop + (title?.height ?? 0)
            sc.a = textTop - SCRIM_REACH * s
            sc.b = textTop + SCRIM_INSET * s
            sc.c = Math.max(sc.b, textBottom - SCRIM_INSET * s)
            sc.d = textBottom + SCRIM_REACH * s
            // A lone title leaves nothing to set off once it's gone.
            if (!caption && counterIn.y >= 2) sc.alpha = 1 - gone
          } else {
            sc.a = Math.max(0, textTop - SCRIM_REACH * s)
            sc.b = textTop + SCRIM_INSET * s
          }
        }
      } else {
        sc.alpha = 0
      }

      // Each clip plays from its start as it fades in; before that it waits on frame 0, after
      // its slot it holds (same time requested again = nothing decoded).
      for (const sl of slides) {
        if (!sl.layer) continue
        const local = Math.max(0, Math.min(t, sl.end) - sl.start)
        sl.layer.seek(Math.min(local, sl.layer.duration))
      }
    },

    render() {
      g.globalAlpha = 1
      g.fillStyle = p.background
      g.fillRect(0, 0, W, H)

      const [outgoing, incoming] = view.layers
      if (outgoing) drawSlide(outgoing)
      if (incoming && incoming.alpha > 0) {
        // A dissolve between two whole frames: where only the outgoing slide shows (slides of
        // different sizes), the ground fades back in as the incoming slide does.
        const a = slides[outgoing!.slide]!.clip
        const b = slides[incoming.slide]!.clip
        if (!sameRect(a, b)) {
          g.save()
          g.globalAlpha = incoming.alpha
          g.beginPath()
          g.rect(a.x, a.y, a.w, a.h)
          g.clip()
          g.beginPath()
          g.rect(0, 0, W, H)
          g.rect(b.x, b.y, b.w, b.h)
          g.clip('evenodd')
          g.fillStyle = p.background
          g.fillRect(a.x, a.y, a.w, a.h)
          g.restore()
        }
        drawSlide(incoming)
      }
      g.globalAlpha = 1

      // Soft darkening behind the type (smoothstep ramps, no visible edge). Fit sets type on the
      // ground, so it needs none.
      const sc = view.scrim
      if (!fit && p.dim > 0 && sc.alpha > 0) {
        const stop = (u: number) =>
          `rgba(0,0,0,${(p.dim * sc.alpha * u * u * (3 - 2 * u)).toFixed(4)})`
        if (position === 'Bottom') {
          // Clear at a, full from b down (the gradient pads its last stop to the bottom edge).
          const grad = g.createLinearGradient(0, sc.a, 0, sc.b)
          for (let i = 0; i <= 10; i++) grad.addColorStop(i / 10, stop(i / 10))
          g.fillStyle = grad
          g.fillRect(0, sc.a, W, H - sc.a)
        } else if (position === 'Top') {
          // Clear at d, full from c up.
          const grad = g.createLinearGradient(0, sc.d, 0, sc.c)
          for (let i = 0; i <= 10; i++) grad.addColorStop(i / 10, stop(i / 10))
          g.fillStyle = grad
          g.fillRect(0, 0, W, sc.d)
        } else {
          // One band gradient (two abutting rects would leave a seam).
          const span = sc.d - sc.a
          const grad = g.createLinearGradient(0, sc.a, 0, sc.d)
          for (let i = 0; i <= 10; i++) {
            grad.addColorStop(clamp01(((sc.b - sc.a) * i) / 10 / span), stop(i / 10))
          }
          for (let i = 0; i <= 10; i++) {
            grad.addColorStop(
              clamp01((sc.c - sc.a + ((sc.d - sc.c) * i) / 10) / span),
              stop(1 - i / 10)
            )
          }
          g.fillStyle = grad
          const y0 = Math.max(0, sc.a)
          g.fillRect(0, y0, W, Math.min(H, sc.d) - y0)
        }
      }

      g.fillStyle = p.color
      g.textBaseline = 'top'

      if (title) {
        g.font = title.font
        g.letterSpacing = `${titleTracking}px`
        title.lines.forEach((line, i) =>
          drawLine(line, titleX[i]!, titleTop, titleBand, view.title[i] ?? 1)
        )
      }

      g.font = `400 ${smallSize}px "${FAMILY}"`
      g.letterSpacing = '0px'
      if (caption) {
        caption.lines.forEach((line, i) =>
          drawLine(line, captionX[i]!, captionTop, captionBand, view.caption[i] ?? 1)
        )
      }

      const c = view.counter
      if (c.y > -1 && c.y < 1) {
        const right = counterRight
        const from = pad(c.from)
        const to = pad(c.to)
        for (let j = 0; j < 2; j++) {
          const x = right - suffixW - cell * (2 - j)
          const digit = (ch: string, offset: number) =>
            masked(counterBand, counterTop, offset, (dy) =>
              g.fillText(ch, x + (cell - (digitW[Number(ch)] ?? cell)) / 2, counterTop + dy)
            )
          if (c.q > 0 && from[j] !== to[j]) {
            digit(from[j]!, c.y - c.q)
            digit(to[j]!, c.y + 1 - c.q)
          } else {
            digit(from[j]!, c.y)
          }
        }
        masked(counterBand, counterTop, c.y, (dy) =>
          g.fillText(suffix, right - suffixW, counterTop + dy)
        )
      }
    },

    dispose() {
      for (const sl of slides) if (sl.resized) sl.bitmap?.close()
      slides.length = 0
    },
  }
}

export default crossfadeSlideshow
