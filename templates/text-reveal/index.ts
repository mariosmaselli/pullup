import type { TemplateFactory, TextLayout } from '@shared/template.ts'
import { STORY_TYPE } from '../_lib/text.ts'
import { parseAccents, type MarkedWord, type Segment } from './accent.ts'

// Kinetic type, canvas 2D. The text is laid out once in setup(); every line gets a clip box
// (its glyph bounds) and each word — or each whole line — rises out of it with expo.out.

const FAMILY = 'PP Neue Montreal'
// Design px (1080 wide).
const LABEL = { size: 32, gap: 56, alpha: 0.6 }
// Story frames keep Mario's text-story margins (clear of Instagram's header and reply bar);
// feed/square frames sit on a tighter editorial margin.
const MARGIN = { story: { top: 160, bottom: STORY_TYPE.bottom }, feed: { top: 40, bottom: 48 } }

// Tweened by the timeline.
interface Piece {
  in: number // 0 → 1: rises out of the mask
  out: number // 0 → 1: leaves through the top of the mask
}

interface Word {
  x: number
  segments: (Segment & { dx: number })[]
  piece: Piece
  dy: number // offset from rest, derived in update()
}

interface Line {
  y: number
  clipTop: number
  clipHeight: number
  words: Word[]
  piece: Piece
}

interface Block {
  font: string
  tracking: number
  // Words rise one by one (else each line rises as a unit). Lines always leave as units.
  byWords: boolean
  lines: Line[]
}

type Params = {
  reveal: 'Words' | 'Lines'
  exit: 'Rise' | 'Fade' | 'None'
  size: number
  weight: 'Regular' | 'Medium'
  background: string
  color: string
  accent: string
}

const piece = (): Piece => ({ in: 0, out: 0 })

