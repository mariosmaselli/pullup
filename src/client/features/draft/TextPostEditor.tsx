import type { Platform } from '@shared/constants.ts'
import type { Asset, Segment } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { assetTitle } from '../../lib/format.ts'
import { LINKEDIN_FOLD, PLATFORMS } from '../../lib/platforms.ts'
import './TextPostEditor.scss'

interface Props {
  platform: Platform
  segments: Segment[]
  media: Asset[]
  copied: number | 'all' | null
  onChange: (segments: Segment[]) => void
  onCopy: (text: string, which: number) => void
}

// X posts/threads and LinkedIn posts: text segments, with the post's media shown under the first.
export function TextPostEditor({ platform, segments, media, copied, onChange, onCopy }: Props) {
  const config = PLATFORMS[platform]

  return (
    <div className="text-post flex flex-col">
      {segments.map((segment, i) => {
        const length = config.length(segment.text)
        const over = length > config.limit
        return (
          <div key={i} className="text-post__segment flex flex-col">
            <textarea
              className="text-post__textarea -p"
              value={segment.text}
              rows={Math.max(
                platform === 'linkedin' ? 8 : 3,
                Math.ceil(segment.text.length / 60) + 1
              )}
              onChange={(e) =>
                onChange(segments.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)))
              }
            />
            {i === 0 && media.length ? (
              <div className="text-post__media flex">
                {media.map((a) => (
                  <img key={a.id} src={a.thumbUrl ?? ''} alt="" title={assetTitle(a)} />
                ))}
              </div>
            ) : null}
            <div className="text-post__footer flex items-center justify-between">
              <span className="-meta" data-over={over}>
                {segments.length > 1 ? `${i + 1}/${segments.length} · ` : ''}
                {length}/{config.limit}
                {platform === 'linkedin' && length > LINKEDIN_FOLD
                  ? ` · first ${LINKEDIN_FOLD} show before “see more”`
                  : ''}
              </span>
              <div className="flex items-center">
                {segments.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="s"
                    onClick={() => onChange(segments.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                ) : null}
                <Button variant="ghost" size="s" onClick={() => onCopy(segment.text, i)}>
                  {copied === i ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
            {platform === 'linkedin' && length > LINKEDIN_FOLD ? (
              <p className="text-post__fold -p1">
                <span className="-meta">Before “see more”:</span>{' '}
                {segment.text.slice(0, LINKEDIN_FOLD)}…
              </p>
            ) : null}
          </div>
        )
      })}
      {config.multiSegment ? (
        <Button
          variant="ghost"
          size="s"
          className="text-post__add"
          onClick={() => onChange([...segments, { text: '' }])}
        >
          + Add post to thread
        </Button>
      ) : null}
    </div>
  )
}
