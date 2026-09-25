import type { TemplateInputs, TemplateMeta } from '@shared/template.ts'

// Messages between the main thread and the render worker.

export type ToWorker =
  | { type: 'preview'; canvas: OffscreenCanvas }
  | { type: 'load'; meta: TemplateMeta; inputs: TemplateInputs; width: number; height: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; t: number }
  | {
      type: 'export'
      meta: TemplateMeta
      inputs: TemplateInputs
      width: number
      height: number
      stillAt?: number
    }
  | { type: 'cancel' }

export type FromWorker =
  | { type: 'loaded'; duration: number; frames: number; fps: number }
  | { type: 'time'; t: number; playing: boolean }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done'
      buffer: ArrayBuffer
      mime: 'video/mp4' | 'image/jpeg'
      encoder: string
      elapsedMs: number
    }
  | { type: 'error'; message: string }
