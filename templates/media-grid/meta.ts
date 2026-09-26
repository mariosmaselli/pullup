import type { TemplateMeta } from '@shared/template.ts'
import { BACKGROUND_PARAMS } from '../_lib/background.ts'
import { MEDIA_SIZE_PARAMS, TEXT_POSITION_PARAMS } from '../_lib/layout.ts'
import { ZOOM_DEFAULT } from './camera.ts'

export const meta: TemplateMeta = {
  id: 'media-grid',
  name: 'Grid',
  description:
    'Your images and clips as one grid of equal cells — square, desktop or phone — over a colour, image or video. The camera opens on the whole grid, glides in close to a few of them, keeps drifting in while it holds, and pulls back.',
  version: 1,
  kind: 'video',
  aspects: ['9:16', '4:5', '1:1'],
  fps: 30,
  duration: { default: 8, min: 4, max: 30 },
  // 20, not 24: a builder frame holds at most 20 media (MAX_FRAME_MEDIA, src/shared/frames.ts)
  // and the renders route accepts at most 20 (src/server/routes/renders.ts). Raise all three.
  media: { min: 2, max: 20, kinds: ['image', 'video'], label: 'Images and clips' },
  text: {
    caption: { label: 'Caption', multiline: true, max: 140, optional: true, default: '' },
  },
  params: {
    cellShape: {
      type: 'select',
      label: 'Cell shape',
      options: ['Square', 'Desktop', 'Mobile'],
      default: 'Desktop',
    },
    columns: {
      type: 'select',
      label: 'Columns',
      options: ['Auto', '2', '3', '4', '5', '6'],
      default: 'Auto',
    },
    gap: { type: 'number', label: 'Gap', min: 0, max: 80, step: 2, default: 16 },
    radius: { type: 'number', label: 'Corner radius', min: 0, max: 48, step: 1, default: 6 },
    // How close a view gets: at the default the cell fills about 85% of the frame's content
    // area; 1 = 92%, 0 = just a little closer than the overview.
    zoom: { type: 'number', label: 'Zoom', min: 0, max: 1, step: 0.05, default: ZOOM_DEFAULT },
    stops: {
      type: 'select',
      label: 'Views',
      options: ['Auto', '1', '2', '3', '4', '5', '6', '8', '10', '12'],
      default: 'Auto',
    },
    pace: { type: 'select', label: 'Pace', options: ['Smooth', 'Snappy'], default: 'Smooth' },
    ending: {
      type: 'select',
      label: 'Ending',
      options: ['Pull back', 'Hero'],
      default: 'Pull back',
    },
    motionBlur: { type: 'boolean', label: 'Motion blur', default: true },
    focusX: MEDIA_SIZE_PARAMS.focusX,
    focusY: MEDIA_SIZE_PARAMS.focusY,
    ...TEXT_POSITION_PARAMS,
    typeSize: { type: 'number', label: 'Type size', min: 48, max: 140, step: 2, default: 84 },
    color: { type: 'color', label: 'Text', default: '#ffffff' },
    // Colour, or an image / video from the library, fixed behind the grid (_lib/background.ts).
    ...BACKGROUND_PARAMS,
  },
  fonts: [{ family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' }],
}
