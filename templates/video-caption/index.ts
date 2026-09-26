import type { TemplateFactory, VideoLayer } from '@shared/template.ts'
import { CAPTION_FAMILY, captionCard, type CaptionFrame } from '../_lib/caption.ts'

// One clip under the "media + caption" card (_lib/caption.ts, shared with image-caption): the
// video is drawn with canvas 2D each frame (Fill / Fit / scale / position from _lib/layout.ts)
// over the ground (a colour or a background image / video, _lib/background.ts) and holds its last
// frame past the clip's end. The caption can fade or rise in, line by line.

// When the type comes in (s), and the stagger between caption lines.
const START = 0.3
const STAGGER = 0.08

const videoCaption: TemplateFactory = (ctx) => {
  const card = captionCard(ctx)
  const animation =
    ctx.params.animation === 'None' || ctx.params.animation === 'Rise'
      ? ctx.params.animation
      : 'Fade'
  let g: OffscreenCanvasRenderingContext2D
  let layer: VideoLayer

  // Tweened by the timeline (seeked by Pullup to t before update()).
  const lines: { alpha: number; rise: number }[] = []
  const corners = { alpha: 1 }
  // Frame state, written by update() and drawn by render().
  const view: Required<CaptionFrame> = { lines: [], corners: 1 }

  return {
    async setup() {
      g = ctx.canvas.getContext('2d', { alpha: false })!
      layer = ctx.video(0)
      await ctx.font(CAPTION_FAMILY)
      // A clip is opaque: when it covers the frame the background isn't drawn (nor decoded).
      card.setup(layer.width, layer.height, { opaque: true })

      for (let i = 0; i < card.lines; i++) lines.push({ alpha: 1, rise: 0 })
      if (animation === 'None') return

      const tl = ctx.timeline()
      const at = { immediateRender: false }
      // The corner type fades in with the first line.
      corners.alpha = 0
      tl.fromTo(
        corners,
        { alpha: 0 },
        { alpha: 1, duration: 0.8, ease: 'power2.out', ...at },
        START
      )
      lines.forEach((line, i) => {
        const time = START + i * STAGGER
        if (animation === 'Fade') {
          line.alpha = 0
          tl.fromTo(
            line,
            { alpha: 0 },
            { alpha: 1, duration: 0.9, ease: 'power2.out', ...at },
            time
          )
        } else {
          // Rises out of a mask that hugs the line (house style, see crossfade-slideshow).
          line.rise = 1
          tl.fromTo(line, { rise: 1 }, { rise: 0, duration: 1.1, ease: 'expo.out', ...at }, time)
        }
      })
    },

    update(t) {
      layer.seek(Math.min(t, layer.duration))
      card.update(t)
      view.lines = lines.map((l) => ({ alpha: l.alpha, rise: l.rise }))
      view.corners = corners.alpha
    },

    render() {
      card.draw(g, layer.frame, view)
    },

    dispose() {
      card.dispose()
    },
  }
}

export default videoCaption
