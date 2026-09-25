import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AssetAnalysis } from '@shared/types.ts'
import type { AiDeps } from '../../index.ts'
import { loadPrompt } from '../../prompts.ts'
import { runAi } from '../../run.ts'
import { toAnalysis, type AnalysisRow } from '../../../services/assets.ts'
import { AiError } from '../../provider.ts'

const prompt = loadPrompt('analyze-asset', 'v1')

export const Output = z.object({
  description: z.string(),
  subjects: z.array(z.string()),
  suggestedTags: z.array(z.string()),
  suggestedProjectId: z.string().nullable(),
  hooks: z.array(z.string()),
  questions: z.array(z.string()),
})

export async function analyzeAsset(deps: AiDeps, assetId: string): Promise<AssetAnalysis> {
  const { db, provider, context, assets } = deps
  const row = assets.row(assetId)
  if (!row) throw new AiError('Asset not found', 400)
  if (row.processing_status !== 'ready') {
    throw new AiError('This asset is still processing — try again in a moment.', 400)
  }

  const sources = await context.sources([row], { maxFramesPerVideo: 6, includeAnalysis: false })
  const projects = db
    .prepare("SELECT id, name, description FROM projects WHERE status != 'archived'")
    .all() as {
    id: string
    name: string
    description: string
  }[]

  const result = await runAi(
    db,
    provider,
    { task: 'analyze-asset', promptVersion: prompt.version, inputRefs: { assetId } },
    {
      system: prompt.system,
      effort: 'low',
      schema: Output,
      content: [
        {
          type: 'text',
          text: [
            projects.length
              ? `Existing projects:\n${projects.map((p) => `- ${p.id}: ${p.name}${p.description ? ` — ${p.description}` : ''}`).join('\n')}`
              : 'Existing projects: none yet.',
            `The material:\n${sources.text}`,
          ].join('\n\n'),
        },
        ...sources.images,
      ],
    }
  )

  const out = result.output
  const projectId =
    out.suggestedProjectId && projects.some((p) => p.id === out.suggestedProjectId)
      ? out.suggestedProjectId
      : null
  const id = randomUUID()
  db.prepare(
    `INSERT INTO asset_analyses (id, asset_id, ai_run_id, description, subjects, suggested_tags,
       suggested_project_id, hooks, questions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    assetId,
    result.runId,
    out.description,
    JSON.stringify(out.subjects),
    JSON.stringify(out.suggestedTags),
    projectId,
    JSON.stringify(out.hooks),
    JSON.stringify(out.questions)
  )
  deps.notify()
  return toAnalysis(db.prepare('SELECT * FROM asset_analyses WHERE id = ?').get(id) as AnalysisRow)
}
