import { gsap } from 'gsap'
import type {
  FontSpec,
  MediaInput,
  TemplateContext,
  TemplateInputs,
  TemplateInstance,
  TemplateMeta,
} from '@shared/template.ts'
import { loadImage, VideoLayerImpl } from './media.ts'
import { layoutText } from './text.ts'
import { loadTemplate } from './templates.ts'

// Pullup owns time: GSAP never advances by itself inside the render worker.
gsap.ticker.remove(gsap.updateRoot)
gsap.ticker.lagSmoothing(0)

const workerFonts = () => (self as unknown as { fonts: FontFaceSet }).fonts
const loadedFonts = new Map<string, Promise<void>>()

function loadFont(spec: FontSpec): Promise<void> {
  const key = `${spec.family}|${spec.file}|${spec.weight ?? ''}|${spec.style ?? ''}`
  let loading = loadedFonts.get(key)
  if (!loading) {
    loading = (async () => {
      const res = await fetch(`/api/files/fonts/${encodeURIComponent(spec.file)}`)
      if (!res.ok) throw new Error(`Font file not found in the library: ${spec.file}`)
      const face = new FontFace(spec.family, await res.arrayBuffer(), {
        weight: spec.weight ?? '400',
        style: spec.style ?? 'normal',
      })
      workerFonts().add(face)
      await face.load()
    })()
    loadedFonts.set(key, loading)
  }
  return loading
}

// mulberry32 — seeded PRNG for setup().
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Stateless hash of (seed, frame, k) → [0,1): the same frame always gets the same value.
function hash(seed: number, frame: number, k = 0) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(frame + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (k + 0x27d4eb2f), 0x165667b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

export interface Session {
  meta: TemplateMeta
  fps: number
  duration: number
  frames: number
  // Prepare frame `index` at time t and draw it. `mode` decides how video frames resolve.
  frame(t: number, index: number, video: 'preview' | 'exact' | 'scheduled'): Promise<void>
  // Export only: runs update() over every frame once to learn which video frames are needed.
  planVideo(): void
  dispose(): void
}

const defaults = (meta: TemplateMeta, inputs: TemplateInputs) => ({
  text: Object.fromEntries(
    Object.entries(meta.text ?? {}).map(([key, spec]) => [
      key,
      inputs.text[key] ?? spec.default ?? '',
    ])
  ),
  params: Object.fromEntries(
    Object.entries(meta.params ?? {}).map(([key, spec]) => [
      key,
      inputs.params[key] ?? spec.default,
    ])
  ),
})

export async function createSession(options: {
  canvas: OffscreenCanvas
  meta: TemplateMeta
  inputs: TemplateInputs
  mode: 'preview' | 'render'
  width: number
  height: number
}): Promise<Session> {
  const { canvas, meta, inputs, mode, width, height } = options
  canvas.width = width
  canvas.height = height

  const fps = meta.fps ?? 30
  const duration = meta.kind === 'still' ? 0 : inputs.duration
  const frames = meta.kind === 'still' ? 1 : Math.max(1, Math.round(duration * fps))
  const abort = new AbortController()
  const timelines: gsap.core.Timeline[] = []
  const images = new Map<number, Promise<ImageBitmap>>()
  const layers = inputs.media.map((m: MediaInput) =>
    m.kind === 'video' ? new VideoLayerImpl(m) : null
  )
  await Promise.all(layers.map((l) => l?.init()))
  await Promise.all((meta.fonts ?? []).map(loadFont))

  const random = prng(inputs.seed)
  const { text, params } = defaults(meta, inputs)

  const ctx: TemplateContext = {
    canvas,
    mode,
    width,
    height,
    scale: width / 1080,
    aspect: inputs.aspect,
    fps,
    duration,
    frames,
    text,
    params,
    media: inputs.media,
    seed: inputs.seed,
    random,
    hash: (frame, k) => hash(inputs.seed, frame, k),
    image(i) {
      const media = inputs.media[i]
      if (!media || media.kind !== 'image') return Promise.reject(new Error(`No image at ${i}`))
      let loading = images.get(i)
      if (!loading) {
        loading = loadImage(media.url, abort.signal)
        images.set(i, loading)
      }
      return loading
    },
    video(i) {
      const layer = layers[i]
      if (!layer) throw new Error(`No video at ${i}`)
      return layer
    },
    async font(family) {
      const specs = (meta.fonts ?? []).filter((f) => f.family === family)
      if (!specs.length) throw new Error(`Font ${family} is not declared in the template meta`)
      await Promise.all(specs.map(loadFont))
    },
    layoutText,
    timeline(vars) {
      const tl = gsap.timeline({ ...vars, paused: true })
      timelines.push(tl)
      return tl
    },
    gsap,
    signal: abort.signal,
  }

  const factory = await loadTemplate(meta.id)
  const instance: TemplateInstance = factory(ctx)
  await instance.setup()

  const videoLayers = layers.filter((l): l is VideoLayerImpl => !!l)
  const step = (t: number, index: number) => {
    for (const tl of timelines) tl.seek(t, true)
    instance.update(t, index)
  }

  return {
    meta,
    fps,
    duration,
    frames,

    async frame(t, index, video) {
      step(t, index)
      if (video === 'preview') videoLayers.forEach((l) => l.resolvePreview())
      else if (video === 'exact') await Promise.all(videoLayers.map((l) => l.resolveExact()))
      else await Promise.all(videoLayers.map((l) => l.resolveScheduled(index)))
      // Nothing is awaited between render() and the caller capturing the canvas.
      instance.render()
    },

    planVideo() {
      if (!videoLayers.length) return
      const plans = videoLayers.map(() => [] as (number | null)[])
      for (let i = 0; i < frames; i++) {
        step(i / fps, i)
        videoLayers.forEach((l, k) => plans[k]!.push(l.takeRequest()))
      }
      videoLayers.forEach((l, k) => l.startSchedule(plans[k]!))
    },

    dispose() {
      abort.abort()
      instance.dispose()
      for (const tl of timelines) tl.kill()
      layers.forEach((l) => l?.dispose())
      images.forEach((p) => p.then((b) => b.close()).catch(() => {}))
    },
  }
}
