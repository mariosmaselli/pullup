import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Post } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import type { ApiError } from '../../lib/api.ts'
import { STATUS_LABEL } from '../../lib/labels.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { usePosts, useUpdatePost } from '../../lib/queries.ts'
import { isDue, useNow } from '../../lib/due.ts'
import './CalendarView.scss'

type View = 'month' | 'week'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const VIEW_KEY = 'pullup.calendar.view'
const pad = (n: number) => String(n).padStart(2, '0')
// Local calendar day as YYYY-MM-DD — the format of a post's planned day.
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromDayKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)
const addDays = (d: Date, days: number) => {
  const next = new Date(d)
  next.setDate(d.getDate() + days)
  return next
}
// The Monday on/before a day.
const mondayOf = (d: Date) =>
  addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7))

// Month: 6 weeks from the Monday on/before the 1st. Week: Monday to Sunday.
const gridDays = (view: View, cursor: Date) => {
  const start = mondayOf(
    view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth(), 1) : cursor
  )
  return Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => addDays(start, i))
}

function savedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'
  } catch {
    return 'month'
  }
}

// Pencilled onto a day without being scheduled (drafts, posts in review, approved posts).
const isPlanned = (post: Post) =>
  !!post.plannedFor &&
  (post.status === 'draft' || post.status === 'review' || post.status === 'approved')

// Where a post sits: its publish date, its scheduled slot, else its planned day.
const placedAt = (post: Post) =>
  post.status === 'published' && post.publishedAt
    ? new Date(post.publishedAt)
    : post.status === 'scheduled' && post.scheduledFor
      ? new Date(post.scheduledFor)
      : isPlanned(post)
        ? fromDayKey(post.plannedFor!)
        : null

const snippet = (post: Post) => {
  const first = post.current?.segments[0]?.text || post.current?.caption || ''
  return first.length > 60 ? `${first.slice(0, 60)}…` : first || '(empty)'
}

// What dropping a post on a day does. Moving keeps what a post is (planned stays planned,
// scheduled stays scheduled); an approved post from the tray is scheduled. ⌥ swaps plan and
// schedule for approved posts. Drafts are only ever planned — they need approval first.
type DropAction = 'plan' | 'schedule' | 'reschedule'
function dropAction(post: Post | undefined, alt: boolean): DropAction | null {
  if (!post || post.status === 'published') return null
  if (post.status === 'scheduled') return 'reschedule'
  if (post.status === 'approved') {
    const plan = post.plannedFor ? !alt : alt
    return plan ? 'plan' : 'schedule'
  }
  return 'plan'
}

const DROP_LABEL: Record<DropAction, string> = {
  plan: 'Plan',
  schedule: 'Schedule 10:00',
  reschedule: 'Reschedule',
}

