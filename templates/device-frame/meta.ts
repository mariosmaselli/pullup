import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'device-frame',
  name: 'Device frame',
  description:
    'A screen recording or screenshot inside a clean laptop, browser window or phone that floats and settles in 3D, with an optional caption.',
  version: 1,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 6, min: 3, max: 20 },
  media: { min: 1, max: 1, kinds: ['image', 'video'], label: 'Screen recording or screenshot' },
  text: {
    caption: {
      label: 'Caption',
      multiline: true,
      max: 120,
      optional: true,
      default: 'New work, now live.',
    },
    url: { label: 'Address bar (Browser)', max: 48, optional: true, default: '' },
  },
  params: {
    device: {
      type: 'select',
      label: 'Device',
      options: ['Laptop', 'Browser', 'Phone'],
      default: 'Laptop',
    },
    fit: {
      type: 'select',
      label: 'Fit media',
      options: ['Auto', 'Fill', 'Fit'],
      default: 'Auto',
    },
    finish: {
      type: 'select',
      label: 'Finish',
      options: ['Graphite', 'Silver'],
      default: 'Graphite',
    },
    background: { type: 'color', label: 'Background', default: '#101010' },
    accent: { type: 'color', label: 'Glow colour', default: '#ffffff' },
    glow: { type: 'number', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.35 },
    tilt: {
      type: 'select',
      label: 'Tilt',
      options: ['Right', 'Left', 'Straight'],
      default: 'Right',
    },
    float: { type: 'number', label: 'Float', min: 0, max: 1, step: 0.05, default: 0.5 },
  },
  fonts: [
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Medium.otf', weight: '500' },
  ],
}
