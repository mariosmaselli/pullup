import { useEffect, useState } from 'react'
import type { Post } from '@shared/types.ts'
import { usePosts } from './queries.ts'

// Pullup doesn't post for Mario (yet): a scheduled post whose time has come is "due" — it shows
// in the sidebar, on the calendar and on the draft until he marks it published.

// The current time, updated every minute so "due" appears without a reload.
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export const isDue = (post: Pick<Post, 'status' | 'scheduledFor'>, now: number) =>
  post.status === 'scheduled' && !!post.scheduledFor && Date.parse(post.scheduledFor) <= now

export function useDuePosts() {
  const now = useNow()
  const { data: scheduled = [] } = usePosts('scheduled')
  return scheduled.filter((post) => isDue(post, now))
}
