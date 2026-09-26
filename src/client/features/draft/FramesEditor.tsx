import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Platform } from '@shared/constants.ts'
import type { Asset, FrameTemplate, Segment } from '@shared/types.ts'
import type { Render } from '@shared/template.ts'
import { frameAssetIds, frameBackgroundId, renderForFrame } from '@shared/frames.ts'
import { AnimationExport } from '../../components/AnimationExport/AnimationExport.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { PLATFORMS } from '../../lib/platforms.ts'
import {
  changedParams,
  compatibleTemplates,
  frameInputs,
  frameMediaKinds,
  withTemplate,
  type MediaKind,
} from '../../lib/frame-templates.ts'
import { useRenders } from '../../lib/queries.ts'
import { renderTemplate, resolveMedia } from '../../render/client.ts'
import { templateMeta } from '../../render/templates.ts'
import {
  BACKGROUND_MEDIA_KEYS,
  BACKGROUND_PARAMS,
  takesBackground,
  type BackgroundKey,
} from '../../../../templates/_lib/background.ts'
import { FrameMedia } from './FrameMedia.tsx'
import { FrameOptions } from './FrameOptions.tsx'
import { FramePreview } from './FramePreview.tsx'
import './FramesEditor.scss'

interface Props {
  postId: string
  platform: Platform
  segments: Segment[]
  caption: string
  sources: Asset[]
  // Media on the saved post (every frame's), offered next to the sources.
  postMedia: Asset[]
  byId: Map<string, Asset>
  copied: number | 'all' | null
  // Unsaved edits: the zip is built from the saved post, so it would be out of date.
  dirty: boolean
  onChange: Dispatch<SetStateAction<Segment[]>>
  onCaption: (caption: string) => void
  onCopy: (text: string, which: number | 'all') => void
}

const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

const isVisual = (a: Asset | undefined): a is Asset => a?.kind === 'image' || a?.kind === 'video'

// The frame's background, when its template takes one (templates/_lib/background.ts).
const backgroundOf = (frame: Segment) => {
  const meta = frame.template ? templateMeta(frame.template.id) : undefined
  return meta && takesBackground(meta) ? frameBackgroundId(frame) : null
}

// A new template choice keeps the background — the image/video and how it sits — when the new
// template takes one too; everything else starts from the new template's defaults.
function switchTemplate(current: FrameTemplate | null | undefined, id: string): FrameTemplate {
  const next = templateMeta(id)
  if (!current?.background || !next || !takesBackground(next)) return { id }
  const params = Object.fromEntries(
    Object.entries(current.params ?? {}).filter(([key]) => key in BACKGROUND_PARAMS)
  )
  return {
    id,
    background: current.background,
    ...(Object.keys(params).length ? { params } : {}),
  }
}

