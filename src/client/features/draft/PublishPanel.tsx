import { useState } from 'react'
import type { Asset, PostDetail } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import type { ApiError } from '../../lib/api.ts'
import { assetTitle, dateTime } from '../../lib/format.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { useApproveMedia, useUpdatePost } from '../../lib/queries.ts'
import './PublishPanel.scss'

// "datetime-local" value for a Date, in local time.
const localInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const tomorrowMorning = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  return d
}

interface Props {
  post: PostDetail
  media: Asset[]
  privateMedia: Asset[]
}

// Getting a post out: approve its media, schedule it, then record where it went live.
export function PublishPanel({ post, media, privateMedia }: Props) {
  const update = useUpdatePost()
  const approve = useApproveMedia()
  const config = PLATFORMS[post.platform]
  const [when, setWhen] = useState(() =>
    localInput(post.scheduledFor ? new Date(post.scheduledFor) : tomorrowMorning())
  )
  const [url, setUrl] = useState(post.publicUrl ?? '')
  const error = (update.error ?? approve.error) as ApiError | null
  const published = post.status === 'published'

  return (
    <section className="publish-panel flex flex-col">
      <span className="publish-panel__label -meta">Publish</span>

      {privateMedia.length ? (
        <div className="publish-panel__notice flex flex-col">
          <p className="-p1">
            {privateMedia.length === 1 ? 'This media is' : `${privateMedia.length} media items are`}{' '}
            still private: {privateMedia.map(assetTitle).join(', ')}.
          </p>
          <Button
            size="s"
            disabled={approve.isPending}
            onClick={() => approve.mutate(post.id, { onSuccess: () => update.reset() })}
          >
            Approve for public use
          </Button>
        </div>
      ) : null}

      {published ? (
        <div className="publish-panel__done flex flex-col">
          <p className="-p1">
            Published {post.publishedAt ? dateTime(post.publishedAt) : ''}
            {post.publicUrl ? (
              <>
                {' · '}
                <a href={post.publicUrl} target="_blank" rel="noreferrer">
                  View post
                </a>
              </>
            ) : null}
          </p>
          <Button
            variant="ghost"
            size="s"
            onClick={() =>
              update.mutate({ id: post.id, status: 'approved', publishedAt: null, publicUrl: null })
            }
          >
            Undo
          </Button>
        </div>
      ) : (
        <>
          <div className="publish-panel__row flex flex-col">
            <label className="publish-panel__muted -meta" htmlFor={`when-${post.id}`}>
              {post.status === 'scheduled' ? 'Scheduled for' : 'Schedule for'}
            </label>
            <div className="flex items-center">
              <input
                id={`when-${post.id}`}
                className="publish-panel__input -p1 flex-1"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
            <div className="publish-panel__actions flex items-center">
              <Button
                size="s"
                disabled={update.isPending || !when}
                onClick={() =>
                  update.mutate({
                    id: post.id,
                    status: 'scheduled',
                    scheduledFor: new Date(when).toISOString(),
                  })
                }
              >
                {post.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
              </Button>
              {post.status === 'scheduled' ? (
                <Button
                  variant="ghost"
                  size="s"
                  onClick={() => update.mutate({ id: post.id, scheduledFor: null })}
                >
                  Unschedule
                </Button>
              ) : null}
            </div>
          </div>

          <div className="publish-panel__row flex flex-col">
            <label className="publish-panel__muted -meta" htmlFor={`url-${post.id}`}>
              Posted it? Paste the link
            </label>
            <input
              id={`url-${post.id}`}
              className="publish-panel__input -p1"
              type="url"
              placeholder={
                post.platform === 'x'
                  ? 'https://x.com/…/status/…'
                  : post.platform === 'linkedin'
                    ? 'https://www.linkedin.com/feed/update/…'
                    : 'https://www.instagram.com/…'
              }
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button
              variant="primary"
              size="s"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ id: post.id, status: 'published', publicUrl: url.trim() || null })
              }
            >
              Mark as published
            </Button>
          </div>
        </>
      )}

      {!config.frames && media.length ? (
        <div className="publish-panel__row flex flex-col">
          <span className="publish-panel__muted -meta">Media to attach</span>
          <ul className="publish-panel__files -p1">
            {media.map((a) =>
              a.file ? (
                <li key={a.id}>
                  <a href={a.file.url} download={a.file.originalName}>
                    ↓ {assetTitle(a)}
                  </a>
                </li>
              ) : null
            )}
          </ul>
        </div>
      ) : null}

      {error ? <p className="publish-panel__error -p1">{error.message}</p> : null}
    </section>
  )
}
