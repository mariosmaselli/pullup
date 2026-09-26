import { useMemo, useState } from 'react'
import { useMutationState } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Idea } from '@shared/types.ts'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { IdeaCard } from '../../components/IdeaCard/IdeaCard.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import type { ApiError } from '../../lib/api.ts'
import {
  DRAFT_IDEA_KEY,
  useAssets,
  useCreatePosts,
  useDraftIdea,
  useIdeas,
  useProjects,
  useSystem,
  useUpdateIdea,
} from '../../lib/queries.ts'
import { NewIdeaForm } from './NewIdeaForm.tsx'
import './IdeasView.scss'

type Filter = 'suggested,saved' | 'saved' | 'drafted' | 'dismissed'

export function IdeasView() {
  const [filter, setFilter] = useState<Filter>('suggested,saved')
  const [creating, setCreating] = useState(false)
  const { data: ideas, isLoading } = useIdeas(filter)
  const { data: assets } = useAssets('all')
  const { data: projects } = useProjects()
  const { data: system } = useSystem()
  const update = useUpdateIdea()
  const draft = useDraftIdea()
  const byHand = useCreatePosts()
  const navigate = useNavigate()

  const byId = useMemo(() => new Map((assets ?? []).map((a) => [a.id, a])), [assets])
  const projectById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects])

  // Why the AI can't write an idea's drafts: no key, or its project (or a source's) has AI off.
  const aiBlocked = (idea: Idea) => {
    if (system && !system.ai.enabled) {
      return 'AI isn’t set up (add your API key in Settings) — you can still write the drafts by hand.'
    }
    const off = [idea.projectId, ...idea.sources.map((s) => byId.get(s.assetId)?.projectId)]
      .map((id) => (id ? projectById.get(id) : undefined))
      .find((p) => p && !p.aiAllowed)
    return off
      ? `AI is off for “${off.name}”. Write the drafts by hand, or allow AI on the project page.`
      : null
  }

  // Every draft call in the cache, oldest first — including ones started before this view last
  // mounted (a draft takes minutes; leaving the page doesn't stop it). The latest call per idea
  // says whether it's still writing or how it failed.
  const calls = useMutationState({
    filters: { mutationKey: DRAFT_IDEA_KEY },
    select: (m) => ({
      id: (m.state.variables as { id: string } | undefined)?.id,
      status: m.state.status,
      error: m.state.error as ApiError | null,
    }),
  })
  const latest = new Map(calls.map((call) => [call.id, call]))
  const errorFor = (id: string) =>
    latest.get(id)?.status === 'error'
      ? latest.get(id)!.error!.message
      : byHand.variables?.ideaId === id && byHand.error
        ? byHand.error.message
        : null

  const openDraft = (postIds: string[], skipped: string[] = []) =>
    postIds[0] &&
    navigate({
      to: '/drafts/$id',
      params: { id: postIds[0] },
      search: { skipped: skipped.length ? skipped.join(',') : undefined },
    })

  return (
    <>
      <ViewHeader
        title="Ideas"
        description="Post concepts from your material, each citing what it's based on."
        actions={
          <div className="ideas-view__actions flex items-center">
            <Segmented<Filter>
              label="Filter ideas"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'suggested,saved', label: 'Open' },
                { value: 'saved', label: 'Saved' },
                { value: 'drafted', label: 'Drafted' },
                { value: 'dismissed', label: 'Dismissed' },
              ]}
            />
            <Button variant="primary" onClick={() => setCreating(true)} disabled={creating}>
              New idea
            </Button>
          </div>
        }
      />

      {creating ? (
        <NewIdeaForm
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            if (filter !== 'saved') setFilter('suggested,saved')
          }}
        />
      ) : null}

      {/* Cards wait for AI status and projects, so their buttons don't change after showing. */}
      {isLoading || !system || !projects ? null : ideas?.length ? (
        <div className="ideas-view__list flex flex-col">
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              assets={byId}
              drafting={
                latest.get(idea.id)?.status === 'pending' ||
                (byHand.isPending && byHand.variables?.ideaId === idea.id)
              }
              error={errorFor(idea.id)}
              aiBlocked={aiBlocked(idea)}
              onStatus={(status) => update.mutate({ id: idea.id, status })}
              onAnswers={(answers) => update.mutate({ id: idea.id, answers })}
              onDraft={(platforms, instruction) =>
                draft.mutate(
                  { id: idea.id, platforms, instruction: instruction || undefined },
                  { onSuccess: ({ postIds, skipped }) => openDraft(postIds, skipped) }
                )
              }
              onWriteByHand={(platforms) =>
                byHand.mutate(
                  { platforms, ideaId: idea.id },
                  { onSuccess: ({ postIds }) => openDraft(postIds) }
                )
              }
            />
          ))}
        </div>
      ) : creating ? null : (
        <EmptyState title={filter === 'suggested,saved' ? 'No open ideas' : 'Nothing here'}>
          Write one with “New idea”, choose “Get ideas” on a project, or open something in the Inbox
          or Library and choose “Get post ideas”.
        </EmptyState>
      )}
    </>
  )
}
