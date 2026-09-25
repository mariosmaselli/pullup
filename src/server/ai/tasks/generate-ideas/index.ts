import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ANGLES, PLATFORMS } from '@shared/constants.ts'
import type { AiDeps } from '../../index.ts'
import { loadPrompt } from '../../prompts.ts'
import { runAi } from '../../run.ts'
import { AiError } from '../../provider.ts'

const prompt = loadPrompt('generate-ideas', 'v1')

const Output = z.object({
  ideas: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      angle: z.enum(ANGLES),
      format: z.enum(['single', 'thread', 'story_seq', 'carousel']),
      platforms: z.array(z.enum(PLATFORMS)),
      rationale: z.string(),
      sourceAssetIds: z.array(z.string()),
      questions: z.array(z.string()),
    })
  ),
})

export interface GenerateIdeasInput {
  assetIds: string[]
  profileId?: string | null
  instruction?: string
}

export async function generateIdeas(deps: AiDeps, input: GenerateIdeasInput): Promise<string[]> {
  const { db, provider, context, assets } = deps
  const rows = assets.rows(input.assetIds)
  if (!rows.length) throw new AiError('Select at least one asset.', 400)

  const sources = await context.sources(rows)
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter((id): id is string => !!id))]
  const profile = input.profileId
    ? (db.prepare('SELECT name, voice_guide FROM profiles WHERE id = ?').get(input.profileId) as
        { name: string; voice_guide: string } | undefined)
    : undefined

  // Existing ideas and posts on this material, to avoid repeats.
  const covered = db
    .prepare(
      `SELECT DISTINCT i.title FROM ideas i JOIN idea_sources s ON s.idea_id = i.id
       WHERE s.asset_id IN (SELECT value FROM json_each(?)) AND i.status != 'dismissed'
       ORDER BY i.created_at DESC LIMIT 20`
    )
    .all(JSON.stringify(input.assetIds)) as { title: string }[]

  const result = await runAi(
    db,
    provider,
    {
      task: 'generate-ideas',
      promptVersion: prompt.version,
      inputRefs: { assetIds: input.assetIds, profileId: input.profileId ?? null },
    },
    {
      system: prompt.system,
      effort: 'medium',
      schema: Output,
      content: [
        {
          type: 'text',
          text: [
            profile && `Posting as: ${profile.name}. ${profile.voice_guide}`,
            ...projectIds.map((id) => context.describeProject(id)),
            covered.length && `Already covered:\n${covered.map((c) => `- ${c.title}`).join('\n')}`,
            input.instruction && `Mario's direction: ${input.instruction}`,
            `The material:\n${sources.text}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...sources.images,
      ],
    }
  )

  const validIds = new Set(rows.map((r) => r.id))
  const insertIdea = db.prepare(
    `INSERT INTO ideas (id, title, summary, angle, format, platforms, rationale, questions,
       origin, status, profile_id, project_id, ai_run_id)
     VALUES (@id, @title, @summary, @angle, @format, @platforms, @rationale, @questions,
       'asset', 'suggested', @profile_id, @project_id, @ai_run_id)`
  )
  const insertSource = db.prepare(
    'INSERT OR IGNORE INTO idea_sources (idea_id, asset_id) VALUES (?, ?)'
  )

  const ids: string[] = []
  db.transaction(() => {
    for (const idea of result.output.ideas) {
      // Only keep citations of assets that were actually provided; fall back to all of them.
      const cited = idea.sourceAssetIds.filter((id) => validIds.has(id))
      const sourceIds = cited.length ? cited : [...validIds]
      const id = randomUUID()
      insertIdea.run({
        id,
        title: idea.title,
        summary: idea.summary,
        angle: idea.angle,
        format: idea.format,
        platforms: JSON.stringify(idea.platforms),
        rationale: idea.rationale,
        questions: JSON.stringify(idea.questions),
        profile_id: input.profileId ?? null,
        project_id: rows.find((r) => sourceIds.includes(r.id))?.project_id ?? null,
        ai_run_id: result.runId,
      })
      for (const assetId of sourceIds) insertSource.run(id, assetId)
      ids.push(id)
    }
  })()
  deps.notify()
  return ids
}
