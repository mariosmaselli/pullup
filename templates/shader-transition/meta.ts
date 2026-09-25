import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'shader-transition',
  name: 'Shader transitions',
  description:
    'Two to six images or clips joined by GLSL transitions — liquid sweep, luminance displace, grain dissolve or sliced bands — with an optional caption.',
  version: 1,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 6, min: 3, max: 20 },
  media: { min: 2, max: 6, kinds: ['image', 'video'], label: 'Images or clips, in order' },
  text: {
    caption: { label: 'Caption', multiline: true, max: 120, optional: true, default: '' },
  },
  params: {
    style: {
      type: 'select',
      label: 'Transition',
      options: ['Liquid', 'Displace', 'Dissolve', 'Slice'],
      default: 'Liquid',
    },
    length: {
      type: 'number',
      label: 'Transition length (s)',
      min: 0.4,
      max: 1.5,
      step: 0.05,
      default: 0.9,
    },
    fit: {
      type: 'select',
      label: 'Media fit',
      options: ['Auto', 'Fill', 'Frame'],
      default: 'Auto',
    },
    accent: { type: 'color', label: 'Accent', default: '#f2f1ec' },
    edge: { type: 'boolean', label: 'Accent layer in transitions', default: true },
    background: { type: 'color', label: 'Ground (framed media)', default: '#101010' },
    shade: {
      type: 'number',
      label: 'Caption shade (full-bleed media)',
      min: 0,
      max: 0.8,
      step: 0.05,
      default: 0.45,
    },
    grain: { type: 'number', label: 'Grain', min: 0, max: 0.08, step: 0.01, default: 0 },
  },
  fonts: [{ family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' }],
}
