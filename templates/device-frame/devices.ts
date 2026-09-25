import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { roundedPlane, slab } from './geometry.ts'
import { browserBarTexture, deckTexture, type Chrome, type Finish } from './textures.ts'

// Procedural devices, all built 1000 units wide (the template scales them to fit the frame).
// Each returns a pivot group to animate, the screen's size (for cover/contain) and its poses.

export type DeviceName = 'Laptop' | 'Browser' | 'Phone'

export interface Pose {
  rx: number
  ry: number
}

export interface Device {
  root: THREE.Group
  screen: { width: number; height: number }
  rest: Pose
  start: Pose
  // Letterbox colour inside the screen (sRGB hex).
  fill: string
  dispose(): void
}

export interface DeviceOptions {
  screenMaterial: THREE.Material
  mediaAspect: number
  finish: Finish & { glass: string; roughness: number; deckMetalness: number }
  chrome: Chrome & { side: string }
  url: string
  anisotropy: number
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

function track() {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []
  return {
    g<T extends THREE.BufferGeometry>(x: T) {
      geometries.push(x)
      return x
    },
    m<T extends THREE.Material>(x: T) {
      materials.push(x)
      return x
    },
    t<T extends THREE.Texture>(x: T) {
      textures.push(x)
      return x
    },
    dispose() {
      geometries.forEach((x) => x.dispose())
      materials.forEach((x) => x.dispose())
      textures.forEach((x) => x.dispose())
    },
  }
}

function metalMaterial(o: DeviceOptions) {
  return new THREE.MeshStandardMaterial({
    color: o.finish.metal,
    metalness: 1,
    roughness: o.finish.roughness,
  })
}

function glassMaterial(o: DeviceOptions) {
  return new THREE.MeshPhysicalMaterial({
    color: o.finish.glass,
    metalness: 0,
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  })
}

// ── Laptop ─────────────────────────────────────────────────────────────────────────────────────
export function laptop(o: DeviceOptions): Device {
  const r = track()
  const aspect = clamp(o.mediaAspect, 1.45, 1.8)
  const LW = 1000
  const side = 21
  const top = 27
  const chin = 34
  const sw = LW - side * 2
  const sh = sw / aspect
  const LH = sh + top + chin
  const LT = 12
  const LEAN = 0.2 // lid opened a little past 90°

  const metal = r.m(metalMaterial(o))
  const glass = r.m(glassMaterial(o))

  const root = new THREE.Group()
  const inner = new THREE.Group()
  root.add(inner)

  // Lid, hinged at the back edge of the base and leaning back a touch.
  const hinge = new THREE.Group()
  hinge.position.set(0, 1, 0)
  hinge.rotation.x = -LEAN
  inner.add(hinge)
  const lid = new THREE.Mesh(r.g(slab(LW, LH, [32, 32, 12, 12], LT, 4.5)), [glass, metal])
  lid.position.set(0, LH / 2, LT / 2)
  hinge.add(lid)

  const screen = new THREE.Mesh(r.g(roundedPlane(sw, sh, [11, 11, 4, 4])), o.screenMaterial)
  screen.position.set(0, chin + sh / 2, LT + 0.6)
  hinge.add(screen)

  const camera = new THREE.Mesh(
    r.g(new THREE.CircleGeometry(3.4, 24)),
    r.m(new THREE.MeshBasicMaterial({ color: '#1c1d20' }))
  )
  camera.position.set(0, LH - top / 2, LT + 0.5)
  hinge.add(camera)

  // Base: a slab lying flat, its top face the keyboard deck (texture: hinge at the top edge).
  const BD = LH * 0.9
  const BT = 17
  const baseGeometry = r.g(slab(LW, BD, [10, 10, 36, 36], BT, 6))
  baseGeometry.rotateX(-Math.PI / 2)
  const deck = r.m(
    new THREE.MeshStandardMaterial({
      map: r.t(deckTexture(LW / BD, o.finish, o.anisotropy)),
      metalness: o.finish.deckMetalness,
      roughness: o.finish.roughness + 0.14,
    })
  )
  const base = new THREE.Mesh(baseGeometry, [deck, metal])
  base.position.set(0, -BT / 2, BD / 2)
  inner.add(base)

  // Pivot near the screen centre, a little forward, so the tilt swings around the picture.
  inner.position.set(0, -LH * 0.45, -BD * 0.12)

  return {
    root,
    screen: { width: sw, height: sh },
    // Tilting the top towards the camera by the lid's lean shows the deck from above while the
    // screen faces the lens squarely.
    rest: { rx: LEAN, ry: 0.14 },
    start: { rx: LEAN + 0.3, ry: 0.38 },
    fill: '#000000',
    dispose: r.dispose,
  }
}

// ── Browser window ────────────────────────────────────────────────────────────────────────────
export async function browser(o: DeviceOptions): Promise<Device> {
  const r = track()
  const aspect = clamp(o.mediaAspect, 0.75, 2.2)
  const W = 1000
  const rim = 3
  const radius = 17
  const bar = 46
  const cw = W - rim * 2
  const ch = cw / aspect
  const H = bar + ch + rim * 2
  const depth = 9

  const root = new THREE.Group()
  const frameCap = r.m(
    new THREE.MeshStandardMaterial({ color: o.chrome.bar, metalness: 0, roughness: 0.55 })
  )
  const frameSide = r.m(
    new THREE.MeshStandardMaterial({ color: o.chrome.side, metalness: 0.6, roughness: 0.35 })
  )
  const body = new THREE.Mesh(r.g(slab(W, H, radius, depth, rim)), [frameCap, frameSide])
  root.add(body)

  const barTexture = r.t(await browserBarTexture(cw, bar, o.chrome, o.url, o.anisotropy))
  const barMesh = new THREE.Mesh(
    r.g(roundedPlane(cw, bar, [radius - rim, radius - rim, 0, 0])),
    r.m(new THREE.MeshBasicMaterial({ map: barTexture, toneMapped: false }))
  )
  barMesh.position.set(0, H / 2 - rim - bar / 2, depth / 2 + 0.5)
  root.add(barMesh)

  const screen = new THREE.Mesh(
    r.g(roundedPlane(cw, ch, [0, 0, radius - rim, radius - rim])),
    o.screenMaterial
  )
  screen.position.set(0, -H / 2 + rim + ch / 2, depth / 2 + 0.5)
  root.add(screen)

  return {
    root,
    screen: { width: cw, height: ch },
    rest: { rx: 0.05, ry: 0.13 },
    start: { rx: 0.3, ry: 0.46 },
    fill: o.chrome.bar,
    dispose: r.dispose,
  }
}

// ── Phone ─────────────────────────────────────────────────────────────────────────────────────
export function phone(o: DeviceOptions): Device {
  const r = track()
  const W = 1000
  const edge = 24 // rounded metal edge seen from the front
  const border = 18 // black glass around the display
  const sw = W - (edge + border) * 2
  const sh = sw * (19.5 / 9)
  const H = sh + (edge + border) * 2
  const radius = 165
  const depth = 100

  const metal = r.m(metalMaterial(o))
  const glass = r.m(glassMaterial(o))
  const root = new THREE.Group()
  root.add(new THREE.Mesh(r.g(slab(W, H, radius, depth, edge)), [glass, metal]))

  const screen = new THREE.Mesh(
    r.g(roundedPlane(sw, sh, radius - edge - border, 20)),
    o.screenMaterial
  )
  screen.position.set(0, 0, depth / 2 + 0.6)
  root.add(screen)

  // Dynamic island.
  const island = new THREE.Mesh(
    r.g(roundedPlane(sw * 0.3, 84, 42, 16)),
    r.m(new THREE.MeshBasicMaterial({ color: '#000000' }))
  )
  island.position.set(0, sh / 2 - 34 - 42, depth / 2 + 1.2)
  root.add(island)

  // Side buttons.
  const button = (x: number, yFromTop: number, length: number) => {
    const mesh = new THREE.Mesh(r.g(new RoundedBoxGeometry(16, length, depth * 0.34, 3, 6)), metal)
    mesh.position.set(x, H / 2 - yFromTop - length / 2, 0)
    root.add(mesh)
  }
  button(W / 2 + 3, 470, 230) // side button
  button(-W / 2 - 3, 330, 80) // action
  button(-W / 2 - 3, 470, 150) // volume up
  button(-W / 2 - 3, 660, 150) // volume down

  return {
    root,
    screen: { width: sw, height: sh },
    rest: { rx: 0.06, ry: 0.17 },
    start: { rx: 0.32, ry: 0.52 },
    fill: '#000000',
    dispose: r.dispose,
  }
}
