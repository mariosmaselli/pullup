import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Asset } from '@shared/types.ts'
import {
  useBulkDeleteAssets,
  useBulkUpdateAssets,
  useGenerateIdeas,
  useProjects,
  useSystem,
} from '../../lib/queries.ts'
import { Button } from '../Button/Button.tsx'
import './AssetBulkBar.scss'

// The ideas endpoint reads at most this many assets in one call.
const MAX_IDEA_SOURCES = 12

interface Props {
  assets: Asset[]
  onClear: () => void
}

// Actions for the selected assets: project, reviewed, post ideas from all of them, delete.
export function AssetBulkBar({ assets, onClear }: Props) {
  const { data: system } = useSystem()
  const { data: projects = [] } = useProjects()
  const update = useBulkUpdateAssets()
  const remove = useBulkDeleteAssets()
  const generate = useGenerateIdeas()
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const ids = assets.map((a) => a.id)
  const busy = update.isPending || remove.isPending || generate.isPending
  const unreviewed = assets.filter((a) => !a.triagedAt).length

  // Why ideas can't be asked for right now (the server checks the same things).
  const aiOff = assets
    .map((a) => projects.find((p) => p.id === a.projectId))
    .find((p) => p && !p.aiAllowed)
  const ideasBlocked =
    system && !system.ai.enabled
      ? 'Add your Anthropic API key in Settings first.'
      : aiOff
        ? `AI is off for “${aiOff.name}”.`
        : assets.length > MAX_IDEA_SOURCES
          ? `Ideas read up to ${MAX_IDEA_SOURCES} items at a time — ${assets.length} are selected.`
          : assets.some((a) => a.processingStatus !== 'ready')
            ? 'Some items are still processing.'
            : null

  const assign = (value: string) => {
    const projectId = value === 'none' ? null : value
    const name = projects.find((p) => p.id === projectId)?.name
    setNotice(null)
    update.mutate(
      { ids, projectId },
      {
        onSuccess: ({ updated }) =>
          setNotice(name ? `Moved ${updated} to “${name}”.` : `Removed ${updated} from projects.`),
      }
    )
  }

  const deleteAll = () => {
    const n = assets.length
    if (
      !confirm(`Delete ${n} item${n === 1 ? '' : 's'}? Original files move to the library trash.`)
    )
      return
    setNotice(null)
    remove.mutate(ids, {
      onSuccess: ({ deleted, blocked }) => {
        if (!blocked.length) return onClear()
        const first = blocked[0]!
        setNotice(
          `${deleted.length ? `Deleted ${deleted.length}. ` : ''}` +
            `${blocked.length} couldn’t be deleted — “${first.title}”: ${first.reason}` +
            (blocked.length > 1 ? ` (and ${blocked.length - 1} more)` : '')
        )
      },
    })
  }

  const getIdeas = () =>
    generate.mutate(
      { assetIds: ids, instruction: instruction.trim() || undefined },
      {
        onSuccess: () => {
          onClear()
          navigate({ to: '/ideas' })
        },
      }
    )

  const error = (update.error ?? remove.error ?? generate.error) as Error | null

  return (
    <div className="asset-bulk-bar flex flex-col" role="toolbar" aria-label="Selected items">
      {asking ? (
        <div className="asset-bulk-bar__ideas flex flex-col">
          <label className="asset-bulk-bar__label -meta" htmlFor="bulk-instruction">
            Post ideas from these {assets.length} items
          </label>
          <textarea
            id="bulk-instruction"
            className="asset-bulk-bar__input -p1"
            rows={2}
            autoFocus
            value={instruction}
            placeholder="Optional direction, e.g. “a before/after story for LinkedIn”"
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) getIdeas()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setAsking(false)
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="asset-bulk-bar__muted -meta">
              {ideasBlocked ?? 'Your titles and notes are the main source.'}
            </span>
            <div className="flex items-center">
              <Button variant="ghost" size="s" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="s"
                disabled={!!ideasBlocked || busy}
                onClick={getIdeas}
              >
                {generate.isPending ? 'Thinking of ideas…' : 'Get ideas'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {notice || error ? (
        <p className="asset-bulk-bar__notice -p1" data-error={error ? true : undefined}>
          {error?.message ?? notice}
        </p>
      ) : null}

      <div className="asset-bulk-bar__row flex items-center">
        <span className="asset-bulk-bar__count -p1 shrink-0">{assets.length} selected</span>
        <select
          className="asset-bulk-bar__select -p1"
          value=""
          disabled={busy}
          aria-label="Move to project"
          onChange={(e) => e.target.value && assign(e.target.value)}
        >
          <option value="">Project…</option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          size="s"
          disabled={busy || !unreviewed}
          onClick={() => {
            setNotice(null)
            update.mutate({ ids, triaged: true })
          }}
        >
          Mark reviewed
        </Button>
        <Button
          size="s"
          disabled={busy}
          aria-expanded={asking}
          title={ideasBlocked ?? undefined}
          onClick={() => setAsking((v) => !v)}
        >
          Get post ideas
        </Button>
        <Button variant="danger" size="s" disabled={busy} onClick={deleteAll}>
          Delete
        </Button>
        <Button variant="ghost" size="s" onClick={onClear} aria-label="Clear selection">
          Clear <span className="button__kbd">Esc</span>
        </Button>
      </div>
    </div>
  )
}
