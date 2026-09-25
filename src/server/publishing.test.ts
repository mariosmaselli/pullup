import { describe, expect, it } from 'vitest'
import type { CaptureResult, PostDetail } from '@shared/types.ts'
import { ensureLibrary } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'

ensureLibrary()
const db = openDatabase()
const { app } = createApp(db)
const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body) })
const patch = (id: string, body: unknown) => app.request(`/api/posts/${id}`, json(body, 'PATCH'))

// A post with one (private) link asset attached, created directly.
async function makePost() {
  const link = (await (
    await app.request('/api/assets/note', json({ body: 'Media stand-in' }))
  ).json()) as CaptureResult
  const profile = (
    db.prepare("SELECT id FROM profiles WHERE slug = 'mario'").get() as { id: string }
  ).id
  const id = `post-${Math.random().toString(36).slice(2)}`
  db.prepare(
    `INSERT INTO posts (id, profile_id, platform, format, current_revision_id) VALUES (?, ?, 'x', 'single', ?)`
  ).run(id, profile, `${id}-rev`)
  db.prepare(
    `INSERT INTO post_revisions (id, post_id, segments, author) VALUES (?, ?, '[{"text":"hi"}]', 'me')`
  ).run(`${id}-rev`, id)
  db.prepare('INSERT INTO post_media (post_id, asset_id) VALUES (?, ?)').run(id, link.asset.id)
  return { id, assetId: link.asset.id }
}

describe('publishing rules', () => {
  it('blocks approval while media is private, until the media is approved', async () => {
    const { id, assetId } = await makePost()
    const blocked = await patch(id, { status: 'approved' })
    expect(blocked.status).toBe(409)
    expect(((await blocked.json()) as { assetIds: string[] }).assetIds).toEqual([assetId])

    // Review is fine — it isn't public yet.
    expect((await patch(id, { status: 'review' })).status).toBe(200)

    const approved = (await (
      await app.request(`/api/posts/${id}/approve-media`, { method: 'POST' })
    ).json()) as PostDetail
    expect(approved.id).toBe(id)
    expect((await patch(id, { status: 'approved' })).status).toBe(200)
  })

  it('needs a date to schedule; clearing it goes back to approved', async () => {
    const { id } = await makePost()
    await app.request(`/api/posts/${id}/approve-media`, { method: 'POST' })
    expect((await patch(id, { status: 'scheduled' })).status).toBe(400)

    const when = '2026-10-02T09:30:00.000Z'
    const scheduled = (await (
      await patch(id, { status: 'scheduled', scheduledFor: when })
    ).json()) as PostDetail
    expect(scheduled).toMatchObject({ status: 'scheduled', scheduledFor: when })

    const unscheduled = (await (await patch(id, { scheduledFor: null })).json()) as PostDetail
    expect(unscheduled).toMatchObject({ status: 'approved', scheduledFor: null })
  })

  it('stamps the publish date and keeps the public URL', async () => {
    const { id } = await makePost()
    await app.request(`/api/posts/${id}/approve-media`, { method: 'POST' })
    const res = await patch(id, { status: 'published', publicUrl: 'https://x.com/mario/status/1' })
    const post = (await res.json()) as PostDetail
    expect(post.status).toBe('published')
    expect(post.publicUrl).toBe('https://x.com/mario/status/1')
    expect(Date.now() - new Date(post.publishedAt!).getTime()).toBeLessThan(10_000)

    const bad = await patch(id, { scheduledFor: 'next tuesday' })
    expect(bad.status).toBe(400)
  })
})
