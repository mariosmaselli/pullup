import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'slow-zoom',
  name: 'Slow zoom',
  description:
    'One image or clip with a slow push-in, film grain and an optional caption that rises in.',
  version: 3,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 6, min: 3, max: 15 },
  media: { min: 1, max: 1, kinds: ['image', 'video'] },
  text: {
    caption: { label: 'Caption', multiline: true, max: 120, optional: true, default: '' },
  },
  params: {
    zoom: { type: 'number', label: 'Zoom', min: 0, max: 0.4, step: 0.01, default: 0.12 },
    drift: {
      type: 'select',
      label: 'Drift',
      options: ['None', 'Up', 'Down', 'Left', 'Right'],
      default: 'None',
    },
    grain: { type: 'number', label: 'Grain', min: 0, max: 0.2, step: 0.01, default: 0.05 },
    dim: {
      type: 'number',
      label: 'Darken for caption',
      min: 0,
      max: 0.8,
      step: 0.05,
      default: 0.35,
    },
  },
  fonts: [{ family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' }],
}
