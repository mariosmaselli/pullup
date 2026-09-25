/// <reference lib="webworker" />
// The render worker: runs templates off the main thread, so previews and exports never freeze
// Pullup's UI. One worker per preview canvas; a fresh worker per export.
import type { FromWorker, ToWorker } from './protocol.ts'
import { createSession, type Session } from './session.ts'
import { encodeStill, encodeVideo } from './encode.ts'

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: FromWorker, t: Transferable[]): void }).postMessage(
    message,
    transfer
  )

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

// ── Preview ────────────────────────────────────────────────────────────────────────────────
let previewCanvas: OffscreenCanvas | null = null
let session: Session | null = null
let loadToken = 0
let playing = false
let t = 0
let clockStart = 0 // performance.now() at t = 0 while playing
let lastTimePost = 0
let rafHandle = 0

function tick(now: number) {
  rafHandle = 0
  const current = session
  if (!current) return
  if (playing && current.duration > 0) {
    t = ((now - clockStart) / 1000) % current.duration
  }
  void current.frame(t, Math.round(t * current.fps), 'preview')
  if (now - lastTimePost > 100) {
    lastTimePost = now
    post({ type: 'time', t, playing })
  }
  // Keep drawing while playing, and briefly after a seek so decoded video frames show up.
  if (playing || now - lastInteraction < 1500) schedule()
}

let lastInteraction = 0
const schedule = () => {
  if (!rafHandle) rafHandle = requestAnimationFrame(tick)
}
const touch = () => {
  lastInteraction = performance.now()
  schedule()
}

async function load(message: Extract<ToWorker, { type: 'load' }>) {
  if (!previewCanvas) return
  const token = ++loadToken
  session?.dispose()
  session = null
  try {
    const next = await createSession({
      canvas: previewCanvas,
      meta: message.meta,
      inputs: message.inputs,
      mode: 'preview',
      width: message.width,
      height: message.height,
    })
    if (token !== loadToken) return next.dispose()
    session = next
    t = Math.min(t, next.duration)
    clockStart = performance.now() - t * 1000
    post({ type: 'loaded', duration: next.duration, frames: next.frames, fps: next.fps })
    touch()
  } catch (err) {
    if (token === loadToken) post({ type: 'error', message: errorMessage(err) })
  }
}

// ── Export ─────────────────────────────────────────────────────────────────────────────────
let exportAbort: AbortController | null = null

async function exportRender(message: Extract<ToWorker, { type: 'export' }>) {
  exportAbort = new AbortController()
  const canvas = new OffscreenCanvas(message.width, message.height)
  let current: Session | null = null
  try {
    current = await createSession({
      canvas,
      meta: message.meta,
      inputs: message.inputs,
      mode: 'render',
      width: message.width,
      height: message.height,
    })
    const result =
      message.meta.kind === 'still'
        ? await encodeStill(current, canvas, message.stillAt ?? 0)
        : await encodeVideo(
            current,
            canvas,
            (done, total) => post({ type: 'progress', done, total }),
            exportAbort.signal
          )
    post({ type: 'done', ...result }, [result.buffer])
  } catch (err) {
    post({ type: 'error', message: errorMessage(err) })
  } finally {
    current?.dispose()
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  switch (message.type) {
    case 'preview':
      previewCanvas = message.canvas
      break
    case 'load':
      void load(message)
      break
    case 'play':
      playing = true
      clockStart = performance.now() - t * 1000
      touch()
      break
    case 'pause':
      playing = false
      touch()
      break
    case 'seek':
      t = Math.max(0, message.t)
      clockStart = performance.now() - t * 1000
      touch()
      break
    case 'export':
      void exportRender(message)
      break
    case 'cancel':
      exportAbort?.abort()
      break
  }
}
