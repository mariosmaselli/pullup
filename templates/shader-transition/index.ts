import * as THREE from 'three'
import type { TemplateFactory } from '@shared/template.ts'
import { drawLayout, STORY_TYPE } from '../_lib/text.ts'
import {
  createRenderer,
  fullscreenScene,
  fullscreenVertex,
  imageTexture,
  videoTexture,
} from '../_lib/three.ts'
import { fragment, MAX_LINES, MAX_SAMPLES, SLICE_STAGGER, STYLE_INDEX } from './shader.ts'

// Shader transitions: 2–6 images or clips, each held for the same time, joined by a GLSL
// transition. Timing (all in seconds):
//
//   | hold | T | hold | T | hold |      hold = (duration − (n − 1)·T) / n
//
// A clip starts playing when its incoming transition starts and holds its last frame past its end.

const AUTO_FILL_RANGE = 1.4 // Auto fit: fill when the media's aspect is within 1.4× of the frame's
const BAND = 240 // Slice: band height in design px (the shader fits whole bands to the media)
const SHUTTER = 0.5 // fraction of a frame the motion blur integrates over (180°)
const SAMPLE_SPACING = 4 // px the media may move between motion-blur samples

// Per style: the ease the shader uses and how far (in frame heights / widths) the media move over the
// whole transition. Edges are blurred analytically in the shader; this only sizes the media samples.
const MOTION: Record<number, { ease: string; travel: number; axis: 'x' | 'y' }> = {
  0: { ease: 'sine.inOut', travel: 0.21, axis: 'y' }, // Liquid: incoming rises + settles
  1: { ease: 'sine.inOut', travel: 0.3, axis: 'y' }, // Displace: the flow
  2: { ease: 'sine.inOut', travel: 0.02, axis: 'y' }, // Dissolve: a slight zoom
  3: { ease: 'expo.inOut', travel: 0.22, axis: 'x' }, // Slice: incoming parallax
}

