import type { TemplateMeta } from '@shared/template.ts'
import { BACKGROUND_PARAMS } from '../_lib/background.ts'
import {
  BASE_FONTS,
  MEDIA_PARAMS,
  SCRIM_PARAMS,
  TEXT_FIELDS,
  TEXT_PARAMS,
  baseOutputKind,
} from '../_lib/base.ts'

// The one template for type, an image or a clip (it replaced text-story, text-reveal,
// image-caption and video-caption — git history). Everything it shows is the base layer
// (_lib/base.ts): at its defaults it is text-story, with Reveal + exit Rise it is text-reveal.
// A JPEG when nothing moves, else an MP4 (baseOutputKind).

export const meta: TemplateMeta = {
  id: 'default',
  name: 'Default',
  description:
    'Large type with up to four corner labels, on a colour, image or video ground, over an optional image or clip. A still when nothing moves; a video when the type animates or there is a clip.',
  version: 1,
  kind: 'auto',
  outputKind: baseOutputKind,
  aspects: ['9:16', '4:5', '1:1', '16:9'],
  fps: 30,
  duration: { default: 6, min: 3, max: 60 },
  media: { min: 0, max: 1, kinds: ['image', 'video'], label: 'Image or video' },
  text: TEXT_FIELDS,
  // In the order the controls read: the media (once there is some) and its gradient, the type,
  // its motion, then the background (its own picker).
  params: {
    ...MEDIA_PARAMS,
    ...SCRIM_PARAMS,
    textPosition: TEXT_PARAMS.textPosition,
    textAlign: TEXT_PARAMS.textAlign,
    textSize: TEXT_PARAMS.textSize,
    weight: TEXT_PARAMS.weight,
    textColor: TEXT_PARAMS.textColor,
    accent: TEXT_PARAMS.accent,
    animation: TEXT_PARAMS.animation,
    revealBy: TEXT_PARAMS.revealBy,
    exit: TEXT_PARAMS.exit,
    ...BACKGROUND_PARAMS,
  },
  fonts: BASE_FONTS,
}
