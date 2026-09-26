import type { TemplateMeta } from '@shared/template.ts'
import { BACKGROUND_PARAMS } from '../_lib/background.ts'
import { TEXT_POSITION_PARAMS } from '../_lib/layout.ts'

export const meta: TemplateMeta = {
  id: 'text-reveal',
  name: 'Text reveal',
  description:
    'Kinetic type: words or lines rise out of a mask, hold, then leave. Wrap words in *asterisks* for the accent colour.',
  version: 3,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 5, min: 3, max: 12 },
  media: { min: 0, max: 0, kinds: [] },
  text: {
    body: {
      label: 'Text — *accent*',
      multiline: true,
      max: 220,
      default:
        'Nonlinear is a creative studio in Tallinn, building *real-time* worlds for the web.',
    },
    label: { label: 'Label', max: 48, optional: true, default: 'Nonlinear Studio' },
  },
  params: {
    reveal: { type: 'select', label: 'Reveal', options: ['Words', 'Lines'], default: 'Words' },
    exit: { type: 'select', label: 'Exit', options: ['Rise', 'Fade', 'None'], default: 'Rise' },
    size: { type: 'number', label: 'Type size', min: 48, max: 160, step: 2, default: 84 },
    weight: { type: 'select', label: 'Weight', options: ['Regular', 'Medium'], default: 'Regular' },
    ...TEXT_POSITION_PARAMS,
    ...BACKGROUND_PARAMS,
    color: { type: 'color', label: 'Text', default: '#ffffff' },
    accent: { type: 'color', label: 'Accent', default: '#ff5b2e' },
  },
  fonts: [
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Medium.otf', weight: '500' },
  ],
}
