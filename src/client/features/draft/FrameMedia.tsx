import { useState, type ReactNode } from 'react'
import type { Asset } from '@shared/types.ts'
import { MAX_FRAME_MEDIA } from '@shared/frames.ts'
import { Button } from '../../components/Button/Button.tsx'
import { MediaPicker } from '../../components/MediaPicker/MediaPicker.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { assetTitle } from '../../lib/format.ts'
import './FrameMedia.scss'

interface Props {
  // The frame's media, in order.
  ids: string[]
  byId: Map<string, Asset>
  // The idea's material and media already on the post.
  suggested: Asset[]
  // Every image/video in the library ("Show all media").
  library: Asset[]
  label: string
  // Right-aligned in the row (the text counter).
  aside?: ReactNode
  onChange: (ids: string[]) => void
}

const move = (list: string[], from: number, to: number) => {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

// A frame's images/videos: a strip of the chosen media (drag or ←/→ to reorder, × to remove) and,
// on demand, a picker. "One" replaces the media with a click; "Several" adds media in order.
export function FrameMedia({ ids, byId, suggested, library, label, aside, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [several, setSeveral] = useState<boolean | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const multiple = several ?? ids.length > 1
  const all = showAll || !suggested.length

  // Chosen media always stay pickable, even when they aren't in the current list.
  const chosen = ids.map((id) => byId.get(id)).filter((a): a is Asset => !!a)
  const listed = all ? library : suggested
  const pickable = [...listed, ...chosen.filter((a) => !listed.includes(a))]

  return (
    <div className="frame-media flex flex-col">
      <div className="frame-media__row flex items-center">
        {ids.length ? (
          <ol className="frame-media__strip flex items-center" aria-label={`${label} media`}>
            {ids.map((id, i) => {
              const asset = byId.get(id)
              return (
                <li
                  key={id}
                  className="frame-media__item shrink-0"
                  draggable={ids.length > 1}
                  data-dragging={dragging === i}
                  title={asset ? assetTitle(asset) : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    setDragging(i)
                  }}
                  onDragOver={(e) => dragging !== null && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragging !== null && dragging !== i) onChange(move(ids, dragging, i))
                    setDragging(null)
                  }}
                  onDragEnd={() => setDragging(null)}
                >
                  <button
                    type="button"
                    className="frame-media__thumb"
                    aria-label={`${i + 1}: ${asset ? assetTitle(asset) : 'media'}${ids.length > 1 ? ' — ←/→ to reorder' : ''}`}
                    onClick={() => setOpen(true)}
                    onKeyDown={(e) => {
                      const to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : -1
                      if (to < 0 || to >= ids.length) return
                      e.preventDefault()
                      onChange(move(ids, i, to))
                    }}
                  >
                    {asset?.thumbUrl ? <img src={asset.thumbUrl} alt="" draggable={false} /> : null}
                    {ids.length > 1 ? (
                      <span className="frame-media__order -meta">{i + 1}</span>
                    ) : null}
                    {asset?.kind === 'video' ? <span className="frame-media__video" /> : null}
                  </button>
                  <button
                    type="button"
                    className="frame-media__remove"
                    aria-label={`Remove ${asset ? assetTitle(asset) : 'media'}`}
                    onClick={() => onChange(ids.filter((x) => x !== id))}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <span className="frame-media__none -p1">Text only</span>
        )}
        <Button
          variant="ghost"
          size="s"
          className="frame-media__toggle shrink-0"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Done' : ids.length ? 'Media' : '+ Media'}
        </Button>
        {aside ? <span className="frame-media__aside shrink-0">{aside}</span> : null}
      </div>

      {open ? (
        <div className="frame-media__panel flex flex-col">
          <div className="frame-media__controls flex items-center justify-between">
            <Segmented<'one' | 'several'>
              label={`How many media on ${label}`}
              value={multiple ? 'several' : 'one'}
              options={[
                { value: 'one', label: 'One' },
                { value: 'several', label: 'Several' },
              ]}
              onChange={(value) => {
                setSeveral(value === 'several')
                if (value === 'one' && ids.length > 1) onChange(ids.slice(0, 1))
              }}
            />
            <div className="flex items-center">
              {suggested.length ? (
                <label className="frame-media__all -p1 flex items-center">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                  />
                  Show all media
                </label>
              ) : null}
              <Button variant="ghost" size="s" disabled={!ids.length} onClick={() => onChange([])}>
                Text only
              </Button>
            </div>
          </div>
          <MediaPicker
            assets={pickable}
            selected={ids}
            max={multiple ? MAX_FRAME_MEDIA : 1}
            onChange={onChange}
          />
          <p className="frame-media__hint -meta">
            {multiple
              ? `Click to add in order, again to remove · drag to reorder · up to ${MAX_FRAME_MEDIA}`
              : 'Click to use one image or video · pick “Several” for a slideshow'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
