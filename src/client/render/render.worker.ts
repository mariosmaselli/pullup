/// <reference lib="webworker" />
// The render worker: runs templates off the main thread, so previews and exports never freeze
// Pullup's UI. One worker per preview canvas; a fresh worker per export.
import type { FromWorker, ToWorker } from './protocol.ts'
import { MediaCache } from './media.ts'
import { createSession, type Session } from './session.ts'
import { encodeStill, encodeVideo } from './encode.ts'

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: FromWorker, t: Transferable[]): void }).postMessage(
    message,
    transfer
  )

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

// ── Preview ────────────────────────────────────────────────────────────────────────────────
// Each session draws on its own canvas and is copied onto the visible one. A reload (a setting
// changed) sets the next session up while the current one keeps playing, and swaps when the next
// has drawn — the preview never shows an empty canvas, and time and play state carry over.
// Loads are handled one at a time; while one is set up, only the latest request waits.
type LoadMessage = Extract<ToWorker, { type: 'load' }>

let target: OffscreenCanvasRenderingContext2D | null = null
let session: Session | null = null
let building = false
let queued: { message: LoadMessage; received: number } | null = null
const cache = new MediaCache()
let playing = false
let t = 0
let clockStart = 0 // performance.now() at t = 0 while playing
let lastTimePost = 0
let rafHandle = 0

const blit = (current: Session) => {
  if (!target) return
  const { canvas } = target
  if (canvas.width !== current.canvas.width || canvas.height !== current.canvas.height) {
    canvas.width = current.canvas.width
    canvas.height = current.canvas.height
  }
  // Same task as render(): a WebGL canvas's drawing buffer is still there.
  target.drawImage(current.canvas, 0, 0)
}

const draw = (current: Session) => {
  current.draw(t, Math.round(t * current.fps))
  blit(current)
}

function tick(now: number) {
  rafHandle = 0
  const current = session
  if (!current) return
  if (playing && current.duration > 0) {
    t = ((now - clockStart) / 1000) % current.duration
  }
  draw(current)
  if (now - lastTimePost > 100) {
    lastTimePost = now
    post({ type: 'time', t, playing })
  }
  // Keep drawing while playing, and briefly after a change so decoded video frames show up.
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

// Frees a finished session's WebGL context now rather than whenever it is collected (a canvas
// with a 2D context returns null here, and nothing is created).
function release(old: Session) {
  old.dispose()
  for (const kind of ['webgl2', 'webgl'] as const) {
    try {
      const gl = old.canvas.getContext(kind) as WebGLRenderingContext | null
      if (gl) {
        gl.getExtension('WEBGL_lose_context')?.loseContext()
        return
      }
    } catch {
      // Not this kind of context.
    }
  }
}

// A first video frame that never decodes must not hold up the preview.
const within = (ms: number, work: Promise<void>) =>
  Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, ms))])

function requestLoad(message: LoadMessage) {
  queued = { message, received: performance.now() }
  if (!building) void buildQueued()
}

async function buildQueued() {
  building = true
  while (queued) {
    const { message, received } = queued
    queued = null
    let next: Session | null = null
    try {
      next = await createSession({
        canvas: new OffscreenCanvas(message.width, message.height),
        meta: message.meta,
        kind: message.kind,
        inputs: message.inputs,
        mode: 'preview',
        width: message.width,
        height: message.height,
        cache,
      })
      if (session) next.adopt(session)
      t = Math.min(t, next.duration)
      await within(1500, next.prime(t, Math.round(t * next.fps)))
    } catch (err) {
      next?.dispose()
      // A newer request may fix it (a font or media still coming); the last good frame stays.
      if (!queued) post({ type: 'error', message: errorMessage(err) })
      continue
    }
    const previous = session
    session = next
    if (playing && next.duration > 0) t %= next.duration
    clockStart = performance.now() - t * 1000
    draw(next)
    if (previous) release(previous)
    post({
      type: 'loaded',
      seq: message.seq,
      duration: next.duration,
      frames: next.frames,
      fps: next.fps,
      t,
      ms: Math.round(performance.now() - received),
    })
    touch()
  }
  building = false
  // Keep only the media the preview shows now.
  if (session) cache.keep(session.media)
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
      kind: message.kind,
      inputs: message.inputs,
      mode: 'render',
      width: message.width,
      height: message.height,
    })
    const result =
      message.kind === 'still'
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
      target = message.canvas.getContext('2d', { alpha: false })
      if (session) draw(session)
      break
    case 'load':
      requestLoad(message)
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
