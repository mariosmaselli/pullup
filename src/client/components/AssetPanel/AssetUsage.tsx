import { Link } from '@tanstack/react-router'
import type { Platform, PostStatus } from '@shared/constants.ts'
import { useAssetUsage } from '../../lib/queries.ts'
import './AssetUsage.scss'

const PLATFORM: Record<Platform, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
  ig_story: 'Story',
  ig_feed: 'Instagram',
}

const STATUS: Record<PostStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
  discarded: 'Discarded',
}

// Posts that show this asset and ideas based on it. `blocking`: a delete just failed because of
// the posts — they're highlighted.
export function AssetUsage({ assetId, blocking }: { assetId: string; blocking?: boolean }) {
  const { data: usage } = useAssetUsage(assetId)
  const posts = usage?.posts ?? []
  const ideas = usage?.ideas ?? []

  return (
    <section className="asset-usage flex flex-col" data-blocking={blocking || undefined}>
      <h3 className="asset-usage__heading -meta">Used in</h3>
      {!usage ? (
        <p className="asset-usage__muted -p1">…</p>
      ) : !posts.length && !ideas.length ? (
        <p className="asset-usage__muted -p1">Not in any post or idea yet.</p>
      ) : (
        <ul className="asset-usage__list flex flex-col">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                to="/drafts/$id"
                params={{ id: post.id }}
                className="asset-usage__item flex flex-col"
                data-kind="post"
              >
                <span className="asset-usage__meta -meta">
                  {PLATFORM[post.platform]} post · {STATUS[post.status]}
                </span>
                <span className="asset-usage__text -p1">{post.excerpt || 'Untitled draft'}</span>
              </Link>
            </li>
          ))}
          {ideas.map((idea) => (
            <li key={idea.id}>
              <Link to="/ideas" className="asset-usage__item flex flex-col" data-kind="idea">
                <span className="asset-usage__meta -meta">Idea · {idea.status}</span>
                <span className="asset-usage__text -p1">{idea.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
