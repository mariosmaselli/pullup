import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Asset, CaptureResult, PostDetail } from '@shared/types.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

// A frame's background image/video (template.background) is frame media: it gets post_media rows,
// so the private-media rule and "media in use" apply to it like to the frame's own media.

ensureLibrary()
const db = openDatabase()
const { app, processor } = createApp(db)
const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body) })
const get = async <T>(path: string) => (await (await app.request(path)).json()) as T

async function image(name: string, color: string): Promise<Asset> {
  const file = join(library.root, `frame-background-${name}`)
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=160x120`,
    '-frames:v',
    '1',
    file,
  ])
  const res = await app.request('/api/assets/upload', {
    method: 'POST',
    body: new Uint8Array(readFileSync(file)),
    headers: { 'Content-Type': 'image/png', 'X-File-Name': name },
  })
  return ((await res.json()) as CaptureResult).asset
}

let ground: Asset, photo: Asset

beforeAll(async () => {
  ground = await image('ground.png', 'navy')
  photo = await image('photo.png', 'orange')
  await processor.idle()
})

function makeStory() {
  const profile = (
    db.prepare("SELECT id FROM profiles WHERE slug = 'mario'").get() as { id: string }
  ).id
  const id = `bg-story-${Math.random().toString(36).slice(2)}`
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

describe('frame backgrounds', () => {
  it('keeps the background with the template and counts it as the frame’s media', async () => {
    const id = makeStory()
    const res = await save(id, [
      {
        text: 'Over a picture',
        template: { id: 'text-story', background: { assetId: ground.id } },
      },
      {
        text: 'Photo on its own ground',
        assetIds: [photo.id],
        template: { id: 'image-caption', background: { assetId: ground.id } },
      },
      // Its own media as the background: one row.
      {
        text: 'Same',
        assetIds: [photo.id],
        template: { id: 'x', background: { assetId: photo.id } },
      },
    ])
    expect(res.status).toBe(201)
    const post = (await res.json()) as PostDetail
    expect(post.current?.segments[0]?.template).toEqual({
      id: 'text-story',
      background: { assetId: ground.id },
    })
    expect(mediaRows(id)).toEqual([
      { asset_id: ground.id, segment_index: 0, position: 0 },
      { asset_id: photo.id, segment_index: 1, position: 0 },
      { asset_id: ground.id, segment_index: 1, position: 1 },
      { asset_id: photo.id, segment_index: 2, position: 0 },
    ])
    // The frame's own media is unchanged: the background is not a slide.
    expect(post.current?.segments[1]).toMatchObject({ assetId: photo.id, assetIds: [photo.id] })
  })

  it('needs a private background approved before the post can go public', async () => {
    const id = makeStory()
    await save(id, [
      {
        text: 'Over a picture',
        template: { id: 'text-story', background: { assetId: ground.id } },
      },
    ])
    const blocked = await app.request(`/api/posts/${id}`, json({ status: 'approved' }, 'PATCH'))
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { assetIds: string[] }).assetIds).toEqual([ground.id])

    await app.request(`/api/posts/${id}/approve-media`, { method: 'POST' })
    expect((await get<Asset>(`/api/assets/${ground.id}`)).visibility).toBe('approved')
    const approved = await app.request(`/api/posts/${id}`, json({ status: 'approved' }, 'PATCH'))
    expect(approved.status).toBe(200)
  })

  it('blocks deleting a background a frame still shows, and forgets a removed one', async () => {
    const lone = await image('lone.png', 'teal')
    await processor.idle()
    const id = makeStory()
    await save(id, [
      { text: 'Over a picture', template: { id: 'text-story', background: { assetId: lone.id } } },
    ])
    expect((await app.request(`/api/assets/${lone.id}`, { method: 'DELETE' })).status).toBe(409)
    // Removing the background (template without it) drops the row.
    await save(id, [{ text: 'Over a colour', template: { id: 'text-story' } }])
    expect(mediaRows(id)).toEqual([])
    // A bogus id is kept on the frame but never becomes a row.
    await save(id, [{ text: 'x', template: { id: 'text-story', background: { assetId: 'nope' } } }])
    expect(mediaRows(id)).toEqual([])
  })
})
