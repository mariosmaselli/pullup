import * as THREE from 'three'
import type { TemplateFactory, TextLayout } from '@shared/template.ts'
import { STORY_TYPE } from '../_lib/text.ts'
import { coverScale, createRenderer, imageTexture, videoTexture } from '../_lib/three.ts'
import { CaptionOverlay } from './caption.ts'
import { roundedRect, shadowTexture } from './geometry.ts'
import {
  dwell,
  lerp,
  planeSize,
  smoothstep,
  stackLayout,
  travel,
  travelTime,
  zigzag,
  type Arrangement,
  type PlaneSpec,
} from './layout.ts'

// Horizontal field of view (same for every aspect; 9:16 simply sees more above and below).
const HFOV = (40 * Math.PI) / 180
const TAN_H = Math.tan(HFOV / 2)
// Zigzag: camera distance in front of the first plane at t = 0 (world units).
const START_DISTANCE = 2.6
// Design px kept between a framed plane and the caption.
const CAPTION_GAP = 120
// How far above the caption the background-coloured scrim begins (design px).
const SCRIM_RISE = 100
// Stack: how much the camera slows at each plane (0 = constant glide, <1).
const DWELL = 0.6

interface Params {
  background: string
  arrangement: Arrangement
  fog: number
  corners: number
  shadow: number
  drift: number
  captionIn: 'At start' | 'On arrival'
}

interface Plane {
  spec: PlaneSpec
  group: THREE.Group
  final: boolean
  // Texture LOD bias: planes soften slightly while they rush past (reads as motion blur and keeps
  // the encoder's peak bitrate in check), and are pin-sharp when framed or settled.
  bias: { value: number }
}

interface Framing {
  // Design px per world unit when framed, the box centre (design px) and the camera distance.
  ppu: number
  cy: number
  distance: number
}

