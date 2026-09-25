import type { TemplateFactory, TextLayout } from '@shared/template.ts'
import { drawLayout, STORY_TYPE } from '../_lib/text.ts'

// A still: one frame, drawn with canvas 2D.
const textStory: TemplateFactory = (ctx) => {
  let g: OffscreenCanvasRenderingContext2D
  let layout: TextLayout
  const p = ctx.params as {
    background: string
    color: string
    size: number
    weight: 'Regular' | 'Medium'
    position: 'Bottom' | 'Middle' | 'Top'
  }
  const s = ctx.scale
  const size = p.size * s
  const side = STORY_TYPE.side * s

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      await ctx.font('PP Neue Montreal')
      layout = ctx.layoutText(ctx.text.body ?? '', {
        family: 'PP Neue Montreal',
        weight: p.weight === 'Medium' ? '500' : '400',
        size,
        lineHeight: STORY_TYPE.lineHeight,
        maxWidth: ctx.width - side * 2,
        letterSpacing: STORY_TYPE.tracking * size,
      })
    },

    update() {},

    render() {
      g.fillStyle = p.background
      g.fillRect(0, 0, ctx.width, ctx.height)
      const top =
        p.position === 'Top'
          ? STORY_TYPE.bottom * s
          : p.position === 'Middle'
            ? (ctx.height - layout.height) / 2
            : ctx.height - STORY_TYPE.bottom * s - layout.height
      drawLayout(g, layout, side, top, {
        color: p.color,
        letterSpacing: STORY_TYPE.tracking * size,
      })
    },

    dispose() {},
  }
}

export default textStory
