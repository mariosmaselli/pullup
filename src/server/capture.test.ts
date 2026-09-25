import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Asset, CaptureResult } from '@shared/types.ts'
import { ensureLibrary, fromLibraryPath, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

// End-to-end through the HTTP layer against a throwaway library (see vitest.config.ts).
ensureLibrary()
const { app, processor } = createApp(openDatabase())

const video = join(library.root, 'fixture.mov')
const heic = join(library.root, 'portrait.heic')

beforeAll(() => {
  // 5 s, 640×360 test pattern.
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=5:size=640x360:rate=24',
    '-pix_fmt',
    'yuv420p',
    video,
  ])
  // Portrait HEIC larger than one 512px HEIF tile — ffmpeg would only see the first tile.
  const png = join(library.root, 'portrait.png')
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'gradients=size=1170x2532',
    '-frames:v',
    '1',
    png,
  ])
  execFileSync('sips', ['-s', 'format', 'heic', png, '--out', heic])
})

const upload = (bytes: Buffer, name: string, type = 'video/quicktime') =>
  app.request('/api/assets/upload', {
    method: 'POST',
    body: new Uint8Array(bytes),
    headers: {
      'Content-Type': type,
      'Content-Length': String(bytes.length),
      'X-File-Name': encodeURIComponent(name),
      'X-Last-Modified': String(Date.UTC(2026, 8, 20, 10)),
      'X-Source': 'drop',
    },
  })

describe('capture', () => {
  let asset: Asset

  it('uploads a video, stores the original and extracts frames', async () => {
    const res = await upload(readFileSync(video), 'Screen Recording.mov')
    expect(res.status).toBe(201)
    const result = (await res.json()) as CaptureResult
    expect(result.duplicate).toBe(false)
    expect(result.asset.file?.path).toMatch(/^media\/2026\/09\/screen-recording-[0-9a-f]{8}\.mov$/)
    expect(readdirSync(library.tmp)).toEqual([])

    await processor.idle()
    asset = (await (await app.request(`/api/assets/${result.asset.id}`)).json()) as Asset

    expect(asset.processingStatus).toBe('ready')
    expect(asset.file).toMatchObject({ width: 640, height: 360, mime: 'video/quicktime' })
    expect(asset.file?.durationMs).toBeGreaterThan(4900)
    expect(asset.derivatives.filter((d) => d.role === 'frame')).toHaveLength(6)
    expect(asset.derivatives.map((d) => d.role)).toContain('poster')
    expect(asset.thumbUrl).toBeTruthy()
    expect(asset.capturedAt).toBe('2026-09-20T10:00:00.000Z')
  })

  it('serves originals with byte ranges and the right type', async () => {
    const res = await app.request(asset.file!.url, { headers: { Range: 'bytes=0-99' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-type')).toBe('video/quicktime')
    expect((await res.arrayBuffer()).byteLength).toBe(100)

    const thumb = await app.request(asset.thumbUrl!)
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get('content-type')).toBe('image/jpeg')
  })

  it('does not serve anything outside media/ and cache/', async () => {
    expect((await app.request('/api/files/pullup.db')).status).toBe(404)
    expect((await app.request('/api/files/media/../pullup.db')).status).toBe(404)
  })

  it('detects duplicates by checksum', async () => {
    const res = await upload(readFileSync(video), 'copy.mov')
    expect(res.status).toBe(200)
    const result = (await res.json()) as CaptureResult
    expect(result).toMatchObject({ duplicate: true, asset: { id: asset.id } })
  })

  it('processes HEIC at full size with a browser-viewable preview', async () => {
    const res = await upload(readFileSync(heic), 'IMG_0001.HEIC', 'image/heic')
    const { asset: created } = (await res.json()) as CaptureResult
    await processor.idle()
    const photo = (await (await app.request(`/api/assets/${created.id}`)).json()) as Asset
    expect(photo.processingStatus).toBe('ready')
    expect(photo.file).toMatchObject({ width: 1170, height: 2532 })
    expect(photo.derivatives.find((d) => d.role === 'thumb')).toMatchObject({ width: 720 })
    expect(photo.derivatives.find((d) => d.role === 'poster')).toMatchObject({ width: 1170 })
  })

  it('rejects unsupported files', async () => {
    const res = await upload(Buffer.from('%PDF-1.7'), 'brief.pdf')
    expect(res.status).toBe(415)
  })

  it('saves notes and validates links', async () => {
    const note = await app.request('/api/assets/note', {
      method: 'POST',
      body: JSON.stringify({ body: 'Idea: thread about instanced grass' }),
    })
    expect(note.status).toBe(201)
    expect(((await note.json()) as CaptureResult).asset).toMatchObject({
      kind: 'note',
      processingStatus: 'ready',
    })

    const bad = await app.request('/api/assets/link', {
      method: 'POST',
      body: JSON.stringify({ url: 'javascript:alert(1)' }),
    })
    expect(bad.status).toBe(400)
  })

  it('marks assets reviewed, removing them from the inbox', async () => {
    const res = await app.request(`/api/assets/${asset.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ triaged: true, title: 'Grass shader' }),
    })
    expect(((await res.json()) as Asset).triagedAt).toBeTruthy()
    const inbox = (await (await app.request('/api/assets?scope=inbox')).json()) as Asset[]
    expect(inbox.map((a) => a.id)).not.toContain(asset.id)
  })

  it('deletes by moving the original to trash', async () => {
    const original = fromLibraryPath(asset.file!.path)
    const res = await app.request(`/api/assets/${asset.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(existsSync(original)).toBe(false)
    expect(readdirSync(library.trash).some((f) => f.startsWith('screen-recording-'))).toBe(true)
    expect(existsSync(join(library.cache, asset.id))).toBe(false)
  })
})
