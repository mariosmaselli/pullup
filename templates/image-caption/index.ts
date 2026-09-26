import type { TemplateFactory } from '@shared/template.ts'
import { CAPTION_FAMILY, captionCard } from '../_lib/caption.ts'

// A still: one image (Fill = cover, Fit = whole image on the ground colour, see
// _lib/layout.ts), a large caption in Mario's story type (top / middle / bottom, left or centred),
// a small label top-left and a date/index top-right. The card itself lives in _lib/caption.ts,
// shared with video-caption.

const imageCaption: TemplateFactory = (ctx) => {
  const card = captionCard(ctx)
  let g: OffscreenCanvasRenderingContext2D
  let bitmap: ImageBitmap

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      bitmap = await ctx.image(0)
      await ctx.font(CAPTION_FAMILY)
      card.setup(bitmap.width, bitmap.height)
    },

    update() {},

    render() {
      card.draw(g, bitmap)
    },

    dispose() {},
  }
}

export default imageCaption
