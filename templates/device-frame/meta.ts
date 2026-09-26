import type { TemplateMeta } from '@shared/template.ts'
import { TEXT_POSITION_PARAMS } from '../_lib/layout.ts'

export const meta: TemplateMeta = {
  id: 'device-frame',
  name: 'Device frame',
  description:
    'A screen recording or screenshot inside a clean laptop, browser window or phone that floats and settles in 3D — sized and placed as you like — with an optional caption.',
  version: 3,
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
    // The device's size and place in the space the caption leaves (1 / 0.5 / 0.5: fitted to that
    // space, centred). Bigger devices run off the frame's edges, never into the caption.
    deviceSize: {
      type: 'number',
      label: 'Device size',
      min: 0.5,
      max: 1.5,
      step: 0.05,
      default: 1,
    },
    deviceX: {
      type: 'number',
      label: 'Device left–right',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    deviceY: {
      type: 'number',
      label: 'Device top–bottom',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
    },
    // Where the caption sits; the device takes the space left (Middle: caption and device as one
    // centred lockup, caption above).
    ...TEXT_POSITION_PARAMS,
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
