import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { relativeTime } from '../../lib/format.ts'
import { ANGLE_LABEL, PLATFORM_LABEL, STATUS_LABEL } from '../../lib/labels.ts'
import { usePosts, useProfiles } from '../../lib/queries.ts'
import { useProfileFilter } from '../../lib/profile.tsx'
import './DraftsView.scss'

type Filter = 'draft,review,approved,scheduled' | 'published' | 'archived,discarded'

export function DraftsView() {
  const [filter, setFilter] = useState<Filter>('draft,review,approved,scheduled')
  const { data: posts, isLoading } = usePosts(filter)
  const { data: profiles } = useProfiles()
  const { profile } = useProfileFilter()

  const visible = (posts ?? []).filter(
    (post) => profile === 'all' || profiles?.find((p) => p.id === post.profileId)?.slug === profile
  )

  return (
    <>
      <ViewHeader
        title="Drafts"
        description="Platform-specific posts, from draft to published."
        actions={
          <Segmented<Filter>
            label="Filter drafts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'draft,review,approved,scheduled', label: 'In progress' },
              { value: 'published', label: 'Published' },
              { value: 'archived,discarded', label: 'Archived' },
            ]}
          />
        }
      />
      {isLoading ? null : visible.length ? (
        <div className="drafts-view__list flex flex-col">
          {visible.map((post) => (
            <Link
              key={post.id}
              to="/drafts/$id"
              params={{ id: post.id }}
              className="drafts-view__row flex items-center"
            >
              <span className="drafts-view__platform -meta shrink-0">
                {PLATFORM_LABEL[post.platform]}
              </span>
              <span className="drafts-view__text -p flex-1">
                {post.current?.segments[0]?.text ?? '(empty)'}
                {post.format === 'thread' ? (
                  <span className="drafts-view__muted">
                    {' '}
                    · {post.current?.segments.length} posts
                  </span>
                ) : null}
              </span>
              <span className="drafts-view__meta -meta shrink-0">
                {post.angle ? `${ANGLE_LABEL[post.angle]} · ` : ''}
                {STATUS_LABEL[post.status]} · {relativeTime(post.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No drafts here">
          Pick an idea on the Ideas page and choose “Write X drafts”.
        </EmptyState>
      )}
    </>
  )
}