// Instagram stories (9:16 frames) and carousels (4:5 slides + caption). Each frame has on-screen
// text and any number of images/videos (in order), rendered by a template with its own options.
export function FramesEditor(props: Props) {
  const {
    postId,
    platform,
    segments,
    caption,
    sources,
    postMedia,
    byId,
    copied,
    dirty,
    onChange,
    onCaption,
    onCopy,
  } = props
  const config = PLATFORMS[platform]
  const frames = config.frames as Exclude<typeof config.frames, false>
  // The idea's images/videos, media on the post and anything a frame uses (it may not be a source).
  const suggested = [
    ...sources,
    ...postMedia,
    ...segments.flatMap(frameAssetIds).map((id) => byId.get(id)),
  ].filter((a, i, all): a is Asset => isVisual(a) && all.indexOf(a) === i)
  // "Show all media": every finished image/video in the library.
  const library = useMemo(
    () => [...byId.values()].filter((a) => isVisual(a) && a.processingStatus === 'ready'),
    [byId]
  )

  // Stable identity per frame, so reordering moves the DOM (and focus) with the frame.
  const nextKey = useRef(0)
  const keys = useRef<number[]>([])
  if (keys.current.length !== segments.length) {
    keys.current = segments.map(() => nextKey.current++)
  }
  const change = (next: Segment[], nextKeys: number[]) => {
    keys.current = nextKeys
    onChange(next)
  }

  // Functional: several renders in a row each record their frame's template.
  const update = (i: number, patch: Partial<Segment>) =>
    onChange((current) => current.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const kindOf = (id: string): MediaKind => (byId.get(id)?.kind === 'video' ? 'video' : 'image')

  // New media keep the frame's template (and its options) while it still fits them; otherwise the
  // frame falls back to the default for its media.
  const setMedia = (i: number, ids: string[]) => {
    const template = segments[i]!.template
    const fits = compatibleTemplates(platform, ids.map(kindOf)).some((m) => m.id === template?.id)
    const first = ids[0]
    update(i, {
      assetId: first ?? null,
      kind: first ? kindOf(first) : 'text',
      assetIds: first ? ids : null,
      template: fits ? template : null,
    })
  }

  // Options: only settings that differ from the template's defaults are kept on the frame.
  const setParams = (i: number, template: FrameTemplate, params: Record<string, unknown>) => {
    const { params: _, ...rest } = template
    update(i, { template: Object.keys(params).length ? { ...rest, params } : rest })
  }
  // Removing the background also drops its size / position / darken / blur (hidden without one).
  const setBackground = (i: number, template: FrameTemplate, assetId: string | null) => {
    if (assetId) return update(i, { template: { ...template, background: { assetId } } })
    const { background: _, params = {}, ...rest } = template
    const kept = Object.fromEntries(
      Object.entries(params).filter(
        ([key]) => !BACKGROUND_MEDIA_KEYS.includes(key as BackgroundKey)
      )
    )
    update(i, { template: Object.keys(kept).length ? { ...rest, params: kept } : rest })
  }
  // Reset: the template's defaults, without a background.
  const resetOptions = (i: number, template: FrameTemplate) => {
    const { params: _, background: __, ...rest } = template
    update(i, { template: rest })
  }
  const [optionsOpen, setOptionsOpen] = useState<Set<number>>(() => new Set())
  const toggleOptions = (key: number) =>
    setOptionsOpen((open) => {
      const next = new Set(open)
      if (!next.delete(key)) next.add(key)
      return next
    })

  // ── Rendering frames with templates ──────────────────────────────────────────────────────
  const { data: renders = [] } = useRenders(postId)
  const [rendering, setRendering] = useState<Record<number, number>>({}) // index → progress 0–1
  const [renderErrors, setRenderErrors] = useState<Record<number, string>>({})
  const kinds = segments.map((s) => frameMediaKinds(s, byId))
  const effective = segments.map((s, i) => withTemplate(platform, s, kinds[i]!))
  const status = effective.map((frame, i) => renderForFrame(renders, frame, i))
  const pending = status.map((s, i) => (!s.current ? i : -1)).filter((i) => i >= 0)
  const busy = Object.keys(rendering).length > 0

  // One live preview at a time (it runs a render worker): the frame whose Options were opened
  // last and are still open. Other frames show their render while it is current, else a stand-in.
  const hasOptions = (i: number) => {
    const id = effective[i]?.template?.id
    return Object.keys((id && templateMeta(id)?.params) || {}).length > 0
  }
  const liveKey = [...optionsOpen].reverse().find((key) => {
    const i = keys.current.indexOf(key)
    return i >= 0 && hasOptions(i)
  })

  async function renderFrame(i: number): Promise<Render | null> {
    const frame = effective[i]!
    const meta = frame.template && templateMeta(frame.template.id)
    if (!meta) return null
    // Keep the template choice on the frame so saving the draft remembers it (also replaces a
    // template that was removed or no longer fits the frame's media).
    if (segments[i]!.template?.id !== frame.template!.id) update(i, { template: frame.template })
    setRendering((r) => ({ ...r, [i]: 0 }))
    setRenderErrors(({ [i]: _, ...rest }) => rest)
    try {
      const backgroundId = backgroundOf(frame)
      const [media, [background = null] = []] = await Promise.all([
        resolveMedia(frameAssetIds(frame)),
        backgroundId ? resolveMedia([backgroundId]) : [],
      ])
      return await renderTemplate({
        meta,
        inputs: { ...frameInputs(platform, frame, meta, media), background },
        postId,
        segmentIndex: i,
        onProgress: (done, total) => setRendering((r) => ({ ...r, [i]: done / total })),
      })
    } catch (err) {
      setRenderErrors((e) => ({ ...e, [i]: (err as Error).message }))
      return null
    } finally {
      setRendering(({ [i]: _, ...rest }) => rest)
    }
  }

  async function renderAll() {
    for (const i of pending) await renderFrame(i)
  }

  return (
    <div className="frames-editor flex flex-col">
      <div className="frames-editor__toolbar flex items-center justify-between">
        <span className="-meta frames-editor__muted">
          {segments.length - pending.length}/{segments.length} {frames.noun}s rendered
        </span>
        <div className="flex items-center">
          <Button size="s" disabled={busy || !pending.length} onClick={renderAll}>
            {busy ? 'Rendering…' : pending.length ? `Render ${pending.length}` : 'All rendered'}
          </Button>
          <a
            className="frames-editor__download -p1"
            aria-disabled={dirty || pending.length === segments.length}
            title={dirty ? 'Save your edits first' : undefined}
            href={
              dirty || pending.length === segments.length
                ? undefined
                : `/api/posts/${postId}/frames.zip`
            }
            download
          >
            Download all
          </a>
        </div>
      </div>

      {segments.map((segment, i) => {
        const ids = frameAssetIds(segment)
        const asset = ids[0] ? byId.get(ids[0]) : undefined
        const length = config.length(segment.text)
        const frame = effective[i]!
        const meta = frame.template ? templateMeta(frame.template.id) : undefined
        const settings = Object.keys(meta?.params ?? {}).length
        const backgroundId = backgroundOf(frame)
        // Stale keys (a setting the template no longer has) don't count as changes.
        const changed = meta
          ? Object.keys(changedParams(meta, frame.template?.params ?? {})).length +
            (backgroundId ? 1 : 0)
          : 0
        const optionsShown = optionsOpen.has(keys.current[i]!) && !!meta && settings > 0
        const live = optionsShown && keys.current[i] === liveKey
        const inputs = meta ? frameInputs(platform, frame, meta, []) : undefined
        const { render, current } = status[i]!
        // Downloads and GIF/WebP exports only for a render of the frame's current template (an
        // outdated one of another template stays out of reach).
        const exportable =
          render?.status === 'ready' && render.url && render.templateId === frame.template?.id
            ? render
            : null
        const progress = rendering[i]
        const options = compatibleTemplates(platform, kinds[i]!)
        return (
          <div key={keys.current[i]} className="frames-editor__frame flex">
            <div className="frames-editor__preview flex flex-col shrink-0">
              {!live && current && render?.url ? (
                <div className="frames-editor__render" data-aspect={frames.aspect}>
                  {render.kind === 'video' ? (
                    <video
                      src={render.url}
                      poster={render.posterUrl ?? undefined}
                      muted
                      loop
                      playsInline
                      autoPlay
                    />
                  ) : (
                    <img src={render.url} alt="" />
                  )}
                </div>
              ) : (
                <FramePreview
                  segment={segment}
                  asset={asset}
                  count={ids.length}
                  aspect={frames.aspect}
                  params={inputs?.params}
                  background={backgroundId ? byId.get(backgroundId) : undefined}
                  live={
                    live && meta && inputs
                      ? { meta, inputs, assetIds: ids, backgroundId }
                      : undefined
                  }
                />
              )}
              <span
                className="frames-editor__state -meta"
                data-state={
                  progress !== undefined ? 'busy' : current ? 'ok' : render ? 'stale' : 'none'
                }
              >
                {live ? 'Live · ' : ''}
                {progress !== undefined
                  ? `Rendering ${Math.round(progress * 100)}%`
                  : current
                    ? 'Rendered'
                    : render
                      ? 'Out of date'
                      : 'Not rendered'}
              </span>
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
                    onClick={() => change(move(segments, i, i - 1), move(keys.current, i, i - 1))}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="s"
                    disabled={i === segments.length - 1}
                    aria-label="Move down"
                    onClick={() => change(move(segments, i, i + 1), move(keys.current, i, i + 1))}
                  >
                    ↓
                  </Button>
                  {segments.length > frames.min ? (
                    <Button
                      variant="ghost"
                      size="s"
                      onClick={() =>
                        change(
                          segments.filter((_, j) => j !== i),
                          keys.current.filter((_, j) => j !== i)
                        )
                      }
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
              <FrameMedia
                ids={ids}
                byId={byId}
                suggested={suggested}
                library={library}
                label={`${frames.noun} ${i + 1}`}
                aside={
                  <span className="-meta frames-editor__count" data-over={length > config.limit}>
                    {length}/{config.limit}
                  </span>
                }
                onChange={(next) => setMedia(i, next)}
              />
              <div className="frames-editor__template flex items-center">
                <select
                  className="frames-editor__media -p1"
                  value={frame.template?.id ?? ''}
                  aria-label={`Template for ${frames.noun} ${i + 1}`}
                  onChange={(e) =>
                    update(i, {
                      template: e.target.value
                        ? switchTemplate(segments[i]!.template, e.target.value)
                        : null,
                    })
                  }
                >
                  {options.length ? null : (
                    <option value="">
                      {ids.length > 1
                        ? `No template takes ${ids.length} media`
                        : 'No template fits'}
                    </option>
                  )}
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                      {option.kind === 'video' ? ' · video' : ''}
                    </option>
                  ))}
                </select>
                {frame.template && meta?.kind === 'video' ? (
                  <label className="frames-editor__duration -p1 flex items-center">
                    <input
                      type="number"
                      min={meta.duration?.min ?? 3}
                      max={meta.duration?.max ?? 15}
                      step={0.5}
                      value={frame.template.duration ?? meta.duration?.default ?? 6}
                      onChange={(e) =>
                        update(i, {
                          template: { ...frame.template!, duration: Number(e.target.value) },
                        })
                      }
                    />
                    s
                  </label>
                ) : null}
                <Button
                  size="s"
                  variant={current ? 'ghost' : 'secondary'}
                  disabled={progress !== undefined || !frame.template}
                  onClick={() => void renderFrame(i)}
                >
                  {current ? 'Re-render' : 'Render'}
                </Button>
                {exportable ? (
                  <a className="frames-editor__file -p1" href={exportable.url!} download>
                    ↓
                  </a>
                ) : null}
              </div>
              {exportable?.kind === 'video' ? (
                <AnimationExport key={exportable.id} render={exportable} />
              ) : null}
              <div className="frames-editor__options flex items-center">
                <button
                  type="button"
                  className="frames-editor__options-toggle -p1 flex items-center"
                  aria-expanded={optionsShown}
                  disabled={!settings}
                  onClick={() => toggleOptions(keys.current[i]!)}
                >
                  <span className="frames-editor__caret" aria-hidden />
                  Options
                  {changed ? (
                    <span className="frames-editor__muted -meta">{changed} changed</span>
                  ) : null}
                </button>
                {changed && frame.template ? (
                  <button
                    type="button"
                    className="frames-editor__reset -p1"
                    onClick={() => resetOptions(i, frame.template!)}
                  >
                    Reset
                  </button>
                ) : null}
              </div>
              {optionsShown && frame.template ? (
                <FrameOptions
                  meta={meta!}
                  params={frame.template.params ?? {}}
                  onChange={(params) => setParams(i, frame.template!, params)}
                  background={{
                    assetId: backgroundId,
                    asset: backgroundId ? byId.get(backgroundId) : undefined,
                    assets: library,
                    onChange: (id) => setBackground(i, frame.template!, id),
                  }}
                />
              ) : null}
              {renderErrors[i] ? (
                <p className="frames-editor__error -p1">{renderErrors[i]}</p>
              ) : null}
              {current && render?.warnings.length ? (
                <p className="frames-editor__error -p1">{render.warnings.join(' · ')}</p>
              ) : null}
            </div>
          </div>
        )
      })}

      {segments.length < frames.max ? (
        <Button
          variant="ghost"
          size="s"
          className="frames-editor__add"
          onClick={() =>
            change(
              [...segments, { text: '', assetId: null, kind: 'text' }],
              [...keys.current, nextKey.current++]
            )
          }
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
