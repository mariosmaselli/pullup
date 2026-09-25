import * as THREE from 'three'
import type { TemplateFactory } from '@shared/template.ts'
import { drawLayout, STORY_TYPE } from '../_lib/text.ts'
import {
  coverScale,
  createRenderer,
  fullscreenScene,
  fullscreenVertex,
  imageTexture,
  videoTexture,
} from '../_lib/three.ts'

const fragment = /* glsl */ `
  uniform sampler2D uMedia;
  uniform sampler2D uCaption;
  uniform vec2 uCover;
  uniform float uZoom;
  uniform vec2 uDrift;
  uniform float uGrain;
  uniform float uNoise;
  uniform float uDim;
  uniform float uCaptionAlpha;
  uniform float uCaptionShift;
  varying vec2 vUv;

  float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uNoise * 91.7) * 43758.5453); }

  void main() {
    vec2 uv = (vUv - 0.5) * uCover / uZoom + 0.5 + uDrift;
    vec3 color = texture2D(uMedia, clamp(uv, 0.0, 1.0)).rgb;

    // Darken the bottom for caption legibility, fading in with the caption.
    float shade = smoothstep(0.55, 0.0, vUv.y) * uDim * uCaptionAlpha;
    color *= 1.0 - shade;

    vec4 caption = texture2D(uCaption, vUv + vec2(0.0, -uCaptionShift));
    color = mix(color, caption.rgb, caption.a * uCaptionAlpha);

    color += (rand(vUv * 1000.0) - 0.5) * uGrain;
    gl_FragColor = vec4(color, 1.0);
    // Textures are decoded to linear light; convert back to the sRGB output.
    #include <colorspace_fragment>
  }
`

const slowZoom: TemplateFactory = (ctx) => {
  const p = ctx.params as { zoom: number; drift: string; grain: number; dim: number }
  const media = ctx.media[0]!
  let renderer: THREE.WebGLRenderer
  let scene: THREE.Scene
  let camera: THREE.Camera
  let material: THREE.ShaderMaterial
  let video: ReturnType<typeof videoTexture> | null = null
  const motion = { zoom: 1, captionAlpha: 0, captionShift: 0.03 }

  return {
    async setup() {
      renderer = createRenderer(ctx)

      let texture: THREE.Texture
      if (media.kind === 'video') {
        video = videoTexture(ctx.video(0))
        texture = video.texture
      } else {
        texture = await imageTexture(await ctx.image(0))
      }

      // The caption is laid out and drawn once, into its own transparent canvas texture.
      const captionCanvas = new OffscreenCanvas(ctx.width, ctx.height)
      const caption = ctx.text.caption?.trim()
      if (caption) {
        await ctx.font('PP Neue Montreal')
        const g = captionCanvas.getContext('2d')!
        const size = STORY_TYPE.size * ctx.scale
        const side = STORY_TYPE.side * ctx.scale
        const layout = ctx.layoutText(caption, {
          family: 'PP Neue Montreal',
          size,
          lineHeight: STORY_TYPE.lineHeight,
          maxWidth: ctx.width - side * 2,
          letterSpacing: STORY_TYPE.tracking * size,
        })
        const top = ctx.height - STORY_TYPE.bottom * ctx.scale - layout.height
        drawLayout(g, layout, side, top, {
          color: '#ffffff',
          letterSpacing: STORY_TYPE.tracking * size,
        })
      }
      const captionTexture = new THREE.CanvasTexture(captionCanvas)
      captionTexture.colorSpace = THREE.SRGBColorSpace

      const drift = { None: [0, 0], Up: [0, 1], Down: [0, -1], Left: [-1, 0], Right: [1, 0] }[
        p.drift
      ] ?? [0, 0]

      material = new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex,
        fragmentShader: fragment,
        uniforms: {
          uMedia: { value: texture },
          uCaption: { value: captionTexture },
          uCover: { value: coverScale(media.width, media.height, ctx.width, ctx.height) },
          uZoom: { value: 1 },
          uDrift: { value: new THREE.Vector2() },
          uDriftDir: { value: new THREE.Vector2(drift[0], drift[1]) },
          uGrain: { value: p.grain },
          uNoise: { value: 0 },
          uDim: { value: caption ? p.dim : 0 },
          uCaptionAlpha: { value: 0 },
          uCaptionShift: { value: 0 },
        },
      })
      ;({ scene, camera } = fullscreenScene(material))

      // All motion lives on one paused timeline; Pullup seeks it to t every frame.
      const tl = ctx.timeline({ defaults: { ease: 'none' } })
      tl.to(motion, { zoom: 1 + p.zoom, duration: ctx.duration, ease: 'sine.inOut' }, 0)
      if (caption) {
        tl.to(motion, { captionAlpha: 1, captionShift: 0, duration: 0.9, ease: 'expo.out' }, 0.4)
      }

      renderer.compile(scene, camera)
    },

    update(t, frame) {
      const u = material.uniforms
      u.uZoom!.value = motion.zoom
      const progress = ctx.duration ? t / ctx.duration : 0
      const dir = u.uDriftDir!.value as THREE.Vector2
      ;(u.uDrift!.value as THREE.Vector2).set(dir.x * 0.03 * progress, dir.y * 0.03 * progress)
      u.uCaptionAlpha!.value = motion.captionAlpha
      u.uCaptionShift!.value = motion.captionShift
      u.uNoise!.value = ctx.hash(frame)
      if (media.kind === 'video') {
        const layer = ctx.video(0)
        layer.seek(Math.min(t, layer.duration))
      }
    },

    render() {
      video?.sync()
      renderer.render(scene, camera)
    },

    dispose() {
      material?.dispose()
      renderer?.dispose()
    },
  }
}

export default slowZoom
