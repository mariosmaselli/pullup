import { useState } from 'react'
import { ATTACHED_IMAGE_LIMIT, type Platform } from '@shared/constants.ts'
import type { Asset, Segment } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { MediaPicker } from '../../components/MediaPicker/MediaPicker.tsx'
import type { ApiError } from '../../lib/api.ts'
import { assetTitle } from '../../lib/format.ts'
import { LINKEDIN_FOLD, PLATFORMS } from '../../lib/platforms.ts'
import { useSetPostMedia } from '../../lib/queries.ts'
import './TextPostEditor.scss'

type AttachPlatform = keyof typeof ATTACHED_IMAGE_LIMIT

export const attachLimit = (platform: Platform) =>
  ATTACHED_IMAGE_LIMIT[platform as AttachPlatform] ?? 10

// X and LinkedIn take one video on its own, or up to a few images (the server checks the same).
// Picking a video replaces the images; picking an image replaces a video; a full set stays full.
export function attachedSelection(
  platform: Platform,
  byId: Map<string, Asset>,
  previous: string[],
  next: string[]
): string[] {
  const added = next.find((id) => !previous.includes(id))
  if (!added) return next
  if (byId.get(added)?.kind === 'video') return [added]
  return next.filter((id) => byId.get(id)?.kind !== 'video').slice(0, attachLimit(platform))
}

export const attachHint = (platform: Platform) =>
  `${PLATFORMS[platform].label} takes one video, or up to ${attachLimit(platform)} images.`

interface Props {
  postId: string
  platform: Platform
  segments: Segment[]
  media: Asset[]
  // Library images and videos that can be attached.
  library: Asset[]
  copied: number | 'all' | null
  onChange: (segments: Segment[]) => void
  onCopy: (text: string, which: number) => void
}

// X posts/threads and LinkedIn posts: text segments, with the post's media under the first.
// Media changes save straight away (they aren't part of the text revision).
export function TextPostEditor({
  postId,
  platform,
  segments,
  media,
  library,
  copied,
  onChange,
  onCopy,
}: Props) {
  const config = PLATFORMS[platform]
  const setMedia = useSetPostMedia()
  const [picking, setPicking] = useState(false)
  const byId = new Map(library.concat(media).map((a) => [a.id, a]))
  // While a change is saving, build on it (fast clicks in the picker don't lose each other).
  const ids =
    setMedia.isPending && setMedia.variables?.id === postId
      ? setMedia.variables.assetIds
      : media.map((a) => a.id)
  const shown = ids.map((id) => byId.get(id)).filter((a): a is Asset => !!a)
  const error = setMedia.error as ApiError | null

  const save = (assetIds: string[]) => setMedia.mutate({ id: postId, assetIds })
  const move = (from: number, by: -1 | 1) => {
    const next = [...ids]
    const [item] = next.splice(from, 1)
    next.splice(from + by, 0, item!)
    save(next)
  }

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
              placeholder={i === 0 && !segment.text ? 'Write the post…' : undefined}
              rows={Math.max(
                platform === 'linkedin' ? 8 : 3,
                Math.ceil(segment.text.length / 60) + 1
              )}
              onChange={(e) =>
                onChange(segments.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)))
              }
            />
            {i === 0 ? (
              <div className="text-post__media flex flex-col">
                <div className="text-post__media-bar flex items-center justify-between">
                  <Button variant="ghost" size="s" onClick={() => setPicking(!picking)}>
                    {picking ? 'Done' : shown.length ? 'Change media' : '+ Add media'}
                  </Button>
                  {picking ? <span className="-meta">{attachHint(platform)}</span> : null}
                </div>
                {picking ? (
                  <MediaPicker
                    assets={library}
                    selected={ids}
                    max={attachLimit(platform) + 1}
                    onChange={(next) => save(attachedSelection(platform, byId, ids, next))}
                  />
                ) : null}
                {/* After the picker, so picking never pushes the picker down. */}
                {shown.length ? (
                  <ul className="text-post__thumbs flex">
                    {shown.map((a, j) => (
                      <li key={a.id} className="text-post__thumb flex flex-col">
                        {a.thumbUrl ? (
                          <img src={a.thumbUrl} alt="" title={assetTitle(a)} />
                        ) : (
                          <span className="text-post__no-thumb" title={assetTitle(a)} />
                        )}
                        <span className="text-post__thumb-meta -meta">
                          {a.kind === 'video' ? 'Video' : `${j + 1}`}
                          {a.visibility === 'private' ? ' · private' : ''}
                        </span>
                        <span className="text-post__thumb-actions flex">
                          <button
                            type="button"
                            className="-meta"
                            aria-label={`Move ${assetTitle(a)} earlier`}
                            disabled={j === 0}
                            onClick={() => move(j, -1)}
                          >
                            ←
                          </button>
                          <button
                            type="button"
                            className="-meta"
                            aria-label={`Move ${assetTitle(a)} later`}
                            disabled={j === shown.length - 1}
                            onClick={() => move(j, 1)}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            className="-meta"
                            aria-label={`Remove ${assetTitle(a)}`}
                            onClick={() => save(ids.filter((id) => id !== a.id))}
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {error ? <p className="text-post__error -p1">{error.message}</p> : null}
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
                {[...segment.text].slice(0, LINKEDIN_FOLD).join('')}…
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
