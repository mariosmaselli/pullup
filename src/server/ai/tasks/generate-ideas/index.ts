import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ANGLES, PLATFORMS } from '@shared/constants.ts'
import type { AiDeps } from '../../index.ts'
import { loadPrompt } from '../../prompts.ts'
import { runAi } from '../../run.ts'
import { AiError } from '../../provider.ts'
import { writingProfile } from '../../../services/profiles.ts'

const prompt = loadPrompt('generate-ideas', 'v3')

// The most assets one call looks at (a whole project is capped to this many).
export const MAX_IDEA_SOURCES = 12

export const Output = z.object({
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
  assetIds?: string[]
  // A whole project: up to MAX_IDEA_SOURCES of its assets (used when assetIds is empty).
  projectId?: string
  profileId?: string | null
  instruction?: string
}

export async function generateIdeas(deps: AiDeps, input: GenerateIdeasInput): Promise<string[]> {
  const { db, provider, context, assets } = deps
  const wholeProject = !input.assetIds?.length && input.projectId
  if (wholeProject) {
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) {
      throw new AiError('Project not found', 400)
    }
    context.assertProjectAllowed(input.projectId!)
  }
  const rows = assets.rows(
    wholeProject
      ? context.projectMaterial(input.projectId!, MAX_IDEA_SOURCES)
      : (input.assetIds ?? []).slice(0, MAX_IDEA_SOURCES)
  )
  if (!rows.length) {
    throw new AiError(
      wholeProject ? 'This project has no material ready yet.' : 'Select at least one asset.',
      400
    )
  }
  const assetIds = rows.map((r) => r.id)

  // Many items share the image budget: fewer frames per recording so more items are seen.
  const sources = await context.sources(rows, { maxFramesPerVideo: rows.length > 4 ? 2 : 4 })
  const projectIds = [
    ...new Set(
      [wholeProject ? input.projectId : null, ...rows.map((r) => r.project_id)].filter(
        (id): id is string => !!id
      )
    ),
  ]
  const profile = writingProfile(db, input.profileId)

  // Ideas, dismissals and approved/published posts on this material or project: no repeats.
  const covered = context.covered({ assetIds, projectIds })

  const result = await runAi(
    db,
    provider,
    {
      task: 'generate-ideas',
      promptVersion: prompt.version,
      inputRefs: {
        assetIds,
        projectId: wholeProject ? input.projectId : undefined,
        profileId: profile.id,
        instruction: input.instruction || undefined,
        covered: covered.counts,
      },
    },
    {
      system: prompt.system,
      effort: 'medium',
      schema: Output,
      content: [
        {
          type: 'text',
          text: [
            `Posting as: ${profile.name}. ${profile.voice_guide}`,
            ...projectIds.map((id) => context.describeProject(id)),
            covered.text,
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
        profile_id: profile.id,
        project_id:
          rows.find((r) => sourceIds.includes(r.id))?.project_id ??
          (wholeProject ? input.projectId! : null),
        ai_run_id: result.runId,
      })
      for (const assetId of sourceIds) insertSource.run(id, assetId)
      ids.push(id)
    }
  })()
  deps.notify()
  return ids
}
