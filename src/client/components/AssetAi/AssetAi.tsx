import { Link, useNavigate } from '@tanstack/react-router'
import type { Asset } from '@shared/types.ts'
import { ApiError } from '../../lib/api.ts'
import { relativeTime } from '../../lib/format.ts'
import { useWritingProfile } from '../../lib/profile.tsx'
import {
  useAnalyzeAsset,
  useGenerateIdeas,
  useProjects,
  useSystem,
  useUpdateAsset,
} from '../../lib/queries.ts'
import { Button } from '../Button/Button.tsx'
import './AssetAi.scss'

// AI suggestions for one asset, kept visually separate from what Mario wrote.
export function AssetAi({ asset }: { asset: Asset }) {
  const { data: system } = useSystem()
  const { data: projects } = useProjects()
  const analyze = useAnalyzeAsset()
  const generate = useGenerateIdeas()
  const update = useUpdateAsset()
  const profile = useWritingProfile()
  const navigate = useNavigate()

  const project = projects?.find((p) => p.id === asset.projectId)
  const blockedByProject = project && !project.aiAllowed
  const suggestedProject = projects?.find((p) => p.id === asset.analysis?.suggestedProjectId)
  const busy = analyze.isPending || generate.isPending
  const ready = asset.processingStatus === 'ready'
  const error = (analyze.error ?? generate.error) as ApiError | null

  if (system && !system.ai.enabled) {
    return (
      <section className="asset-ai">
        <h3 className="asset-ai__heading -meta">AI</h3>
        <p className="asset-ai__muted -p1">
          AI isn’t set up yet. Add your Anthropic API key in{' '}
          <Link to="/settings" className="asset-ai__link">
            Settings
          </Link>
          .
        </p>
      </section>
    )
  }

  if (blockedByProject) {
    return (
      <section className="asset-ai">
        <h3 className="asset-ai__heading -meta">AI</h3>
        <p className="asset-ai__muted -p1">
          AI analysis is off for “{project.name}”. Allow it on the project page to use it here.
        </p>
      </section>
    )
  }

  const analysis = asset.analysis

  return (
    <section className="asset-ai flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="asset-ai__heading -meta">
          AI {analysis ? `· analyzed ${relativeTime(analysis.createdAt)}` : ''}
        </h3>
        <Button
          variant="ghost"
          size="s"
          disabled={busy || !ready}
          onClick={() => analyze.mutate(asset.id)}
        >
          {analyze.isPending ? 'Looking…' : analysis ? 'Re-analyze' : 'Analyze'}
        </Button>
      </div>

      {analysis ? (
        <div className="asset-ai__result flex flex-col">
          <p className="-p1">{analysis.description}</p>

          {suggestedProject && suggestedProject.id !== asset.projectId ? (
            <div className="asset-ai__suggestion flex items-center justify-between">
              <span className="-p1">Looks like “{suggestedProject.name}”</span>
              <Button
                size="s"
                onClick={() => update.mutate({ id: asset.id, projectId: suggestedProject.id })}
              >
                Assign
              </Button>
            </div>
          ) : null}

          {analysis.hooks.length ? (
            <div className="flex flex-col">
              <span className="asset-ai__label -meta">Worth sharing</span>
              <ul className="asset-ai__list -p1">
                {analysis.hooks.map((hook) => (
                  <li key={hook}>{hook}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.questions.length ? (
            <div className="flex flex-col">
              <span className="asset-ai__label -meta">Answer in Notes for better posts</span>
              <ul className="asset-ai__list -p1">
                {analysis.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.suggestedTags.length ? (
            <div className="asset-ai__tags flex">
              {analysis.suggestedTags.map((tag) => (
                <span key={tag} className="asset-ai__tag -meta">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="asset-ai__muted -p1">
          Analyze to get a description, what might be worth sharing and questions that make posts
          more accurate. Your title and notes are always used as the main source.
        </p>
      )}

      <Button
        variant="primary"
        disabled={busy || !ready}
        onClick={() =>
          generate.mutate(
            { assetIds: [asset.id], profileId: profile?.id },
            { onSuccess: () => navigate({ to: '/ideas' }) }
          )
        }
      >
        {generate.isPending ? 'Thinking of ideas…' : 'Get post ideas'}
      </Button>

      {error ? <p className="asset-ai__error -p1">{error.message}</p> : null}
    </section>
  )
}
