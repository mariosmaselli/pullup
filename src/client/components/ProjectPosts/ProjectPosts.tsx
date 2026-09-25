import { Link } from '@tanstack/react-router'
import type { Post } from '@shared/types.ts'
import { dateTime } from '../../lib/format.ts'
import { STATUS_LABEL } from '../../lib/labels.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { usePosts } from '../../lib/queries.ts'
import './ProjectPosts.scss'

const snippet = (post: Post) => {
  const text = post.current?.segments[0]?.text ?? ''
  return text.length > 90 ? `${text.slice(0, 90)}…` : text || '(empty)'
}

// "What have I already shared about this project?" — published posts first, then work in progress.
export function ProjectPosts({ projectId }: { projectId: string }) {
  const { data: posts = [] } = usePosts('draft,review,approved,scheduled,published', projectId)
  if (!posts.length) return null
  const published = posts.filter((p) => p.status === 'published')
  const open = posts.filter((p) => p.status !== 'published')

  const row = (post: Post) => (
    <li key={post.id} className="project-posts__row flex items-center">
      <span className="project-posts__platform -meta shrink-0">
        {PLATFORMS[post.platform].label}
      </span>
      <Link to="/drafts/$id" params={{ id: post.id }} className="project-posts__text -p1 flex-1">
        {snippet(post)}
      </Link>
      <span className="project-posts__meta -meta shrink-0">
        {post.status === 'published'
          ? post.publishedAt
            ? dateTime(post.publishedAt)
            : 'Published'
          : post.status === 'scheduled' && post.scheduledFor
            ? `Scheduled · ${dateTime(post.scheduledFor)}`
            : STATUS_LABEL[post.status]}
      </span>
      {post.publicUrl ? (
        <a
          className="project-posts__link -p1 shrink-0"
          href={post.publicUrl}
          target="_blank"
          rel="noreferrer"
        >
          View
        </a>
      ) : null}
    </li>
  )

  return (
    <section className="project-posts flex flex-col">
      {published.length ? (
        <div className="flex flex-col">
          <span className="project-posts__label -meta">Published · {published.length}</span>
          <ul className="project-posts__list">{published.map(row)}</ul>
        </div>
      ) : null}
      {open.length ? (
        <div className="flex flex-col">
          <span className="project-posts__label -meta">In progress · {open.length}</span>
          <ul className="project-posts__list">{open.map(row)}</ul>
        </div>
      ) : null}
    </section>
  )
}
