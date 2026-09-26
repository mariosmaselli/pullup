import type { TemplateFactory, TextLayout } from '@shared/template.ts'
import { createBackground2D, type Background2D } from '../_lib/background.ts'
import { textBlockY, textLineX, textPlacement } from '../_lib/layout.ts'
import { STORY_TYPE } from '../_lib/text.ts'
import { parseAccents, type MarkedWord, type Segment } from './accent.ts'

// Kinetic type, canvas 2D. The text is laid out once in setup(); every line gets a clip box
// (its glyph bounds) and each word — or each whole line — rises out of it with expo.out. The
// ground is a colour or an image / video from the library (_lib/background.ts).
//
// Placement (TEXT_POSITION_PARAMS): at Bottom — the default — the label is a masthead in the top
// corner and balances the empty top of the frame. At Top and Middle it sits right above the body
// as one lockup (at Top the two coincide; at Middle a corner label would float alone far from
// the block). Both follow the text alignment.

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
  color: string
  accent: string
}

const piece = (): Piece => ({ in: 0, out: 0 })

const textReveal: TemplateFactory = (ctx) => {
  const p = ctx.params as Params
  const s = ctx.scale
  const margin = ctx.aspect === '9:16' ? MARGIN.story : MARGIN.feed
  const side = STORY_TYPE.side * s
  const { position, align } = textPlacement(ctx.params)
  const byWords = p.reveal !== 'Lines'
  const fade = { alpha: 1 }
  let g: OffscreenCanvasRenderingContext2D
  let background: Background2D
  let body: Block = { font: '', tracking: 0, byWords, lines: [] }
  let label: Block | null = null

  // Turns a layout into lines with clip boxes and per-word coloured segments; lines sit on the
  // side margin or centred (textAlign), the first line box's top at y0.
  function block(
    layout: TextLayout,
    tracking: number,
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
      const x = textLineX(ctx.width, line.width, align, side)
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
          return { x: x + line.x + word.x, segments, piece: piece(), dy: 0 }
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
      background = createBackground2D(ctx)
      await ctx.font(FAMILY)
      const weight = p.weight === 'Medium' ? '500' : '400'
      const maxWidth = ctx.width - side * 2
      const margins = { top: margin.top * s, bottom: margin.bottom * s }

      const labelText = (ctx.text.label ?? '').replace(/\s+/g, ' ').trim()
      const labelLayout = labelText
        ? ctx.layoutText(labelText, {
            family: FAMILY,
            size: LABEL.size * s,
            lineHeight: 1.1,
            maxWidth: Number.MAX_SAFE_INTEGER,
          })
        : null
      // The label and the gap under it: the body always leaves this much room above it.
      const labelSpace = labelLayout ? labelLayout.height + LABEL.gap * s : 0

      // Body; shrinks to fit when a long text at a large size would overflow.
      const { text, words } = parseAccents(ctx.text.body ?? '')
      let bodyLayout: TextLayout | null = null
      let bodySize = 0
      if (text.trim()) {
        const room = ctx.height - margins.bottom - margins.top - labelSpace
        bodySize = (Number(p.size) || STORY_TYPE.size) * s
        for (let i = 0; i < 30; i++) {
          bodyLayout = ctx.layoutText(text, {
            family: FAMILY,
            weight,
            size: bodySize,
            lineHeight: STORY_TYPE.lineHeight,
            maxWidth,
            letterSpacing: STORY_TYPE.tracking * bodySize,
          })
          if (bodyLayout.height <= room) break
          bodySize *= 0.95
        }
      }

      // Bottom: the body's last line box on the bottom margin, the label in the top corner.
      // Top / Middle: label + gap + body placed as one block.
      let labelTop = margins.top
      let bodyTop = 0
      if (position === 'Bottom') {
        bodyTop = textBlockY(ctx.height, bodyLayout?.height ?? 0, position, margins)
      } else {
        const blockH = bodyLayout ? labelSpace + bodyLayout.height : (labelLayout?.height ?? 0)
        labelTop = textBlockY(ctx.height, blockH, position, margins)
        bodyTop = labelTop + labelSpace
      }
      if (labelLayout) label = block(labelLayout, 0, labelTop, false)
      if (bodyLayout) {
        body = block(bodyLayout, STORY_TYPE.tracking * bodySize, bodyTop, byWords, words)
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

    update(t) {
      background.update(t)
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
      background.draw(g)
      if (fade.alpha <= 0) return
      if (label) drawBlock(label, fade.alpha * LABEL.alpha)
      drawBlock(body, fade.alpha)
    },

    dispose() {
      background?.dispose()
    },
  }
}

export default textReveal
