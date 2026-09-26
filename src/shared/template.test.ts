import { describe, expect, it } from 'vitest'
import {
  ASPECTS,
  ASPECT_SIZE,
  designScale,
  metaData,
  paramVisible,
  renderKindOf,
  resolveOutputKind,
  type TemplateMeta,
} from './template.ts'
import {
  TEXT_FIELDS,
  TEXT_PARAMS,
  balancedLines,
  baseOutputKind,
} from '../../templates/_lib/base.ts'

const meta = (over: Partial<TemplateMeta> = {}): TemplateMeta => ({
  id: 't',
  name: 'T',
  description: '',
  version: 1,
  kind: 'auto',
  outputKind: baseOutputKind,
  aspects: [...ASPECTS],
  duration: { default: 5, min: 3, max: 30 },
  media: { min: 0, max: 1, kinds: ['image', 'video'] },
  text: TEXT_FIELDS,
  params: TEXT_PARAMS,
  ...over,
})

describe('output kind', () => {
  it('is fixed for still and video templates', () => {
    expect(resolveOutputKind(meta({ kind: 'still' }))).toBe('still')
    expect(resolveOutputKind(meta({ kind: 'video' }))).toBe('video')
    expect(renderKindOf('still')).toBe('image')
    expect(renderKindOf('video')).toBe('video')
  })

  it('auto: a still when nothing moves, else a video (defaults filled in)', () => {
    const m = meta()
    expect(resolveOutputKind(m)).toBe('still')
    expect(resolveOutputKind(m, { params: { animation: 'Reveal' } })).toBe('video')
    expect(resolveOutputKind(m, { params: { exit: 'Fade' } })).toBe('video')
    expect(resolveOutputKind(m, { media: [{ kind: 'image' }] })).toBe('still')
    expect(resolveOutputKind(m, { media: [{ kind: 'video' }] })).toBe('video')
    expect(resolveOutputKind(m, { background: { kind: 'video' } })).toBe('video')
    // No type at all: nothing to animate.
    expect(resolveOutputKind(m, { text: { caption: '' }, params: { animation: 'Fade' } })).toBe(
      'still'
    )
    expect(
      resolveOutputKind(m, {
        text: { caption: '', labelTopLeft: 'Studio' },
        params: { animation: 'Fade' },
      })
    ).toBe('video')
  })

  it('auto without outputKind (or one that throws) renders a video', () => {
    expect(resolveOutputKind(meta({ outputKind: undefined }))).toBe('video')
    const broken = meta({
      outputKind: () => {
        throw new Error('nope')
      },
    })
    expect(resolveOutputKind(broken)).toBe('video')
  })

  it('strips functions before a meta is posted to a worker', () => {
    const data = metaData(meta())
    expect('outputKind' in data).toBe(false)
    expect(() => structuredClone(data)).not.toThrow()
  })
})

describe('formats', () => {
  it('scales design px by the short side', () => {
    for (const aspect of ASPECTS) {
      const { width, height } = ASPECT_SIZE[aspect]
      expect(designScale(width, height)).toBe(1)
    }
    expect(designScale(540, 960)).toBe(0.5)
    expect(designScale(960, 540)).toBe(0.5)
  })
})

describe('param visibility', () => {
  it('follows another param and the media count', () => {
    const reveal = TEXT_PARAMS.revealBy
    expect(paramVisible(reveal, { params: { animation: 'Reveal' }, media: 0 })).toBe(true)
    expect(paramVisible(reveal, { params: { animation: 'Fade' }, media: 0 })).toBe(false)
    const withMedia = { type: 'boolean' as const, label: 'x', default: true, when: { media: true } }
    expect(paramVisible(withMedia, { params: {}, media: 1 })).toBe(true)
    expect(paramVisible(withMedia, { params: {}, media: 0 })).toBe(false)
    expect(paramVisible(TEXT_PARAMS.accent, { params: {}, media: 0 })).toBe(true)
  })
})

describe('16:9 caption balance', () => {
  // Lines of `words` words each, `widths` px wide.
  const layout = (lines: [number, number][]) => ({
    lines: lines.map(([words, width], i) => ({
      text: '',
      x: 0,
      y: i,
      width,
      words: Array.from({ length: words }, () => ({ text: 'w', x: 0, width: 1 })),
    })),
  })

  it('wants the last line of a wrapped paragraph at least 45% of its longest', () => {
    const text = 'one two three four five six seven'
    expect(
      balancedLines(
        text,
        layout([
          [6, 1200],
          [1, 300],
        ])
      )
    ).toBe(false)
    expect(
      balancedLines(
        text,
        layout([
          [4, 1000],
          [3, 600],
        ])
      )
    ).toBe(true)
    expect(balancedLines('one line', layout([[2, 400]]))).toBe(true)
  })

  it('judges each paragraph on its own lines (a short line after a hard break is fine)', () => {
    const text = 'Selected work,\n2024 — 2026'
    expect(
      balancedLines(
        text,
        layout([
          [2, 900],
          [3, 200],
        ])
      )
    ).toBe(true)
    const wrapped = 'one two three four\nfive'
    expect(
      balancedLines(
        wrapped,
        layout([
          [3, 1000],
          [1, 200],
          [1, 150],
        ])
      )
    ).toBe(false)
    expect(
      balancedLines(
        'a\n\nb',
        layout([
          [1, 100],
          [0, 0],
          [1, 100],
        ])
      )
    ).toBe(true)
  })
})
