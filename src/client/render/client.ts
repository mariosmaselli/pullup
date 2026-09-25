import {
  ASPECT_SIZE,
  type Aspect,
  type MediaInput,
  type Render,
  type TemplateInputs,
  type TemplateMeta,
} from '@shared/template.ts'
import { api, ApiError } from '../lib/api.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

// Longest a render may go without any progress (setup includes decoding the first video frames).
const STALL_MS = 20_000

const newWorker = () =>
  new Worker(new URL('./render.worker.ts', import.meta.url), {
    type: 'module',
    name: 'pullup-render',
  })

export const sizeFor = (aspect: Aspect, width: number) => {
  const full = ASPECT_SIZE[aspect]
  return { width, height: Math.round((full.height / full.width) * width) }
}

// Real-time preview on a visible canvas, drawn by a worker (the canvas is transferred to it).
// A canvas can be transferred only once: create one controller per <canvas> element.
export class PreviewController {
  private worker = newWorker()

  constructor(
    canvas: HTMLCanvasElement,
    private handlers: {
      onLoaded?: (info: { duration: number; frames: number; fps: number }) => void
      onTime?: (t: number, playing: boolean) => void
      onError?: (message: string) => void
    }
  ) {
    const offscreen = canvas.transferControlToOffscreen()
    this.send({ type: 'preview', canvas: offscreen }, [offscreen])
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data
      if (m.type === 'loaded') this.handlers.onLoaded?.(m)
      else if (m.type === 'time') this.handlers.onTime?.(m.t, m.playing)
      else if (m.type === 'error') this.handlers.onError?.(m.message)
    }
    this.worker.onerror = (e) => this.handlers.onError?.(e.message || 'Render worker crashed')
  }

  private send(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer)
  }

  load(meta: TemplateMeta, inputs: TemplateInputs, previewWidth: number) {
    const { width, height } = sizeFor(inputs.aspect, previewWidth)
    this.send({ type: 'load', meta, inputs, width, height })
  }
  play = () => this.send({ type: 'play' })
  pause = () => this.send({ type: 'pause' })
  seek = (t: number) => this.send({ type: 'seek', t })
  dispose = () => this.worker.terminate()
}

// What the render worker reads for each asset (a video's proxy is built on first use).
export async function resolveMedia(assetIds: string[]): Promise<MediaInput[]> {
  return Promise.all(assetIds.map((id) => api<MediaInput>(`/assets/${id}/render-source`)))
}

export interface RenderRequest {
  meta: TemplateMeta
  inputs: TemplateInputs
  postId?: string | null
  segmentIndex?: number | null
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

// Full-size export in a fresh worker, then upload. Returns the stored render (with checks).
export async function renderTemplate(request: RenderRequest): Promise<Render> {
  const { meta, inputs } = request
  const { width, height } = ASPECT_SIZE[inputs.aspect]
  const render = await api<Render>('/renders', {
    method: 'POST',
    body: JSON.stringify({
      templateId: meta.id,
      templateVersion: meta.version,
      kind: meta.kind === 'still' ? 'image' : 'video',
      aspect: inputs.aspect,
      fps: meta.kind === 'video' ? (meta.fps ?? 30) : null,
      inputs,
      postId: request.postId ?? null,
      segmentIndex: request.segmentIndex ?? null,
    }),
  })

  const worker = newWorker()
  let watchdog: ReturnType<typeof setInterval> | undefined
  try {
    const result = await new Promise<Extract<FromWorker, { type: 'done' }>>((resolve, reject) => {
      const onAbort = () => {
        worker.postMessage({ type: 'cancel' } satisfies ToWorker)
        // The worker may be stuck inside a frame; don't wait for it to notice.
        reject(new DOMException('Render cancelled', 'AbortError'))
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })

      // Browsers can stop encoding in hidden or background windows. If nothing moves for a while,
      // give up with a useful message instead of hanging.
      let lastProgress = performance.now()
      watchdog = setInterval(() => {
        if (performance.now() - lastProgress > STALL_MS) {
          reject(
            new Error(
              'Rendering stalled. Keep the Pullup window visible while it renders, then try again.'
            )
          )
        }
      }, 2000)

      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const m = event.data
        lastProgress = performance.now()
        if (m.type === 'progress') request.onProgress?.(m.done, m.total)
        else if (m.type === 'done') resolve(m)
        else if (m.type === 'error') reject(new Error(m.message))
      }
      worker.onerror = (e) => reject(new Error(e.message || 'Render worker crashed'))
      worker.postMessage({ type: 'export', meta, inputs, width, height } satisfies ToWorker)
    })

    const res = await fetch(`/api/renders/${render.id}/file`, {
      method: 'PUT',
      body: result.buffer,
      headers: {
        'Content-Type': result.mime,
        'X-Render-Encoder': result.encoder,
        'X-Render-Elapsed-Ms': String(result.elapsedMs),
      },
    })
    const body = (await res.json()) as Render & { error?: string }
    if (!res.ok) throw new ApiError(res.status, body.error ?? 'Upload failed')
    return body
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await api(`/renders/${render.id}/fail`, {
      method: 'POST',
      body: JSON.stringify({ error: message }),
    }).catch(() => {})
    throw err
  } finally {
    clearInterval(watchdog)
    worker.terminate()
  }
}