const textReveal: TemplateFactory = (ctx) => {
  const p = ctx.params as Params
  const s = ctx.scale
  const margin = ctx.aspect === '9:16' ? MARGIN.story : MARGIN.feed
  const side = STORY_TYPE.side * s
  const byWords = p.reveal !== 'Lines'
  const fade = { alpha: 1 }
  let g: OffscreenCanvasRenderingContext2D
  let body: Block = { font: '', tracking: 0, byWords, lines: [] }
  let label: Block | null = null

  // Turns a layout into lines with clip boxes and per-word coloured segments.
  function block(
    layout: TextLayout,
    tracking: number,
    x0: number,
    y0: number,
    words: boolean,
    marked?: MarkedWord[]
  ): Block {
    g.font = layout.font
    g.letterSpacing = `${tracking}px`
    g.textBaseline = 'top'
    // Glyph bounds relative to the 'top' baseline, wide enough for accents and descenders.
    const ref = g.measureText('ÅÉÎÇgjpqy|')
    const pad = layout.size * 0.06
    let k = 0
    const lines = layout.lines.map((line): Line => {
      const m = line.text ? g.measureText(line.text) : ref
      const top = Math.min(-ref.actualBoundingBoxAscent, -m.actualBoundingBoxAscent) - pad
      const bottom = Math.max(ref.actualBoundingBoxDescent, m.actualBoundingBoxDescent) + pad
      const y = y0 + line.y
      return {
        y,
        clipTop: y + top,
        clipHeight: bottom - top,
        piece: piece(),
        words: line.words.map((word): Word => {
          const mark = marked?.[k++]
          const segs =
            mark && mark.text === word.text ? mark.segments : [{ text: word.text, accent: false }]
          let dx = 0
          const segments = segs.map((seg) => {
            const placed = { ...seg, dx }
            dx += g.measureText(seg.text).width
            return placed
          })
          return { x: x0 + line.x + word.x, segments, piece: piece(), dy: 0 }
        }),
      }
    })
    return { font: layout.font, tracking, byWords: words, lines }
  }

  function drawBlock(b: Block, alpha: number) {
    g.save()
    g.font = b.font
    g.letterSpacing = `${b.tracking}px`
    g.textBaseline = 'top'
    g.globalAlpha = alpha
    for (const line of b.lines) {
      if (!line.words.length) continue
      g.save()
      g.beginPath()
      g.rect(0, line.clipTop, ctx.width, line.clipHeight)
      g.clip()
      for (const word of line.words) {
        if (Math.abs(word.dy) >= line.clipHeight) continue
        for (const seg of word.segments) {
          g.fillStyle = seg.accent ? p.accent : p.color
          g.fillText(seg.text, word.x + seg.dx, line.y + word.dy)
        }
      }
      g.restore()
    }
    g.restore()
  }

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      await ctx.font(FAMILY)
      const weight = p.weight === 'Medium' ? '500' : '400'
      const maxWidth = ctx.width - side * 2

      // Label, top-left.
      const labelText = (ctx.text.label ?? '').replace(/\s+/g, ' ').trim()
      let labelBottom = margin.top * s
      if (labelText) {
        const size = LABEL.size * s
        const layout = ctx.layoutText(labelText, {
          family: FAMILY,
          size,
          lineHeight: 1.1,
          maxWidth: Number.MAX_SAFE_INTEGER,
        })
        label = block(layout, 0, side, margin.top * s, false)
        labelBottom = margin.top * s + layout.height + LABEL.gap * s
      }

      // Body, bottom-left; shrinks to fit when a long text at a large size would overflow.
      const { text, words } = parseAccents(ctx.text.body ?? '')
      if (text.trim()) {
        const room = ctx.height - margin.bottom * s - labelBottom
        let size = (Number(p.size) || STORY_TYPE.size) * s
        let layout!: TextLayout
        for (let i = 0; i < 30; i++) {
          layout = ctx.layoutText(text, {
            family: FAMILY,
            weight,
            size,
            lineHeight: STORY_TYPE.lineHeight,
            maxWidth,
            letterSpacing: STORY_TYPE.tracking * size,
          })
          if (layout.height <= room) break
          size *= 0.95
        }
        const top = ctx.height - margin.bottom * s - layout.height
        body = block(layout, STORY_TYPE.tracking * size, side, top, byWords, words)
      }

      // ── Timeline ─────────────────────────────────────────────────────────────────────────
      const T = ctx.duration
      const lines = body.lines.filter((l) => l.words.length)
      const pieces = byWords
        ? lines.flatMap((l) => l.words.map((w) => w.piece))
        : lines.map((l) => l.piece)
      const n = pieces.length
      const start = 0.2
      const inDur = byWords ? 1.1 : 1.3
      // Stagger shrinks for long texts so the reveal never takes more than ~a fifth of the clip.
      const stagger = n > 1 ? Math.min(byWords ? 0.055 : 0.12, (0.2 * T) / (n - 1)) : 0
      const tl = ctx.timeline()

      const labelPiece = label?.lines[0]?.piece
      if (labelPiece)
        tl.fromTo(labelPiece, { in: 0 }, { in: 1, duration: 1.1, ease: 'expo.out' }, 0.1)
      pieces.forEach((pc, i) =>
        tl.fromTo(pc, { in: 0 }, { in: 1, duration: inDur, ease: 'expo.out' }, start + i * stagger)
      )

      // Exit ends a beat before the last frame, so a looping reel starts and ends on the ground.
      const settled = start + Math.max(0, n - 1) * stagger + inDur * 0.6
      const end = T - 0.25
      if (p.exit === 'Rise') {
        // Whole lines leave through the top of their masks, top line first (word-by-word exits
        // read as a broken baseline while the ease-in is still slow).
        const outDur = 0.6
        const outStagger = lines.length > 1 ? Math.min(0.07, 0.5 / (lines.length - 1)) : 0
        const outStart = Math.max(settled, end - outDur - (lines.length - 1) * outStagger)
        const leaving = labelPiece
          ? [labelPiece, ...lines.map((l) => l.piece)]
          : lines.map((l) => l.piece)
        leaving.forEach((pc, i) =>
          tl.fromTo(
            pc,
            { out: 0 },
            { out: 1, duration: outDur, ease: 'power3.in' },
            outStart + Math.max(0, i - (labelPiece ? 1 : 0)) * outStagger
          )
        )
      } else if (p.exit === 'Fade') {
        const outDur = 0.7
        tl.fromTo(
          fade,
          { alpha: 1 },
          { alpha: 0, duration: outDur, ease: 'power2.inOut' },
          Math.max(settled, end - outDur)
        )
      }
    },

    update() {
      // Tweened progress → offsets in canvas px: from below the mask (in = 0) up to rest, then
      // out through its top (out = 1).
      for (const b of [label, body]) {
        if (!b) continue
        for (const line of b.lines) {
          const h = line.clipHeight
          for (const word of line.words) {
            const rise = b.byWords ? word.piece.in : line.piece.in
            word.dy = h * (1 - rise) - h * line.piece.out
          }
        }
      }
    },

    render() {
      g.globalAlpha = 1
      g.fillStyle = p.background
      g.fillRect(0, 0, ctx.width, ctx.height)
      if (fade.alpha <= 0) return
      if (label) drawBlock(label, fade.alpha * LABEL.alpha)
      drawBlock(body, fade.alpha)
    },

    dispose() {},
  }
}

export default textReveal
