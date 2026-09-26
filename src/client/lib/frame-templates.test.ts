import { describe, expect, it } from 'vitest'
import type { Segment } from '@shared/types.ts'
import {
  defaultTemplate,
  foldedInto,
  frameOutputKind,
  switchTemplate,
  upgradeTemplate,
  withTemplate,
} from './frame-templates.ts'
import { templateMeta } from '../render/templates.ts'

// text-story, text-reveal, image-caption and video-caption were folded into templates/default:
// frames saved with them open as Default, with what they had set.

describe('templates folded into Default', () => {
  it('text, image and video frames default to Default; several media to the grid', () => {
    expect(defaultTemplate('ig_story', [])).toEqual({ id: 'default' })
    expect(defaultTemplate('ig_feed', ['image'])).toEqual({ id: 'default' })
    expect(defaultTemplate('ig_story', ['video'])).toEqual({ id: 'default' })
    expect(defaultTemplate('ig_story', ['image', 'video'])).toEqual({ id: 'media-grid' })
  })

  it('text-story → Default, its type settings renamed (its `size` was the type size)', () => {
    expect(
      upgradeTemplate({
        id: 'text-story',
        params: { color: '#101010', size: 120, weight: 'Medium', background: '#f2f1ec' },
        background: { assetId: 'bg' },
      })
    ).toEqual({
      id: 'default',
      params: { textColor: '#101010', textSize: 120, weight: 'Medium', background: '#f2f1ec' },
      background: { assetId: 'bg' },
    })
    // Nothing set: plain Default (its defaults are text-story's look).
    expect(upgradeTemplate({ id: 'text-story' })).toEqual({ id: 'default' })
  })

  it('text-reveal → Default with its motion (Reveal by words, exit Rise, 5 s) and its label', () => {
    expect(upgradeTemplate({ id: 'text-reveal', text: { label: 'Nonlinear' } })).toEqual({
      id: 'default',
      duration: 5,
      params: { animation: 'Reveal', exit: 'Rise' },
      text: { labelTopLeft: 'Nonlinear' },
    })
    expect(
      upgradeTemplate({
        id: 'text-reveal',
        duration: 8,
        params: { reveal: 'Lines', exit: 'None', accent: '#00ff00' },
      })
    ).toEqual({
      id: 'default',
      duration: 8,
      params: { animation: 'Reveal', revealBy: 'Lines', accent: '#00ff00' },
    })
  })

  it('image-caption / video-caption → Default, media settings and corner labels kept', () => {
    expect(
      upgradeTemplate({
        id: 'image-caption',
        params: { size: 'Fit', focusY: 0.2, typeSize: 100, gradient: 0.8, textPosition: 'Top' },
        text: { label: 'Nonlinear', index: '(02)' },
      })
    ).toEqual({
      id: 'default',
      params: { size: 'Fit', focusY: 0.2, textSize: 100, gradient: 0.8, textPosition: 'Top' },
      text: { labelTopLeft: 'Nonlinear', labelTopRight: '(02)' },
    })
    // video-caption faded in by default; its Rise came out of line masks (Reveal by lines).
    expect(upgradeTemplate({ id: 'video-caption' })).toEqual({
      id: 'default',
      params: { animation: 'Fade' },
    })
    expect(upgradeTemplate({ id: 'video-caption', params: { animation: 'Rise' } })).toEqual({
      id: 'default',
      params: { animation: 'Reveal', revealBy: 'Lines' },
    })
    expect(upgradeTemplate({ id: 'video-caption', params: { animation: 'None' } })).toEqual({
      id: 'default',
    })
  })

  it('old studio links to a folded template open Default', () => {
    for (const id of ['text-story', 'text-reveal', 'image-caption', 'video-caption']) {
      expect(foldedInto(id)).toBe('default')
    }
    expect(foldedInto('default')).toBeNull()
    expect(foldedInto('media-grid')).toBeNull()
    expect(foldedInto('no-such-template')).toBeNull()
  })

  it('leaves other templates alone', () => {
    const grid = { id: 'media-grid', params: { columns: '3' } }
    expect(upgradeTemplate(grid)).toBe(grid)
    expect(upgradeTemplate(null)).toBeNull()
    expect(upgradeTemplate(undefined)).toBeUndefined()
  })

  it('the builder sees the upgraded template, and switching to Default keeps it', () => {
    const frame: Segment = {
      text: 'Hello',
      assetId: null,
      kind: 'text',
      template: { id: 'text-reveal', params: { color: '#ff0000' } },
    }
    const effective = withTemplate('ig_story', frame, [])
    expect(effective.template).toEqual({
      id: 'default',
      duration: 5,
      params: { animation: 'Reveal', exit: 'Rise', textColor: '#ff0000' },
    })
    expect(switchTemplate(frame.template, 'default')).toEqual(effective.template)
    // It still moves: a video.
    const meta = templateMeta('default')!
    expect(frameOutputKind('ig_story', effective, meta, [], null)).toBe('video')
    // A plain text-story frame is a still.
    const still = withTemplate('ig_story', { ...frame, template: { id: 'text-story' } }, [])
    expect(frameOutputKind('ig_story', still, meta, [], null)).toBe('still')
  })
})
