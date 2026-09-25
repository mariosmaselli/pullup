import * as THREE from 'three'

// Procedural surfaces drawn with canvas 2D — no external assets.

function rr(
  g: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

function canvasTexture(canvas: OffscreenCanvas, anisotropy: number) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = anisotropy
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  return texture
}

export interface Finish {
  metal: string // frame / aluminium
  deck: string // laptop keyboard deck base colour
  keys: string
  well: string
}

// Laptop deck, seen from above: the canvas top edge is the hinge, bottom edge the front lip.
export function deckTexture(aspect: number, finish: Finish, anisotropy: number) {
  const W = 2048
  const H = Math.round(W / aspect)
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d')!
  g.fillStyle = finish.deck
  g.fillRect(0, 0, W, H)

  // Keyboard well.
  const kx = W * 0.085
  const kw = W * 0.83
  const ky = H * 0.06
  const kh = H * 0.47
  g.fillStyle = finish.well
  rr(g, kx - W * 0.006, ky - W * 0.006, kw + W * 0.012, kh + W * 0.012, W * 0.012)
  g.fill()

  // Keys: a function row + five rows, with the usual wide keys.
  const rows: number[][] = [
    Array(14).fill(1),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
    [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.7],
    [2.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.2],
    [1, 1, 1, 1.25, 5.2, 1.25, 1, 1, 1],
  ]
  const gap = kw * 0.006
  const rowH = [0.55, 1, 1, 1, 1, 1]
  const unitH = (kh - gap * 5) / rowH.reduce((a, b) => a + b, 0)
  g.fillStyle = finish.keys
  let y = ky
  rows.forEach((row, ri) => {
    const units = row.reduce((a, b) => a + b, 0)
    const unitW = (kw - gap * (row.length - 1)) / units
    const h = unitH * rowH[ri]!
    let x = kx
    for (const u of row) {
      const w = unitW * u
      rr(g, x, y, w, h, Math.min(w, h) * 0.12)
      g.fill()
      x += w + gap
    }
    y += h + gap
  })

  // Speaker grilles either side of the keyboard.
  g.fillStyle = finish.well
  for (const sx of [W * 0.028, W * 0.93]) {
    for (let iy = 0; iy < 26; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        g.beginPath()
        g.arc(
          sx + ix * W * 0.009 + W * 0.003,
          ky + iy * (kh / 26) + W * 0.004,
          W * 0.0022,
          0,
          Math.PI * 2
        )
        g.fill()
      }
    }
  }

  // Trackpad.
  const tw = W * 0.4
  const th = H * 0.36
  const tx = (W - tw) / 2
  const ty = H * 0.58
  g.strokeStyle = finish.well
  g.lineWidth = W * 0.0025
  rr(g, tx, ty, tw, th, W * 0.012)
  g.stroke()

  // Front lip notch.
  g.fillStyle = finish.well
  rr(g, W / 2 - W * 0.05, H - W * 0.004, W * 0.1, W * 0.01, W * 0.004)
  g.fill()

  return canvasTexture(canvas, anisotropy)
}

export interface Chrome {
  bar: string
  pill: string
  dot: string
  text: string
  line: string
}

// The browser toolbar: window controls, an address pill and an optional address.
export async function browserBarTexture(
  w: number,
  h: number,
  chrome: Chrome,
  url: string,
  anisotropy: number
) {
  const k = 2048 / w
  const W = 2048
  const H = Math.max(8, Math.round(h * k))
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d')!
  g.fillStyle = chrome.bar
  g.fillRect(0, 0, W, H)

  // Window controls.
  const d = H * 0.28
  g.fillStyle = chrome.dot
  for (let i = 0; i < 3; i++) {
    g.beginPath()
    g.arc(H * 0.62 + i * d * 1.75, H / 2, d / 2, 0, Math.PI * 2)
    g.fill()
  }

  // Address pill, centred.
  const pw = W * 0.38
  const ph = H * 0.56
  g.fillStyle = chrome.pill
  rr(g, (W - pw) / 2, (H - ph) / 2, pw, ph, ph * 0.3)
  g.fill()

  const address = url.trim()
  if (address) {
    const size = H * 0.3
    g.font = `500 ${size}px "PP Neue Montreal"`
    g.letterSpacing = `${-0.005 * size}px`
    g.fillStyle = chrome.text
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    let text = address
    while (g.measureText(text).width > pw * 0.86 && text.length > 4) text = text.slice(0, -2) + '…'
    g.fillText(text, W / 2, H / 2 + size * 0.04)
  }

  // Hairline between toolbar and page.
  g.fillStyle = chrome.line
  g.fillRect(0, H - Math.max(2, H * 0.02), W, Math.max(2, H * 0.02))

  return canvasTexture(canvas, anisotropy)
}

// A small studio: a dark room with a large soft key, a strip light and a faint fill. Reflected in
// the metal and glass it gives clean product-shot highlights instead of a generic grey room.
export function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  const geometry = new THREE.PlaneGeometry(1, 1)
  const materials: THREE.Material[] = []
  const panel = (intensity: number, size: [number, number], position: [number, number, number]) => {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    material.color.setRGB(intensity, intensity, intensity)
    materials.push(material)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(size[0], size[1], 1)
    mesh.position.set(...position)
    mesh.lookAt(0, 0, 0)
    scene.add(mesh)
  }
  panel(4.0, [7, 5], [-5, 6, 6]) // key: large softbox, top-left, in front
  panel(2.4, [1.4, 9], [8, 1, 1]) // strip light right
  panel(1.2, [1.2, 8], [-8, 0, -2]) // strip left, behind
  panel(0.12, [14, 5], [0, -4, 10]) // faint low frontal fill (kept dim: glass mirrors it)
  panel(1.1, [12, 12], [0, 10, -2]) // soft ceiling
  panel(1.6, [18, 4], [0, 1.2, -9]) // low backdrop sweep: what a deck seen from the front reflects

  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0.035)
  pmrem.dispose()
  geometry.dispose()
  materials.forEach((m) => m.dispose())
  return target
}
