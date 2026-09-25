import type { DB } from '../db/index.ts'
import type { AssetStore } from '../services/assets.ts'
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

export type ProviderFactory = (apiKey: string) => AiProvider

export const providerFor = (apiKey: string, factory: ProviderFactory = createAnthropicProvider) =>
  apiKey ? factory(apiKey) : unavailableProvider

// The AI operations Pullup offers. Each is one structured call, logged in ai_runs.
export function createAi(deps: Omit<AiDeps, 'context'>) {
  const full: AiDeps = { ...deps, context: createContextBuilder(deps.db) }
  return {
    get enabled() {
      return full.provider.name !== 'none'
    },
    // Swapped when the API key is saved or removed in Settings — no restart needed.
    setProvider(provider: AiProvider) {
      full.provider = provider
    },
    analyzeAsset: (assetId: string) => analyzeAsset(full, assetId),
    generateIdeas: (input: GenerateIdeasInput) => generateIdeas(full, input),
    draftPost: (input: { ideaId: string; profileId?: string | null; instruction?: string }) =>
      draftPost(full, input),
    revisePost: (input: { postId: string; instruction: string }) => revisePost(full, input),
  }
}

export type Ai = ReturnType<typeof createAi>
