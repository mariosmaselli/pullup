import type { Render } from './template.ts'

// Looping GIF / animated WebP made from a finished video render (server ↔ client).
// Exports are rebuildable derivatives: stored next to the render, reused, deleted with it.

export const EXPORT_FORMATS = ['gif', 'webp'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const EXPORT_PRESET_IDS = ['small', 'medium', 'large'] as const
export type ExportPreset = (typeof EXPORT_PRESET_IDS)[number]

export const EXPORT_PRESETS: Record<ExportPreset, { label: string; width: number; fps: number }> = {
  small: { label: 'Small', width: 480, fps: 15 },
  medium: { label: 'Medium', width: 720, fps: 20 },
  large: { label: 'Large', width: 1080, fps: 24 },
}

export interface RenderExport {
  format: ExportFormat
  preset: ExportPreset
  status: 'pending' | 'ready'
  progress: number | null // 0–1 while pending
  width: number
  height: number
  fps: number
  url: string | null
  sizeBytes: number | null
  warnings: string[]
}

// GET /api/renders/:id
export type RenderWithExports = Render & { exports: RenderExport[] }

// The preset width, never wider than the render; height keeps the render's aspect. The frame
// rate never goes above the render's own.
export function exportSize(
  render: Pick<Render, 'width' | 'height' | 'fps'>,
  preset: ExportPreset
): { width: number; height: number; fps: number } {
  const spec = EXPORT_PRESETS[preset]
  const width = Math.min(spec.width, render.width)
  const height = Math.max(1, Math.round((render.height * width) / render.width))
  return { width, height, fps: Math.min(spec.fps, render.fps ?? spec.fps) }
}
