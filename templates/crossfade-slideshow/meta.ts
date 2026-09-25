import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'crossfade-slideshow',
  name: 'Crossfade slideshow',
  description:
    '2–10 images or clips with a slow Ken Burns drift and soft crossfades — full bleed or framed on a plain ground. Optional title over the first slide, a caption and a slide counter.',
  version: 2,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 8, min: 3, max: 30 },
  media: { min: 2, max: 10, kinds: ['image', 'video'], label: 'Slides' },
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
      label: 'Framing',
      options: ['Auto', 'Fill', 'Fit'],
      default: 'Auto',
    },
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
    background: { type: 'color', label: 'Background (Fit)', default: '#101010' },
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
