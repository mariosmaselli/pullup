import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { TrashItem, TrashKind } from '@shared/storage.ts'
import { ViewHeader } from '../../components/ViewHeader/ViewHeader.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { Button } from '../../components/Button/Button.tsx'
import type { ApiError } from '../../lib/api.ts'
import { bytes, dateTime, relativeTime } from '../../lib/format.ts'
import { useEmptyTrash, useRestoreFromTrash, useTrash } from '../../lib/queries.ts'
import './TrashView.scss'

const KIND_LABELS: Record<TrashKind, string> = {
  original: 'Original',
  duplicate: 'Duplicate',
  render: 'Render',
  'render-file': 'Studio render',
  other: 'Other',
}

const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`

// What's in <library>/trash: deleted originals and cleaned-up renders. Restore where Pullup can;
// "Empty trash" is the only thing in Pullup that deletes files for good.
export function TrashView() {
  const { data: trash } = useTrash()
  const restore = useRestoreFromTrash()
  const empty = useEmptyTrash()
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<ReactNode>(null)

  const list = trash?.items ?? []
  const listedBytes = list.reduce((sum, i) => sum + i.sizeBytes, 0)

  const onRestore = (item: TrashItem) => {
    setNotice(null)
    restore.mutate(item.name, {
      onSuccess: (result) =>
        setNotice(
          result.kind === 'asset' ? (
            <>
              Restored “{item.label}” as a new asset — it’s in the <Link to="/inbox">Inbox</Link>.
            </>
          ) : result.postId ? (
            <>
              Restored the render to media/renders.{' '}
              <Link to="/drafts/$id" params={{ id: result.postId }}>
                Open its post
              </Link>
            </>
          ) : (
            'Restored the render to media/renders.'
          )
        ),
    })
  }

  const onEmpty = () => {
    const names = list.map((i) => i.name)
    empty.mutate(names, {
      onSuccess: (result) => {
        setConfirming(false)
        setNotice(`Deleted ${items(result.removed)} (${bytes(result.bytes)}) for good.`)
      },
    })
  }

  return (
    <>
      <ViewHeader
        title="Trash"
        description="Deleted originals and cleaned-up renders. Nothing here is gone until you empty the trash."
        actions={
          <Button
            size="s"
            variant="danger"
            disabled={!list.length || confirming}
            onClick={() => {
              setNotice(null)
              setConfirming(true)
            }}
          >
            Empty trash…
          </Button>
        }
      />

      <div className="trash-view__bar flex flex-wrap items-center">
        {confirming ? (
          <>
            <span className="trash-view__warning -p1">
              Delete {items(list.length)} · {bytes(listedBytes)} forever? This can’t be undone.
            </span>
            <div className="trash-view__confirm flex items-center">
              <Button
                size="s"
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={empty.isPending}
              >
                Cancel
              </Button>
              <Button size="s" variant="danger" onClick={onEmpty} disabled={empty.isPending}>
                {empty.isPending ? 'Deleting…' : 'Delete forever'}
              </Button>
            </div>
          </>
        ) : (
          <p className="trash-view__notice -p1">
            {empty.error
              ? (empty.error as ApiError).message
              : (notice ??
                (trash ? `${items(list.length)} · ${bytes(trash.totalBytes)}` : '\u00a0'))}
          </p>
        )}
      </div>

      {trash && !list.length ? (
        <EmptyState title="Trash is empty">
          Deleted originals and renders moved out by{' '}
          <Link to="/settings">Clean up old renders</Link> land here.
        </EmptyState>
      ) : (
        <ul className="trash-view__list">
          {list.map((item) => {
            const pending = restore.isPending && restore.variables === item.name
            const error =
              restore.error && restore.variables === item.name
                ? (restore.error as ApiError).message
                : null
            return (
              <li key={item.name} className="trash-view__row flex items-start">
                <div className="trash-view__main flex flex-col flex-1 min-w-0">
                  <div className="trash-view__title flex items-baseline min-w-0">
                    <span className="trash-view__kind -meta shrink-0">
                      {KIND_LABELS[item.kind]}
                    </span>
                    <span className="trash-view__label -p min-w-0" title={item.name}>
                      {item.label}
                    </span>
                  </div>
                  <span className={`trash-view__note -p1 ${error ? '-error' : ''}`}>
                    {error ?? item.restoreNote}
                  </span>
                  <span className="trash-view__details -meta">
                    {bytes(item.sizeBytes)}
                    {item.files > 1 ? ` · ${item.files} files` : ''} ·{' '}
                    <span title={dateTime(item.trashedAt)}>
                      trashed {relativeTime(item.trashedAt)}
                    </span>
                  </span>
                </div>
                <Button
                  size="s"
                  className="trash-view__restore shrink-0"
                  disabled={!item.restorable || restore.isPending || empty.isPending}
                  title={item.restorable ? undefined : item.restoreNote}
                  onClick={() => onRestore(item)}
                >
                  {pending ? 'Restoring…' : 'Restore'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {trash ? <code className="trash-view__folder -meta">{trash.folder}</code> : null}
    </>
  )
}
