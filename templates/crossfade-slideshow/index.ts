import type { TemplateFactory, TextLayout, TextLine, VideoLayer } from '@shared/template.ts'
import { STORY_TYPE } from '../_lib/text.ts'

// A slideshow drawn with canvas 2D: every frame is two cover-fitted draws (the outgoing and the
// incoming slide) blended with globalAlpha — an sRGB dissolve, like an editor's crossfade — plus
// type drawn straight onto the canvas with per-line masks.
// Framing 'Fill' runs the slides full bleed; 'Fit' puts them in one fixed window on the ground
// colour (whole website recordings instead of a centre crop), with the type set below it; 'Auto'
// picks between them from the media's shapes.

const FAMILY = 'PP Neue Montreal'
// Caption and counter type, in design px.
const SMALL = { size: 36, lineHeight: 1.15 }
// Line masks hug the glyphs (measured), plus this much of the font size above and below.
const MASK_PAD = 0.05

interface Slide {
  bitmap: ImageBitmap | null
  layer: VideoLayer | null
  resized: boolean // bitmap made here, closed in dispose()
  coverW: number // canvas px at zoom 1
  coverH: number
  start: number // visible window (s), crossfades included
  end: number
  zoom: [number, number]
  pan: [number, number, number, number] // x0, y0 → x1, y1 in fractions of the frame rect
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

interface Placement {
  slide: number
  alpha: number
  x: number
  y: number
  w: number
  h: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
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
  const s = ctx.scale
  const W = ctx.width
  const H = ctx.height
  const n = ctx.media.length
  const D = ctx.duration
  const slot = D / n
  const fade = Math.min(p.crossfade, slot * 0.6)
  const side = STORY_TYPE.side * s
  const bottom = (ctx.aspect === '9:16' ? STORY_TYPE.bottom : 56) * s
  // Auto: full bleed when every slide is close to the frame's shape; otherwise (a landscape site
  // recording in a story) Fit, so the crop doesn't cut the site's own type and the title can't
  // land on it. Same 1.4× tolerance as shader-transition.
  const frameAspect = W / H
  const fit =
    p.framing === 'Fit' ||
    (p.framing === 'Auto' &&
      ctx.media.some((m) => Math.abs(Math.log(m.width / m.height / frameAspect)) > Math.log(1.4)))
  // Where slides are drawn: the whole canvas, or (Fit) a window sized in setup().
  const frame: Rect = { x: 0, y: 0, w: W, h: H }

  const dissolve = ctx.gsap.parseEase('sine.inOut')
  const roll = ctx.gsap.parseEase('power3.inOut')

  let g: OffscreenCanvasRenderingContext2D
  const slides: Slide[] = []

  // Type, laid out in setup().
  const titleText = ctx.text.title?.trim() ?? ''
  const captionText = ctx.text.caption?.trim() ?? ''
  const titleSize = p.titleSize * s
  const titleTracking = STORY_TYPE.tracking * titleSize
  const smallSize = SMALL.size * s
  let title: TextLayout | null = null
  let caption: TextLayout | null = null
  let titleTop = 0
  let footerTop = 0 // top of the caption / counter row
  let counterTop = 0
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
    scrimTop: H, // gradient starts (clear) here…
    scrimFull: H, // …and is at full strength from here down
  }

  const place = (index: number, t: number, alpha: number): Placement => {
    const sl = slides[index]!
    const u = clamp01((t - sl.start) / (sl.end - sl.start))
    const z = sl.zoom[0] + (sl.zoom[1] - sl.zoom[0]) * u
    const px = sl.pan[0] + (sl.pan[2] - sl.pan[0]) * u
    const py = sl.pan[1] + (sl.pan[3] - sl.pan[1]) * u
    const w = sl.coverW * z
    const h = sl.coverH * z
    const cx = frame.x + frame.w * (0.5 + px)
    const cy = frame.y + frame.h * (0.5 + py)
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

  const drawLine = (line: TextLine, x: number, y: number, b: Band, offset: number) =>
    masked(b, y + line.y, offset, (dy) => {
      for (const word of line.words) g.fillText(word.text, x + line.x + word.x, y + line.y + dy)
    })

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'

      // ── Type ─────────────────────────────────────────────────────────────────────────
      await ctx.font(FAMILY)
      const counter = p.counter && n > 1
      g.font = `400 ${smallSize}px "${FAMILY}"`
      g.letterSpacing = '0px'
      suffix = `/${pad(n)}`
      suffixW = g.measureText(suffix).width
      counterBand = band('0123456789/', smallSize)
      for (let d = 0; d <= 9; d++) digitW[d] = g.measureText(String(d)).width
      cell = Math.max(...digitW)
      const counterW = counter ? suffixW + cell * 2 : 0

      if (captionText) {
        caption = ctx.layoutText(captionText, {
          family: FAMILY,
          size: smallSize,
          lineHeight: SMALL.lineHeight,
          maxWidth: W - side * 2 - (counter ? counterW + 64 * s : 0),
        })
        captionBand = band(`H${captionText.replace(/\s+/g, '')}`, smallSize)
      }
      const footer = caption || counter
      const footerH = caption ? caption.height : smallSize * SMALL.lineHeight
      footerTop = H - bottom - footerH
      counterTop = footerTop + footerH - smallSize * SMALL.lineHeight // on the caption's last line

      if (titleText) {
        title = ctx.layoutText(titleText, {
          family: FAMILY,
          weight: p.weight === 'Medium' ? '500' : '400',
          size: titleSize,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: W - side * 2,
          letterSpacing: titleTracking,
        })
        titleTop = (footer ? footerTop - 40 * s : H - bottom) - title.height
        g.font = title.font
        g.letterSpacing = `${titleTracking}px`
        titleBand = band(`H${titleText.replace(/\s+/g, '')}`, titleSize)
      }

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
        const textTop = title ? titleTop : caption || counter ? footerTop : H
        const top = ctx.aspect === '9:16' ? STORY_TYPE.bottom * s : bottom
        const floor = Math.min(textTop - 56 * s, H - bottom)
        // A very tall title could leave no room: keep a usable window (the type then overlaps it).
        const w = Math.min(W - side * 2, Math.max(floor - top, H * 0.3) * aspect)
        const h = w / aspect
        frame.w = w
        frame.h = h
        frame.x = (W - w) / 2
        // Optically centred on the canvas, kept clear of the type.
        frame.y = Math.max(top, Math.min((H - h) / 2, floor - h))
      }

