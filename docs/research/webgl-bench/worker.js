import * as THREE from '/node_modules/three/build/three.module.js'
import { gsap } from '/node_modules/gsap/index.js'
import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  Input,
  UrlSource,
  ALL_FORMATS,
  AudioBufferSource,
  VideoSampleSink,
} from '/node_modules/mediabunny/dist/bundles/mediabunny.mjs'

const q = new URLSearchParams(self.location.search)
const W = Number(q.get('w') || 1080)
const H = Number(q.get('h') || 1920)
const FPS = Number(q.get('fps') || 30)
const DUR = Number(q.get('dur') || 15)
const USE_VIDEO = q.get('video') === '1'
const USE_EL = q.get('video') === '2'
const PDB = q.get('pdb') === '1'
const MODE = q.get('mode') || 'encode' // encode | render
const BITRATE = Number(q.get('br') || 16e6)
const HW = q.get('hw') || 'prefer-hardware'
const CODEC_STR = q.get('cs') || undefined
const NAME = q.get('name') || 'out.mp4'
const USE_AUDIO = q.get('audio') === '1'

const log = (...a) => self.postMessage({ log: a.join(' ') })

async function probe() {
  const res = {}
  for (const codec of ['avc1.640028', 'avc1.64002a', 'avc1.4d0028', 'hvc1.1.6.L123.B0']) {
    for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software']) {
      try {
        const s = await VideoEncoder.isConfigSupported({
          codec,
          width: W,
          height: H,
          bitrate: BITRATE,
          framerate: FPS,
          hardwareAcceleration,
          avc: codec.startsWith('avc') ? { format: 'avc' } : undefined,
        })
        res[`${codec}/${hardwareAcceleration}`] = s.supported
      } catch (e) {
        res[`${codec}/${hardwareAcceleration}`] = 'err:' + e.message
      }
    }
  }
  try {
    const a = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128000,
    })
    res['aac mp4a.40.2'] = a.supported
  } catch (e) {
    res['aac mp4a.40.2'] = 'err:' + e.message
  }
  return res
}

