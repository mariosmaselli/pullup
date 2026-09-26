import type { MouseEvent } from 'react'
import type { Asset } from '@shared/types.ts'
import { assetTitle, duration, hostname, relativeTime } from '../../lib/format.ts'
import { repairAsset, useProjects } from '../../lib/queries.ts'
import './AssetCard.scss'

interface Props {
  asset: Asset
  // Open in the detail panel.
  selected?: boolean
  // Part of a multi-selection (⌘/⇧-click or Select mode).
  checked?: boolean
  // Select mode: every card shows its checkbox.
  selecting?: boolean
  onSelect: (id: string, event: MouseEvent) => void
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  image: 'Image',
  video: 'Video',
  link: 'Link',
  note: 'Note',
}

// A thumbnail that won't load usually means cache/ was cleared: ask once per asset to rebuild it
// (the list refreshes by itself when it's done).
const repairRequested = new Set<string>()
const requestRepair = (asset: Asset) => {
  if (asset.processingStatus !== 'ready' || repairRequested.has(asset.id)) return
  repairRequested.add(asset.id)
  repairAsset(asset.id).catch(() => undefined)
}

function Media({ asset }: { asset: Asset }) {
  const busy = asset.processingStatus === 'pending' || asset.processingStatus === 'processing'

  if (asset.kind === 'note') {
    return <p className="asset-card__note -p1">{asset.body}</p>
  }
  // SVGs have no thumbnail — the original renders directly.
  const src = asset.thumbUrl ?? (asset.file?.mime === 'image/svg+xml' ? asset.file.url : null)
  if (src)
    return (
      <img
        className="asset-card__image"
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => requestRepair(asset)}
      />
    )
  if (busy) return <div className="asset-card__skeleton" />
  return (
    <div className="asset-card__placeholder flex items-center justify-center -meta">
      {asset.kind === 'link' ? hostname(asset.link?.url ?? '') : KIND_LABEL[asset.kind]}
    </div>
  )
}

export function AssetCard({ asset, selected, checked, selecting, onSelect }: Props) {
  const { data: projects } = useProjects()
  const project = asset.projectId ? projects?.find((p) => p.id === asset.projectId) : undefined
  const status =
    asset.processingStatus === 'failed'
      ? 'Failed'
      : asset.processingStatus === 'ready'
        ? null
        : 'Processing'

  const detail = asset.pdf
    ? `PDF page ${asset.pdf.page}`
    : asset.kind === 'link'
      ? `${hostname(asset.link?.url ?? '')}${asset.link?.meta?.error ? ' · no preview' : ''}`
      : KIND_LABEL[asset.kind]

  return (
    <button
      type="button"
      className="asset-card flex flex-col"
      aria-pressed={selected}
      data-kind={asset.kind}
      data-checked={checked || undefined}
      data-selecting={selecting || undefined}
      onClick={(e) => onSelect(asset.id, e)}
    >
      <div className="asset-card__media">
        <Media asset={asset} />
        {asset.file?.durationMs ? (
          <span className="asset-card__badge -meta">{duration(asset.file.durationMs)}</span>
        ) : null}
        <span className="asset-card__check" aria-hidden />
      </div>
      <div className="asset-card__meta flex flex-col">
        <span className="asset-card__title -p1">{assetTitle(asset)}</span>
        <span className="asset-card__detail -meta">
          {status ? <span data-status={asset.processingStatus}>{status} · </span> : null}
          {project ? <span className="asset-card__project">{project.name} · </span> : null}
          {detail} · {relativeTime(asset.capturedAt)}
        </span>
      </div>
    </button>
  )
}
