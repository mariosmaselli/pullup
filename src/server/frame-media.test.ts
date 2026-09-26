import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Asset, CaptureResult, PostDetail } from '@shared/types.ts'
import { MAX_FRAME_MEDIA } from '@shared/frames.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

// Instagram frames with several images/videos (slideshows): stored as `assetIds` on the frame.

ensureLibrary()
const db = openDatabase()
const { app, processor } = createApp(db)
const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body) })
const get = async <T>(path: string) => (await (await app.request(path)).json()) as T

async function upload(name: string, args: string[], contentType: string) {
  const file = join(library.root, `frame-media-${name}`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', ...args, file])
  const res = await app.request('/api/assets/upload', {
    method: 'POST',
    body: new Uint8Array(readFileSync(file)),
    headers: { 'Content-Type': contentType, 'X-File-Name': name },
  })
  return ((await res.json()) as CaptureResult).asset
}

const image = (name: string, color: string) =>
  upload(name, ['-i', `color=c=${color}:s=160x120`, '-frames:v', '1'], 'image/png')

let red: Asset, green: Asset, blue: Asset, clip: Asset, note: Asset

beforeAll(async () => {
  red = await image('red.png', 'red')
  green = await image('green.png', 'green')
  blue = await image('blue.png', 'blue')
  clip = await upload(
    'clip.mp4',
    ['-i', 'testsrc2=duration=1:size=320x240:rate=24', '-pix_fmt', 'yuv420p'],
    'video/mp4'
  )
  note = (
    (await (
      await app.request('/api/assets/note', json({ body: 'Not a visual' }))
    ).json()) as CaptureResult
  ).asset
  await processor.idle()
})

// An Instagram story created directly (no AI), with one text frame.
function makeStory() {
  const profile = (
    db.prepare("SELECT id FROM profiles WHERE slug = 'mario'").get() as { id: string }
  ).id
  const id = `story-${Math.random().toString(36).slice(2)}`
  db.prepare(
    `INSERT INTO posts (id, profile_id, platform, format, current_revision_id) VALUES (?, ?, 'ig_story', 'story_seq', ?)`
  ).run(id, profile, `${id}-rev`)
  db.prepare(
    `INSERT INTO post_revisions (id, post_id, segments, author) VALUES (?, ?, '[{"text":"hi"}]', 'me')`
  ).run(`${id}-rev`, id)
  return id
}

const save = (id: string, segments: unknown[]) =>
  app.request(`/api/posts/${id}/revisions`, json({ segments }))

const mediaRows = (postId: string) =>
  db
    .prepare(
      'SELECT asset_id, segment_index, position FROM post_media WHERE post_id = ? ORDER BY segment_index, position'
    )
    .all(postId)

describe('frames with several media', () => {
  it('keeps real images/videos in order, without repeats; the first sets assetId and kind', async () => {
    const id = makeStory()
    const res = await save(id, [
      // Duplicates, a note, an unknown id: only the real visuals remain, in order.
      { text: 'Slides', assetIds: [clip.id, red.id, clip.id, note.id, 'bogus', green.id] },
      // Older clients (and the AI) send only assetId.
      { text: 'One', assetId: red.id, kind: 'video' },
      { text: 'None', assetIds: [] },
      { text: 'Only junk', assetIds: [note.id], template: { id: 'text-story' } },
    ])
    expect(res.status).toBe(201)
    const post = (await res.json()) as PostDetail
    expect(post.current?.segments).toEqual([
      { text: 'Slides', assetId: clip.id, kind: 'video', assetIds: [clip.id, red.id, green.id] },
      { text: 'One', assetId: red.id, kind: 'image', assetIds: [red.id] },
      { text: 'None', assetId: null, kind: 'text' },
      { text: 'Only junk', assetId: null, kind: 'text', template: { id: 'text-story' } },
    ])
    expect(post.mediaAssetIds).toEqual([clip.id, red.id, green.id])
    // One row per media of every frame; the same asset may be in several frames.
    expect(mediaRows(id)).toEqual([
      { asset_id: clip.id, segment_index: 0, position: 0 },
      { asset_id: red.id, segment_index: 0, position: 1 },
      { asset_id: green.id, segment_index: 0, position: 2 },
      { asset_id: red.id, segment_index: 1, position: 0 },
    ])
  })

  it(`accepts at most ${MAX_FRAME_MEDIA} media per frame`, async () => {
    const id = makeStory()
    const tooMany = Array.from({ length: MAX_FRAME_MEDIA + 1 }, (_, i) => `id-${i}`)
    expect((await save(id, [{ text: 'x', assetIds: tooMany }])).status).toBe(400)
  })

  it('needs every media of every frame approved before the post can go public', async () => {
    const id = makeStory()
    await save(id, [
      { text: 'First', assetIds: [red.id] },
      { text: 'Slides', assetIds: [red.id, green.id, blue.id] },
    ])
    const blocked = await app.request(`/api/posts/${id}`, json({ status: 'approved' }, 'PATCH'))
    expect(blocked.status).toBe(409)
    const { assetIds } = (await blocked.json()) as { assetIds: string[] }
    expect([...assetIds].sort()).toEqual([red.id, green.id, blue.id].sort())

    await app.request(`/api/posts/${id}/approve-media`, { method: 'POST' })
    for (const asset of [red, green, blue]) {
      expect((await get<Asset>(`/api/assets/${asset.id}`)).visibility).toBe('approved')
    }
    // Media outside this post is untouched.
    expect((await get<Asset>(`/api/assets/${clip.id}`)).visibility).toBe('private')
    const approved = await app.request(`/api/posts/${id}`, json({ status: 'approved' }, 'PATCH'))
    expect(approved.status).toBe(200)
  })

  it('drops a deleted asset from a frame’s media (a new first one takes over)', async () => {
    const doomed = await image('doomed.png', 'yellow')
    await processor.idle()
    const id = makeStory()
    await save(id, [
      { text: 'Starts with it', assetIds: [doomed.id, clip.id] },
      { text: 'Has it inside', assetIds: [red.id, doomed.id, green.id] },
      { text: 'Only it', assetIds: [doomed.id] },
    ])
    const withIt = (await get<PostDetail>(`/api/posts/${id}`)).current!.id
    // A later revision without it, so it can be deleted (media in use can't be).
    await save(id, [{ text: 'Text only' }])
    expect((await app.request(`/api/assets/${doomed.id}`, { method: 'DELETE' })).status).toBe(204)

    const res = await app.request(`/api/posts/${id}/restore/${withIt}`, { method: 'POST' })
    const post = (await res.json()) as PostDetail
    expect(post.current?.segments).toEqual([
      { text: 'Starts with it', assetId: clip.id, kind: 'video', assetIds: [clip.id] },
      { text: 'Has it inside', assetId: red.id, kind: 'image', assetIds: [red.id, green.id] },
      { text: 'Only it', assetId: null, kind: 'text' },
    ])
    expect(post.revisions.find((r) => r.id === withIt)?.segments).toEqual(post.current?.segments)
    expect(post.mediaAssetIds).toEqual([clip.id, red.id, green.id])
    // Rows only for media that still exists.
    expect(mediaRows(id)).toEqual([
      { asset_id: clip.id, segment_index: 0, position: 0 },
      { asset_id: red.id, segment_index: 1, position: 0 },
      { asset_id: green.id, segment_index: 1, position: 1 },
    ])
  })

  it('blocks deleting media that any frame still shows', async () => {
    const id = makeStory()
    await save(id, [{ text: 'Slides', assetIds: [red.id, blue.id] }])
    expect((await app.request(`/api/assets/${blue.id}`, { method: 'DELETE' })).status).toBe(409)
  })
})
