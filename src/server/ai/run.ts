import { randomUUID } from 'node:crypto'
import type { DB } from '../db/index.ts'
import type { AiProvider, AiRequest, AiResult } from './provider.ts'

// Runs one AI call and records it in ai_runs — success or failure — with cost and prompt version.
export async function runAi<T>(
  db: DB,
  provider: AiProvider,
  meta: { task: string; promptVersion: string; inputRefs: Record<string, unknown> },
  request: AiRequest<T>
): Promise<AiResult<T> & { runId: string }> {
  const runId = randomUUID()
  const started = Date.now()
  const insert = db.prepare(
    `INSERT INTO ai_runs (id, task, prompt_version, provider, model, input_refs, output,
       tokens_in, tokens_out, cost_usd, duration_ms, error)
     VALUES (@id, @task, @prompt_version, @provider, @model, @input_refs, @output,
       @tokens_in, @tokens_out, @cost_usd, @duration_ms, @error)`
  )
  const base = {
    id: runId,
    task: meta.task,
    prompt_version: meta.promptVersion,
    provider: provider.name,
    input_refs: JSON.stringify(meta.inputRefs),
  }

  try {
    const result = await provider.generate(request)
    insert.run({
      ...base,
      model: result.model,
      output: JSON.stringify(result.output),
      tokens_in:
        result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens,
      tokens_out: result.usage.outputTokens,
      cost_usd: result.costUsd,
      duration_ms: Date.now() - started,
      error: null,
    })
    return { ...result, runId }
  } catch (err) {
    insert.run({
      ...base,
      model: provider.model,
      output: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      duration_ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
