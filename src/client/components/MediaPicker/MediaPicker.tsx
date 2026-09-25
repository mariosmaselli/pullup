import type { Asset } from '@shared/types.ts'
import { assetTitle, duration } from '../../lib/format.ts'
import './MediaPicker.scss'

interface Props {
  assets: Asset[]
  selected: string[]
  max: number
  onChange: (ids: string[]) => void
}

// Pick media in order: click to add (numbered), click again to remove.
export function MediaPicker({ assets, selected, max, onChange }: Props) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id))
    else if (max === 1) onChange([id])
    else if (selected.length < max) onChange([...selected, id])
  }

  if (!assets.length) {
    return <p className="media-picker__empty -p1">No images or videos in the library yet.</p>
  }

  return (
    <div className="media-picker">
      {assets.map((asset) => {
        const index = selected.indexOf(asset.id)
        return (
          <button
            key={asset.id}
            type="button"
            className="media-picker__item"
            aria-pressed={index !== -1}
            title={assetTitle(asset)}
            onClick={() => toggle(asset.id)}
          >
            {asset.thumbUrl ? <img src={asset.thumbUrl} alt="" loading="lazy" /> : null}
            {index !== -1 ? <span className="media-picker__order -meta">{index + 1}</span> : null}
            {asset.file?.durationMs ? (
              <span className="media-picker__duration -meta">
                {duration(asset.file.durationMs)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