      // ── Slides: timing, cover size, Ken Burns path ───────────────────────────────────
      for (let k = 0; k < n; k++) {
        const start = k === 0 ? 0 : k * slot - fade / 2
        const end = k === n - 1 ? D : (k + 1) * slot + fade / 2

        // Same drift speed whatever the slot length (within limits), alternating direction.
        const delta = p.motion * Math.min(1.6, Math.max(0.35, (end - start) / 3.2))
        const pan = 0.3 * delta // half-range in frame fractions
        const zLow = 1 + 2.1 * pan // always enough overscan for the pan
        const zHigh = zLow + delta
        const dir = k % 2 === 0 ? 1 : -1
        const lift = ctx.random() - 0.5

        let { bitmap } = sources[k]!
        const { layer, aspect } = sources[k]!
        const wide = aspect > frame.w / frame.h
        const coverW = wide ? frame.h * aspect : frame.w
        const coverH = wide ? frame.h : frame.w / aspect

        // Downscale big images once (high-quality filter), to the smallest size they are drawn
        // at: every frame then magnifies by at most zHigh/zLow (~8%). Minifying fine detail at a
        // slowly changing scale each frame makes it shimmer (and balloons the bitrate).
        let resized = false
        const targetW = Math.ceil(coverW * zLow)
        if (bitmap && bitmap.width > targetW * 1.02) {
          bitmap = await createImageBitmap(bitmap, {
            resizeWidth: targetW,
            resizeHeight: Math.ceil(coverH * zLow),
            resizeQuality: 'high',
          })
          resized = true
        }

        slides.push({
          bitmap,
          layer,
          resized,
          coverW,
          coverH,
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
      if (title || caption || counterIn.y < 2) {
        const gone = view.title.length
          ? view.title.reduce((sum, y) => sum + Math.max(0, -y), 0) / view.title.length
          : 1
        const textTop = title ? titleTop + (footerTop - titleTop) * gone : footerTop
        view.scrimTop = Math.max(0, textTop - 400 * s)
        view.scrimFull = textTop + 24 * s
      } else {
        view.scrimTop = H
        view.scrimFull = H
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

      g.save()
      if (fit) {
        g.beginPath()
        g.rect(frame.x, frame.y, frame.w, frame.h)
        g.clip()
      }
      for (const l of view.layers) {
        const sl = slides[l.slide]!
        const source = sl.bitmap ?? sl.layer?.frame
        if (!source || l.alpha <= 0) continue
        g.globalAlpha = l.alpha
        g.drawImage(source, l.x, l.y, l.w, l.h)
      }
      g.restore()
      g.globalAlpha = 1

      // Soft darkening under the type (smoothstep ramp, no visible edge). Fit sets type on the
      // ground, so it needs none.
      if (!fit && p.dim > 0 && view.scrimTop < H) {
        const grad = g.createLinearGradient(0, view.scrimTop, 0, view.scrimFull)
        for (let i = 0; i <= 10; i++) {
          const u = i / 10
          grad.addColorStop(u, `rgba(0,0,0,${(p.dim * u * u * (3 - 2 * u)).toFixed(4)})`)
        }
        g.fillStyle = grad
        g.fillRect(0, view.scrimTop, W, H - view.scrimTop)
      }

      g.fillStyle = p.color
      g.textBaseline = 'top'

      if (title) {
        g.font = title.font
        g.letterSpacing = `${titleTracking}px`
        title.lines.forEach((line, i) =>
          drawLine(line, side, titleTop, titleBand, view.title[i] ?? 1)
        )
      }

      g.font = `400 ${smallSize}px "${FAMILY}"`
      g.letterSpacing = '0px'
      if (caption) {
        caption.lines.forEach((line, i) =>
          drawLine(line, side, footerTop, captionBand, view.caption[i] ?? 1)
        )
      }

      const c = view.counter
      if (c.y > -1 && c.y < 1) {
        const right = W - side
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
