import type { OutputKind, TemplateInputs, TemplateMeta } from '@shared/template.ts'

// Messages between the main thread and the render worker. `meta` is metaData(meta) (functions
// don't clone); `kind` is resolved on the main thread (resolveOutputKind) so the render record,
// the preview and the encoder agree.

export type ToWorker =
  | { type: 'preview'; canvas: OffscreenCanvas }
  // Preview. Loads replace each other: the current time and play state carry over (clamped to
  // the new duration); the current frame stays up until the new one is drawn.
  | {
      type: 'load'
      seq: number
      meta: TemplateMeta
      kind: OutputKind
      inputs: TemplateInputs
      width: number
      height: number
    }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; t: number }
  | {
      type: 'export'
      meta: TemplateMeta
      kind: OutputKind
      inputs: TemplateInputs
      width: number
      height: number
      stillAt?: number
    }
  | { type: 'cancel' }

export type FromWorker =
  // A load is shown: `ms` from the worker receiving it to its first frame on the canvas.
  | {
      type: 'loaded'
      seq: number
      duration: number
      frames: number
      fps: number
      t: number
      ms: number
    }
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
