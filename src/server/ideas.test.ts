import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CaptureResult, Idea, PostDetail, Project } from '@shared/types.ts'
import { ensureLibrary, library } from './library.ts'
import { openDatabase } from './db/index.ts'
import { createApp } from './app.ts'
import type { AiProvider, AiRequest } from './ai/provider.ts'

// Ideas and projects: hand-written ideas, steering, answers, project-level ideas, what the AI is
// told is already covered, and Mario's posts as voice examples. A fake provider records every
// request; nothing reaches a real API. Its own database, so other test files' posts can't change
// which voice examples are picked.

const calls: AiRequest<unknown>[] = []

const idea = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  summary: `${title} summary.`,
  angle: 'technical',
  format: 'thread',
  platforms: ['x'],
  rationale: 'From the notes.',
  sourceAssetIds: [], // falls back to every asset in the request
  questions: [],
  ...extra,
})
const draft = (text: string) => ({
  format: 'single',
  segments: [{ text, assetId: null, kind: null }],
  caption: null,
  claims: [{ text, basis: 'source', assetId: null }],
  questions: [],
})
const drafts =
  (x: string, linkedin = 'Drafted for LinkedIn.') =>
  () => ({
    x: draft(x),
    linkedin: draft(linkedin),
    ig_story: null,
    ig_feed: null,
  })

let ideasOutput: () => unknown = () => ({ ideas: [idea('Idea one'), idea('Idea two')] })
let draftsOutput: () => unknown = drafts('Drafted for X.')

const fake: AiProvider = {
  name: 'fake',
  model: 'fake-model',
  async generate<T>(request: AiRequest<T>) {
    calls.push(request as AiRequest<unknown>)
    const output = request.system.includes('suggest post ideas')
      ? ideasOutput()
      : request.system.includes('write drafts for several platforms')
        ? draftsOutput()
        : null
    if (!output) throw new Error('unknown task')
    return {
      output: request.schema.parse(output),
      model: 'fake-model',
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0.01,
    }
  },
}

const suffix = Math.random().toString(36).slice(2, 7)
ensureLibrary()
const db = openDatabase(join(library.root, `ideas-test-${suffix}.db`))
const { app } = createApp(db, { provider: fake })
const offline = createApp(db).app // no API key: AI unavailable

type App = typeof app
const send = async <T>(target: App, path: string, body?: unknown, method = 'POST') => {
  const res = await target.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as T }
}
const promptText = (request = calls.at(-1)!) =>
  request.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n')
const lastRun = (task: string) => {
  const run = db
    .prepare('SELECT prompt_version, input_refs FROM ai_runs WHERE task = ? ORDER BY rowid DESC')
    .get(task) as { prompt_version: string; input_refs: string }
  return { version: run.prompt_version, refs: JSON.parse(run.input_refs) }
}

const newProject = async (name: string, values: Record<string, unknown> = {}, target = app) =>
  (await send<Project>(target, '/api/projects', { name: `${name} ${suffix}`, ...values })).body
const newNote = async (body: string, projectId?: string, target = app) => {
  const { body: result } = await send<CaptureResult>(target, '/api/assets/note', { body })
  if (projectId) await send(target, `/api/assets/${result.asset.id}`, { projectId }, 'PATCH')
  return result.asset.id
}
const newIdea = async (values: Record<string, unknown>, target = app) =>
  (await send<Idea>(target, '/api/ideas', values)).body
const ideasByTitle = async (status: string) =>
  new Map(
    (await send<Idea[]>(app, `/api/ideas?status=${status}`, undefined, 'GET')).body.map((i) => [
      i.title,
      i,
    ])
  )
const writeDrafts = (id: string, body: Record<string, unknown> = {}) =>
  send<{ postIds: string[]; error?: string }>(app, `/api/ideas/${id}/draft`, body)
const handEdit = (postId: string, text: string) =>
  send<PostDetail>(app, `/api/posts/${postId}/revisions`, { segments: [{ text }] })
