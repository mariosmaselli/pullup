import type { TextLayout } from '@shared/template.ts'

// Draws a layout from ctx.layoutText() with its top-left at (x, y). Per-word/line animation:
// pass `line` and `word` callbacks to offset/fade individual pieces (values from update()).
export function drawLayout(
  g: OffscreenCanvasRenderingContext2D,
  layout: TextLayout,
  x: number,
  y: number,
  options: {
    color: string
    letterSpacing?: number
    word?: (lineIndex: number, wordIndex: number) => { dx?: number; dy?: number; alpha?: number }
  }
) {
  g.save()
  g.font = layout.font
  g.letterSpacing = `${options.letterSpacing ?? 0}px`
  g.textBaseline = 'top'
  g.fillStyle = options.color
  layout.lines.forEach((line, li) => {
    line.words.forEach((word, wi) => {
      const o = options.word?.(li, wi) ?? {}
      if (o.alpha === 0) return
      g.globalAlpha = o.alpha ?? 1
      g.fillText(word.text, x + line.x + word.x + (o.dx ?? 0), y + line.y + (o.dy ?? 0))
    })
  })
  g.restore()
}

// Mario's text-story proportions (from his 1080x1920 reference), in design pixels.
// Measured against the reference render (line breaks and widths match at 84 px / -1%).
export const STORY_TYPE = {
  size: 84,
  lineHeight: 0.98,
  tracking: -0.01, // em
  side: 40,
  bottom: 160,
}
