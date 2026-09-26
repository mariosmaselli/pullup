import type { TemplateMeta } from '@shared/template.ts'
import { CAPTION_FONTS, CAPTION_PARAMS, CAPTION_TEXT } from '../_lib/caption.ts'

export const meta: TemplateMeta = {
  id: 'image-caption',
  name: 'Media + caption',
  description:
    'One image — full bleed or fitted on a colour, image or video ground — with a large caption (top, middle or bottom) over a soft gradient and small corner labels.',
  version: 3,
  kind: 'still',
  aspects: ['9:16', '4:5', '1:1'],
  media: { min: 1, max: 1, kinds: ['image'], label: 'Image' },
  text: CAPTION_TEXT,
  params: CAPTION_PARAMS,
  fonts: CAPTION_FONTS,
}
