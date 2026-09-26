import { randomUUID } from 'node:crypto'
import type { Angle, IdeaStatus, Platform, PostFormat } from '@shared/constants.ts'
import type { Idea, IdeaDraft } from '@shared/types.ts'
import type { DB } from '../db/index.ts'
import { notify } from '../lib/events.ts'
import { now } from './assets.ts'
import { writingProfile } from './profiles.ts'

interface IdeaRow {
  id: string
  title: string
  summary: string
  angle: Idea['angle']
  format: Idea['format']
  platforms: string
  rationale: string
  questions: string
  origin: Idea['origin']
  status: IdeaStatus
  profile_id: string | null
  project_id: string | null
  created_at: string
}

// ideas.questions holds the AI's questions and Mario's answers. Each item is the question text,
// or { question, answer } once he has answered it — older rows are plain strings.
type StoredQuestion = string | { question: string; answer?: string }

export interface IdeaQuestion {
  question: string
  answer: string
}

export function parseQuestions(json: string): IdeaQuestion[] {
  return (JSON.parse(json) as StoredQuestion[]).map((q) =>
    typeof q === 'string'
      ? { question: q, answer: '' }
      : { question: q.question, answer: q.answer ?? '' }
  )
}

const storeQuestions = (items: IdeaQuestion[]): string =>
  JSON.stringify(
    items.map<StoredQuestion>(({ question, answer }) =>
      answer.trim() ? { question, answer: answer.trim() } : question
    )
  )

// An idea Mario writes himself — no AI involved, so it works for projects with AI off.
export interface NewIdea {
  title: string
  summary?: string
  angle?: Angle | null
  format?: PostFormat | null
  platforms?: Platform[]
  assetIds?: string[]
  projectId?: string | null
}

export class IdeaInputError extends Error {
  status = 400 as const
}

export function createIdeaStore(db: DB) {
  const sourcesFor = (ids: string[]) => {
    // In the order they were added (the primary key would otherwise order them by asset id).
    const rows = db
      .prepare(
        'SELECT * FROM idea_sources WHERE idea_id IN (SELECT value FROM json_each(?)) ORDER BY rowid'
      )
      .all(JSON.stringify(ids)) as { idea_id: string; asset_id: string; note: string }[]
    const map = new Map<string, Idea['sources']>()
    for (const r of rows)
      map.set(r.idea_id, [...(map.get(r.idea_id) ?? []), { assetId: r.asset_id, note: r.note }])
    return map
  }

  // Drafts written from each idea, in editor tab order.
  const draftsFor = (ids: string[]) => {
    const rows = db
      .prepare(
        `SELECT id, idea_id, platform, status FROM posts
         WHERE idea_id IN (SELECT value FROM json_each(?)) AND status != 'discarded'
         ORDER BY CASE platform WHEN 'x' THEN 0 WHEN 'linkedin' THEN 1 WHEN 'ig_story' THEN 2 ELSE 3 END,
           created_at`
      )
      .all(JSON.stringify(ids)) as (IdeaDraft & { idea_id: string })[]
    const map = new Map<string, IdeaDraft[]>()
    for (const { idea_id, ...draft } of rows) map.set(idea_id, [...(map.get(idea_id) ?? []), draft])
    return map
  }

  const hydrate = (rows: IdeaRow[]): Idea[] => {
    const ids = rows.map((r) => r.id)
    const sources = sourcesFor(ids)
    const drafts = draftsFor(ids)
    return rows.map((r) => {
      const questions = parseQuestions(r.questions)
      return {
        id: r.id,
        title: r.title,
        summary: r.summary,
        angle: r.angle,
        format: r.format,
        platforms: JSON.parse(r.platforms),
        rationale: r.rationale,
        questions: questions.map((q) => q.question),
        answers: questions.map((q) => q.answer),
        origin: r.origin,
        status: r.status,
        profileId: r.profile_id,
        projectId: r.project_id,
        sources: sources.get(r.id) ?? [],
        drafts: drafts.get(r.id) ?? [],
        createdAt: r.created_at,
      }
    })
  }

  return {
    list(statuses: IdeaStatus[], ids?: string[]): Idea[] {
      const rows = db
        .prepare(
          `SELECT * FROM ideas WHERE status IN (SELECT value FROM json_each(@statuses))
           ${ids ? 'AND id IN (SELECT value FROM json_each(@ids))' : ''}
           ORDER BY created_at DESC LIMIT 300`
        )
        .all({ statuses: JSON.stringify(statuses), ids: JSON.stringify(ids ?? []) }) as IdeaRow[]
      return hydrate(rows)
    },

    get(id: string): Idea | undefined {
      const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id) as IdeaRow | undefined
      return row ? hydrate([row])[0] : undefined
    },

    exists(id: string) {
      return !!db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(id)
    },

    create(input: NewIdea): Idea {
      const assetIds = [...new Set(input.assetIds ?? [])]
      const found = db
        .prepare('SELECT id, project_id FROM assets WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(assetIds)) as { id: string; project_id: string | null }[]
      if (found.length !== assetIds.length)
        throw new IdeaInputError('Some sources no longer exist.')
      if (
        input.projectId &&
        !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)
      )
        throw new IdeaInputError('Project not found')
      // Its project: the one picked, else the first source's.
      const projectId =
        input.projectId ??
        assetIds.map((id) => found.find((f) => f.id === id)?.project_id).find(Boolean) ??
        null

      const id = randomUUID()
      db.transaction(() => {
        db.prepare(
          `INSERT INTO ideas (id, title, summary, angle, format, platforms, rationale, questions,
             origin, status, profile_id, project_id)
           VALUES (@id, @title, @summary, @angle, @format, @platforms, '', '[]',
             'manual', 'saved', @profile_id, @project_id)`
        ).run({
          id,
          title: input.title,
          summary: input.summary ?? '',
          angle: input.angle ?? null,
          format: input.format ?? null,
          platforms: JSON.stringify(input.platforms ?? []),
          profile_id: writingProfile(db).id,
          project_id: projectId,
        })
        const insert = db.prepare('INSERT INTO idea_sources (idea_id, asset_id) VALUES (?, ?)')
        for (const assetId of assetIds) insert.run(id, assetId)
      })()
      notify('ideas')
      return this.get(id)!
    },

    setStatus(id: string, status: IdeaStatus) {
      db.prepare('UPDATE ideas SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
      notify('ideas')
    },

    // Mario's answers to the idea's questions, by position ('' clears one).
    setAnswers(id: string, answers: string[]) {
      const row = db.prepare('SELECT questions FROM ideas WHERE id = ?').get(id) as {
        questions: string
      }
      const questions = parseQuestions(row.questions)
      if (answers.length > questions.length) {
        throw new IdeaInputError('More answers than the idea has questions.')
      }
      const updated = questions.map((q, i) => ({ ...q, answer: answers[i] ?? q.answer }))
      db.prepare('UPDATE ideas SET questions = ?, updated_at = ? WHERE id = ?').run(
        storeQuestions(updated),
        now(),
        id
      )
      notify('ideas')
    },
  }
}

export type IdeaStore = ReturnType<typeof createIdeaStore>
