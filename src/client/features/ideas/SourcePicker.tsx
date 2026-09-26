import { useMemo, useState } from 'react'
import type { Asset } from '@shared/types.ts'
import { assetTitle, hostname } from '../../lib/format.ts'
import './SourcePicker.scss'

interface Props {
  assets: Asset[]
  selected: string[]
  max: number
  onChange: (ids: string[]) => void
}

const KIND_LABEL: Record<Asset['kind'], string> = {
  image: 'Image',
  video: 'Video',
  link: 'Link',
  note: 'Note',
}

const matches = (asset: Asset, query: string) =>
  [assetTitle(asset), asset.notes, asset.body ?? '', asset.link?.url ?? '']
    .join(' ')
    .toLowerCase()
    .includes(query)

// Any library item as an idea's source — images, videos, links and notes. Click to add
// (numbered), click again to remove.
export function SourcePicker({ assets, selected, max, onChange }: Props) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? assets.filter((a) => matches(a, q)) : assets
  }, [assets, query])

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id))
    else if (selected.length < max) onChange([...selected, id])
  }

  return (
    <div className="source-picker flex flex-col">
      <input
        className="source-picker__search -p1"
        type="search"
        value={query}
        placeholder="Search titles, notes and links"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="source-picker__grid">
        {visible.map((asset) => {
          const index = selected.indexOf(asset.id)
          return (
            <button
              key={asset.id}
              type="button"
              className="source-picker__item flex flex-col"
              aria-pressed={index !== -1}
              disabled={index === -1 && selected.length >= max}
              title={assetTitle(asset)}
              onClick={() => toggle(asset.id)}
            >
              <span className="source-picker__preview flex">
                {asset.thumbUrl ? (
                  <img src={asset.thumbUrl} alt="" loading="lazy" />
                ) : (
                  <span className="source-picker__text -meta">
                    {asset.kind === 'link' && asset.link
                      ? hostname(asset.link.url)
                      : (asset.body ?? asset.notes).slice(0, 120)}
                  </span>
                )}
                {index !== -1 ? (
                  <span className="source-picker__order -meta">{index + 1}</span>
                ) : null}
              </span>
              <span className="source-picker__title -meta">
                {KIND_LABEL[asset.kind]} · {assetTitle(asset)}
              </span>
            </button>
          )
        })}
        {!visible.length ? (
          <p className="source-picker__empty -p1">
            {assets.length ? 'Nothing matches.' : 'No material here yet.'}
          </p>
        ) : null}
      </div>
    </div>
  )
}
