import type { LayoutTextOptions, TextLayout, TextLine } from '@shared/template.ts'

let measurer: OffscreenCanvasRenderingContext2D | null = null

export const fontString = (o: { family: string; weight?: string; size: number }) =>
  `${o.weight ?? '400'} ${o.size}px "${o.family}"`

// Greedy word wrap using the canvas's own metrics (so emoji and kerning measure as drawn).
// Lines are positioned top-down from y = 0; `y` is each line's top in canvas pixels.
export function layoutText(text: string, o: LayoutTextOptions): TextLayout {
  measurer ??= new OffscreenCanvas(8, 8).getContext('2d')!
  const font = fontString(o)
  measurer.font = font
  measurer.letterSpacing = `${o.letterSpacing ?? 0}px`
  const lineHeight = o.size * (o.lineHeight ?? 1.1)
  const space = measurer.measureText(' ').width
  const lines: TextLine[] = []

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current: { text: string; x: number; width: number }[] = []
    let x = 0
    const flush = () => {
      const width = current.length ? current.at(-1)!.x + current.at(-1)!.width : 0
      lines.push({
        text: current.map((w) => w.text).join(' '),
        x: 0,
        y: lines.length * lineHeight,
        width,
        words: current,
      })
      current = []
      x = 0
    }
    for (const word of words) {
      const width = measurer.measureText(word).width
      if (current.length && x + width > o.maxWidth) flush()
      current.push({ text: word, x, width })
      x += width + space
    }
    flush() // also keeps empty paragraphs as blank lines
  }

  return {
    font,
    size: o.size,
    lineHeight,
    lines,
    width: Math.max(0, ...lines.map((l) => l.width)),
    height: lines.length * lineHeight,
  }
}
