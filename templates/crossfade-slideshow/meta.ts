import type { TemplateMeta } from '@shared/template.ts'
import { MEDIA_SIZE_PARAMS, TEXT_POSITION_PARAMS } from '../_lib/layout.ts'

// Scale and position as everywhere else (same keys and labels), applied to each slide within its
// Media size: Fill covers the frame × scale, Fit scales the shared window.
const { scale, focusX, focusY } = MEDIA_SIZE_PARAMS

export const meta: TemplateMeta = {
  id: 'crossfade-slideshow',
  name: 'Crossfade slideshow',
  description:
    '2–20 images or clips with a slow Ken Burns drift and soft crossfades — full bleed or framed on a plain ground, scaled and placed as you like. Optional title over the first slide, a caption and a slide counter, set at the top, middle or bottom.',
  version: 4,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 8, min: 3, max: 30 },
  media: { min: 2, max: 20, kinds: ['image', 'video'], label: 'Slides' },
  text: {
    title: {
      label: 'Title (first slide)',
      multiline: true,
      max: 80,
      optional: true,
      default: 'Selected work, 2026',
    },
    caption: {
      label: 'Caption',
      multiline: true,
      max: 90,
      optional: true,
      default: 'Nonlinear — Tallinn',
    },
  },
  params: {
    framing: {
      type: 'select',
      label: 'Media size',
      options: ['Auto', 'Fill', 'Fit'],
      default: 'Auto',
    },
    scale,
    focusX,
    focusY,
    ...TEXT_POSITION_PARAMS,
    crossfade: {
      type: 'number',
      label: 'Crossfade (s)',
      min: 0.2,
      max: 1.5,
      step: 0.05,
      default: 0.6,
    },
    motion: { type: 'number', label: 'Ken Burns', min: 0, max: 0.2, step: 0.01, default: 0.08 },
    titleSize: { type: 'number', label: 'Title size', min: 48, max: 160, step: 2, default: 84 },
    weight: {
      type: 'select',
      label: 'Title weight',
      options: ['Regular', 'Medium'],
      default: 'Regular',
    },
    counter: { type: 'boolean', label: 'Slide counter', default: true },
    background: { type: 'color', label: 'Background', default: '#101010' },
    color: { type: 'color', label: 'Text', default: '#ffffff' },
    dim: {
      type: 'number',
      label: 'Darken for text (Fill)',
      min: 0,
      max: 0.8,
      step: 0.05,
      default: 0.5,
    },
  },
  fonts: [
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Medium.otf', weight: '500' },
  ],
}