export function CalendarView() {
  const navigate = useNavigate()
  const { data: posts = [] } = usePosts('draft,review,approved,scheduled,published')
  const update = useUpdatePost()
  const [view, setView] = useState<View>(savedView)
  const [cursor, setCursor] = useState(() => new Date())
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<{ key: string; alt: boolean } | null>(null)

  const days = useMemo(() => gridDays(view, cursor), [view, cursor])
  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>()
    for (const post of posts) {
      const at = placedAt(post)
      if (!at) continue
      const key = dayKey(at)
      map.set(key, [...(map.get(key) ?? []), post])
    }
    // Timed posts in time order, then the day's plans.
    const order = (p: Post) => (isPlanned(p) ? Infinity : placedAt(p)!.getTime())
    for (const list of map.values()) list.sort((a, b) => order(a) - order(b))
    return map
  }, [posts])
  const ready = posts.filter((p) => p.status === 'approved' && !p.plannedFor)
  const toPlan = posts.filter(
    (p) => (p.status === 'draft' || p.status === 'review') && !p.plannedFor
  )
  const now = useNow()
  const due = posts
    .filter((p) => isDue(p, now))
    .sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!))
  const today = new Date(now)
  const draggedPost = posts.find((p) => p.id === dragging)

  const changeView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Private window / blocked storage: the view just isn't remembered.
    }
  }

  const move = (by: -1 | 1) =>
    setCursor(
      view === 'month'
        ? new Date(cursor.getFullYear(), cursor.getMonth() + by, 1)
        : addDays(cursor, 7 * by)
    )

  const title =
    view === 'month'
      ? cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : `${days[0]!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${days[6]!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`

  const dropOn = (postId: string, day: Date, alt: boolean) => {
    const post = posts.find((p) => p.id === postId)
    const action = dropAction(post, alt)
    if (!post || !action) return
    if (action === 'plan') {
      if (post.plannedFor !== dayKey(day)) update.mutate({ id: postId, plannedFor: dayKey(day) })
      return
    }
    // Keep the time of day when rescheduling; newly scheduled posts go out at 10:00.
    const previous =
      post.status === 'scheduled' && post.scheduledFor ? new Date(post.scheduledFor) : null
    const when = new Date(day)
    when.setHours(previous?.getHours() ?? 10, previous?.getMinutes() ?? 0, 0, 0)
    update.mutate({ id: postId, status: 'scheduled', scheduledFor: when.toISOString() })
  }

  // Back to the tray: unschedule a scheduled post, clear a plan.
  const dropInTray = (postId: string) => {
    const post = posts.find((p) => p.id === postId)
    if (post?.status === 'scheduled') update.mutate({ id: postId, scheduledFor: null })
    else if (post && isPlanned(post)) update.mutate({ id: postId, plannedFor: null })
  }

  const chip = (post: Post) => {
    const at = placedAt(post)
    const planned = isPlanned(post)
    const draggable = post.status !== 'published'
    return (
      <button
        key={post.id}
        type="button"
        className="calendar-view__chip flex flex-col"
        data-status={post.status}
        data-planned={planned}
        data-due={isDue(post, now)}
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
        title={`${STATUS_LABEL[post.status]}${planned ? ' · planned, not scheduled' : ''}: ${snippet(post)}`}
      >
        <span className="calendar-view__chip-head flex items-center justify-between -meta">
          <span>{PLATFORMS[post.platform].label}</span>
          {planned ? (
            // Approved plans get the same ✓ as approved drafts elsewhere.
            <span>Plan{post.status === 'approved' ? ' ✓' : ''}</span>
          ) : at && post.status !== 'approved' ? (
            <span>
              {isDue(post, now) ? 'Due · ' : ''}
              {at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : post.status === 'draft' || post.status === 'review' ? (
            <span>{post.status === 'review' ? 'Review' : STATUS_LABEL.draft}</span>
          ) : null}
        </span>
        <span className="calendar-view__chip-text -p1">{snippet(post)}</span>
      </button>
    )
  }

  const dropProps = (key: string, onDrop: (postId: string, alt: boolean) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-pullup-post')) return
      e.preventDefault()
      if (over?.key !== key || over.alt !== e.altKey) setOver({ key, alt: e.altKey })
    },
    onDragLeave: (e: React.DragEvent) => {
      // Moving onto a chip inside the day isn't leaving it.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOver((current) => (current?.key === key ? null : current))
    },
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData('application/x-pullup-post')
      setOver(null)
      if (id) onDrop(id, e.altKey)
    },
  })

  const hoverAction = over && over.key !== 'tray' ? dropAction(draggedPost, over.alt) : null
  const altHint =
    draggedPost?.status === 'approved'
      ? hoverAction === 'plan'
        ? ' · ⌥ schedule'
        : ' · ⌥ plan'
      : ''

  return (
    <>
      <ViewHeader
        title="Calendar"
        description="Plan the week: drag drafts onto a day to pencil them in, and approved posts to schedule them (hold ⌥ to switch). Pullup doesn’t post for you yet — when a scheduled post is due, it’s flagged here and in the sidebar until you mark it published."
        actions={
          <div className="calendar-view__nav flex items-center">
            <Segmented<View>
              label="Calendar view"
              value={view}
              onChange={changeView}
              options={[
                { value: 'month', label: 'Month' },
                { value: 'week', label: 'Week' },
              ]}
            />
            <Button
              variant="ghost"
              size="s"
              aria-label={`Previous ${view}`}
              onClick={() => move(-1)}
            >
              ←
            </Button>
            <span className="calendar-view__month -t2">{title}</span>
            <Button variant="ghost" size="s" aria-label={`Next ${view}`} onClick={() => move(1)}>
              →
            </Button>
            <Button size="s" onClick={() => setCursor(new Date())}>
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
          data-over={over?.key === 'tray'}
          {...dropProps('tray', dropInTray)}
        >
          {due.length ? (
            <div className="calendar-view__due flex flex-col">
              <span className="calendar-view__label -meta">Due now · {due.length}</span>
              <p className="calendar-view__due-hint -p1">
                Post {due.length === 1 ? 'it' : 'them'}, then mark as published with the link.
              </p>
              {due.map(chip)}
            </div>
          ) : null}
          <span className="calendar-view__label -meta">Ready to schedule · {ready.length}</span>
          {ready.length ? (
            ready.map(chip)
          ) : (
            <p className="calendar-view__muted -p1">
              Approved posts appear here. Drag one onto a day to schedule it.
            </p>
          )}
          <span className="calendar-view__label calendar-view__label--spaced -meta">
            Drafts to plan · {toPlan.length}
          </span>
          {toPlan.length ? (
            toPlan.map(chip)
          ) : (
            <p className="calendar-view__muted -p1">
              Drafts without a day. Drag one onto a day to pencil it in — it isn’t scheduled.
            </p>
          )}
          <p className="calendar-view__muted calendar-view__tray-hint -meta">
            Dashed = planned: pencilled in, not scheduled. Drop a post back here to unschedule it or
            clear its plan.
          </p>
        </aside>

        <div className="calendar-view__grid flex-1" data-view={view}>
          {WEEKDAYS.map((d, i) => (
            <span key={d} className="calendar-view__weekday -meta">
              {d}
              {view === 'week' ? ` ${days[i]!.getDate()}` : ''}
            </span>
          ))}
          {days.map((day) => {
            const key = dayKey(day)
            return (
              <div
                key={key}
                className="calendar-view__day flex flex-col"
                data-outside={view === 'month' && day.getMonth() !== cursor.getMonth()}
                data-today={sameDay(day, today)}
                data-over={over?.key === key}
                {...dropProps(key, (id, alt) => dropOn(id, day, alt))}
              >
                <span className="calendar-view__date -meta">{day.getDate()}</span>
                {(byDay.get(key) ?? []).map(chip)}
                {over?.key === key && hoverAction ? (
                  <span className="calendar-view__drop -meta" data-action={hoverAction}>
                    {DROP_LABEL[hoverAction]}
                    {altHint}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
