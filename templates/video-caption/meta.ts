import type { TemplateMeta } from '@shared/template.ts'
import { CAPTION_FONTS, CAPTION_PARAMS, CAPTION_TEXT } from '../_lib/caption.ts'

export const meta: TemplateMeta = {
  id: 'video-caption',
  name: 'Video + caption',
  description:
    'One clip — full bleed or fitted on a plain ground — with a large caption (top, middle or bottom) that fades or rises in over a soft gradient, and small corner labels.',
  version: 1,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 6, min: 3, max: 60 },
  media: { min: 1, max: 1, kinds: ['video'], label: 'Video' },
  text: CAPTION_TEXT,
  params: {
    ...CAPTION_PARAMS,
    animation: {
      type: 'select',
      label: 'Caption animation',
      options: ['None', 'Fade', 'Rise'],
      default: 'Fade',
    },
  },
  fonts: CAPTION_FONTS,
}