// Publishing comes after approval.
const publish = async (postId: string) => {
  await send(app, `/api/posts/${postId}`, { status: 'approved' }, 'PATCH')
  const res = await send<PostDetail>(app, `/api/posts/${postId}`, { status: 'published' }, 'PATCH')
  expect(res.body.status).toBe('published')
}

describe('ideas written by hand', () => {
  it('creates an idea without the AI, for client work with AI off', async () => {
    const client = await newProject('Harbor client', { isClientWork: true }, offline)
    expect(client.aiAllowed).toBe(false)
    const brief = await newNote('Client brief: a calm harbor map.', client.id, offline)
    const sketch = await newNote('Sketch of the map legend.', client.id, offline)

    const res = await send<Idea>(offline, '/api/ideas', {
      title: 'Harbor map case study',
      summary: 'What we built for the harbor and why the legend matters.',
      angle: 'business',
      format: 'carousel',
      platforms: ['linkedin', 'ig_feed'],
      assetIds: [brief, sketch],
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      origin: 'manual',
      status: 'saved',
      angle: 'business',
      format: 'carousel',
      platforms: ['linkedin', 'ig_feed'],
      projectId: client.id, // from its sources
      questions: [],
      answers: [],
      drafts: [],
    })
    expect(res.body.sources.map((s) => s.assetId)).toEqual([brief, sketch])
    expect((await ideasByTitle('suggested,saved')).get('Harbor map case study')?.id).toBe(
      res.body.id
    )

    // The AI never sees it while the project keeps AI off.
    const before = calls.length
    expect((await writeDrafts(res.body.id)).status).toBe(403)
    expect(calls.length).toBe(before)
  })

  it('keeps an idea without sources away from the AI when its project has AI off', async () => {
    const client = await newProject('Quiet client', { isClientWork: true })
    const quiet = await newIdea({ title: 'What the quiet client taught me', projectId: client.id })
    expect(quiet).toMatchObject({ projectId: client.id, sources: [], platforms: [] })
    const before = calls.length
    expect((await writeDrafts(quiet.id)).status).toBe(403)
    expect(calls.length).toBe(before)
  })

  it('rejects ideas without a title, with unknown sources or an unknown project', async () => {
    expect((await send(app, '/api/ideas', { title: '  ' })).status).toBe(400)
    const unknown = await send<{ error: string }>(app, '/api/ideas', {
      title: 'Ghost',
      assetIds: ['not-an-asset'],
    })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toMatch(/no longer exist/)
    expect((await send(app, '/api/ideas', { title: 'X', projectId: 'nope' })).status).toBe(400)
  })
})

describe('projects', () => {
  it('turns AI off when a project becomes client work — once, and only then', async () => {
    let project = await newProject('Own tool')
    expect(project).toMatchObject({ isClientWork: false, aiAllowed: true })
    const patch = async (values: Record<string, unknown>) =>
      (project = (await send<Project>(app, `/api/projects/${project.id}`, values, 'PATCH')).body)

    await patch({ isClientWork: true })
    expect(project).toMatchObject({ isClientWork: true, aiAllowed: false })
    // Mario turns it back on; later edits leave it alone.
    await patch({ aiAllowed: true })
    await patch({ isClientWork: true, status: 'paused' })
    expect(project).toMatchObject({ isClientWork: true, aiAllowed: true, status: 'paused' })
    // Back to own work doesn't switch AI on or off either.
    await patch({ aiAllowed: false })
    await patch({ isClientWork: false })
    expect(project).toMatchObject({ isClientWork: false, aiAllowed: false })
    // Saying both in one request: the explicit choice wins.
    await patch({ isClientWork: true, aiAllowed: true })
    expect(project).toMatchObject({ isClientWork: true, aiAllowed: true })
  })

  it('renames, describes and tags a project, and the AI reads all of it', async () => {
    const project = await newProject('Untitled shader thing')
    await newNote('Caustics shader test, 60fps on an M1.', project.id)
    const { body } = await send<Project>(
      app,
      `/api/projects/${project.id}`,
      {
        name: `Caustics ${suffix}`,
        description: 'Real-time water caustics for a pool brand site.',
        tags: ['webgl', 'shaders', 'webgl'],
      },
      'PATCH'
    )
    expect(body).toMatchObject({
      name: `Caustics ${suffix}`,
      slug: `caustics-${suffix}`,
      description: 'Real-time water caustics for a pool brand site.',
      tags: ['webgl', 'shaders'],
    })

    const res = await send<Idea[]>(app, '/api/ideas/generate', { projectId: project.id })
    expect(res.status).toBe(201)
    const text = promptText()
    expect(text).toContain(
      'Description (by Mario): Real-time water caustics for a pool brand site.'
    )
    expect(text).toContain('Tags (by Mario): webgl, shaders')
    expect(res.body.every((i) => i.projectId === project.id)).toBe(true)
  })
})