const shaderTransition: TemplateFactory = (ctx) => {
  const p = ctx.params as {
    style: string
    length: number
    fit: 'Auto' | 'Fill' | 'Frame'
    accent: string
    edge: boolean
    background: string
    grain: number
    shade: number
  }
  const s = ctx.scale
  const n = ctx.media.length
  // Auto: media close to the frame's shape fill it; others (a landscape screen recording in a story)
  // are framed whole on the ground.
  const frameAspect = ctx.width / ctx.height
  const isFramed = (w: number, h: number) =>
    p.fit === 'Frame' ||
    (p.fit !== 'Fill' && Math.abs(Math.log(w / h / frameAspect)) > Math.log(AUTO_FILL_RANGE))
  const framed: boolean[] = []
  const style = STYLE_INDEX[p.style] ?? 0
  const motion = MOTION[style]!
  const ease = ctx.gsap.parseEase(motion.ease)
  const windowEase = ctx.gsap.parseEase('power3.inOut') // keep in step with windowAt() in shader.ts

  // ── Timing ──
  const T = Math.max(0.2, Math.min(p.length, (0.5 * ctx.duration) / Math.max(1, n)))
  const hold = Math.max(0, (ctx.duration - (n - 1) * T) / n)
  const starts = Array.from({ length: Math.max(0, n - 1) }, (_, k) => (k + 1) * hold + k * T)
  // Each slot is visible from the start of its incoming transition to the end of its outgoing one.
  const windowStart = (i: number) => (i === 0 ? 0 : starts[i - 1]!)
  const windowEnd = (i: number) => (i === n - 1 ? ctx.duration : starts[i]! + T)

  let renderer: THREE.WebGLRenderer
  let scene: THREE.Scene
  let camera: THREE.Camera
  let material: THREE.ShaderMaterial
  const textures: THREE.Texture[] = []
  const videos: (ReturnType<typeof videoTexture> | null)[] = []
  const rects: THREE.Vector4[] = []
  const aspects: number[] = []
  const lods: number[] = []
  let seeds: number[] = []
  // Slice: bands per transition, fitted to the taller of the two windows (~BAND design px each).
  let bandCounts: number[] = []
  let captionTexture: THREE.Texture | null = null

  // Caption ink on the ground: near-black on a light ground, white on a dark one (sRGB).
  const groundColor = new THREE.Color(p.background)
  const groundLight =
    0.2126 * groundColor.r + 0.7152 * groundColor.g + 0.0722 * groundColor.b > 0.18 // linear, WCAG crossover
  const ink = groundLight
    ? new THREE.Vector3(16 / 255, 16 / 255, 16 / 255)
    : new THREE.Vector3(1, 1, 1)

  const caption = {
    lines: [] as { offset: number }[],
    dim: { value: 0 },
    row: 0,
  }

  // Margins: Mario's story spec at 9:16 (160 px clear of the story UI), tighter on feed formats.
  const side = STORY_TYPE.side * s
  const edgeMargin = (ctx.aspect === '9:16' ? STORY_TYPE.bottom : 64) * s

  // How far (px) the media move over the shutter [s0, s1].
  const motionPx = (s0: number, s1: number, bands: number) => {
    let delta: number
    if (style === 3) {
      // Slice: the fastest band (bands start staggered, each over 1 − stagger of the transition).
      delta = 0
      for (let r = 0; r < bands; r++) {
        const off = (r / Math.max(bands - 1, 1)) * SLICE_STAGGER
        const local = (x: number) => Math.min(1, Math.max(0, (x - off) / (1 - SLICE_STAGGER)))
        delta = Math.max(delta, Math.abs(ease(local(s1)) - ease(local(s0))))
      }
    } else {
      delta = Math.abs(ease(s1) - ease(s0))
    }
    const extent = motion.axis === 'x' ? ctx.width : ctx.height
    return delta * motion.travel * extent
  }

  return {
    async setup() {
      renderer = createRenderer(ctx)

      // ── Caption ──
      const text = ctx.text.caption?.trim() ?? ''
      let captionTop = ctx.height - edgeMargin
      const lineTops = new Array<number>(MAX_LINES).fill(0)
      let captionLeft = 0
      let atlasSize = new THREE.Vector2(1, 1)
      let lineCount = 0
      let canvas = new OffscreenCanvas(1, 1)
      if (text) {
        await ctx.font('PP Neue Montreal')
        const size = STORY_TYPE.size * s
        const tracking = STORY_TYPE.tracking * size
        const layout = ctx.layoutText(text, {
          family: 'PP Neue Montreal',
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: ctx.width - side * 2,
          letterSpacing: tracking,
        })
        const lines = layout.lines.slice(0, MAX_LINES)
        lineCount = lines.length
        // Atlas rows are taller than the line height so ascenders/descenders never share a row.
        const pad = Math.ceil(size * 0.12)
        const row = Math.ceil(size * 1.42)
        caption.row = row
        const atlasW = Math.ceil(layout.width + size * 0.5)
        canvas = new OffscreenCanvas(atlasW, row * lineCount)
        const g = canvas.getContext('2d')!
        drawLayout(
          g,
          { ...layout, lines: lines.map((l, i) => ({ ...l, y: i * row + pad })) },
          0,
          0,
          {
            color: '#ffffff',
            letterSpacing: tracking,
          }
        )
        atlasSize = new THREE.Vector2(atlasW, row * lineCount)
        captionLeft = Math.round(side)
        captionTop = Math.round(ctx.height - edgeMargin - lineCount * layout.lineHeight)
        lines.forEach((_, i) => {
          lineTops[i] = Math.round(captionTop + i * layout.lineHeight) - pad
        })
        caption.lines = lines.map(() => ({ offset: row }))
      }
      const atlas = new THREE.CanvasTexture(canvas)
      atlas.colorSpace = THREE.SRGBColorSpace
      atlas.generateMipmaps = false
      atlas.minFilter = THREE.LinearFilter
      captionTexture = atlas

      // ── Media ──
      // Framed media are contained inside [side, top] – [W − side, bottom], above the caption.
      const areaTop = edgeMargin
      const areaBottom = text ? captionTop - 56 * s : ctx.height - edgeMargin
      const areaW = ctx.width - side * 2
      const areaH = Math.max(1, areaBottom - areaTop)
      for (let i = 0; i < n; i++) {
        const m = ctx.media[i]!
        let texture: THREE.Texture
        if (m.kind === 'video') {
          const layer = ctx.video(i)
          const v = videoTexture(layer)
          // Mipmaps: clean minification and a blurred luminance map for Displace.
          v.texture.generateMipmaps = true
          v.texture.minFilter = THREE.LinearMipmapLinearFilter
          videos.push(v)
          texture = v.texture
        } else {
          texture = await imageTexture(await ctx.image(i))
          videos.push(null)
        }
        texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping
        textures.push(texture)
        const w = m.kind === 'video' ? ctx.video(i).width : m.width
        const h = m.kind === 'video' ? ctx.video(i).height : m.height
        lods.push(Math.max(0, Math.floor(Math.log2(Math.max(w, h) / 64))))
        aspects.push(w / h)
        framed.push(isFramed(w, h))
        if (framed[i]) {
          // Contained, centred in the area; whole pixels so edges stay crisp.
          const k = Math.min(areaW / w, areaH / h)
          const rw = Math.round(w * k)
          const rh = Math.round(h * k)
          const left = Math.round((ctx.width - rw) / 2)
          const top = Math.round(areaTop + (areaH - rh) / 2)
          // Rect in uv (y up): centre, size.
          rects.push(
            new THREE.Vector4(
              (left + rw / 2) / ctx.width,
              1 - (top + rh / 2) / ctx.height,
              rw / ctx.width,
              rh / ctx.height
            )
          )
        } else {
          rects.push(new THREE.Vector4(0.5, 0.5, 1, 1))
        }
      }
      seeds = starts.map(() => Math.floor(ctx.random() * 97) + ctx.random())

      bandCounts = starts.map((_, k) => {
        const h = Math.max(rects[k]!.w, rects[k + 1]!.w) * ctx.height
        return Math.max(3, Math.round(h / s / BAND))
      })

      material = new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex,
        fragmentShader: fragment,
        uniforms: {
          uFrom: { value: textures[0] },
          uTo: { value: textures[0] },
          uFromRect: { value: rects[0] },
          uToRect: { value: rects[0] },
          uFromAspect: { value: aspects[0] },
          uToAspect: { value: aspects[0] },
          uFromZoom: { value: 1 },
          uToZoom: { value: 1 },
          uToLod: { value: lods[0] },
          uFromVideo: { value: 0 },
          uToVideo: { value: 0 },
          uStyle: { value: -1 },
          uS0: { value: 0 },
          uS1: { value: 0 },
          uSamples: { value: 1 },
          uMotion: { value: 0 },
          uWinMotion: { value: 0 },
          uSeed: { value: 0 },
          uFlip: { value: 1 },
          uRes: { value: new THREE.Vector2(ctx.width, ctx.height) },
          uScale: { value: s },
          uBands: { value: 3 },
          uAccent: { value: new THREE.Color(p.accent) },
          uEdge: { value: p.edge ? 1 : 0 },
          uBackground: { value: new THREE.Color(p.background) },
          uGrain: { value: p.grain },
          uNoise: { value: 0 },
          uCaption: { value: captionTexture },
          uCaptionSize: { value: atlasSize },
          uCaptionLeft: { value: captionLeft },
          uRow: { value: caption.row },
          uLines: { value: lineCount },
          uLineTop: { value: lineTops },
          uLineOffset: { value: new Array<number>(MAX_LINES).fill(0) },
          uCaptionColor: { value: new THREE.Vector3(1, 1, 1) },
          uDim: { value: 0 },
          uDimTop: { value: 1 - (captionTop - 420 * s) / ctx.height },
          uDimFull: { value: 1 - (captionTop - 40 * s) / ctx.height },
        },
      })
      ;({ scene, camera } = fullscreenScene(material))

      // Caption: each line rises out of its own mask; the ground darkens beneath it.
      if (lineCount) {
        const tl = ctx.timeline()
        tl.to(caption.lines, { offset: 0, duration: 1.3, ease: 'expo.out', stagger: 0.09 }, 0.35)
        tl.to(caption.dim, { value: 1, duration: 1.4, ease: 'power2.out' }, 0.2)
      }

      renderer.compile(scene, camera)
    },

    update(t, frame) {
      const u = material.uniforms

      // Which slot(s) are on screen.
      let from = n - 1
      let k = -1
      for (let i = 0; i < starts.length; i++) {
        const a = starts[i]!
        if (t < a) {
          from = i
          break
        }
        if (t < a + T) {
          from = i
          k = i
          break
        }
      }
      const to = k >= 0 ? k + 1 : from

      // Slow push-in over each slot's time on screen (same speed for every slot). Framed media are
      // shown whole, so they hold still.
      const zoom = (i: number) => (framed[i] ? 1 : 1 + 0.014 * Math.max(0, t - windowStart(i)))

      u.uFrom!.value = textures[from]
      u.uTo!.value = textures[to]
      u.uFromRect!.value = rects[from]
      u.uToRect!.value = rects[to]
      u.uFromAspect!.value = aspects[from]
      u.uToAspect!.value = aspects[to]
      u.uFromZoom!.value = zoom(from)
      u.uToZoom!.value = zoom(to)
      u.uToLod!.value = lods[to]
      u.uFromVideo!.value = videos[from] ? 1 : 0
      u.uToVideo!.value = videos[to] ? 1 : 0

      if (k >= 0) {
        const a = starts[k]!
        const half = (SHUTTER * 0.5) / ctx.fps
        u.uStyle!.value = style
        const s0 = Math.min(1, Math.max(0, (t - half - a) / T))
        const s1 = Math.min(1, Math.max(0, (t + half - a) / T))
        u.uS0!.value = s0
        u.uS1!.value = s1
        // Enough motion-blur samples that the media move ≤ SAMPLE_SPACING px between them.
        // The window morph (between differently framed media) rescales both: count its edge travel.
        const ra = rects[from]!
        const rb = rects[to]!
        const morph =
          Math.abs(windowEase(s1) - windowEase(s0)) *
          (Math.max(Math.abs(rb.x - ra.x) * ctx.width, Math.abs(rb.y - ra.y) * ctx.height) +
            Math.max(Math.abs(rb.z - ra.z) * ctx.width, Math.abs(rb.w - ra.w) * ctx.height) / 2)
        const bands = bandCounts[k]!
        u.uBands!.value = bands
        const px = motionPx(s0, s1, bands) + morph
        u.uMotion!.value = px
        u.uWinMotion!.value = morph
        u.uSamples!.value = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(px / SAMPLE_SPACING)))
        u.uSeed!.value = seeds[k]
        u.uFlip!.value = k % 2 === 0 ? 1 : -1
      } else {
        u.uStyle!.value = -1
        u.uSamples!.value = 1
        u.uMotion!.value = 0
        u.uWinMotion!.value = 0
      }

      const offsets = u.uLineOffset!.value as number[]
      caption.lines.forEach((l, i) => (offsets[i] = l.offset))
      // Over full-bleed media the caption is white on a shade; over the ground (framed media) it is
      // ink that contrasts with the ground, unshaded. Both follow the window between slots.
      const onGround = (i: number) => (framed[i] ? 1 : 0)
      const toward = k >= 0 ? windowEase(u.uS0!.value * 0.5 + u.uS1!.value * 0.5) : 0
      const ground = onGround(from) + (onGround(to) - onGround(from)) * toward
      u.uDim!.value = p.shade * caption.dim.value * (1 - ground)
      ;(u.uCaptionColor!.value as THREE.Vector3).set(1, 1, 1).lerp(ink, ground)
      u.uNoise!.value = Math.floor(ctx.hash(frame, 7) * 1e6)

      // Clips play from the start of their incoming transition; hold the last frame after.
      for (let i = 0; i < n; i++) {
        if (!videos[i]) continue
        if (t < windowStart(i) || t > windowEnd(i)) continue
        const layer = ctx.video(i)
        layer.seek(Math.min(t - windowStart(i), layer.duration))
      }
    },

    render() {
      for (const v of videos) v?.sync()
      renderer.render(scene, camera)
    },

    dispose() {
      textures.forEach((t, i) => {
        t.dispose()
        // imageTexture() made a flipped copy of the bitmap; video frames belong to Pullup.
        if (!videos[i]) (t.image as ImageBitmap | null)?.close?.()
      })
      captionTexture?.dispose()
      material?.dispose()
      renderer?.dispose()
    },
  }
}

export default shaderTransition
