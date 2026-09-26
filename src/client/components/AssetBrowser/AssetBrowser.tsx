import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import type { Asset } from '@shared/types.ts'
import { useAsset } from '../../lib/queries.ts'
import { AssetGrid } from '../AssetGrid/AssetGrid.tsx'
import { AssetPanel } from '../AssetPanel/AssetPanel.tsx'
import { Button } from '../Button/Button.tsx'
import { AssetBulkBar } from './AssetBulkBar.tsx'
import './AssetBrowser.scss'

interface Props {
  assets: Asset[] | undefined
  isLoading: boolean
  empty: ReactNode
  // Left side of the toolbar above the grid (e.g. the Library filters); defaults to a count.
  tools?: ReactNode
  // Replaces the default "N items" text.
  summary?: ReactNode
  // Inbox: "Mark reviewed" moves straight on to the next item.
  advanceOnReview?: boolean
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

// Grid + detail panel + multi-selection. The panel and the selection bar overlay the grid — the
// grid never reflows, so opening/closing either doesn't shift cards.
//   click          open in the panel (or toggle, while anything is selected)
//   ⌘/Ctrl-click   add to / remove from the selection
//   Shift-click    select the range from the last clicked card
export function AssetBrowser({ assets, isLoading, empty, tools, summary, advanceOnReview }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const anchor = useRef<string | null>(null)
  const close = useCallback(() => setOpenId(null), [])

  const list = useMemo(() => assets ?? [], [assets])
  const order = useMemo(() => list.map((a) => a.id), [list])
  const selecting = selectMode || checked.size > 0

  // The panel reads from the list, so edits and processing updates flow in. An asset that left
  // the list (moved to another project, filtered out) stays open, read on its own.
  const inList = openId ? list.find((a) => a.id === openId) : undefined
  const single = useAsset(openId, !inList && !isLoading)
  const open = inList ?? (single.data?.id === openId ? single.data : undefined)
  useEffect(() => {
    if (openId && !inList && single.isError) setOpenId(null)
  }, [openId, inList, single.isError])

  // Selected items that left the list (reviewed in the Inbox, deleted, filtered out) drop out.
  useEffect(() => {
    setChecked((current) => {
      const ids = new Set(order)
      const kept = [...current].filter((id) => ids.has(id))
      return kept.length === current.size ? current : new Set(kept)
    })
  }, [order])

  const clearSelection = useCallback(() => {
    setChecked(new Set())
    setSelectMode(false)
    anchor.current = null
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isEditable(e.target) || document.querySelector('dialog[open]')) {
        return
      }
      if (checked.size || selectMode) clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [checked.size, selectMode, clearSelection])

  const onSelect = useCallback(
    (id: string, event: MouseEvent) => {
      const toggle = event.metaKey || event.ctrlKey
      const from = anchor.current ?? openId
      if (event.shiftKey && from && order.includes(from)) {
        const [a, b] = [order.indexOf(from), order.indexOf(id)].sort((x, y) => x - y)
        setChecked((current) => new Set([...current, ...order.slice(a!, b! + 1)]))
        setOpenId(null)
        return
      }
      if (toggle || selecting) {
        setChecked((current) => {
          const next = new Set(current)
          // ⌘-clicking while a panel is open starts a selection with the open item.
          if (!selecting && openId && openId !== id) next.add(openId)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
        anchor.current = id
        setOpenId(null)
        return
      }
      anchor.current = id
      setOpenId(id)
    },
    [order, openId, selecting]
  )

  // Inbox triage: after "Mark reviewed" the next item opens (the reviewed one leaves the list).
  const onReviewed = useCallback(
    (id: string) => {
      const i = order.indexOf(id)
      setOpenId(order[i + 1] ?? order[i - 1] ?? null)
    },
    [order]
  )

  if (isLoading) return null

  const selected = list.filter((a) => checked.has(a.id))

  return (
    <div className="asset-browser">
      {tools || list.length ? (
        <div className="asset-browser__toolbar flex items-center justify-between">
          <div className="asset-browser__tools flex items-center flex-1 min-w-0">
            {tools ?? (
              <span className="asset-browser__count -meta">
                {summary ?? `${list.length} item${list.length === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
          {list.length ? (
            <div className="asset-browser__select flex items-center shrink-0">
              {selecting ? (
                <>
                  <Button
                    variant="ghost"
                    size="s"
                    onClick={() => setChecked(new Set(order))}
                    disabled={checked.size === order.length}
                  >
                    Select all
                  </Button>
                  <Button variant="ghost" size="s" onClick={clearSelection}>
                    Done
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="s"
                  onClick={() => {
                    setSelectMode(true)
                    setOpenId(null)
                  }}
                  title="Or ⌘-click / Shift-click cards"
                >
                  Select
                </Button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {list.length ? (
        <AssetGrid
          assets={list}
          selectedId={openId}
          onSelect={onSelect}
          checkedIds={checked}
          selecting={selecting}
        />
      ) : (
        empty
      )}

      {open ? (
        <AssetPanel
          key={open.id}
          asset={open}
          onClose={close}
          onReviewed={advanceOnReview ? onReviewed : undefined}
        />
      ) : null}
      {selected.length ? <AssetBulkBar assets={selected} onClear={clearSelection} /> : null}
    </div>
  )
}
