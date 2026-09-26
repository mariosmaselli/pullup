import type { MouseEvent } from 'react'
import type { Asset } from '@shared/types.ts'
import { AssetCard } from '../AssetCard/AssetCard.tsx'
import './AssetGrid.scss'

interface Props {
  assets: Asset[]
  // Open in the detail panel.
  selectedId: string | null
  onSelect: (id: string, event: MouseEvent) => void
  // Multi-selection, and whether Select mode is on.
  checkedIds?: ReadonlySet<string>
  selecting?: boolean
}

export function AssetGrid({ assets, selectedId, onSelect, checkedIds, selecting }: Props) {
  return (
    <div className="asset-grid">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={asset.id === selectedId}
          checked={checkedIds?.has(asset.id)}
          selecting={selecting}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
