import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { StorageInfo } from '@shared/storage.ts'
import { Button } from '../../components/Button/Button.tsx'
import type { ApiError } from '../../lib/api.ts'
import { bytes } from '../../lib/format.ts'
import { useCleanUpRenders, useCleanupPreview, useStorage } from '../../lib/queries.ts'
import './StoragePanel.scss'

type Part = Exclude<keyof StorageInfo, 'root' | 'total' | 'diskFreeBytes'>

const ROWS: { key: Part; label: string; note: string }[] = [
  { key: 'originals', label: 'Originals', note: 'media/ — what you captured' },
  { key: 'renders', label: 'Renders', note: 'media/renders — MP4 / JPEG made by templates' },
  { key: 'exports', label: 'GIF / WebP', note: 'exports of video renders' },
  { key: 'cache', label: 'Cache', note: 'thumbnails, frames, video proxies' },
  { key: 'trash', label: 'Trash', note: 'deleted originals and cleaned-up renders' },
  { key: 'backups', label: 'Backups', note: 'database snapshots' },
  { key: 'database', label: 'Database', note: 'pullup.db' },
]

const files = (n: number) => `${n.toLocaleString('en-GB')} file${n === 1 ? '' : 's'}`

// How much each part of the library takes, and "Clean up old renders".
export function StoragePanel() {
  const { data: storage } = useStorage()

  return (
    <div className="storage-panel flex flex-col">
      <dl className="storage-panel__list">
        {ROWS.map(({ key, label, note }) => {
          const usage = storage?.[key]
          return (
            <div key={key} className="storage-panel__row flex items-baseline">
              <dt className="storage-panel__part flex flex-col flex-1 min-w-0">
                <span className="storage-panel__label -p1">
                  {key === 'trash' ? <Link to="/trash">{label}</Link> : label}
                </span>
                <span className="storage-panel__note -p1">{note}</span>
              </dt>
              <dd className="storage-panel__files -meta shrink-0">
                {usage ? files(usage.files) : ''}
              </dd>
              <dd className="storage-panel__size -p1 shrink-0">
                {usage ? bytes(usage.bytes) : '—'}
              </dd>
            </div>
          )
        })}
        <div className="storage-panel__row -total flex items-baseline">
          <dt className="storage-panel__part flex flex-col flex-1 min-w-0">
            <span className="storage-panel__label -p1">Total</span>
            <span className="storage-panel__note -p1">
              {storage?.diskFreeBytes != null
                ? `${bytes(storage.diskFreeBytes)} free on this disk`
                : '\u00a0'}
            </span>
          </dt>
          <dd className="storage-panel__size -p1 shrink-0">
            {storage ? bytes(storage.total) : '—'}
          </dd>
        </div>
      </dl>
      <CleanupRenders />
    </div>
  )
}

function CleanupRenders() {
  const [asked, setAsked] = useState(false)
  const preview = useCleanupPreview(asked)
  const cleanUp = useCleanUpRenders()
  const data = asked ? preview.data : undefined

  const close = () => setAsked(false)
  const confirm = () => {
    if (!data?.count) return
    cleanUp.mutate(
      data.candidates.map((c) => c.id),
      { onSuccess: close }
    )
  }

  let message: ReactNode
  if (cleanUp.error) message = (cleanUp.error as ApiError).message
  else if (preview.error && asked) message = (preview.error as ApiError).message
  else if (asked && !data) message = 'Looking for old renders…'
  else if (data && !data.count) {
    message = `Nothing to clean up — every render older than ${data.olderThanDays} days is still used by a frame or a published post.`
  } else if (data) {
    message = (
      <>
        <strong>
          {data.count} render{data.count === 1 ? '' : 's'} · {bytes(data.bytes)}
        </strong>{' '}
        {data.exports
          ? `(with ${data.exports} GIF / WebP export${data.exports === 1 ? '' : 's'}) `
          : ''}
        older than {data.olderThanDays} days that no frame uses and no published post links to. They
        move to the <Link to="/trash">trash</Link>, where you can restore them; emptying the trash
        frees the {bytes(data.bytes)}.
      </>
    )
  } else if (cleanUp.data) {
    const { moved, bytes: freed } = cleanUp.data
    message = (
      <>
        Moved {moved} render{moved === 1 ? '' : 's'} ({bytes(freed)}) to the{' '}
        <Link to="/trash">trash</Link>. Empty the trash to free the space.
      </>
    )
  } else {
    message =
      'Every re-render keeps the old file. Renders older than 7 days that no frame uses and no published post links to can move to the trash.'
  }

  return (
    <div className="storage-panel__cleanup flex flex-col">
      <div className="storage-panel__cleanup-row flex items-center justify-between">
        <p className="storage-panel__cleanup-title -p1 shrink-0">Old renders</p>
        <div className="storage-panel__actions flex items-center shrink-0">
          {data?.count ? (
            <>
              <Button size="s" variant="ghost" onClick={close} disabled={cleanUp.isPending}>
                Cancel
              </Button>
              <Button size="s" variant="primary" onClick={confirm} disabled={cleanUp.isPending}>
                {cleanUp.isPending
                  ? 'Moving…'
                  : `Move ${data.count} to trash · ${bytes(data.bytes)}`}
              </Button>
            </>
          ) : asked && data ? (
            <Button size="s" variant="ghost" onClick={close}>
              OK
            </Button>
          ) : (
            <Button
              size="s"
              onClick={() => {
                cleanUp.reset()
                setAsked(true)
              }}
              disabled={asked}
            >
              Clean up old renders…
            </Button>
          )}
        </div>
      </div>
      <p className="storage-panel__message -p1">{message}</p>
    </div>
  )
}
