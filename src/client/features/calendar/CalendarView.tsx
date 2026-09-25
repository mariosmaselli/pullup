import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Post } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import type { ApiError } from '../../lib/api.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { usePosts, useUpdatePost } from '../../lib/queries.ts'
import './CalendarView.scss'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)

// 6 weeks starting on the Monday on/before the 1st of the month.
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

// When a post sits on the calendar: its publish date, else its scheduled date.
const placedAt = (post: Post) =>
  post.status === 'published' && post.publishedAt
    ? new Date(post.publishedAt)
    : post.scheduledFor
      ? new Date(post.scheduledFor)
      : null

const snippet = (post: Post) => {
  const first = post.current?.segments[0]?.text ?? ''
  return first.length > 60 ? `${first.slice(0, 60)}…` : first || '(empty)'
}

export function CalendarView() {
  const navigate = useNavigate()
  const { data: posts = [] } = usePosts('approved,scheduled,published')
  const update = useUpdatePost()
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const days = useMemo(() => monthGrid(month), [month])
  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>()
    for (const post of posts) {
      const at = placedAt(post)
      if (!at) continue
      const key = dayKey(at)
      map.set(
        key,
        [...(map.get(key) ?? []), post].sort(
          (a, b) => placedAt(a)!.getTime() - placedAt(b)!.getTime()
        )
      )
    }
    return map
  }, [posts])
  const ready = posts.filter((p) => p.status === 'approved' && !p.scheduledFor)
  const today = new Date()

  const scheduleOn = (postId: string, day: Date) => {
    const post = posts.find((p) => p.id === postId)
    if (!post || post.status === 'published') return
    // Keep the time of day when rescheduling; new posts go out at 10:00.
    const previous = post.scheduledFor ? new Date(post.scheduledFor) : null
    const when = new Date(day)
    when.setHours(previous?.getHours() ?? 10, previous?.getMinutes() ?? 0, 0, 0)
    update.mutate({ id: postId, status: 'scheduled', scheduledFor: when.toISOString() })
  }

  const chip = (post: Post) => {
    const at = placedAt(post)
    const draggable = post.status !== 'published'
    return (
      <button
        key={post.id}
        type="button"
        className="calendar-view__chip flex flex-col"
        data-status={post.status}
        data-dragging={dragging === post.id}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-pullup-post', post.id)
          e.dataTransfer.effectAllowed = 'move'
          setDragging(post.id)
        }}
        onDragEnd={() => {
          setDragging(null)
          setOver(null)
        }}
        onClick={() => navigate({ to: '/drafts/$id', params: { id: post.id } })}
        title={snippet(post)}
      >
        <span className="calendar-view__chip-head flex items-center justify-between -meta">
          <span>{PLATFORMS[post.platform].label}</span>
          {at && post.status !== 'approved' ? (
            <span>{at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          ) : null}
        </span>
        <span className="calendar-view__chip-text -p1">{snippet(post)}</span>
      </button>
    )
  }

  const dropProps = (key: string, onDrop: (postId: string) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-pullup-post')) return
      e.preventDefault()
      setOver(key)
    },
    onDragLeave: () => setOver((current) => (current === key ? null : current)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData('application/x-pullup-post')
      setOver(null)
      if (id) onDrop(id)
    },
  })

  return (
    <>
      <ViewHeader
        title="Calendar"
        description="Drag approved posts onto a day to schedule them. Published posts stay on the day they went out."
        actions={
          <div className="calendar-view__nav flex items-center">
            <Button
              variant="ghost"
              size="s"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              ←
            </Button>
            <span className="calendar-view__month -t2">
              {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </span>
            <Button
              variant="ghost"
              size="s"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              →
            </Button>
            <Button
              size="s"
              onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
            >
              Today
            </Button>
          </div>
        }
      />

      {update.error ? (
        <p className="calendar-view__error -p1">{(update.error as ApiError).message}</p>
      ) : null}

      <div className="calendar-view__layout flex">
        <aside
          className="calendar-view__ready flex flex-col shrink-0"
          data-over={over === 'ready'}
          {...dropProps('ready', (id) => {
            const post = posts.find((p) => p.id === id)
            if (post?.status === 'scheduled') update.mutate({ id, scheduledFor: null })
          })}
        >
          <span className="calendar-view__label -meta">Ready to schedule · {ready.length}</span>
          {ready.length ? (
            ready.map(chip)
          ) : (
            <p className="calendar-view__muted -p1">
              Approved posts appear here. Drag one onto a day, or back here to unschedule.
            </p>
          )}
        </aside>

        <div className="calendar-view__grid flex-1">
          {WEEKDAYS.map((d) => (
            <span key={d} className="calendar-view__weekday -meta">
              {d}
            </span>
          ))}
          {days.map((day) => {
            const key = dayKey(day)
            return (
              <div
                key={key}
                className="calendar-view__day flex flex-col"
                data-outside={day.getMonth() !== month.getMonth()}
                data-today={sameDay(day, today)}
                data-over={over === key}
                {...dropProps(key, (id) => scheduleOn(id, day))}
              >
                <span className="calendar-view__date -meta">{day.getDate()}</span>
                {(byDay.get(key) ?? []).map(chip)}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
