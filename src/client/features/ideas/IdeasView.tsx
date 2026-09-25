import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { IdeaCard } from '../../components/IdeaCard/IdeaCard.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import type { ApiError } from '../../lib/api.ts'
import { useAssets, useDraftIdea, useIdeas, useUpdateIdea } from '../../lib/queries.ts'
import './IdeasView.scss'

type Filter = 'suggested,saved' | 'saved' | 'drafted' | 'dismissed'

export function IdeasView() {
  const [filter, setFilter] = useState<Filter>('suggested,saved')
  const { data: ideas, isLoading } = useIdeas(filter)
  const { data: assets } = useAssets('all')
  const update = useUpdateIdea()
  const draft = useDraftIdea()
  const navigate = useNavigate()

  const byId = useMemo(() => new Map((assets ?? []).map((a) => [a.id, a])), [assets])

  return (
    <>
      <ViewHeader
        title="Ideas"
        description="Post concepts from your material, each citing what it's based on."
        actions={
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
        }
      />

      {draft.error ? (
        <p className="ideas-view__error -p1">{(draft.error as ApiError).message}</p>
      ) : null}

      {isLoading ? null : ideas?.length ? (
        <div className="ideas-view__list flex flex-col">
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              assets={byId}
              drafting={draft.isPending && draft.variables?.id === idea.id}
              onStatus={(status) => update.mutate({ id: idea.id, status })}
              onDraft={(platforms) =>
                draft.mutate(
                  { id: idea.id, platforms },
                  {
                    onSuccess: ({ postIds }) =>
                      postIds[0] && navigate({ to: '/drafts/$id', params: { id: postIds[0] } }),
                  }
                )
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState title={filter === 'suggested,saved' ? 'No open ideas' : 'Nothing here'}>
          Open something in the Inbox or Library and choose “Get post ideas”.
        </EmptyState>
      )}
    </>
  )
}
