import { useCallback, useState, type ReactNode } from 'react'
import type { Asset } from '@shared/types.ts'
import { AssetGrid } from '../AssetGrid/AssetGrid.tsx'
import { AssetPanel } from '../AssetPanel/AssetPanel.tsx'
import './AssetBrowser.scss'

interface Props {
  assets: Asset[] | undefined
  isLoading: boolean
  empty: ReactNode
}

// Grid + detail panel. The panel reads from the list, so edits and processing updates flow in.
export function AssetBrowser({ assets, isLoading, empty }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const close = useCallback(() => setSelectedId(null), [])
  const selected = assets?.find((a) => a.id === selectedId)

  if (isLoading) return null
  if (!assets?.length) return <>{empty}</>

  return (
    <div className="asset-browser" data-panel={!!selected}>
      <AssetGrid assets={assets} selectedId={selectedId} onSelect={setSelectedId} />
      {selected ? <AssetPanel key={selected.id} asset={selected} onClose={close} /> : null}
    </div>
  )
}
