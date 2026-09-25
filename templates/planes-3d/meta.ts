import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'planes-3d',
  name: '3D planes',
  description:
    'Two to eight images or clips float as planes in depth. The camera lands on each one in turn, glides past it and settles on the last.',
  version: 1,
  kind: 'video',
  aspects: ['9:16', '4:5'],
  fps: 30,
  duration: { default: 8, min: 4, max: 20 },
  media: {
    min: 2,
    max: 8,
    kinds: ['image', 'video'],
    label: 'Planes (the camera lands on the last)',
  },
  text: {
    caption: { label: 'Caption', multiline: true, max: 120, optional: true, default: '' },
  },
  params: {
    background: { type: 'color', label: 'Background', default: '#101010' },
    arrangement: {
      type: 'select',
      label: 'Arrangement',
      options: ['Stack', 'Zigzag'],
      default: 'Stack',
    },
    fog: { type: 'number', label: 'Fog', min: 0, max: 1, step: 0.05, default: 0.5 },
    corners: { type: 'number', label: 'Corner radius', min: 0, max: 48, step: 1, default: 12 },
    shadow: { type: 'number', label: 'Shadow', min: 0, max: 1, step: 0.05, default: 0.5 },
    drift: { type: 'number', label: 'Camera drift', min: 0, max: 1, step: 0.05, default: 0.5 },
    captionIn: {
      type: 'select',
      label: 'Caption appears',
      options: ['At start', 'On arrival'],
      default: 'At start',
    },
  },
  fonts: [{ family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' }],
}
