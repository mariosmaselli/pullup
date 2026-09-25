import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Render } from '@shared/template.ts'
import { ensureLibrary, fromLibraryPath, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

ensureLibrary()
const db = openDatabase()
const { app } = createApp(db)
const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body) })

const inputs = { aspect: '9:16', duration: 4, media: [], text: {}, params: {}, seed: 1 }
const create = async (kind: 'video' | 'image') =>
  (await (
    await app.request(
      '/api/renders',
      json({
        templateId: 'test-template',
        templateVersion: 1,
        kind,
        aspect: '9:16',
        fps: 30,
        inputs,
      })
    )
  ).json()) as Render

const ffmpeg = (...args: string[]) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

describe('renders', () => {
  it('stores a good MP4: retags BT.709, keeps moov first, makes a poster, no warnings', async () => {
    const file = join(library.root, 'good.mp4')
    // What WebCodecs produces: H.264 High, no B-frames, fast start, sRGB transfer tag.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1080x1920:rate=30:duration=4',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-bf',
      '0',
      '-color_trc',
      'iec61966-2-1',
      '-movflags',
      '+faststart',
      file
    )
    const render = await create('video')
    const res = await app.request(`/api/renders/${render.id}/file`, {
      method: 'PUT',
      body: new Uint8Array(readFileSync(file)),
      headers: {
        'Content-Type': 'video/mp4',
        'X-Render-Encoder': 'test',
        'X-Render-Elapsed-Ms': '1234',
      },
    })
    const stored = (await res.json()) as Render
    expect(stored).toMatchObject({
      status: 'ready',
      warnings: [],
      elapsedMs: 1234,
      durationMs: 4000,
    })
    const path = fromLibraryPath(stored.url!.replace('/api/files/', ''))
    expect(existsSync(path)).toBe(true)
    expect(existsSync(fromLibraryPath(stored.posterUrl!.replace('/api/files/', '')))).toBe(true)
    const trc = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=color_transfer',
      '-of',
      'csv=p=0',
      path,
    ])
      .toString()
      .trim()
    expect(trc).toBe('bt709')
    // Served with the right type.
    const served = await app.request(stored.url!)
    expect(served.headers.get('content-type')).toBe('video/mp4')
  })

  it('warns about files that break platform rules', async () => {
    const file = join(library.root, 'bad.mp4')
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1080x1920:rate=30:duration=2',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-bf',
      '2',
      file
    ) // B-frames, moov at the end, under 3 s
    const render = await create('video')
    const stored = (await (
      await app.request(`/api/renders/${render.id}/file`, {
        method: 'PUT',
        body: new Uint8Array(readFileSync(file)),
        headers: { 'Content-Type': 'video/mp4' },
      })
    ).json()) as Render
    expect(stored.status).toBe('ready')
    expect(stored.warnings.join(' | ')).toMatch(/B-frames/)
    expect(stored.warnings.join(' | ')).toMatch(/Shorter than 3 s/)
  })

  it('stores stills and rejects the wrong file type', async () => {
    const jpg = join(library.root, 'still.jpg')
    ffmpeg('-f', 'lavfi', '-i', 'color=c=black:s=1080x1920', '-frames:v', '1', jpg)
    const still = await create('image')
    const wrong = await app.request(`/api/renders/${still.id}/file`, {
      method: 'PUT',
      body: new Uint8Array(readFileSync(jpg)),
      headers: { 'Content-Type': 'video/mp4' },
    })
    expect(wrong.status).toBe(415)
    const ok = (await (
      await app.request(`/api/renders/${still.id}/file`, {
        method: 'PUT',
        body: new Uint8Array(readFileSync(jpg)),
        headers: { 'Content-Type': 'image/jpeg' },
      })
    ).json()) as Render
    expect(ok).toMatchObject({ status: 'ready', kind: 'image', posterUrl: null, warnings: [] })
  })

  it('fails renders left pending by a closed tab', async () => {
    const render = await create('video')
    db.prepare("UPDATE renders SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(
      render.id
    )
    createApp(db) // startup
    const after = (await (await app.request(`/api/renders/${render.id}`)).json()) as Render
    expect(after).toMatchObject({ status: 'failed', error: 'Interrupted before it finished' })
  })

  it("zips a post's current frames in order and lists what is missing", async () => {
    const profile = (
      db.prepare("SELECT id FROM profiles WHERE slug = 'mario'").get() as { id: string }
    ).id
    db.prepare("INSERT INTO ideas (id, title, origin) VALUES ('zip-idea', 'Zip', 'manual')").run()
    db.prepare(
      `INSERT INTO posts (id, idea_id, profile_id, platform, format, current_revision_id)
       VALUES ('zip-post', 'zip-idea', ?, 'ig_story', 'story_seq', 'zip-rev')`
    ).run(profile)
    db.prepare(
      `INSERT INTO post_revisions (id, post_id, segments, author) VALUES ('zip-rev', 'zip-post', ?, 'me')`
    ).run(
      JSON.stringify([
        { text: 'First', assetId: null, kind: 'text', template: { id: 'test-template' } },
        { text: 'Second', assetId: null, kind: 'text' },
      ])
    )
    const res = await app.request(
      '/api/renders',
      json({
        templateId: 'test-template',
        templateVersion: 1,
        kind: 'image',
        aspect: '9:16',
        inputs: { ...inputs, text: { body: 'First' } },
        postId: 'zip-post',
        segmentIndex: 0,
      })
    )
    const render = (await res.json()) as Render
    const jpg = join(library.root, 'frame1.jpg')
    ffmpeg('-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920', '-frames:v', '1', jpg)
    await app.request(`/api/renders/${render.id}/file`, {
      method: 'PUT',
      body: new Uint8Array(readFileSync(jpg)),
      headers: { 'Content-Type': 'image/jpeg' },
    })

    const zip = await app.request('/api/posts/zip-post/frames.zip')
    expect(zip.status).toBe(200)
    expect(zip.headers.get('content-type')).toBe('application/zip')
    const out = join(library.root, 'frames.zip')
    writeFileSync(out, Buffer.from(await zip.arrayBuffer()))
    const listing = execFileSync('unzip', ['-l', out]).toString()
    expect(listing).toMatch(/01-frame\.jpg/)
    expect(listing).toMatch(/MISSING\.txt/)
    expect(execFileSync('unzip', ['-p', out, 'MISSING.txt']).toString()).toMatch(/2/)
  })

  it('moves deleted renders to trash', async () => {
    const [render] = ((await (await app.request('/api/renders')).json()) as Render[]).filter(
      (r) => r.status === 'ready' && r.kind === 'video'
    )
    const path = fromLibraryPath(render!.url!.replace('/api/files/', ''))
    expect((await app.request(`/api/renders/${render!.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(existsSync(path)).toBe(false)
  })
})
