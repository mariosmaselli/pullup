import { describe, expect, it } from 'vitest'
import type { Render } from './template.ts'
import {
  carryOverFrames,
  frameAssetIds,
  frameBackgroundId,
  frameMediaIds,
  renderForFrame,
  renderMatchesFrame,
} from './frames.ts'

const render = (
  over: Partial<Render> & { text?: string; media?: string[]; background?: string } = {}
): Render => ({
  id: over.id ?? 'r1',
  templateId: over.templateId ?? 'text-story',
  templateVersion: 1,
  kind: 'image',
  aspect: '9:16',
  width: 1080,
  height: 1920,
  fps: null,
  durationMs: null,
  inputs: {
    aspect: '9:16',
    duration: over.inputs?.duration ?? 0,
    media: (over.media ?? []).map((assetId) => ({
      assetId,
      kind: 'image',
      url: '',
      width: 1,
      height: 1,
    })),
    text: { body: over.text ?? 'Hello' },
    params: over.inputs?.params ?? { size: 84 },
    seed: 1,
    ...(over.background
      ? {
          background: {
            assetId: over.background,
            kind: 'image' as const,
            url: '',
            width: 1,
            height: 1,
          },
        }
      : {}),
  },
  status: over.status ?? 'ready',
  error: null,
  warnings: [],
  url: '/api/files/x.jpg',
  posterUrl: null,
  sizeBytes: 1,
  elapsedMs: 1,
  postId: 'p',
  segmentIndex: over.segmentIndex ?? 0,
  createdAt: over.createdAt ?? '2026-09-26T10:00:00.000Z',
})

describe('renderMatchesFrame', () => {
  it('matches on template, text, media and chosen settings', () => {
    const frame = {
      text: 'Hello',
      assetId: null,
      kind: 'text' as const,
      template: { id: 'text-story' },
    }
    expect(renderMatchesFrame(render(), frame)).toBe(true)
    expect(renderMatchesFrame(render({ text: 'Changed' }), frame)).toBe(false)
    expect(renderMatchesFrame(render({ templateId: 'text-reveal' }), frame)).toBe(false)
    expect(renderMatchesFrame(render({ media: ['a1'] }), frame)).toBe(false)
    expect(renderMatchesFrame(render({ status: 'failed' }), frame)).toBe(false)
    const withParams = { ...frame, template: { id: 'text-story', params: { size: 100 } } }
    expect(renderMatchesFrame(render(), withParams)).toBe(false)
  })

  it('accepts any template for frames using the default template', () => {
    const frame = { text: 'Hello', assetId: null, kind: 'text' as const }
    expect(renderMatchesFrame(render({ templateId: 'text-reveal' }), frame)).toBe(true)
  })

  it('prefers a matching render over a newer outdated one, and survives reordering', () => {
    const frame = {
      text: 'Hello',
      assetId: null,
      kind: 'text' as const,
      template: { id: 'text-story' },
    }
    const old = render({ id: 'old', segmentIndex: 2, createdAt: '2026-09-26T09:00:00.000Z' })
    const newer = render({ id: 'new', text: 'Other', segmentIndex: 0 })
    expect(renderForFrame([old, newer], frame, 0)).toEqual({ render: old, current: true })
    expect(renderForFrame([newer], frame, 0)).toEqual({ render: newer, current: false })
  })
})

describe('frame text fields', () => {
  // A render of a template with a caption and two labels (the caption is the frame's text).
  const withLabels = (labels: Record<string, string>, caption = 'Hello') => {
    const r = render()
    r.inputs.text = { caption, labelTopLeft: '', labelBottomRight: '', ...labels }
    return r
  }
  const frame = (text?: Record<string, string>) => ({
    text: 'Hello',
    assetId: null,
    kind: 'text' as const,
    template: { id: 'text-story', ...(text ? { text } : {}) },
  })

  it('matches the first field to the frame text and the others to template.text', () => {
    expect(renderMatchesFrame(withLabels({}), frame())).toBe(true)
    expect(renderMatchesFrame(withLabels({ labelTopLeft: 'Studio' }), frame())).toBe(false)
    expect(
      renderMatchesFrame(withLabels({ labelTopLeft: 'Studio' }), frame({ labelTopLeft: 'Studio' }))
    ).toBe(true)
    expect(
      renderMatchesFrame(withLabels({ labelTopLeft: 'Studio' }), frame({ labelTopLeft: 'Other' }))
    ).toBe(false)
    expect(renderMatchesFrame(withLabels({}), frame({ labelTopLeft: 'Studio' }))).toBe(false)
    // Keys the template doesn't have are ignored.
    expect(renderMatchesFrame(withLabels({}), frame({ subtitle: 'x' }))).toBe(true)
  })

  it('outdates a render when the frame text changes, even to empty', () => {
    expect(renderMatchesFrame(withLabels({}, 'Hello'), { ...frame(), text: '' })).toBe(false)
    expect(renderMatchesFrame(withLabels({}, ''), { ...frame(), text: '' })).toBe(true)
  })
})

