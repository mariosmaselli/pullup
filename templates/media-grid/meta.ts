import type { ParamWhen, TemplateMeta } from '@shared/template.ts'
import { BACKGROUND_PARAMS } from '../_lib/background.ts'
import {
  BASE_FONTS,
  CAPTION_FIELD,
  LABEL_FIELDS,
  MEDIA_PARAMS,
  SCRIM_PARAMS,
  TEXT_PARAMS,
  baseOutputKind,
} from '../_lib/base.ts'
import { ZOOM_DEFAULT } from './camera.ts'
import { MAX_COLUMNS, MAX_ROWS } from './layout.ts'

// Camera settings only show while the camera tours.
const TOUR: ParamWhen = { param: 'camera', is: ['Tour'] }
const counts = (max: number) => ['Auto', ...Array.from({ length: max }, (_, i) => String(i + 1))]

export const meta: TemplateMeta = {
  id: 'media-grid',
  name: 'Grid',
  description:
    'Your images and clips as one grid of rows × columns — square, desktop or phone cells, the media repeated to fill it — with the caption, corner labels and background every template has. The camera opens on the whole grid, glides in close to a few cells, keeps drifting in while it holds, and pulls back; or it stays on the whole grid.',
  version: 2,
  // A video while the camera tours; with the camera still, a JPEG when nothing else moves.
  kind: 'auto',
  outputKind: (inputs) => (inputs.params.camera === 'Still' ? baseOutputKind(inputs) : 'video'),
  aspects: ['9:16', '4:5', '1:1', '16:9'],
  fps: 30,
  duration: { default: 8, min: 4, max: 30 },
  // 20, not 24: a builder frame holds at most 20 media (MAX_FRAME_MEDIA, src/shared/frames.ts)
  // and the renders route accepts at most 20 (src/server/routes/renders.ts). Raise all three.
  media: { min: 1, max: 20, kinds: ['image', 'video'], label: 'Images and clips' },
  text: {
    caption: { ...CAPTION_FIELD.caption, default: 'Selected work,\n2024 — 2026' },
    ...LABEL_FIELDS,
  },
  params: {
    // The grid: rows × columns cells (Auto: as many as the media need), media repeated to fill.
    columns: { type: 'select', label: 'Columns', options: counts(MAX_COLUMNS), default: 'Auto' },
    rows: { type: 'select', label: 'Rows', options: counts(MAX_ROWS), default: 'Auto' },
    cellShape: {
      type: 'select',
      label: 'Cell shape',
      options: ['Square', 'Desktop', 'Mobile'],
      default: 'Desktop',
    },
    gap: { type: 'number', label: 'Gap', min: 0, max: 80, step: 2, default: 16 },
    radius: { type: 'number', label: 'Corner radius', min: 0, max: 48, step: 1, default: 6 },
    // Tour: the camera travels to a few cells and back. Still: the whole grid, held.
    camera: { type: 'select', label: 'Camera', options: ['Tour', 'Still'], default: 'Tour' },
    stops: {
      type: 'select',
      label: 'Views',
      options: ['Auto', '1', '2', '3', '4', '5', '6', '8', '10', '12'],
      default: 'Auto',
      when: TOUR,
    },
    // How close a view gets: at the default the cell fills about 85% of the frame's content
    // area; 1 = 92%, 0 = just a little closer than the overview.
    zoom: {
      type: 'number',
      label: 'Zoom',
      min: 0,
      max: 1,
      step: 0.05,
      default: ZOOM_DEFAULT,
      when: TOUR,
    },
    pace: {
      type: 'select',
      label: 'Pace',
      options: ['Smooth', 'Snappy'],
      default: 'Smooth',
      when: TOUR,
    },
    ending: {
      type: 'select',
      label: 'Ending',
      options: ['Pull back', 'Hero'],
      default: 'Pull back',
      when: TOUR,
    },
    motionBlur: { type: 'boolean', label: 'Motion blur', default: true, when: TOUR },
    // How each medium sits in its cell: Fill (cover) / Fit (whole), scale, position — then its
    // gradient, the type and its motion, in the order Default's controls read.
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
    // Colour, or an image / video from the library, fixed behind the grid (_lib/background.ts).
    ...BACKGROUND_PARAMS,
  },
  fonts: BASE_FONTS,
}
