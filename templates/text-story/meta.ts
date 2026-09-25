import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'text-story',
  name: 'Text story',
  description: 'Large type on a dark canvas, set bottom-left — updates, thoughts, announcements.',
  version: 1,
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
    background: { type: 'color', label: 'Background', default: '#101010' },
    color: { type: 'color', label: 'Text', default: '#ffffff' },
    size: { type: 'number', label: 'Type size', min: 48, max: 160, step: 2, default: 84 },
    weight: { type: 'select', label: 'Weight', options: ['Regular', 'Medium'], default: 'Regular' },
    position: {
      type: 'select',
      label: 'Position',
      options: ['Bottom', 'Middle', 'Top'],
      default: 'Bottom',
    },
  },
  fonts: [
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Medium.otf', weight: '500' },
  ],
}