describe('ideas for a whole project', () => {
  it('sends up to 12 of its items, unused ones first, with Mario’s direction', async () => {
    const project = await newProject('Big project')
    const notes: string[] = []
    for (let i = 1; i <= 13; i++) notes.push(await newNote(`Progress note ${i}.`, project.id))
    // The newest note is already used by an idea: the 12 unused ones go instead.
    await newIdea({ title: 'Uses note 13', assetIds: [notes[12]] })

    const res = await send<Idea[]>(app, '/api/ideas/generate', {
      projectId: project.id,
      instruction: '  A LinkedIn case study for agencies.  ',
    })
    expect(res.status).toBe(201)
    const text = promptText()
    expect(text.match(/<asset id=/g)).toHaveLength(12)
    expect(text).not.toContain(notes[12]!)
    expect(text).toContain("Mario's direction: A LinkedIn case study for agencies.")
    // Oldest first, so the model sees how the work progressed.
    expect(text.indexOf('Progress note 1.')).toBeLessThan(text.indexOf('Progress note 12.'))
    expect(res.body).toHaveLength(2)
    for (const created of res.body) {
      expect(created.projectId).toBe(project.id)
      expect(created.sources).toHaveLength(12)
    }

    const run = lastRun('generate-ideas')
    expect(run.version).toBe('generate-ideas@v3')
    expect(run.refs).toMatchObject({
      projectId: project.id,
      instruction: 'A LinkedIn case study for agencies.',
    })
    expect(run.refs.assetIds).toHaveLength(12)
  })

  it('refuses projects with AI off or without material, without calling the AI', async () => {
    const before = calls.length
    const secret = await newProject('Secret launch', { isClientWork: true })
    await newNote('Unreleased product details.', secret.id)
    expect((await send(app, '/api/ideas/generate', { projectId: secret.id })).status).toBe(403)

    const empty = await newProject('Empty project')
    const res = await send<{ error: string }>(app, '/api/ideas/generate', { projectId: empty.id })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no material/)
    expect((await send(app, '/api/ideas/generate', {})).status).toBe(400)
    expect(calls.length).toBe(before)
  })
})

