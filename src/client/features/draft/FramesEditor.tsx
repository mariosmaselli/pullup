import type { Platform } from '@shared/constants.ts'
import type { Asset, Segment } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { assetTitle } from '../../lib/format.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { FramePreview } from './FramePreview.tsx'
import './FramesEditor.scss'

interface Props {
  platform: Platform
  segments: Segment[]
  caption: string
  sources: Asset[]
  byId: Map<string, Asset>
  copied: number | 'all' | null
  onChange: (segments: Segment[]) => void
  onCaption: (caption: string) => void
  onCopy: (text: string, which: number | 'all') => void
}

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

// Instagram stories (9:16 frames) and carousels (4:5 slides + caption). Each frame has on-screen
// text and optionally one image or video from the idea's material.
export function FramesEditor(props: Props) {
  const { platform, segments, caption, sources, byId, copied, onChange, onCaption, onCopy } = props
  const config = PLATFORMS[platform]
  const frames = config.frames as Exclude<typeof config.frames, false>
  const visual = sources.filter((a) => a.kind === 'image' || a.kind === 'video')

  const update = (i: number, patch: Partial<Segment>) =>
    onChange(segments.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  return (
    <div className="frames-editor flex flex-col">
      {segments.map((segment, i) => {
        const asset = segment.assetId ? byId.get(segment.assetId) : undefined
        const length = config.length(segment.text)
        return (
          <div key={i} className="frames-editor__frame flex">
            <div className="frames-editor__preview shrink-0">
              <FramePreview segment={segment} asset={asset} aspect={frames.aspect} />
            </div>
            <div className="frames-editor__fields flex flex-col flex-1">
              <div className="flex items-center justify-between">
                <span className="frames-editor__label -meta">
                  {frames.noun} {i + 1}
                </span>
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="s"
                    disabled={i === 0}
                    aria-label="Move up"
                    onClick={() => onChange(move(segments, i, i - 1))}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="s"
                    disabled={i === segments.length - 1}
                    aria-label="Move down"
                    onClick={() => onChange(move(segments, i, i + 1))}
                  >
                    ↓
                  </Button>
                  {segments.length > frames.min ? (
                    <Button
                      variant="ghost"
                      size="s"
                      onClick={() => onChange(segments.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <textarea
                className="frames-editor__text -p"
                value={segment.text}
                rows={3}
                placeholder="On-screen text (optional)"
                onChange={(e) => update(i, { text: e.target.value })}
              />
              <div className="flex items-center justify-between">
                <select
                  className="frames-editor__media -p1"
                  value={segment.assetId ?? ''}
                  aria-label={`Media for ${frames.noun} ${i + 1}`}
                  onChange={(e) => {
                    const picked = visual.find((a) => a.id === e.target.value)
                    update(
                      i,
                      picked
                        ? { assetId: picked.id, kind: picked.kind as 'image' | 'video' }
                        : { assetId: null, kind: 'text' }
                    )
                  }}
                >
                  <option value="">Text only</option>
                  {visual.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.kind === 'video' ? 'Video · ' : 'Image · '}
                      {assetTitle(a)}
                    </option>
                  ))}
                </select>
                <span className="-meta frames-editor__count" data-over={length > config.limit}>
                  {length}/{config.limit}
                </span>
              </div>
            </div>
          </div>
        )
      })}

      {segments.length < frames.max ? (
        <Button
          variant="ghost"
          size="s"
          className="frames-editor__add"
          onClick={() => onChange([...segments, { text: '', assetId: null, kind: 'text' }])}
        >
          + Add {frames.noun}
        </Button>
      ) : null}

      {config.caption ? (
        <div className="frames-editor__caption flex flex-col">
          <div className="flex items-center justify-between">
            <span className="frames-editor__label -meta">Caption</span>
            <div className="flex items-center">
              <span
                className="-meta frames-editor__count"
                data-over={[...caption].length > config.caption.limit}
              >
                {[...caption].length}/{config.caption.limit}
              </span>
              <Button variant="ghost" size="s" onClick={() => onCopy(caption, 'all')}>
                {copied === 'all' ? 'Copied' : 'Copy caption'}
              </Button>
            </div>
          </div>
          <textarea
            className="frames-editor__text -p"
            value={caption}
            rows={6}
            onChange={(e) => onCaption(e.target.value)}
          />
        </div>
      ) : null}
    </div>
  )
}
