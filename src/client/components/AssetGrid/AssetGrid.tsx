import type { Asset } from '@shared/types.ts'
import { AssetCard } from '../AssetCard/AssetCard.tsx'
import './AssetGrid.scss'

interface Props {
  assets: Asset[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function AssetGrid({ assets, selectedId, onSelect }: Props) {
  return (
    <div className="asset-grid">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={asset.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
