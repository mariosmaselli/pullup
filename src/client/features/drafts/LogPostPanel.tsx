import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PLATFORMS as PLATFORM_IDS, type Platform } from '@shared/constants.ts'
import type { Asset } from '@shared/types.ts'
import { Button } from '../../components/Button/Button.tsx'
import { MediaPicker } from '../../components/MediaPicker/MediaPicker.tsx'
import { ProjectPicker } from '../../components/ProjectPicker/ProjectPicker.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import type { ApiError } from '../../lib/api.ts'
import { assetTitle } from '../../lib/format.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { useAssets, useLogPost } from '../../lib/queries.ts'
import { localInput } from '../draft/PublishPanel.tsx'
import { attachedSelection, attachHint, attachLimit } from '../draft/TextPostEditor.tsx'
import './LogPostPanel.scss'

interface Props {
  onClose: () => void
}

const TEXT_LABEL: Record<Platform, string> = {
  x: 'Text',
  linkedin: 'Text',
  ig_story: 'Text on the first frame (optional)',
  ig_feed: 'Caption',
}

// Keep a media pick valid when the platform changes (X/LinkedIn: one video, or a few images).
function fitPlatform(platform: Platform, byId: Map<string, Asset>, ids: string[]) {
  const frames = PLATFORMS[platform].frames
  if (frames) return ids.slice(0, frames.max)
  const video = ids.find((id) => byId.get(id)?.kind === 'video')
  if (video) return [video]
  return ids.slice(0, attachLimit(platform))
}

// A post that went out without Pullup: recorded as published, so the calendar and history
// are complete.
export function LogPostPanel({ onClose }: Props) {
  const navigate = useNavigate()
  const log = useLogPost()
  const { data: assets = [] } = useAssets('all')
  const library = useMemo(
    () => assets.filter((a) => a.kind === 'image' || a.kind === 'video'),
    [assets]
  )
  const byId = useMemo(() => new Map(library.map((a) => [a.id, a])), [library])
  const [platform, setPlatform] = useState<Platform>('x')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [when, setWhen] = useState(() => localInput(new Date()))
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [approve, setApprove] = useState(false)
  const [picking, setPicking] = useState(false)
  const error = log.error as ApiError | null

  const frames = PLATFORMS[platform].frames
  const picked = assetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a)
  const privateOnes = picked.filter((a) => a.visibility === 'private')
  const ready = (!!text.trim() || picked.length > 0) && !!when && (!privateOnes.length || approve)

  const submit = () =>
    log.mutate(
      {
        platform,
        text: text.trim(),
        publicUrl: url.trim() || null,
        publishedAt: new Date(when).toISOString(),
        assetIds,
        projectId,
        approveMedia: privateOnes.length ? approve : undefined,
      },
      { onSuccess: (post) => navigate({ to: '/drafts/$id', params: { id: post.id } }) }
    )

  return (
    <form
      className="log-post-panel flex flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) submit()
      }}
    >
      <div className="log-post-panel__head flex items-center justify-between">
        <span className="log-post-panel__label -meta">Log a published post</span>
        <Button variant="ghost" size="s" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="log-post-panel__hint -p1">
        For something you posted outside Pullup — it’s saved as published, so the calendar and
        history stay complete.
      </p>

      <div className="log-post-panel__field flex flex-col">
        <span className="log-post-panel__label -meta">Platform</span>
        <Segmented<Platform>
          label="Platform"
          value={platform}
          onChange={(next) => {
            setPlatform(next)
            setAssetIds((ids) => fitPlatform(next, byId, ids))
          }}
          options={PLATFORM_IDS.map((p) => ({ value: p, label: PLATFORMS[p].label }))}
        />
      </div>

      <label className="log-post-panel__field flex flex-col">
        <span className="log-post-panel__label -meta">{TEXT_LABEL[platform]}</span>
        <textarea
          className="log-post-panel__input -p"
          rows={platform === 'ig_story' ? 2 : 5}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      <div className="log-post-panel__row flex">
        <label className="log-post-panel__field flex flex-col flex-1">
          <span className="log-post-panel__label -meta">Link (optional)</span>
          <input
            className="log-post-panel__input -p1"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="log-post-panel__field flex flex-col">
          <span className="log-post-panel__label -meta">Published on</span>
          <input
            className="log-post-panel__input -p1"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        <div className="log-post-panel__field log-post-panel__project flex flex-col">
          <span className="log-post-panel__label -meta">Project (optional)</span>
          <ProjectPicker value={projectId} onChange={setProjectId} />
        </div>
      </div>

      <div className="log-post-panel__field flex flex-col">
        <div className="flex items-center justify-between">
          <span className="log-post-panel__label -meta">
            Media{picked.length ? ` · ${picked.length}` : ''}
          </span>
          <Button variant="ghost" size="s" onClick={() => setPicking(!picking)}>
            {picking ? 'Done' : picked.length ? 'Change' : '+ Add media'}
          </Button>
        </div>
        {picked.length && !picking ? (
          <p className="log-post-panel__hint -p1">
            {picked.map(assetTitle).join(', ')}
            {frames ? ` — one ${frames.noun} each` : ''}
          </p>
        ) : null}
        {picking ? (
          <>
            <span className="log-post-panel__hint -meta">
              {frames
                ? `One ${frames.noun} per image or video, in the order you pick them.`
                : attachHint(platform)}
            </span>
            <div className="log-post-panel__picker">
              <MediaPicker
                assets={library}
                selected={assetIds}
                max={frames ? frames.max : attachLimit(platform) + 1}
                onChange={(next) =>
                  setAssetIds(frames ? next : attachedSelection(platform, byId, assetIds, next))
                }
              />
            </div>
          </>
        ) : null}
      </div>

      {privateOnes.length ? (
        <label className="log-post-panel__notice flex items-center -p1">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
          {privateOnes.length === 1 ? 'This is' : 'These are'} still private (
          {privateOnes.map(assetTitle).join(', ')}). It’s posted already — approve{' '}
          {privateOnes.length === 1 ? 'it' : 'them'} for public use.
        </label>
      ) : null}

      {error ? <p className="log-post-panel__error -p1">{error.message}</p> : null}

      <div className="flex items-center justify-end">
        <Button variant="primary" size="s" type="submit" disabled={!ready || log.isPending}>
          Save as published
        </Button>
      </div>
    </form>
  )
}
