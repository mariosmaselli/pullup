import type { TemplateMeta } from '@shared/template.ts'
import { MEDIA_SIZE_PARAMS, TEXT_POSITION_PARAMS } from '../_lib/layout.ts'

// Scale and position as everywhere else (same keys and labels), applied to each clip within its
// Media size: Fill covers the frame × scale, Frame scales the framed media.
const { scale, focusX, focusY } = MEDIA_SIZE_PARAMS

export const meta: TemplateMeta = {
  id: 'shader-transition',
  name: 'Shader transitions',
  description:
    'Two to twelve images or clips joined by GLSL transitions — liquid sweep, luminance displace, grain dissolve or sliced bands — full bleed or framed, scaled and placed as you like, with an optional caption at the top, middle or bottom.',
  version: 3,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 6, min: 3, max: 20 },
  media: { min: 2, max: 12, kinds: ['image', 'video'], label: 'Images or clips, in order' },
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
      label: 'Media size',
      options: ['Auto', 'Fill', 'Frame'],
      default: 'Auto',
    },
    scale,
    focusX,
    focusY,
    ...TEXT_POSITION_PARAMS,
    accent: { type: 'color', label: 'Accent', default: '#f2f1ec' },
    edge: { type: 'boolean', label: 'Accent layer in transitions', default: true },
    background: { type: 'color', label: 'Ground (framed or scaled media)', default: '#101010' },
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
