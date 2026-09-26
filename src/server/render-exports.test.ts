import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, truncateSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RenderExport, RenderWithExports } from '@shared/render-exports.ts'
import type { Render } from '@shared/template.ts'
import { ensureLibrary, fromLibraryPath, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

ensureLibrary()
const db = openDatabase()
const { app } = createApp(db)
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) })
const pathOf = (url: string) =>
  fromLibraryPath(decodeURIComponent(url.split('?')[0]!.replace('/api/files/', '')))

const ffmpeg = (...args: string[]) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

async function readyRender(kind: 'video' | 'image'): Promise<Render> {
  const created = (await (
    await app.request(
      '/api/renders',
      json({
        templateId: 'export-test',
        templateVersion: 1,
        kind,
        aspect: '9:16',
        fps: 30,
        inputs: { aspect: '9:16', duration: 2, media: [], text: {}, params: {}, seed: 1 },
      })
    )
  ).json()) as Render
  const file = join(library.root, kind === 'video' ? 'export-source.mp4' : 'export-source.jpg')
  if (kind === 'video') {
    // What the render engine uploads: 1080×1920 H.264, 30 fps, no B-frames.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1080x1920:rate=30:duration=2',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-bf',
      '0',
      file
    )
  } else {
    ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=1080x1920', '-frames:v', '1', file)
  }
  const res = await app.request(`/api/renders/${created.id}/file`, {
    method: 'PUT',
    body: new Uint8Array(readFileSync(file)),
    headers: { 'Content-Type': kind === 'video' ? 'video/mp4' : 'image/jpeg' },
  })
  return (await res.json()) as Render
}

const exportIt = async (id: string, format: string, preset: string) =>
  app.request(`/api/renders/${id}/exports`, json({ format, preset }))

// GIF: logical screen size (LE uint16) and the NETSCAPE2.0 loop count (0 = forever).
function gifInfo(path: string) {
  const buf = readFileSync(path)
  const netscape = buf.indexOf('NETSCAPE2.0')
  return {
    signature: buf.toString('latin1', 0, 6),
    width: buf.readUInt16LE(6),
    height: buf.readUInt16LE(8),
    loop: netscape < 0 ? null : buf.readUInt16LE(netscape + 11 + 2),
  }
}

