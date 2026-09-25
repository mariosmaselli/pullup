import type { DB } from '../db/index.ts'
import type { AssetStore } from '../services/assets.ts'
import { config } from '../config.ts'
import { createContextBuilder, type ContextBuilder } from './context.ts'
import type { AiProvider } from './provider.ts'
import { createAnthropicProvider, unavailableProvider } from './providers/anthropic.ts'
import { analyzeAsset } from './tasks/analyze-asset/index.ts'
import { generateIdeas, type GenerateIdeasInput } from './tasks/generate-ideas/index.ts'
import { draftPost } from './tasks/draft-post/index.ts'
import { revisePost } from './tasks/revise-post/index.ts'

export interface AiDeps {
  db: DB
  provider: AiProvider
  context: ContextBuilder
  assets: AssetStore
  notify: () => void
}

export const defaultProvider = (): AiProvider =>
  config.anthropicApiKey ? createAnthropicProvider(config.anthropicApiKey) : unavailableProvider

// The AI operations Pullup offers. Each is one structured call, logged in ai_runs.
export function createAi(deps: Omit<AiDeps, 'context'>) {
  const full: AiDeps = { ...deps, context: createContextBuilder(deps.db) }
  return {
    enabled: deps.provider.name !== 'none',
    analyzeAsset: (assetId: string) => analyzeAsset(full, assetId),
    generateIdeas: (input: GenerateIdeasInput) => generateIdeas(full, input),
    draftPost: (input: { ideaId: string; profileId: string; instruction?: string }) =>
      draftPost(full, input),
    revisePost: (input: { postId: string; instruction: string }) => revisePost(full, input),
  }
}

export type Ai = ReturnType<typeof createAi>