describe('what the AI is told is already covered', () => {
  it('lists open ideas, dismissed ideas and approved or published posts', async () => {
    const project = await newProject('Harbor lights')
    const note = await newNote('Harbor lights shader with fog.', project.id)
    // An idea that also uses material of a project with AI off: never mentioned.
    const hidden = await newProject('Hidden client', { isClientWork: true })
    const hiddenNote = await newNote('Hidden client note.', hidden.id)
    await newIdea({ title: 'Secret combo', assetIds: [note, hiddenNote] })

    ideasOutput = () => ({ ideas: [idea('Fog breakdown'), idea('Why fog matters')] })
    const first = (await send<Idea[]>(app, '/api/ideas/generate', { assetIds: [note] })).body
    ideasOutput = () => ({ ideas: [idea('Idea one'), idea('Idea two')] })
    const keep = first.find((i) => i.title === 'Fog breakdown')!
    const dismiss = first.find((i) => i.title === 'Why fog matters')!
    await send(app, `/api/ideas/${dismiss.id}`, { status: 'dismissed' }, 'PATCH')

    draftsOutput = drafts('Fog in the harbor shader is two noise layers.', 'Still a draft.')
    const { postIds } = (await writeDrafts(keep.id, { platforms: ['x', 'linkedin'] })).body
    await publish(postIds[0]!)

    await send(app, '/api/ideas/generate', { assetIds: [note] })
    const text = promptText()
    expect(text).toContain('<already_covered>')
    expect(text).toContain(
      'Ideas already suggested or drafted:\n- Fog breakdown — Fog breakdown summary.'
    )
    expect(text).toContain("Ideas Mario dismissed (he didn't want these):\n- Why fog matters")
    expect(text).toMatch(
      /<post platform="x" status="published" published="\d{4}-\d{2}-\d{2}">\nFog in the harbor shader is two noise layers.\n<\/post>/
    )
    expect(text).not.toContain('Still a draft.')
    expect(text).not.toContain('Secret combo')
    expect(calls.at(-1)!.system).toContain('Ideas Mario dismissed')
    expect(lastRun('generate-ideas').refs.covered).toEqual({ ideas: 1, dismissed: 1, posts: 1 })
  })
})

