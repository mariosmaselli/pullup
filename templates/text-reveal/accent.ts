// *Asterisk* accents → plain text for ctx.layoutText() plus, for every word in layout order, its
// coloured segments. "*real-time* worlds" accents one word; "*real-time worlds*" spans words;
// "*Nonlinear*'s" accents only part of a word. Asterisks standing alone ("5 * 3") and an unmatched
// final asterisk stay literal.

export interface Segment {
  text: string
  accent: boolean
}

export interface MarkedWord {
  text: string
  segments: Segment[]
}

const LITERAL = '\u0000'

export function parseAccents(source: string): { text: string; words: MarkedWord[] } {
  let src = source
    .replace(/\r\n?/g, '\n')
    .replace(
      /(^|\s)(\*+)(?=\s|$)/g,
      (_, pre: string, run: string) => pre + LITERAL.repeat(run.length)
    )
  const stars = src.split('*').length - 1
  if (stars % 2) {
    const at = src.lastIndexOf('*')
    src = src.slice(0, at) + LITERAL + src.slice(at + 1)
  }

  let accent = false
  const words: MarkedWord[] = []
  const paragraphs: string[] = []
  // Split exactly like layoutText (paragraphs on \n, words on whitespace) so indices line up.
  for (const paragraph of src.split('\n')) {
    const kept: string[] = []
    for (const token of paragraph.split(/\s+/).filter(Boolean)) {
      const segments: Segment[] = []
      let current = ''
      const push = () => {
        if (!current) return
        const last = segments.at(-1)
        if (last && last.accent === accent) last.text += current
        else segments.push({ text: current, accent })
        current = ''
      }
      for (const ch of token) {
        if (ch === '*') {
          push()
          accent = !accent
        } else {
          current += ch === LITERAL ? '*' : ch
        }
      }
      push()
      const text = segments.map((s) => s.text).join('')
      if (!text) continue
      kept.push(text)
      words.push({ text, segments })
    }
    paragraphs.push(kept.join(' '))
  }
  return { text: paragraphs.join('\n'), words }
}
