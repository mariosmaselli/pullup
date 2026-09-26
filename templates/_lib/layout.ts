import type { ParamSpec } from '@shared/template.ts'

// Shared layout options for templates that show media full frame and/or set type. Spread the
// param groups into `meta.params` so every template offers the same controls with the same keys
// (renders stay comparable, and the editor labels read the same everywhere):
//
//   params: { ...MEDIA_SIZE_PARAMS, ...TEXT_POSITION_PARAMS, color: { … } }
//
// then read them in index.ts with mediaSize(ctx.params) / textPlacement(ctx.params) and place
// things with mediaRect() / textBlockY() / textLineX(). The defaults reproduce the classic look:
// media covering the frame, centred; type bottom-left.

// ── Media size ──────────────────────────────────────────────────────────────────────────────

// Fill = cover the frame (crops), Fit = the whole media visible on the background colour.
// Scale multiplies either. Position: when the media overflows the frame it picks which part
// shows (0 = its left/top edge visible); when there's room to spare it places the media in the
// frame (0 = against the left/top edge).
export const MEDIA_SIZE_PARAMS = {
  size: { type: 'select', label: 'Media size', options: ['Fill', 'Fit'], default: 'Fill' },
  scale: { type: 'number', label: 'Scale', min: 0.5, max: 2, step: 0.05, default: 1 },
  focusX: {
    type: 'number',
    label: 'Position left–right',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
  },
  focusY: {
    type: 'number',
    label: 'Position top–bottom',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.5,
  },
  background: { type: 'color', label: 'Background', default: '#101010' },
} satisfies Record<string, ParamSpec>

// Where a block of type sits vertically, and how its lines align.
export const TEXT_POSITION_PARAMS = {
  textPosition: {
    type: 'select',
    label: 'Text position',
    options: ['Top', 'Middle', 'Bottom'],
    default: 'Bottom',
  },
  textAlign: { type: 'select', label: 'Text align', options: ['Left', 'Center'], default: 'Left' },
} satisfies Record<string, ParamSpec>

export type MediaFit = 'Fill' | 'Fit'
export type TextPosition = 'Top' | 'Middle' | 'Bottom'
export type TextAlign = 'Left' | 'Center'

export interface MediaSize {
  size: MediaFit
  scale: number
  focusX: number
  focusY: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

// Reads the MEDIA_SIZE_PARAMS values from ctx.params, tolerating missing or stale values (an old
// render's inputs may carry a different `size`): anything but 'Fit' is Fill.
export function mediaSize(params: Record<string, unknown>): MediaSize {
  return {
    size: params.size === 'Fit' ? 'Fit' : 'Fill',
    scale: clamp(num(params.scale, 1), 0.05, 10),
    focusX: clamp(num(params.focusX, 0.5), 0, 1),
    focusY: clamp(num(params.focusY, 0.5), 0, 1),
  }
}

// Reads the TEXT_POSITION_PARAMS values from ctx.params (defaults: Bottom, Left).
export function textPlacement(params: Record<string, unknown>): {
  position: TextPosition
  align: TextAlign
} {
  const position = params.textPosition
  return {
    position: position === 'Top' || position === 'Middle' ? position : 'Bottom',
    align: params.textAlign === 'Center' ? 'Center' : 'Left',
  }
}

// The destination rect (canvas px, relative to the frame's top-left) that draws a mediaW×mediaH
// source into a frameW×frameH frame. It may extend past the frame — the caller clips (or fills the
// uncovered part with the background first).
export function mediaRect(
  frameW: number,
  frameH: number,
  mediaW: number,
  mediaH: number,
  options: { size?: string; scale?: number; focusX?: number; focusY?: number }
): Rect {
  const { size, scale, focusX, focusY } = mediaSize(options)
  if (!(mediaW > 0 && mediaH > 0)) return { x: 0, y: 0, w: frameW, h: frameH }
  const base =
    size === 'Fit'
      ? Math.min(frameW / mediaW, frameH / mediaH)
      : Math.max(frameW / mediaW, frameH / mediaH)
  const w = mediaW * base * scale
  const h = mediaH * base * scale
  // One formula for both cases: with overflow (w > frameW) x runs from 0 (left edge visible) to
  // frameW - w (right edge visible); with room to spare from 0 (flush left) to frameW - w (flush
  // right).
  return { x: (frameW - w) * focusX, y: (frameH - h) * focusY, w, h }
}

// Top y of a text block blockH tall. Top/Bottom sit on the margins; Middle centres it on the frame,
// kept inside the margins when it doesn't fit there.
export function textBlockY(
  frameH: number,
  blockH: number,
  position: string,
  margins: { top: number; bottom: number }
): number {
  const low = frameH - margins.bottom - blockH
  if (position === 'Top') return margins.top
  if (position === 'Middle') return Math.max(margins.top, Math.min(low, (frameH - blockH) / 2))
  return low
}

// x of a line lineW wide: on the side margin (Left) or centred on the frame (Center).
export function textLineX(frameW: number, lineW: number, align: string, side: number): number {
  return align === 'Center' ? (frameW - lineW) / 2 : side
}
