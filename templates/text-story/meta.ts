import type { TemplateMeta } from '@shared/template.ts'
import { BACKGROUND_PARAMS } from '../_lib/background.ts'
import { TEXT_POSITION_PARAMS } from '../_lib/layout.ts'

export const meta: TemplateMeta = {
  id: 'text-story',
  name: 'Text story',
  description: 'Large type on a colour, image or video ground — updates, thoughts, announcements.',
  version: 3,
  kind: 'still',
  aspects: ['9:16', '4:5', '1:1'],
  media: { min: 0, max: 0, kinds: [] },
  text: {
    body: {
      label: 'Text',
      multiline: true,
      max: 200,
      default:
        'Finally got a new phone! 🎉 Better late than never—now I can start thanking everyone for last week.',
    },
  },
  params: {
    ...BACKGROUND_PARAMS,
    color: { type: 'color', label: 'Text', default: '#ffffff' },
    size: { type: 'number', label: 'Type size', min: 48, max: 160, step: 2, default: 84 },
    weight: { type: 'select', label: 'Weight', options: ['Regular', 'Medium'], default: 'Regular' },
    ...TEXT_POSITION_PARAMS,
  },
  fonts: [
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Medium.otf', weight: '500' },
  ],
}
