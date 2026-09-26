import * as THREE from 'three'
import type { TemplateContext } from '@shared/template.ts'
import type { BaseLayer, InkBox, LabelGround } from './base.ts'
import type { Rect } from './layout.ts'

// The base layer (_lib/base.ts) for three.js templates: the type — and, if asked, its legibility
// gradient — drawn with canvas 2D on a transparent layer (CPU-rasterised, so renders are
// reproducible), uploaded as an sRGB texture only when it changed, and composited over the frame
// as a screen-space quad. The look is identical to the 2D templates'.
//
//   setup():   base = await createBase(ctx);  overlay = createBaseOverlay(ctx, base, { scrim })
//   update(t): base.update(t)
//   render():  …your scene…;  overlay.render(renderer)      (autoClear off for that one draw)
//   dispose(): overlay.dispose()
//
// `scrim`: where the gradient darkens — 'frame' (everything under the type), a rect (only that
// area, e.g. the media), or null/undefined for none (darken your own layer with base.scrims and
// base.scrimLevel() in a shader instead — the grid does, so the background is never touched).
// `labels`: how much picture sits under each corner label this frame (base.ts LabelGround, read
// in sync() — so from state update(t) set): quiet on the plain ground, solid over a picture.
// Without it the labels are solid whenever the template has media.

export interface BaseOverlay {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  texture: THREE.CanvasTexture<OffscreenCanvas>
  // Redraws the layer when the type moved. render() calls it.
  sync(): void
  // sync() + draw the layer over what the renderer drew this frame.
  render(renderer: THREE.WebGLRenderer): void
  dispose(): void
}

export function createBaseOverlay(
  ctx: TemplateContext,
  base: BaseLayer,
  options: { scrim?: 'frame' | Rect | null; labels?: LabelGround } = {}
): BaseOverlay {
  const W = ctx.width
  const H = ctx.height
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const geometry = new THREE.PlaneGeometry(W, H)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(W / 2, H / 2, 0)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const camera = new THREE.OrthographicCamera(0, W, H, 0, -1, 1)
  const scrim = options.scrim ?? null
  // Rounded, so what's drawn is exactly what the key says (a redraw never depends on the frames
  // before it).
  const labels = options.labels
  const ground = labels && ((ink: InkBox) => Math.round(labels(ink) * 1000) / 1000)
  let key = ''

  const sync = () => {
    // The labels' ground is part of what's drawn: redraw when it changes.
    const under = ground ? base.labels.map((ink) => ground(ink)) : []
    const next = [base.stateKey(), ...under].join(',')
    if (next === key) return
    key = next
    g.clearRect(0, 0, W, H)
    if (scrim) base.drawScrim(g, scrim === 'frame' ? null : scrim)
    base.drawType(g, ground)
    texture.needsUpdate = true
  }

  return {
    scene,
    camera,
    texture,
    sync,
    render(renderer) {
      sync()
      const autoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.render(scene, camera)
      renderer.autoClear = autoClear
    },
    dispose() {
      texture.dispose()
      material.dispose()
      geometry.dispose()
      canvas.width = canvas.height = 0
    },
  }
}
