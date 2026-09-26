import type { TemplateFactory } from '@shared/template.ts'
import { createBackground2D, type Background2D } from '../_lib/background.ts'
import { createBase, createMedia2D, type BaseLayer, type Media2D } from '../_lib/base.ts'

// Canvas 2D, three layers: the ground (a colour, or an image / video from the library, darkened
// and blurred — _lib/background.ts), the optional image or clip sized by Media size / Scale /
// Position, and the base layer on top — caption, corner labels, and the legibility gradient only
// where that type sits over the media (_lib/base.ts). Everything is laid out in setup(); update()
// only seeks clips and reads the type's timeline.

const defaultTemplate: TemplateFactory = (ctx) => {
  let g: OffscreenCanvasRenderingContext2D
  let background: Background2D | undefined
  let media: Media2D | undefined
  let base: BaseLayer | undefined

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      background = createBackground2D(ctx)
      media = await createMedia2D(ctx)
      base = await createBase(ctx)
    },

    update(t) {
      media!.update(t)
      // A clip covering the frame hides the ground: don't decode a background video under it.
      if (!media!.hidesGround) background!.update(t)
      base!.update(t)
    },

    render() {
      // Always painted: under a covering clip it is the ground colour until the clip's first
      // frame is decoded (the background video itself isn't seeked, so never decoded).
      background!.draw(g)
      media!.draw(g)
      base!.draw(g, media!.rect)
    },

    dispose() {
      background?.dispose()
      media?.dispose()
      base?.dispose()
    },
  }
}

export default defaultTemplate
