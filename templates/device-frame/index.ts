import * as THREE from 'three'
import type { TemplateFactory, TextLayout } from '@shared/template.ts'
import { textLineX, textPlacement } from '../_lib/layout.ts'
import { STORY_TYPE } from '../_lib/text.ts'
import { createRenderer, imageTexture, videoTexture } from '../_lib/three.ts'
import {
  browser,
  laptop,
  phone,
  type Device,
  type DeviceName,
  type DeviceOptions,
} from './devices.ts'
import { studioEnvironment } from './textures.ts'

// ── Shaders ───────────────────────────────────────────────────────────────────────────────────

// The media on the device screen: cover or contain (letterboxed) inside the screen rectangle.
const screenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const screenFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uScale;
  uniform vec3 uFill;
  uniform float uDecode;
  varying vec2 vUv;
  void main() {
    vec2 uv = (vUv - 0.5) * uScale + 0.5;
    vec4 texel = texture2D(uMap, clamp(uv, 0.0, 1.0));
    // three.js uploads video frames without sRGB decoding (built-in materials decode them in
    // their shader), so a custom shader has to decode video samples itself. Images are decoded
    // by the GPU (SRGB8_ALPHA8) and must not be decoded twice.
    vec3 color = uDecode > 0.5 ? sRGBTransferEOTF(texel).rgb : texel.rgb;
    vec2 aa = max(fwidth(uv), vec2(1e-5));
    vec2 inside = smoothstep(-aa, aa, uv) * smoothstep(-aa, aa, 1.0 - uv);
    color = mix(uFill, color, inside.x * inside.y);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`

// Background: flat colour, a soft glow behind the device and a soft floor shadow under it.
// Mixed in sRGB (perceptual, like a design tool), dithered, then decoded for three's output.
const backgroundVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`
const backgroundFragment = /* glsl */ `
  uniform vec3 uBg;
  uniform vec3 uGlow;
  uniform float uGlowAmount;
  uniform vec2 uGlowCenter;
  uniform vec2 uGlowRadius;
  uniform vec3 uShadowColor;
  uniform vec2 uShadowCenter;
  uniform vec2 uShadowSize;
  uniform float uShadowAmount;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 toLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  void main() {
    vec2 p = vUv * uResolution;
    vec3 color = uBg;

    vec2 g = (p - uGlowCenter) / uGlowRadius;
    color = mix(color, uGlow, uGlowAmount * exp(-dot(g, g) * 2.2));

    vec2 s = (p - uShadowCenter) / uShadowSize;
    float shadow = exp(-(pow(abs(s.x), 3.0) + s.y * s.y) * 1.6);
    color = mix(color, uShadowColor, uShadowAmount * shadow);

    color += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(toLinear(clamp(color, 0.0, 1.0)), 1.0);
    #include <colorspace_fragment>
  }
`

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

const FINISHES = {
  // Metals reflect their base colour: keep it light enough to catch the studio lights.
  Graphite: {
    metal: '#7c7f85',
    roughness: 0.3,
    deck: '#6d7075',
    keys: '#101012',
    well: '#4c4e53',
    glass: '#060607',
    deckMetalness: 0.6,
  },
  Silver: {
    metal: '#e2e4e7',
    roughness: 0.3,
    deck: '#dcdee1',
    keys: '#1c1c1e',
    well: '#b5b7bb',
    glass: '#060607',
    deckMetalness: 0.3,
  },
}

const CHROMES = {
  Graphite: {
    bar: '#1d1d1f',
    pill: '#2d2d30',
    dot: '#4a4a4d',
    text: '#a5a5aa',
    line: '#0c0c0d',
    side: '#3a3a3d',
  },
  Silver: {
    bar: '#efeeea',
    pill: '#e0dfda',
    dot: '#c7c6c1',
    text: '#6d6d71',
    line: '#d6d5d0',
    side: '#c9c8c4',
  },
}

const srgb = (hex: string) => {
  const c = new THREE.Color()
  c.setStyle(hex, THREE.SRGBColorSpace)
  const out = { r: 0, g: 0, b: 0 }
  c.getRGB(out, THREE.SRGBColorSpace)
  return new THREE.Vector3(out.r, out.g, out.b)
}
const luminance = (v: THREE.Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

// Position 0 → lo, 0.5 → mid (exactly: the default placement), 1 → hi.
const between = (lo: number, mid: number, hi: number, f: number) =>
  f < 0.5 ? lo + (mid - lo) * f * 2 : mid + (hi - mid) * (f - 0.5) * 2

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Starts from rest (no first-frame jump), then settles with a long exponential tail like
// expo.out. Monotonic, 0 → 1.
const settleEase = (p: number) =>
  ((1 - Math.pow(2, -7.5 * p)) / (1 - Math.pow(2, -7.5))) * smooth(0, 0.3, p)

// Where the entrance starts, relative to the resting pose (design px; the device also starts
// tilted further, see device.start): lower and further back.
const ENTRY = { y: -90, z: -260 }

// ── Template ──────────────────────────────────────────────────────────────────────────────────

const deviceFrame: TemplateFactory = (ctx) => {
  const p = ctx.params as {
    device: DeviceName
    fit: 'Auto' | 'Fill' | 'Fit'
    finish: 'Graphite' | 'Silver'
    background: string
    accent: string
    glow: number
    tilt: 'Right' | 'Left' | 'Straight'
    float: number
  }
  const media = ctx.media[0]!
  const s = ctx.scale
  const DW = 1080
  const DH = ctx.height / s // design height (1920, 1350 or 1080)
  const story = ctx.aspect === '9:16'
  const { position, align } = textPlacement(ctx.params)
  // Device size and position: relative to the device fitted into the space the caption leaves.
  // (Not `size`: setup() has its own `size`, the caption's type size.)
  const deviceScale = num(ctx.params.deviceSize, 1, 0.5, 1.5)
  const fx = num(ctx.params.deviceX, 0.5, 0, 1)
  const fy = num(ctx.params.deviceY, 0.5, 0, 1)
  const custom = deviceScale !== 1 || fx !== 0.5 || fy !== 0.5

  let renderer: THREE.WebGLRenderer
  let env: THREE.WebGLRenderTarget
  let scene: THREE.Scene
  let camera: THREE.PerspectiveCamera
  let device: Device
  let screenMaterial: THREE.ShaderMaterial
  let mediaTexture: THREE.Texture
  let video: ReturnType<typeof videoTexture> | null = null
  let bgMaterial: THREE.ShaderMaterial
  let bg: { scene: THREE.Scene; camera: THREE.Camera }
  let overlay: { scene: THREE.Scene; camera: THREE.Camera } | null = null
  let captionCanvas: OffscreenCanvas | null = null
  let captionG: OffscreenCanvasRenderingContext2D | null = null
  let captionTexture: THREE.CanvasTexture<OffscreenCanvas> | null = null
  let captionLayout: TextLayout | null = null
  let captionX: number[] = [] // canvas px, x of each caption line
  let captionTop = 0 // canvas px, top of the caption canvas
  let captionPad = 0
  let captionKey = ''
  const disposables: { dispose(): void }[] = []

  const dir = p.tilt === 'Left' ? -1 : p.tilt === 'Straight' ? 0 : 1
  const pose = { rx: 0, ry: 0, y: 0, z: 0 }
  const lines: { p: number }[] = []
  const place = { x: 0, y: 0, k: 1 } // device resting position (world units = design px)
  const rest = { rx: 0, ry: 0 }
  const floatAmount = p.float
  let settle = 3.6
  // Local bounding box of the device (corners, for the floor shadow).
  const corners: THREE.Vector3[] = []
  let floorY = 0 // design px from the top
  let restBox = { x0: 0, x1: 0, y0: 0, y1: 0 }
  let shadowStrength = 0.6
  const tmp = new THREE.Vector3()

  const textColor = () => (luminance(srgb(p.background)) > 0.45 ? '#101010' : '#ffffff')

  // Projected bounds of the device in design px (x right, y down).
  function projectedBox() {
    device.root.updateMatrixWorld(true)
    const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    device.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const pos = mesh.geometry.attributes.position!
      const step = Math.max(1, Math.floor(pos.count / 1500))
      for (let i = 0; i < pos.count; i += step) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(camera)
        const x = ((tmp.x + 1) / 2) * DW
        const y = ((1 - tmp.y) / 2) * DH
        box.x0 = Math.min(box.x0, x)
        box.x1 = Math.max(box.x1, x)
        box.y0 = Math.min(box.y0, y)
        box.y1 = Math.max(box.y1, y)
      }
    })
    return box
  }

  function applyPose(t: number) {
    const f = floatAmount * smooth(0.2, settle, t)
    const w = (Math.PI * 2) / 6.4
    const fy = Math.sin(t * w) * 24 * f
    const frx = Math.sin(t * w * 0.8 + 1.3) * 0.03 * f
    const fry = Math.sin(t * w * 0.6 + 0.4) * 0.045 * f
    const root = device.root
    root.scale.setScalar(place.k)
    root.position.set(place.x, place.y + pose.y * place.k + fy * place.k, pose.z * place.k)
    root.rotation.set(pose.rx + frx, pose.ry + fry, 0, 'YXZ')
  }

  // Projected bounds at the first frame of the entrance — the device's lowest point.
  function entryBox() {
    const saved = { ...pose }
    pose.rx = device.start.rx
    pose.ry = device.start.ry * dir
    pose.y = ENTRY.y
    pose.z = ENTRY.z
    applyPose(0)
    const box = projectedBox()
    Object.assign(pose, saved)
    applyPose(0)
    return box
  }

  return {
    async setup() {
      renderer = createRenderer(ctx)
      renderer.autoClear = false
      const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      env = studioEnvironment(renderer)
      await ctx.font('PP Neue Montreal')

      // Media texture.
      let mediaW = media.width
      let mediaH = media.height
      if (media.kind === 'video') {
        const layer = ctx.video(0)
        mediaW = layer.width || mediaW
        mediaH = layer.height || mediaH
        video = videoTexture(layer)
        mediaTexture = video.texture
      } else {
        const bitmap = await ctx.image(0)
        mediaW = bitmap.width
        mediaH = bitmap.height
        mediaTexture = await imageTexture(bitmap)
      }
      // Screens show the media well below its size: mipmaps keep UI text and fine lines clean.
      mediaTexture.generateMipmaps = true
      mediaTexture.minFilter = THREE.LinearMipmapLinearFilter
      mediaTexture.anisotropy = anisotropy
      const mediaAspect = mediaW / Math.max(1, mediaH)

      screenMaterial = new THREE.ShaderMaterial({
        vertexShader: screenVertex,
        fragmentShader: screenFragment,
        uniforms: {
          uMap: { value: mediaTexture },
          uScale: { value: new THREE.Vector2(1, 1) },
          uFill: { value: new THREE.Color('#000000') },
          uDecode: { value: media.kind === 'video' ? 1 : 0 },
        },
      })

      const finishName = p.finish === 'Silver' ? 'Silver' : 'Graphite'
      const options: DeviceOptions = {
        screenMaterial,
        mediaAspect,
        finish: FINISHES[finishName],
        chrome: CHROMES[finishName],
        url: ctx.text.url ?? '',
        anisotropy,
      }
      device =
        p.device === 'Phone'
          ? phone(options)
          : p.device === 'Browser'
            ? await browser(options)
            : laptop(options)

      // Cover when the crop is small, otherwise contain (letterbox) — or as the user chose.
      const screenAspect = device.screen.width / device.screen.height
      const ratio = mediaAspect / screenAspect
      const crop = 1 - Math.min(ratio, 1 / ratio)
      const cover = p.fit === 'Fill' || (p.fit === 'Auto' && crop <= 0.2)
      ;(screenMaterial.uniforms.uScale!.value as THREE.Vector2).set(
        // uv = (screenUv - 0.5) * scale + 0.5. Cover crops the long side (scale < 1); contain
        // stretches the short side's range past 0..1 so the media fits with bars (scale > 1).
        cover ? Math.min(1, 1 / ratio) : Math.max(1, 1 / ratio),
        cover ? Math.min(1, ratio) : Math.max(1, ratio)
      )
      ;(screenMaterial.uniforms.uFill!.value as THREE.Color).set(device.fill)

      scene = new THREE.Scene()
      scene.environment = env.texture
      scene.environmentIntensity = 1
      scene.add(device.root)

      // A long lens: product-shot perspective, little distortion. World units = design px.
      const fov = 20
      const distance = DH / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2))
      camera = new THREE.PerspectiveCamera(fov, DW / DH, distance - 3000, distance + 3000)
      camera.position.set(0, 0, distance)
      camera.updateMatrixWorld()

      // Caption: Mario's story type, lines rising from a mask, placed by TEXT_POSITION_PARAMS.
      const caption = ctx.text.caption?.trim() ?? ''
      const size = STORY_TYPE.size * s
      const side = STORY_TYPE.side * s
      // Design px. Bottom keeps the last line box on this margin (Mario's story type); Top puts
      // the first line's cap top on it, like the caption card (_lib/caption.ts).
      const edge = story ? STORY_TYPE.bottom : STORY_TYPE.side + 8
      let capOffset = 0 // design px, line top → cap top
      let captionH = 0 // design px
      if (caption) {
        captionLayout = ctx.layoutText(caption, {
          family: 'PP Neue Montreal',
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: ctx.width - side * 2,
          letterSpacing: STORY_TYPE.tracking * size,
        })
        captionH = captionLayout.height / s
        captionX = captionLayout.lines.map((line) => textLineX(ctx.width, line.width, align, side))
        const measure = new OffscreenCanvas(8, 8).getContext('2d')!
        measure.font = captionLayout.font
        measure.letterSpacing = `${STORY_TYPE.tracking * size}px`
        measure.textBaseline = 'top'
        capOffset = -measure.measureText('H').actualBoundingBoxAscent / s
      }

      // Where the device rests: the space the caption leaves (or the whole frame), inside margins.
      // Caption at the bottom → device above it; at the top → device below it; Middle → caption
      // and device as one lockup centred on the frame, caption above (the device rises into place
      // from below, away from the type, and its floor shadow stays clear of it).
      const margin = story ? 48 : ctx.aspect === '4:5' ? 72 : 88
      const gap = story ? 150 : 96
      const spaceTop = story ? 200 : 84
      const spaceBottom = DH - (story ? 230 : 84)
      let captionPx = 0 // canvas px, top of the caption's first line box
      const region = { x0: margin, x1: DW - margin, y0: spaceTop, y1: spaceBottom }
      if (captionLayout && position === 'Bottom') {
        captionPx = ctx.height - edge * s - captionLayout.height
        region.y1 = captionPx / s - gap
      } else if (captionLayout) {
        captionPx = (edge - capOffset) * s
        region.y0 = captionPx / s + captionH + gap
      }
      region.y1 = Math.max(region.y0 + 200, region.y1)
      rest.rx = device.rest.rx
      rest.ry = device.rest.ry * dir
      pose.rx = rest.rx
      pose.ry = rest.ry
      pose.y = 0
      pose.z = 0
      // Fit iteratively (perspective makes the projected box depend on position and scale).
      const fit = () => {
        for (let i = 0; i < 4; i++) {
          applyPose(0)
          let box = projectedBox()
          place.k *= Math.min(
            (region.x1 - region.x0) / (box.x1 - box.x0),
            (region.y1 - region.y0) / (box.y1 - box.y0)
          )
          applyPose(0)
          box = projectedBox()
          place.x += (region.x0 + region.x1) / 2 - (box.x0 + box.x1) / 2
          place.y -= (region.y0 + region.y1) / 2 - (box.y0 + box.y1) / 2
        }
        applyPose(0)
        restBox = projectedBox()
      }
      // The entrance starts lower and tilted: when the device rests near the bottom edge (caption
      // at the top, or a tall device), raise the space's floor until the first frame clears it.
      const clearEntry = () => {
        for (let i = 0; i < 6; i++) {
          const over = entryBox().y1 - (DH - margin)
          if (over <= 0.5 || region.y1 <= region.y0 + 200) break
          region.y1 = Math.max(region.y0 + 200, region.y1 - over)
          fit()
        }
      }
      place.k = 1
      fit()
      clearEntry()
      // Device size scales the fitted device; Device left–right / top–bottom move it through the
      // space (margin to margin; the space the caption leaves). A device bigger than that runs off
      // the frame's edges — vertically always away from the caption, never into it.
      const width = (restBox.x1 - restBox.x0) * deviceScale
      const x0 = margin + (DW - margin * 2 - width) * fx
      if (captionLayout && position === 'Middle') {
        // Same device size as Top (× Device size); the lockup (cap top → device bottom) is
        // centred on the frame, never above the Top placement, nor so low that the device leaves
        // its space or its entrance leaves the frame. Device top–bottom moves the lockup.
        const h = (restBox.y1 - restBox.y0) * deviceScale
        const entry = (entryBox().y1 - restBox.y1) * deviceScale
        const floor = Math.min(spaceBottom, DH - margin - entry)
        const top = captionPx / s
        const lockup = captionH - capOffset + gap + h
        const low = floor - h - gap - captionH
        const mid = Math.max(top, Math.min(low, (DH - lockup) / 2 - capOffset))
        const y = between(top, mid, Math.max(mid, low), fy)
        captionPx = y * s
        region.y0 = y + captionH + gap
        region.y1 = region.y0 + h
        if (custom) {
          region.x0 = x0
          region.x1 = x0 + width
        }
        fit()
      } else if (custom) {
        const h = (restBox.y1 - restBox.y0) * deviceScale
        let { y0, y1 } = region
        if (captionLayout && position === 'Bottom') y0 = Math.min(y0, y1 - h)
        else if (captionLayout) y1 = Math.max(y1, y0 + h)
        const y = y0 + (y1 - y0 - h) * fy
        Object.assign(region, { x0, x1: x0 + width, y0: y, y1: y + h })
        fit()
        // The entrance starts lower: keep its first frame off a caption below.
        const over = captionLayout && position === 'Bottom' ? entryBox().y1 - captionPx / s : 0
        if (over > 0) {
          region.y0 -= over
          region.y1 -= over
          fit()
        }
      }
      floorY = restBox.y1 + (restBox.y1 - restBox.y0) * 0.05

      if (captionLayout) {
        captionPad = Math.ceil(size * 0.35)
        captionTop = Math.floor(captionPx - captionPad)
        captionCanvas = new OffscreenCanvas(
          ctx.width,
          Math.ceil(captionLayout.height + captionPad * 2)
        )
        // A transparent 2D layer: CPU-rasterised (willReadFrequently) so glyphs are exact.
        captionG = captionCanvas.getContext('2d', { willReadFrequently: true })!
        const texture = new THREE.CanvasTexture(captionCanvas)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.generateMipmaps = false
        captionTexture = texture
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(captionCanvas.width, captionCanvas.height),
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          })
        )
        plane.position.set(captionCanvas.width / 2, -(captionTop + captionCanvas.height / 2), 0)
        const oscene = new THREE.Scene()
        oscene.add(plane)
        disposables.push(plane.geometry, plane.material, texture)
        overlay = {
          scene: oscene,
          camera: new THREE.OrthographicCamera(0, ctx.width, 0, -ctx.height, -1, 1),
        }
        captionLayout.lines.forEach(() => lines.push({ p: 0 }))
      }

      // Local bounding-box corners for the shadow estimate each frame.
      const localBox = new THREE.Box3()
      device.root.updateMatrixWorld(true)
      const inverse = device.root.matrixWorld.clone().invert()
      device.root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.computeBoundingBox()
        const b = mesh.geometry.boundingBox!.clone()
        b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld))
        localBox.union(b)
      })
      for (let i = 0; i < 8; i++) {
        corners.push(
          new THREE.Vector3(
            i & 1 ? localBox.max.x : localBox.min.x,
            i & 2 ? localBox.max.y : localBox.min.y,
            i & 4 ? localBox.max.z : localBox.min.z
          )
        )
      }

      // Background.
      const bgColor = srgb(p.background)
      const dark = luminance(bgColor) < 0.45
      bgMaterial = new THREE.ShaderMaterial({
        vertexShader: backgroundVertex,
        fragmentShader: backgroundFragment,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uBg: { value: bgColor },
          uGlow: { value: srgb(p.accent) },
          uGlowAmount: { value: p.glow * (dark ? 0.12 : 0.35) },
          uGlowCenter: { value: new THREE.Vector2() },
          uGlowRadius: { value: new THREE.Vector2() },
          uShadowColor: { value: dark ? new THREE.Vector3(0, 0, 0) : srgb('#6b6962') },
          uShadowCenter: { value: new THREE.Vector2() },
          uShadowSize: { value: new THREE.Vector2(1, 1) },
          uShadowAmount: { value: 0 },
          uResolution: { value: new THREE.Vector2(ctx.width, ctx.height) },
        },
      })
      shadowStrength = dark ? 0.6 : 0.32
      const bgScene = new THREE.Scene()
      const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMaterial)
      bgMesh.frustumCulled = false
      bgScene.add(bgMesh)
      disposables.push(bgMesh.geometry)
      bg = { scene: bgScene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
      const cxd = (restBox.x0 + restBox.x1) / 2
      const cyd = (restBox.y0 + restBox.y1) / 2
      ;(bgMaterial.uniforms.uGlowCenter!.value as THREE.Vector2).set(cxd * s, (DH - cyd) * s)
      const rw = restBox.x1 - restBox.x0
      const rh = restBox.y1 - restBox.y0
      ;(bgMaterial.uniforms.uGlowRadius!.value as THREE.Vector2).set(
        Math.max(rw, rh) * 0.95 * s,
        Math.max(rw, rh) * 0.95 * s
      )

      // Motion: one paused timeline, seeked by Pullup.
      settle = Math.min(4.2, ctx.duration * 0.8)
      const start = device.start
      pose.rx = start.rx
      pose.ry = start.ry * dir
      pose.y = ENTRY.y
      pose.z = ENTRY.z
      const tl = ctx.timeline()
      tl.to(pose, { rx: rest.rx, ry: rest.ry, duration: settle, ease: settleEase }, 0)
      tl.to(pose, { y: 0, z: 0, duration: settle * 0.85, ease: settleEase }, 0)
      lines.forEach((line, i) => {
        tl.to(line, { p: 1, duration: 1.3, ease: 'expo.out' }, 0.5 + i * 0.09)
      })

      renderer.compile(scene, camera)
      renderer.compile(bg.scene, bg.camera)
      if (overlay) renderer.compile(overlay.scene, overlay.camera)
    },

    update(t) {
      applyPose(t)

      // Floor shadow: under the device's current footprint; softer and lighter as it lifts.
      device.root.updateMatrixWorld(true)
      let x0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const c of corners) {
        tmp.copy(c).applyMatrix4(device.root.matrixWorld).project(camera)
        x0 = Math.min(x0, ((tmp.x + 1) / 2) * DW)
        x1 = Math.max(x1, ((tmp.x + 1) / 2) * DW)
        y1 = Math.max(y1, ((1 - tmp.y) / 2) * DH)
      }
      const rh = restBox.y1 - restBox.y0
      const lift = Math.max(0, floorY - y1) / rh // 0 when resting on the floor line
      const u = bgMaterial.uniforms
      const width = (x1 - x0) * (0.42 + lift * 0.3)
      ;(u.uShadowCenter!.value as THREE.Vector2).set(((x0 + x1) / 2) * s, (DH - floorY) * s)
      ;(u.uShadowSize!.value as THREE.Vector2).set(width * s, rh * (0.045 + lift * 0.08) * s)
      u.uShadowAmount!.value = shadowStrength / (1 + lift * 5)

      if (media.kind === 'video') {
        const layer = ctx.video(0)
        layer.seek(Math.min(t, layer.duration))
      }
    },

    render() {
      video?.sync()

      // Caption: redraw only when a line moved.
      if (captionG && captionLayout && captionCanvas && captionTexture) {
        const key = lines.map((l) => l.p.toFixed(4)).join(',')
        if (key !== captionKey) {
          captionKey = key
          const g = captionG
          const layout = captionLayout
          const size = layout.size
          g.clearRect(0, 0, captionCanvas.width, captionCanvas.height)
          g.font = layout.font
          g.letterSpacing = `${STORY_TYPE.tracking * size}px`
          g.textBaseline = 'top'
          g.fillStyle = textColor()
          layout.lines.forEach((line, li) => {
            const pr = lines[li]?.p ?? 1
            if (pr <= 0) return
            const top = captionPad + line.y
            g.save()
            g.beginPath()
            g.rect(0, top - size * 0.12, captionCanvas!.width, layout.lineHeight + size * 0.34)
            g.clip()
            g.globalAlpha = Math.min(1, pr * 1.6)
            const dy = (1 - pr) * size * 1.25
            const x = captionX[li]!
            line.words.forEach((word) => g.fillText(word.text, x + word.x, top + dy))
            g.restore()
          })
          captionTexture.needsUpdate = true
        }
      }

      renderer.setRenderTarget(null)
      renderer.clear(true, true, true)
      renderer.render(bg.scene, bg.camera)
      renderer.clearDepth()
      renderer.render(scene, camera)
      if (overlay) renderer.render(overlay.scene, overlay.camera)
    },

    dispose() {
      device?.dispose()
      screenMaterial?.dispose()
      if (mediaTexture?.image instanceof ImageBitmap) mediaTexture.image.close()
      mediaTexture?.dispose()
      bgMaterial?.dispose()
      disposables.forEach((d) => d.dispose())
      env?.dispose()
      renderer?.dispose()
    },
  }
}

export default deviceFrame