const planes3d: TemplateFactory = (ctx) => {
  const p = ctx.params as unknown as Params
  const s = ctx.scale
  const DW = 1080
  const DH = ctx.height / s
  const tall = DH / DW
  const tanV = (TAN_H * DH) / DW
  const n = ctx.media.length
  const stack = p.arrangement === 'Stack'

  let renderer: THREE.WebGLRenderer
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let overlay: CaptionOverlay | null = null
  const planes: Plane[] = []
  const videos: ReturnType<typeof videoTexture>[] = []
  const disposables: { dispose(): void }[] = []
  const bitmaps: ImageBitmap[] = [] // flipped copies made by imageTexture()

  // Camera path (filled in setup): through the stations (Stack) or start → end (Zigzag).
  let stackPoint: ((s: number, out: THREE.Vector3) => THREE.Vector3) | null = null
  const line = { from: new THREE.Vector3(), to: new THREE.Vector3() }
  // Zigzag: the camera opens aimed at the first plane and pans back down the corridor.
  const aim = { yaw: 0, pitch: 0 }
  const phases: number[] = []
  const at = new THREE.Vector3()
  const ahead = new THREE.Vector3()

  // Tweened by the timeline (Pullup seeks it to t).
  const reveal: { v: number }[] = []
  const scrim = { v: 0 }

  // Camera position along the path (no drift) for u = t / duration.
  const pathPoint = (u: number, out: THREE.Vector3) => {
    const k = travel(u)
    if (stackPoint) return stackPoint(dwell(k * (n - 1), DWELL), out)
    const blend = k * k * (3 - 2 * k) // x/y ease into the settle a little later than z
    return out.set(
      lerp(line.from.x, line.to.x, blend),
      lerp(line.from.y, line.to.y, blend),
      lerp(line.from.z, line.to.z, k)
    )
  }

  return {
    async setup() {
      renderer = createRenderer(ctx)
      const background = new THREE.Color(p.background)
      renderer.setClearColor(background, 1)
      scene = new THREE.Scene()
      const light = luminance(background) > 0.25

      // ── Caption layout first: it decides where planes may be framed ─────────────────────
      const caption = ctx.text.caption?.trim() ?? ''
      let layout: TextLayout | null = null
      let captionTop = 0 // canvas px
      const side = STORY_TYPE.side * s
      const bottom = (ctx.aspect === '9:16' ? STORY_TYPE.bottom : 56) * s
      if (caption) {
        await ctx.font('PP Neue Montreal')
        const size = STORY_TYPE.size * s
        layout = ctx.layoutText(caption, {
          family: 'PP Neue Montreal',
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: ctx.width - side * 2,
          letterSpacing: STORY_TYPE.tracking * size,
        })
        captionTop = ctx.height - bottom - layout.height
      }

      // ── Media → textures and plane sizes ────────────────────────────────────────────────
      const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      const sources: { texture: THREE.Texture; w: number; h: number }[] = []
      for (let i = 0; i < n; i++) {
        const media = ctx.media[i]!
        if (media.kind === 'video') {
          const layer = ctx.video(i)
          const video = videoTexture(layer)
          video.texture.generateMipmaps = true
          video.texture.minFilter = THREE.LinearMipmapLinearFilter
          video.texture.anisotropy = maxAniso
          videos.push(video)
          sources.push({ texture: video.texture, w: layer.width, h: layer.height })
        } else {
          const bitmap = await ctx.image(i)
          const texture = await imageTexture(bitmap)
          texture.anisotropy = maxAniso
          bitmaps.push(texture.image as ImageBitmap)
          sources.push({ texture, w: bitmap.width, h: bitmap.height })
        }
      }
      const sizes = sources.map((m) => planeSize(m.w / m.h))

      // ── Framing: a plane fits the box on the 40 px grid (full width minus margins, above
      //    the caption), centred in the frame unless the caption pushes it up ───────────────
      const margin = STORY_TYPE.side
      const boxTop = ctx.aspect === '9:16' ? STORY_TYPE.bottom : margin
      let boxBottom = DH - boxTop
      if (layout) boxBottom = Math.min(boxBottom, captionTop / s - CAPTION_GAP)
      const framing = ({ w, h }: { w: number; h: number }): Framing => {
        const ppu = Math.min((DW - margin * 2) / w, (boxBottom - boxTop) / h)
        const plateH = h * ppu
        let cy = DH / 2
        cy = Math.min(cy, boxBottom - plateH / 2)
        cy = Math.max(cy, boxTop + plateH / 2)
        return { ppu, cy, distance: DW / (2 * TAN_H * ppu) }
      }
      const frames = sizes.map(framing)
      // Camera position that frames a plane centred at (x, y, z).
      const station = (f: Framing, x: number, y: number, z: number) =>
        new THREE.Vector3(x, y + (1 - (2 * f.cy) / DH) * -f.distance * tanV, z + f.distance)

      // ── Plane positions + camera path ───────────────────────────────────────────────────
      const last = sizes[n - 1]!
      const lastFrame = frames[n - 1]!
      let specs: PlaneSpec[]
      let gap: number
      if (stack) {
        const plan = stackLayout(
          sizes,
          frames.map((f) => ({ distance: f.distance, offset: station(f, 0, 0, 0).y })),
          ctx.random
        )
        ;({ specs, gap } = plan)
        stackPoint = plan.point
      } else {
        // Depth between passed planes: roomier when there is time, tighter when many planes
        // share a short clip (keeps the cruise speed sensible).
        const passes = Math.max(1, n - 2)
        gap = Math.min(2.4, Math.max(1.5, (1.3 * ctx.duration - START_DISTANCE - 1.1) / passes))
        const passers = zigzag(sizes.slice(0, -1), gap, tall, ctx.random)
        const finalZ = passers.at(-1)!.z - Math.max(gap, lastFrame.distance + 1.1)
        specs = [
          ...passers,
          { w: last.w, h: last.h, x: 0, y: 0, z: finalZ, rx: 0, ry: 0, rz: 0, phase: 0 },
        ]
        // Start slightly off-axis, away from the first plane, looking most of the way toward it.
        const first = passers[0]!
        line.from.set(-first.x * 0.12, -first.y * 0.12, START_DISTANCE)
        line.to.copy(station(lastFrame, 0, 0, finalZ))
        const dz = line.from.z - first.z
        aim.yaw = -Math.atan((first.x - line.from.x) / dz) * 0.65
        aim.pitch = Math.atan((first.y - line.from.y) / dz) * 0.65
      }
      for (let k = 0; k < 6; k++) phases.push(ctx.random() * Math.PI * 2)

      // ── Meshes ──────────────────────────────────────────────────────────────────────────
      const shadowPad = 0.16
      const shadowColor = background.clone().multiplyScalar(light ? 0.35 : 0)
      specs.forEach((spec, i) => {
        const source = sources[i]!
        const texture = source.texture
        const cover = coverScale(source.w, source.h, spec.w, spec.h)
        texture.repeat.copy(cover)
        texture.offset.set((1 - cover.x) / 2, (1 - cover.y) / 2)
        const final = i === n - 1
        // Corner radius in px as seen when the plane is framed.
        const radius = p.corners / frames[i]!.ppu

        const group = new THREE.Group()
        const geometry = roundedRect(spec.w, spec.h, radius)
        const bias = { value: 0 }
        const material = new THREE.MeshBasicMaterial({ map: texture })
        // Same built-in shader (sRGB, fog, video decode untouched), plus a LOD bias on the map.
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uLodBias = bias
          shader.fragmentShader =
            'uniform float uLodBias;\n' +
            shader.fragmentShader.replace(
              '#include <map_fragment>',
              THREE.ShaderChunk.map_fragment.replace(
                'texture2D( map, vMapUv )',
                'texture2D( map, vMapUv, uLodBias )'
              )
            )
        }
        group.add(new THREE.Mesh(geometry, material))
        disposables.push(geometry, material, texture)

        if (p.shadow > 0) {
          const alpha = shadowTexture(spec.w, spec.h, radius, shadowPad)
          const shadowGeometry = new THREE.PlaneGeometry(
            spec.w + shadowPad * 2,
            spec.h + shadowPad * 2
          )
          const shadowMaterial = new THREE.MeshBasicMaterial({
            color: shadowColor,
            alphaMap: alpha,
            transparent: true,
            opacity: p.shadow * (light ? 0.45 : 0.8),
            depthWrite: false,
          })
          const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial)
          shadow.position.set(0, -spec.h * 0.035, -0.04)
          group.add(shadow)
          disposables.push(alpha, shadowGeometry, shadowMaterial)
        }

        group.position.set(spec.x, spec.y, spec.z)
        group.rotation.set(spec.rx, spec.ry, spec.rz)
        scene.add(group)
        planes.push({ spec, group, final, bias })
      })

      // Fog in the background colour: planes a few gaps away dissolve into it, the last one
      // emerges as the camera approaches, and a framed plane is never fogged.
      if (p.fog > 0) {
        const near = Math.max(...frames.map((f) => f.distance)) + 0.2
        const far = near + gap * (1.6 + 10 * (1 - p.fog) ** 2)
        scene.fog = new THREE.Fog(background, near, far)
      }

      camera = new THREE.PerspectiveCamera(
        (2 * Math.atan(tanV) * 180) / Math.PI,
        ctx.width / ctx.height,
        0.05,
        200
      )
      camera.rotation.order = 'YXZ'

      // ── Caption overlay + reveal timeline ───────────────────────────────────────────────
      if (layout) {
        const scrimFrom = captionTop - SCRIM_RISE * s
        overlay = new CaptionOverlay(layout, {
          width: ctx.width,
          height: ctx.height,
          bandTop: Math.floor(Math.min(scrimFrom, captionTop - layout.size * 0.25)),
          x: side,
          top: captionTop,
          letterSpacing: STORY_TYPE.tracking * layout.size,
          color: light ? '#101010' : '#ffffff',
          scrimColor: p.background,
          scrimAlpha: 0.82,
          scrimFrom,
          scrimTo: captionTop + layout.lineHeight * 0.4,
        })
        const start =
          p.captionIn === 'On arrival'
            ? Math.max(0.35, ctx.duration * travelTime(stack ? 1 - 0.4 / (n - 1) : 0.9))
            : 0.35
        const tl = ctx.timeline()
        tl.to(scrim, { v: 1, duration: 0.9, ease: 'power2.out' }, Math.max(0, start - 0.25))
        layout.lines.forEach((_, i) => {
          const r = { v: 0 }
          reveal.push(r)
          tl.to(r, { v: 1, duration: 1.1, ease: 'expo.out' }, start + i * 0.09)
        })
      }

      renderer.compile(scene, camera)
    },

    update(t) {
      const u = ctx.duration ? t / ctx.duration : 1
      const k = travel(u)
      // Drift fades out as the camera settles, so the last frames sit exactly on the grid; in the
      // stack it also fades out at every station, so each plane lands exactly on the grid.
      const settle = Math.pow(1 - k, 1.3)
      const lock = stack ? Math.sin(Math.PI * k * (n - 1)) ** 2 : 1
      const env = settle * lock * p.drift
      const wave = (period: number, i: number) => Math.sin((2 * Math.PI * t) / period + phases[i]!)

      pathPoint(u, at)
      camera.position.set(
        at.x + 0.08 * env * wave(7.3, 0),
        at.y + 0.05 * tall * env * wave(9.1, 1),
        at.z
      )
      const pan = 1 - smoothstep(0, 0.3, k)
      camera.rotation.set(
        aim.pitch * pan + 0.035 * env * wave(8.3, 2),
        aim.yaw * pan + 0.055 * env * wave(10.7, 3),
        0.035 * env * wave(12.1, 4) // roll
      )

      // Camera speed (world units per second), from the path one frame ahead.
      const dt = 1 / ctx.fps
      pathPoint(Math.min(1, u + dt / Math.max(ctx.duration, dt)), ahead)
      const speed = ahead.distanceTo(at) / dt

      for (const plane of planes) {
        const { spec, group } = plane
        const float = plane.final ? settle : 1
        group.position.y = spec.y + 0.014 * float * Math.sin((2 * Math.PI * t) / 6.4 + spec.phase)
        group.rotation.z = spec.rz + 0.006 * float * Math.sin((2 * Math.PI * t) / 8.2 + spec.phase)
        // How fast the plane grows on screen (1/s): ~0.3 while a plane is framed, 1.5+ mid-pass.
        const rate = speed / Math.max(0.5, camera.position.z - spec.z)
        plane.bias.value = Math.min(1.4, Math.max(0, (rate - 0.25) * 1.3))
      }

      ctx.media.forEach((media, i) => {
        if (media.kind !== 'video') return
        const layer = ctx.video(i)
        layer.seek(Math.min(t, layer.duration))
      })
    },

    render() {
      for (const video of videos) video.sync()
      renderer.autoClear = true
      renderer.render(scene, camera)
      if (overlay) {
        overlay.draw(
          reveal.map((r) => r.v),
          scrim.v
        )
        renderer.autoClear = false
        renderer.render(overlay.scene, overlay.camera)
        renderer.autoClear = true
      }
    },

    dispose() {
      disposables.forEach((d) => d.dispose())
      bitmaps.forEach((b) => b.close())
      overlay?.dispose()
      renderer?.dispose()
    },
  }
}

// Relative luminance (linear working space) — picks white or near-black caption type.
function luminance(c: THREE.Color) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

export default planes3d