function makeImageTexture(i) {
  const c = new OffscreenCanvas(1080, 1350)
  const g = c.getContext('2d')
  const grad = g.createLinearGradient(0, 0, 1080, 1350)
  const hues = [[20, 60], [200, 260], [300, 340]][i % 3]
  grad.addColorStop(0, `hsl(${hues[0]} 80% 55%)`)
  grad.addColorStop(1, `hsl(${hues[1]} 70% 25%)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 1080, 1350)
  g.fillStyle = 'rgba(255,255,255,0.9)'
  g.font = 'bold 160px Helvetica'
  g.fillText(`0${i + 1}`, 80, 1250)
  for (let k = 0; k < 40; k++) {
    g.strokeStyle = `rgba(255,255,255,${0.05 + (k % 5) * 0.03})`
    g.beginPath()
    g.arc(540, 500, 20 + k * 14, 0, Math.PI * 2)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const postVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`
const postFrag = /* glsl */ `
uniform sampler2D tScene;
uniform float uTime;
uniform float uProgress;
uniform float uSeed;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uSeed) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
void main(){
  float n = noise(vUv*6.0 + uTime*0.5);
  float d = sin(uProgress*3.14159) * 0.06;
  vec2 uv = vUv + vec2(n-0.5, noise(vUv*5.0-uTime*0.3)-0.5) * d;
  vec3 col;
  col.r = texture2D(tScene, uv + vec2(d*0.15,0.0)).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - vec2(d*0.15,0.0)).b;
  float grain = hash(vUv*vec2(1080.0,1920.0) + floor(uTime*30.0)) - 0.5;
  col += grain * 0.06;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

async function main() {
  const result = { W, H, FPS, DUR, USE_VIDEO, PDB, MODE, BITRATE, HW, CODEC_STR, ua: navigator.userAgent }
  result.probe = await probe()
  log('probe', JSON.stringify(result.probe))

  // --- deterministic GSAP: unhook from rAF
  gsap.ticker.remove(gsap.updateRoot)
  gsap.ticker.lagSmoothing(0)

  const canvas = new OffscreenCanvas(W, H)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: PDB,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(1)
  renderer.setSize(W, H, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const gl = renderer.getContext()
  const dbg = gl.getExtension('WEBGL_debug_renderer_info')
  result.glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  log('gl', result.glRenderer)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0b0b0b')
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 100)
  camera.position.set(0, 0, 8)

  const planes = []
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 3, 32, 32),
      new THREE.MeshBasicMaterial({ map: makeImageTexture(i), transparent: true }),
    )
    m.position.set((i - 1) * 0.6, (i - 1) * -0.4, -i * 1.5)
    m.rotation.y = (i - 1) * 0.25
    scene.add(m)
    planes.push(m)
  }

  // video plane via WebCodecs frames
  let videoTex = null
  let videoIter = null
  let lastFrame = null
  if (USE_VIDEO) {
    const input = new Input({ source: new UrlSource('/clip.mp4'), formats: ALL_FORMATS })
    const track = await input.getPrimaryVideoTrack()
    const clipDur = await track.computeDuration()
    const sink = new VideoSampleSink(track)
    const n = Math.round(DUR * FPS)
    const ts = Array.from({ length: n }, (_, i) => Math.min(i / FPS, clipDur - 1 / FPS))
    videoIter = sink.samplesAtTimestamps(ts)[Symbol.asyncIterator]()
    videoTex = new THREE.VideoFrameTexture()
    videoTex.colorSpace = THREE.SRGBColorSpace
    const vm = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 2.0 * (1920 / 1080)),
      new THREE.MeshBasicMaterial({ map: videoTex }),
    )
    vm.position.set(0.3, 0.2, 1.0)
    scene.add(vm)
    result.clipDur = clipDur
  }

  let vel = null
  let elTex = null
  if (USE_EL && typeof document !== 'undefined') {
    vel = document.createElement('video')
    vel.src = '/clip.mp4'
    vel.muted = true
    vel.playsInline = true
    vel.preload = 'auto'
    await new Promise((r) => vel.addEventListener('loadeddata', r, { once: true }))
    elTex = new THREE.VideoTexture(vel)
    elTex.colorSpace = THREE.SRGBColorSpace
    const vm = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 2.0 * (1920 / 1080)),
      new THREE.MeshBasicMaterial({ map: elTex }),
    )
    vm.position.set(0.3, 0.2, 1.0)
    scene.add(vm)
    result.clipDur = vel.duration
  }

  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace })
  const postScene = new THREE.Scene()
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const postMat = new THREE.ShaderMaterial({
    vertexShader: postVert,
    fragmentShader: postFrag,
    uniforms: {
      tScene: { value: rt.texture },
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uSeed: { value: 42 },
    },
  })
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat))

  // GSAP master timeline (paused) — seeked per frame
  const tl = gsap.timeline({ paused: true })
  tl.to(camera.position, { z: 5, x: 0.4, duration: DUR * 0.5, ease: 'power2.inOut' }, 0)
  tl.to(camera.position, { z: 3.5, x: -0.3, y: 0.3, duration: DUR * 0.5, ease: 'expo.inOut' }, DUR * 0.5)
  planes.forEach((p, i) => {
    tl.to(p.rotation, { y: -p.rotation.y, duration: DUR * 0.6, ease: 'sine.inOut' }, i * 0.4)
  })
  const prog = { v: 0 }
  tl.to(prog, { v: 1, duration: 1.2, ease: 'power3.inOut', repeat: Math.floor(DUR / 3) - 1, repeatDelay: 1.8 }, 0.5)

  const n = Math.round(DUR * FPS)
  let output = null
  let source = null
  if (MODE === 'encode') {
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
    source = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: BITRATE,
      keyFrameInterval: 1,
      latencyMode: 'quality',
      hardwareAcceleration: HW,
      fullCodecString: CODEC_STR,
    })
    output.addVideoTrack(source, { frameRate: FPS })
    let audioSource = null
    if (USE_AUDIO) {
      audioSource = new AudioBufferSource({ codec: 'aac', bitrate: 128000 })
      output.addAudioTrack(audioSource)
    }
    await output.start()
    if (audioSource) {
      const a0 = performance.now()
      const bytes = await (await fetch('/music.m4a')).arrayBuffer()
      const ctx = new OfflineAudioContext(2, Math.round(48000 * DUR), 48000)
      const decoded = await ctx.decodeAudioData(bytes)
      // trim + fade out last 0.5 s via offline render
      const src = ctx.createBufferSource()
      src.buffer = decoded
      const g = ctx.createGain()
      g.gain.setValueAtTime(1, Math.max(0, DUR - 0.5))
      g.gain.linearRampToValueAtTime(0, DUR)
      src.connect(g).connect(ctx.destination)
      src.start(0)
      const rendered = await ctx.startRendering()
      await audioSource.add(rendered)
      audioSource.close()
      result.audioMs = Math.round(performance.now() - a0)
    }
  }

  // warmup (shader compile)
  renderer.compile(scene, camera)
  renderer.compile(postScene, postCam)

  const t0 = performance.now()
  let videoWait = 0
  for (let i = 0; i < n; i++) {
    const t = i / FPS
    tl.seek(t, false)
    camera.lookAt(0, 0, 0)
    postMat.uniforms.uTime.value = t
    postMat.uniforms.uProgress.value = prog.v
    if (videoIter) {
      const v0 = performance.now()
      const { value: sample } = await videoIter.next()
      videoWait += performance.now() - v0
      if (sample) {
        const frame = sample.toVideoFrame()
        sample.close()
        videoTex.setFrame(frame)
        if (lastFrame) lastFrame.close()
        lastFrame = frame
      }
    }
    if (vel) {
      const v0 = performance.now()
      const target = Math.min(t, vel.duration - 1 / FPS) + 0.5 / FPS
      await new Promise((r) => {
        vel.addEventListener('seeked', r, { once: true })
        vel.currentTime = target
      })
      if (vel.requestVideoFrameCallback) {
        await new Promise((r) => { vel.requestVideoFrameCallback(() => r()); setTimeout(r, 100) })
      }
      videoWait += performance.now() - v0
      elTex.needsUpdate = true
    }
    renderer.setRenderTarget(rt)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    renderer.render(postScene, postCam)
    if (MODE === 'encode') {
      await source.add(t, 1 / FPS)
    } else {
      const f = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) })
      f.close()
    }
  }
  const tLoop = performance.now() - t0
  let size = 0
  let codecString = null
  if (MODE === 'encode') {
    const f0 = performance.now()
    await output.finalize()
    result.finalizeMs = Math.round(performance.now() - f0)
    const buf = output.target.buffer
    size = buf.byteLength
    codecString = await output.getMimeType?.()
    await fetch('/save?name=' + encodeURIComponent(NAME), { method: 'POST', body: buf })
  } else {
    // flush GPU
    gl.finish()
  }
  const total = performance.now() - t0
  Object.assign(result, {
    frames: n,
    loopMs: Math.round(tLoop),
    totalMs: Math.round(total),
    fps: +(n / (total / 1000)).toFixed(1),
    realtimeFactor: +(DUR / (total / 1000)).toFixed(2),
    videoWaitMs: Math.round(videoWait),
    sizeMB: +(size / 1e6).toFixed(2),
    mime: codecString,
  })
  log(JSON.stringify(result, null, 1))
  self.postMessage({ result })
}

main().catch((e) => {
  log('ERROR', e.stack || e.message)
  self.postMessage({ result: { error: String(e.stack || e) } })
})
