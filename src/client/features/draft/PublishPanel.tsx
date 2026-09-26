import { useEffect, useState } from 'react'
import type { Asset, PostDetail } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import type { ApiError } from '../../lib/api.ts'
import { assetTitle, dateTime } from '../../lib/format.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { useApproveMedia, useUpdatePost } from '../../lib/queries.ts'
import { isDue, useNow } from '../../lib/due.ts'
import './PublishPanel.scss'

// "datetime-local" value for a Date, in local time.
export const localInput = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const urlPlaceholder = (platform: PostDetail['platform']) =>
  platform === 'x'
    ? 'https://x.com/…/status/…'
    : platform === 'linkedin'
      ? 'https://www.linkedin.com/feed/update/…'
      : 'https://www.instagram.com/…'

const tomorrowMorning = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  return d
}

// 10:00 on a planned day (local YYYY-MM-DD).
const plannedMorning = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 10, 0, 0, 0)
}

const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

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
    localInput(
      post.scheduledFor
        ? new Date(post.scheduledFor)
        : post.plannedFor
          ? plannedMorning(post.plannedFor)
          : tomorrowMorning()
    )
  )
  // Status workflow: drafts are approved before they're scheduled or marked published.
  const early = post.status === 'draft' || post.status === 'review'
  const shelved = post.status === 'archived' || post.status === 'discarded'
  const plannable = early || post.status === 'approved'
  // The pencilled-in day; saved once the field holds a whole date.
  const [plan, setPlan] = useState(post.plannedFor ?? '')
  useEffect(() => setPlan(post.plannedFor ?? ''), [post.plannedFor])
  const [url, setUrl] = useState(post.publicUrl ?? '')
  const now = useNow()
  const due = isDue(post, now)
  // When it went out: the recorded date, else — for a due post — its slot, else now.
  const [publishedWhen, setPublishedWhen] = useState(() =>
    localInput(
      new Date(post.publishedAt ?? (due ? post.scheduledFor! : new Date(now).toISOString()))
    )
  )
  const error = (update.error ?? approve.error) as ApiError | null
  const published = post.status === 'published'
  const recorded = {
    url: post.publicUrl ?? '',
    when: post.publishedAt ? localInput(new Date(post.publishedAt)) : '',
  }
  const edited = published && (url.trim() !== recorded.url || publishedWhen !== recorded.when)

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

      {due ? (
        <div className="publish-panel__notice flex flex-col">
          <p className="-p1">
            Due since {dateTime(post.scheduledFor!)}. Post it on {config.label}, then paste the link
            below and mark it published.
          </p>
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

          {/* The link and date can be filled in or corrected afterwards. */}
          <div className="publish-panel__row flex flex-col">
            <label className="publish-panel__muted -meta" htmlFor={`url-${post.id}`}>
              Link
            </label>
            <input
              id={`url-${post.id}`}
              className="publish-panel__input -p1"
              type="url"
              placeholder={urlPlaceholder(post.platform)}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <label className="publish-panel__muted -meta" htmlFor={`published-${post.id}`}>
              Published on
            </label>
            <input
              id={`published-${post.id}`}
              className="publish-panel__input -p1"
              type="datetime-local"
              value={publishedWhen}
              onChange={(e) => setPublishedWhen(e.target.value)}
            />
          </div>
          <div className="publish-panel__actions flex items-center">
            <Button
              size="s"
              disabled={!edited || !publishedWhen || update.isPending}
              onClick={() =>
                update.mutate({
                  id: post.id,
                  publicUrl: url.trim() || null,
                  publishedAt: new Date(publishedWhen).toISOString(),
                })
              }
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="s"
              onClick={() =>
                update.mutate({
                  id: post.id,
                  status: 'approved',
                  publishedAt: null,
                  publicUrl: null,
                })
              }
            >
              Undo publish
            </Button>
          </div>
        </div>
      ) : early ? (
        <p className="publish-panel__hint -p1">
          Scheduling and “Mark as published” come after approval. Set the status to Approved first —
          that’s when Pullup checks every image and video is cleared for public use.
        </p>
      ) : shelved ? (
        <p className="publish-panel__hint -p1">
          This post is {post.status}. Restore it (top of the page) to keep working on it.
        </p>
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
              placeholder={urlPlaceholder(post.platform)}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <label className="publish-panel__muted -meta" htmlFor={`published-${post.id}`}>
              Published on
            </label>
            <input
              id={`published-${post.id}`}
              className="publish-panel__input -p1"
              type="datetime-local"
              value={publishedWhen}
              onChange={(e) => setPublishedWhen(e.target.value)}
            />
            <Button
              variant="primary"
              size="s"
              disabled={update.isPending || !publishedWhen}
              onClick={() =>
                update.mutate({
                  id: post.id,
                  status: 'published',
                  publicUrl: url.trim() || null,
                  publishedAt: new Date(publishedWhen).toISOString(),
                })
              }
            >
              Mark as published
            </Button>
          </div>
        </>
      )}

      {plannable ? (
        <div className="publish-panel__row flex flex-col">
          <label className="publish-panel__muted -meta" htmlFor={`plan-${post.id}`}>
            Planned for · pencilled in, not scheduled
          </label>
          <div className="publish-panel__actions flex items-center">
            <input
              id={`plan-${post.id}`}
              className="publish-panel__input -p1 flex-1"
              type="date"
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value)
                if (isDay(e.target.value) && e.target.value !== post.plannedFor) {
                  update.mutate({ id: post.id, plannedFor: e.target.value })
                }
              }}
            />
            {post.plannedFor ? (
              <Button
                variant="ghost"
                size="s"
                onClick={() => update.mutate({ id: post.id, plannedFor: null })}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

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
