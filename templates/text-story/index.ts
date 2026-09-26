import type { TemplateFactory, TextLayout } from '@shared/template.ts'
import { textBlockY, textLineX, textPlacement } from '../_lib/layout.ts'
import { drawLayout, STORY_TYPE } from '../_lib/text.ts'

// A still: one frame, drawn with canvas 2D. The body is placed by TEXT_POSITION_PARAMS — by
// default bottom-left on Mario's story margins.

// Design px. The top margin mirrors the bottom one (clear of Instagram's header on stories).
const MARGIN = { top: STORY_TYPE.bottom, bottom: STORY_TYPE.bottom }
// A long text at a large size shrinks until it fits between the margins, down to this size.
const MIN_SIZE = 32

const textStory: TemplateFactory = (ctx) => {
  let g: OffscreenCanvasRenderingContext2D
  let layout: TextLayout
  let size = 0
  let top = 0 // top of the first line box
  let shift: number[] = [] // per line: x offset from the side margin (0 when left-aligned)
  const p = ctx.params as {
    background: string
    color: string
    size: number
    weight: 'Regular' | 'Medium'
  }
  const { position, align } = textPlacement(ctx.params)
  const s = ctx.scale
  const side = STORY_TYPE.side * s
  const margins = { top: MARGIN.top * s, bottom: MARGIN.bottom * s }

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      await ctx.font('PP Neue Montreal')
      const room = ctx.height - margins.top - margins.bottom
      size = (Number(p.size) || STORY_TYPE.size) * s
      for (;;) {
        layout = ctx.layoutText(ctx.text.body ?? '', {
          family: 'PP Neue Montreal',
          weight: p.weight === 'Medium' ? '500' : '400',
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: ctx.width - side * 2,
          letterSpacing: STORY_TYPE.tracking * size,
        })
        if (layout.height <= room || size <= MIN_SIZE * s) break
        size *= 0.95
      }
      // Bottom keeps the last line box on the bottom margin, Top the first on the top margin.
      top = textBlockY(ctx.height, layout.height, position, margins)
      shift = layout.lines.map((line) => textLineX(ctx.width, line.width, align, side) - side)
    },

    update() {},

    render() {
      g.fillStyle = p.background
      g.fillRect(0, 0, ctx.width, ctx.height)
      drawLayout(g, layout, side, top, {
        color: p.color,
        letterSpacing: STORY_TYPE.tracking * size,
        word: (line) => ({ dx: shift[line] }),
      })
    },

    dispose() {},
  }
}

export default textStory