// Animated WebP: RIFF chunks — VP8X (flags, canvas size), ANIM (loop count), one ANMF per frame.
function webpInfo(path: string) {
  const buf = readFileSync(path)
  const info = {
    signature: `${buf.toString('latin1', 0, 4)}/${buf.toString('latin1', 8, 12)}`,
    animated: false,
    width: 0,
    height: 0,
    loop: null as number | null,
    frames: 0,
  }
  let offset = 12
  while (offset + 8 <= buf.length) {
    const type = buf.toString('latin1', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const data = offset + 8
    if (type === 'VP8X') {
      info.animated = (buf[data]! & 0x02) !== 0
      info.width = buf.readUIntLE(data + 4, 3) + 1
      info.height = buf.readUIntLE(data + 7, 3) + 1
    } else if (type === 'ANIM') {
      info.loop = buf.readUInt16LE(data + 4)
    } else if (type === 'ANMF') {
      info.frames++
    }
    offset = data + size + (size % 2)
  }
  return info
}

describe('render exports (GIF / animated WebP)', () => {
  it('makes a looping GIF at the preset size and frame rate, and reuses it', async () => {
    const render = await readyRender('video')
    expect(render).toMatchObject({ status: 'ready', width: 1080, height: 1920, durationMs: 2000 })

    const res = await exportIt(render.id, 'gif', 'small')
    expect(res.status).toBe(200)
    const gif = (await res.json()) as RenderExport
    expect(gif).toMatchObject({
      format: 'gif',
      preset: 'small',
      status: 'ready',
      width: 480,
      height: 853,
      fps: 15,
      warnings: [],
    })
    const path = pathOf(gif.url!)
    // Stored next to the render's MP4, named after what it holds.
    expect(path.startsWith(library.renders)).toBe(true)
    expect(path).toMatch(/export-test-[0-9a-f]{8}\.480x853-15fps\.gif$/)
    expect(statSync(path).size).toBe(gif.sizeBytes)
    expect(gifInfo(path)).toEqual({ signature: 'GIF89a', width: 480, height: 853, loop: 0 })
    const probed = execFileSync('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,width,height,nb_read_frames',
      '-of',
      'csv=p=0',
      path,
    ])
      .toString()
      .trim()
    expect(probed).toBe('gif,480,853,30') // 2 s at 15 fps

    // Served as an image from the library.
    const served = await app.request(gif.url!)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/gif')

    // Asked again: the same file, not re-encoded.
    const before = statSync(path).mtimeMs
    const again = (await (await exportIt(render.id, 'gif', 'small')).json()) as RenderExport
    expect(again).toEqual(gif)
    expect(statSync(path).mtimeMs).toBe(before)
  })

  it('makes a looping animated WebP, one run for concurrent requests, listed on the render', async () => {
    const render = await readyRender('video')
    const [a, b] = await Promise.all([
      exportIt(render.id, 'webp', 'medium'),
      exportIt(render.id, 'webp', 'medium'),
    ])
    const webp = (await a.json()) as RenderExport
    expect(await b.json()).toEqual(webp)
    expect(webp).toMatchObject({
      format: 'webp',
      status: 'ready',
      width: 720,
      height: 1280,
      fps: 20,
    })
    expect(webp.warnings.join(' ')).toMatch(/X or Instagram/)
    const path = pathOf(webp.url!)
    expect(webpInfo(path)).toEqual({
      signature: 'RIFF/WEBP',
      animated: true,
      width: 720,
      height: 1280,
      loop: 0,
      frames: 40, // 2 s at 20 fps
    })
    // No scratch files (output being written, GIF palette) left behind.
    expect(readdirSync(library.tmp).filter((name) => name.startsWith('export-'))).toEqual([])

    await exportIt(render.id, 'gif', 'small')
    const detail = (await (
      await app.request(`/api/renders/${render.id}`)
    ).json()) as RenderWithExports
    expect(detail.id).toBe(render.id)
    expect(detail.exports.map((e) => `${e.format}:${e.preset}:${e.status}`).sort()).toEqual([
      'gif:small:ready',
      'webp:medium:ready',
    ])
  })

  it('shows progress on the render while an export is being made', async () => {
    const render = await readyRender('video')
    let done = false
    const request = exportIt(render.id, 'gif', 'large').then((res) => {
      done = true
      return res
    })
    const seen: number[] = []
    while (!done) {
      const detail = (await (
        await app.request(`/api/renders/${render.id}`)
      ).json()) as RenderWithExports
      const pending = detail.exports.find((e) => e.status === 'pending')
      if (pending) {
        expect(pending).toMatchObject({ format: 'gif', preset: 'large', url: null })
        seen.push(pending.progress!)
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const gif = (await (await request).json()) as RenderExport
    expect(gif).toMatchObject({ status: 'ready', width: 1080, height: 1920, fps: 24 })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((p) => p >= 0 && p <= 1)).toBe(true)
    expect(Math.max(...seen)).toBeGreaterThan(0)
  })

  it('refuses stills, unknown renders and unknown presets', async () => {
    const still = await readyRender('image')
    expect((await exportIt(still.id, 'gif', 'small')).status).toBe(409)
    expect((await exportIt('nope', 'gif', 'small')).status).toBe(404)
    const video = (await (await app.request('/api/renders')).json()) as Render[]
    const id = video.find((r) => r.kind === 'video' && r.status === 'ready')!.id
    expect((await exportIt(id, 'gif', 'huge')).status).toBe(400)
    expect((await exportIt(id, 'avif', 'small')).status).toBe(400)
    // No exports on a still.
    const detail = (await (
      await app.request(`/api/renders/${still.id}`)
    ).json()) as RenderWithExports
    expect(detail.exports).toEqual([])
  })

  it('warns when a GIF is over X’s 15 MB limit', async () => {
    const render = await readyRender('video')
    const gif = (await (await exportIt(render.id, 'gif', 'small')).json()) as RenderExport
    expect(gif.warnings).toEqual([])
    // Pretend it came out big: the file is reused as it is and the warning follows its size.
    truncateSync(pathOf(gif.url!), 16 * 1024 * 1024)
    const big = (await (await exportIt(render.id, 'gif', 'small')).json()) as RenderExport
    expect(big.sizeBytes).toBe(16 * 1024 * 1024)
    expect(big.warnings).toEqual(['Over X’s 15 MB GIF limit on the web — try a smaller size'])
  })

  it('deletes exports with their render', async () => {
    const render = await readyRender('video')
    const gif = (await (await exportIt(render.id, 'gif', 'small')).json()) as RenderExport
    const webp = (await (await exportIt(render.id, 'webp', 'small')).json()) as RenderExport
    const files = [pathOf(gif.url!), pathOf(webp.url!)]
    expect(files.every((f) => existsSync(f))).toBe(true)
    expect((await app.request(`/api/renders/${render.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(files.some((f) => existsSync(f))).toBe(false)
    expect(existsSync(pathOf(render.url!))).toBe(false) // the MP4 went to trash
  })
})
