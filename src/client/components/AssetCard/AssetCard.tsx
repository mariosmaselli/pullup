import type { Asset } from '@shared/types.ts'
import { assetTitle, duration, hostname, relativeTime } from '../../lib/format.ts'
import './AssetCard.scss'

interface Props {
  asset: Asset
  selected?: boolean
  onSelect: (id: string) => void
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  image: 'Image',
  video: 'Video',
  link: 'Link',
  note: 'Note',
}

function Media({ asset }: { asset: Asset }) {
  const busy = asset.processingStatus === 'pending' || asset.processingStatus === 'processing'

  if (asset.kind === 'note') {
    return <p className="asset-card__note -p1">{asset.body}</p>
  }
  // SVGs have no thumbnail — the original renders directly.
  const src = asset.thumbUrl ?? (asset.file?.mime === 'image/svg+xml' ? asset.file.url : null)
  if (src)
    return <img className="asset-card__image" src={src} alt="" loading="lazy" draggable={false} />
  if (busy) return <div className="asset-card__skeleton" />
  return (
    <div className="asset-card__placeholder flex items-center justify-center -meta">
      {asset.kind === 'link' ? hostname(asset.link?.url ?? '') : KIND_LABEL[asset.kind]}
    </div>
  )
}

export function AssetCard({ asset, selected, onSelect }: Props) {
  const status =
    asset.processingStatus === 'failed'
      ? 'Failed'
      : asset.processingStatus === 'ready'
        ? null
        : 'Processing'

  const detail = asset.kind === 'link' ? hostname(asset.link?.url ?? '') : KIND_LABEL[asset.kind]

  return (
    <button
      type="button"
      className="asset-card flex flex-col"
      aria-pressed={selected}
      data-kind={asset.kind}
      onClick={() => onSelect(asset.id)}
    >
      <div className="asset-card__media">
        <Media asset={asset} />
        {asset.file?.durationMs ? (
          <span className="asset-card__badge -meta">{duration(asset.file.durationMs)}</span>
        ) : null}
      </div>
      <div className="asset-card__meta flex flex-col">
        <span className="asset-card__title -p1">{assetTitle(asset)}</span>
        <span className="asset-card__detail -meta">
          {status ? <span data-status={asset.processingStatus}>{status} · </span> : null}
          {detail} · {relativeTime(asset.capturedAt)}
        </span>
      </div>
    </button>
  )
}