describe('frame backgrounds', () => {
  const frame = {
    text: 'Hello',
    assetId: null,
    kind: 'text' as const,
    template: { id: 'text-story', background: { assetId: 'bg' } },
  }

  it('reads the background, and counts it as the frame’s media (once)', () => {
    expect(frameBackgroundId(frame)).toBe('bg')
    expect(frameBackgroundId({ text: '', template: { id: 'text-story' } })).toBeNull()
    expect(frameBackgroundId({ text: '', template: { id: 'x', background: null } })).toBeNull()
    expect(frameMediaIds(frame)).toEqual(['bg'])
    expect(frameMediaIds({ ...frame, assetId: 'a', assetIds: ['a', 'b'] })).toEqual([
      'a',
      'b',
      'bg',
    ])
    const own = { ...frame, assetId: 'a', template: { id: 'x', background: { assetId: 'a' } } }
    expect(frameMediaIds(own)).toEqual(['a'])
    expect(frameMediaIds({ text: '', assetId: 'a' })).toEqual(['a'])
  })

  it('outdates a render when the background is added, changed or removed', () => {
    expect(renderMatchesFrame(render({ background: 'bg' }), frame)).toBe(true)
    expect(renderMatchesFrame(render(), frame)).toBe(false)
    expect(renderMatchesFrame(render({ background: 'other' }), frame)).toBe(false)
    const plain = { ...frame, template: { id: 'text-story' } }
    expect(renderMatchesFrame(render({ background: 'bg' }), plain)).toBe(false)
    expect(renderMatchesFrame(render(), plain)).toBe(true)
  })
})

describe('frames with several media', () => {
  it('reads the media list, falling back to the single assetId of older frames', () => {
    expect(frameAssetIds({ text: '', assetId: 'a', assetIds: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(frameAssetIds({ text: '', assetId: 'a' })).toEqual(['a'])
    expect(frameAssetIds({ text: '', assetId: null, kind: 'text' })).toEqual([])
    // Inconsistent writers never lose the frame's media.
    expect(frameAssetIds({ text: '', assetId: 'a', assetIds: [] })).toEqual(['a'])
    expect(frameAssetIds({ text: '', assetId: 'c', assetIds: ['a', 'b'] })).toEqual(['c', 'a', 'b'])
  })

  it('matches a render only with the same media in the same order', () => {
    const frame = {
      text: 'Hello',
      assetId: 'a',
      kind: 'image' as const,
      assetIds: ['a', 'b', 'c'],
      template: { id: 'text-story' },
    }
    expect(renderMatchesFrame(render({ media: ['a', 'b', 'c'] }), frame)).toBe(true)
    expect(renderMatchesFrame(render({ media: ['a', 'c', 'b'] }), frame)).toBe(false)
    expect(renderMatchesFrame(render({ media: ['a', 'b'] }), frame)).toBe(false)
    expect(renderMatchesFrame(render({ media: ['a'] }), frame)).toBe(false)
    // An older frame with only assetId still matches its one-media render.
    const old = { text: 'Hello', assetId: 'a', kind: 'image' as const }
    expect(renderMatchesFrame(render({ media: ['a'] }), old)).toBe(true)
  })

  it('carries media lists and templates over to AI-revised frames by their first media', () => {
    const slideshow = { id: 'crossfade-slideshow', params: { counter: false } }
    const previous = [
      { text: 'Intro', assetId: null, kind: 'text' as const, template: { id: 'text-reveal' } },
      {
        text: 'Slides',
        assetId: 'a',
        kind: 'image' as const,
        assetIds: ['a', 'b'],
        template: slideshow,
      },
      { text: 'Clip', assetId: 'v', kind: 'video' as const, assetIds: ['v'] },
    ]
    const revised = carryOverFrames(previous, [
      // Moved to the front: follows its media, not its position.
      { text: 'Slides!', assetId: 'a', kind: 'image' },
      { text: 'Intro!', assetId: null, kind: 'text' },
      { text: 'New', assetId: 'x', kind: 'image' },
      // The same first media twice: only the first copy inherits the list.
      { text: 'Slides again', assetId: 'a', kind: 'image' },
    ])
    expect(revised).toEqual([
      { text: 'Slides!', assetId: 'a', kind: 'image', assetIds: ['a', 'b'], template: slideshow },
      // Text frames only follow the text frame at their position (frame 2 was the slideshow).
      { text: 'Intro!', assetId: null, kind: 'text' },
      { text: 'New', assetId: 'x', kind: 'image' },
      { text: 'Slides again', assetId: 'a', kind: 'image' },
    ])
    expect(carryOverFrames(previous, [{ text: 'Intro?', assetId: null, kind: 'text' }])[0]).toEqual(
      { text: 'Intro?', assetId: null, kind: 'text', template: { id: 'text-reveal' } }
    )
  })
})
