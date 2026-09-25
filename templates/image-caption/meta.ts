import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'image-caption',
  name: 'Image + caption',
  description:
    'One image, full bleed, with a large caption bottom-left over a soft gradient and small corner labels.',
  version: 1,
  kind: 'still',
  aspects: ['9:16', '4:5', '1:1'],
  media: { min: 1, max: 1, kinds: ['image'], label: 'Image' },
  text: {
    caption: {
      label: 'Caption',
      multiline: true,
      max: 140,
      optional: true,
      default: 'A study in light and form, rendered in real time.',
    },
    label: { label: 'Label (top left)', max: 40, optional: true, default: 'Nonlinear' },
    index: { label: 'Date / index (top right)', max: 24, optional: true, default: '(01)' },
  },
  params: {
    gradient: { type: 'number', label: 'Gradient', min: 0, max: 1, step: 0.05, default: 0.55 },
    color: { type: 'color', label: 'Text', default: '#ffffff' },
    size: { type: 'number', label: 'Type size', min: 48, max: 140, step: 2, default: 84 },
    focusX: { type: 'number', label: 'Crop left–right', min: 0, max: 1, step: 0.01, default: 0.5 },
    focusY: { type: 'number', label: 'Crop top–bottom', min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  fonts: [
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Medium.otf', weight: '500' },
  ],
}