describe('drafting with Mario’s own input', () => {
  it('saves answers to an idea’s questions', async () => {
    const note = await newNote('Water ripple experiment.')
    ideasOutput = () => ({
      ideas: [idea('Ripples', { questions: ['Which engine?', 'Is it live?'] })],
    })
    const [ripples] = (await send<Idea[]>(app, '/api/ideas/generate', { assetIds: [note] })).body
    ideasOutput = () => ({ ideas: [idea('Idea one'), idea('Idea two')] })
    expect(ripples!.answers).toEqual(['', ''])

    const res = await send<Idea>(
      app,
      `/api/ideas/${ripples!.id}`,
      { answers: ['  Three.js r180 with a custom shader.  ', ''] },
      'PATCH'
    )
    expect(res.status).toBe(200)
    expect(res.body.questions).toEqual(['Which engine?', 'Is it live?'])
    expect(res.body.answers).toEqual(['Three.js r180 with a custom shader.', ''])
    // Clearing an answer.
    const cleared = await send<Idea>(app, `/api/ideas/${ripples!.id}`, { answers: [''] }, 'PATCH')
    expect(cleared.body.answers).toEqual(['', ''])
    const tooMany = await send(
      app,
      `/api/ideas/${ripples!.id}`,
      { answers: ['a', 'b', 'c'] },
      'PATCH'
    )
    expect(tooMany.status).toBe(400)
  })

  it('sends answers, format, direction and voice examples to the drafter', async () => {
    const project = await newProject('Ripple site')
    const note = await newNote('Ripple hero for a spa website.', project.id)

    // Mario's posts from another idea: an X post he edited and published, an X post he
    // edited, an X post published as the AI wrote it, and a LinkedIn edit (other platform).
    const other = await newIdea({ title: 'Older work', assetIds: [note] })
    draftsOutput = drafts('AI wrote this X post.', 'AI wrote this LinkedIn post.')
    const [editedX, editedLinkedin] = (
      await writeDrafts(other.id, { platforms: ['x', 'linkedin'] })
    ).body.postIds
    await handEdit(editedX!, 'Lighting took three tries. The last one was the simplest.')
    await publish(editedX!)
    await handEdit(editedLinkedin!, 'My LinkedIn words, not for X.')
    const [draftX] = (await writeDrafts(other.id, { platforms: ['x'] })).body.postIds
    await handEdit(draftX!, 'Pooling the ripples made it cheap.')
    const [publishedX] = (await writeDrafts(other.id, { platforms: ['x'] })).body.postIds
    await publish(publishedX!)
    // A blank draft started by hand has nothing to show.
    const [blankX] = (await writeDrafts(other.id, { platforms: ['x'] })).body.postIds
    await handEdit(blankX!, ' ')

    // An edited X post of a project that later turned AI off: never sent.
    const closed = await newProject('Closed later')
    const closedIdea = await newIdea({
      title: 'Closed idea',
      assetIds: [await newNote('Closed project note.', closed.id)],
    })
    const [closedPost] = (await writeDrafts(closedIdea.id, { platforms: ['x'] })).body.postIds
    await handEdit(closedPost!, 'Confidential edit that must never be sent.')
    await send(app, `/api/projects/${closed.id}`, { aiAllowed: false }, 'PATCH')

    // The idea being drafted: Mario's own, with an answered question.
    const mine = await newIdea({
      title: 'Ripples that follow the cursor',
      summary: 'How the ripple hero reacts to the pointer.',
      format: 'thread',
      angle: 'technical',
      platforms: ['x'],
      assetIds: [note],
    })
    db.prepare('UPDATE ideas SET questions = ? WHERE id = ?').run(
      JSON.stringify(['How many ripples at once?']),
      mine.id
    )
    await send(app, `/api/ideas/${mine.id}`, { answers: ['Up to 32, pooled.'] }, 'PATCH')
    // An earlier hand-edited draft of this same idea is not a voice example.
    const [earlier] = (await writeDrafts(mine.id, { platforms: ['x'] })).body.postIds
    await handEdit(earlier!, 'Earlier version of this very idea.')

    const res = await writeDrafts(mine.id, {
      platforms: ['x'],
      instruction: 'Keep each post under 200 characters.',
    })
    expect(res.status).toBe(201)
    const request = calls.at(-1)!
    expect(request.system).toContain('<voice_examples>')
    const text = promptText(request)
    expect(text).toContain('<idea angle="technical" format="thread" by="mario">')
    expect(text).toContain('Summary: How the ripple hero reacts to the pointer.')
    expect(text).toContain(
      '<answers by="mario">\nQ: How many ripples at once?\nA: Up to 32, pooled.\n</answers>'
    )
    expect(text).toContain("Mario's direction: Keep each post under 200 characters.")
    // Edited and published first, then edited, then published as written; three at most.
    const examples = [...text.matchAll(/<example ([^>]*)>\n([^\n]*)/g)].map((m) => [m[1], m[2]])
    expect(examples).toEqual([
      [
        'platform="x" status="published" by="mario"',
        'Lighting took three tries. The last one was the simplest.',
      ],
      ['platform="x" status="draft" by="mario"', 'Pooling the ripples made it cheap.'],
      ['platform="x" status="published"', 'AI wrote this X post.'],
    ])
    expect(text).not.toContain('My LinkedIn words')
    expect(text).not.toContain('Confidential edit')
    expect(text).not.toContain('Earlier version of this very idea.')

    const run = lastRun('draft-package')
    expect(run.version).toBe('draft-package@v2')
    expect(run.refs).toMatchObject({
      instruction: 'Keep each post under 200 characters.',
      answers: 1,
      voiceExamples: [editedX, draftX, publishedX],
    })
  })

  it('lists the drafts made from an idea, without discarded ones', async () => {
    const own = await newIdea({
      title: 'Drafts list',
      assetIds: [await newNote('Drafts list note.')],
    })
    draftsOutput = drafts('One.', 'Two.')
    const { postIds } = (await writeDrafts(own.id, { platforms: ['x', 'linkedin'] })).body
    let listed = (await ideasByTitle('drafted')).get('Drafts list')!
    expect(listed.drafts).toEqual([
      { id: postIds[0], platform: 'x', status: 'draft' },
      { id: postIds[1], platform: 'linkedin', status: 'draft' },
    ])
    await send(app, `/api/posts/${postIds[1]}`, { status: 'discarded' }, 'PATCH')
    listed = (await ideasByTitle('drafted')).get('Drafts list')!
    expect(listed.drafts.map((d) => d.platform)).toEqual(['x'])
  })
})
