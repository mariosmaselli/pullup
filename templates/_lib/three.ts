import * as THREE from 'three'
import type { TemplateContext, VideoLayer } from '@shared/template.ts'

// Shared Three.js helpers for templates.

export function createRenderer(ctx: TemplateContext) {
  const renderer = new THREE.WebGLRenderer({
    canvas: ctx.canvas,
    antialias: true,
    alpha: false, // output is always opaque (see the template contract)
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(1)
  renderer.setSize(ctx.width, ctx.height, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  return renderer
}

// A texture from an upright bitmap (ctx.image). WebGL ignores UNPACK_FLIP_Y for ImageBitmap, so
// the pixels are flipped once here instead — the texture then works with standard UVs.
export async function imageTexture(bitmap: ImageBitmap) {
  const flipped = await createImageBitmap(bitmap, { imageOrientation: 'flipY' })
  const texture = new THREE.Texture(flipped)
  texture.flipY = false
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

// A texture that follows a video layer. Call sync() in render() (after Pullup resolved frames).
export function videoTexture(layer: VideoLayer) {
  const texture = new THREE.VideoFrameTexture()
  texture.colorSpace = THREE.SRGBColorSpace
  let version = -1
  return {
    texture,
    sync() {
      if (layer.frame && layer.version !== version) {
        version = layer.version
        texture.setFrame(layer.frame)
      }
    },
  }
}

// UV scale that makes a (w×h) source "cover" a (W×H) frame, like CSS object-fit: cover.
export function coverScale(w: number, h: number, W: number, H: number) {
  const source = w / h
  const target = W / H
  return source > target
    ? new THREE.Vector2(target / source, 1)
    : new THREE.Vector2(1, source / target)
}

export const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// A 2×2 plane in clip space covering the frame, with an orthographic camera that never moves.
export function fullscreenScene(material: THREE.Material) {
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  return { scene, camera }
}
