import { describe, expect, it } from 'vitest'
import type { Render } from './template.ts'
import { renderForFrame, renderMatchesFrame } from './frames.ts'

const render = (over: Partial<Render> & { text?: string; media?: string[] } = {}): Render => ({
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
