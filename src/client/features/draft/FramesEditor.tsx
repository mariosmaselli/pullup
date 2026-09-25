import { useRef, useState } from 'react'
import type { Platform } from '@shared/constants.ts'
import type { Asset, Segment } from '@shared/types.ts'
import type { Render } from '@shared/template.ts'
import { renderForFrame } from '@shared/frames.ts'
import { Button } from '../../components/Button/Button.tsx'
import { assetTitle } from '../../lib/format.ts'
import { PLATFORMS } from '../../lib/platforms.ts'
import { compatibleTemplates, frameInputs, withTemplate } from '../../lib/frame-templates.ts'
import { useRenders } from '../../lib/queries.ts'
import { renderTemplate, resolveMedia } from '../../render/client.ts'
import { templateMeta } from '../../render/templates.ts'
import { FramePreview } from './FramePreview.tsx'
import './FramesEditor.scss'

interface Props {
  postId: string
  platform: Platform
  segments: Segment[]
  caption: string
  sources: Asset[]
  byId: Map<string, Asset>
  copied: number | 'all' | null
  // Unsaved edits: the zip is built from the saved post, so it would be out of date.
  dirty: boolean
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
  const {
    postId,
    platform,
    segments,
    caption,
    sources,
    byId,
    copied,
    dirty,
    onChange,
    onCaption,
    onCopy,
  } = props
  const config = PLATFORMS[platform]
  const frames = config.frames as Exclude<typeof config.frames, false>
  // The idea's images/videos, plus anything a frame already uses (it may not be a source).
  const visual = [
    ...sources,
    ...segments
      .map((s) => s.assetId && byId.get(s.assetId))
      .filter((a): a is Asset => !!a && !sources.includes(a)),
  ].filter((a, i, all) => (a.kind === 'image' || a.kind === 'video') && all.indexOf(a) === i)

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

  const update = (i: number, patch: Partial<Segment>) =>
    onChange(segments.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  // ── Rendering frames with templates ──────────────────────────────────────────────────────
  const { data: renders = [] } = useRenders(postId)
  const [rendering, setRendering] = useState<Record<number, number>>({}) // index → progress 0–1
  const [renderErrors, setRenderErrors] = useState<Record<number, string>>({})
  const effective = segments.map((s) => withTemplate(platform, s))
  const status = effective.map((frame, i) => renderForFrame(renders, frame, i))
  const pending = status.map((s, i) => (!s.current ? i : -1)).filter((i) => i >= 0)
  const busy = Object.keys(rendering).length > 0

  async function renderFrame(i: number): Promise<Render | null> {
    const frame = effective[i]!
    const meta = frame.template && templateMeta(frame.template.id)
    if (!meta) return null
    // Keep the template choice on the frame so saving the draft remembers it.
    if (!segments[i]!.template) update(i, { template: frame.template })
    setRendering((r) => ({ ...r, [i]: 0 }))
    setRenderErrors(({ [i]: _, ...rest }) => rest)
    try {
      const media = frame.assetId ? await resolveMedia([frame.assetId]) : []
      return await renderTemplate({
        meta,
        inputs: frameInputs(platform, frame, meta, media),
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
        const asset = segment.assetId ? byId.get(segment.assetId) : undefined
        const length = config.length(segment.text)
        const frame = effective[i]!
        const { render, current } = status[i]!
        const progress = rendering[i]
        const options = compatibleTemplates(platform, segment)
        return (
          <div key={keys.current[i]} className="frames-editor__frame flex">
            <div className="frames-editor__preview flex flex-col shrink-0">
              {render?.url ? (
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
                <FramePreview segment={segment} asset={asset} aspect={frames.aspect} />
              )}
              <span
                className="frames-editor__state -meta"
                data-state={
                  progress !== undefined ? 'busy' : current ? 'ok' : render ? 'stale' : 'none'
                }
              >
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
              <div className="flex items-center justify-between">
                <select
                  className="frames-editor__media -p1"
                  value={segment.assetId ?? ''}
                  aria-label={`Media for ${frames.noun} ${i + 1}`}
                  onChange={(e) => {
                    const picked = visual.find((a) => a.id === e.target.value)
                    // A new kind of media may need a different template: fall back to the default.
                    update(
                      i,
                      picked
                        ? {
                            assetId: picked.id,
                            kind: picked.kind as 'image' | 'video',
                            template: null,
                          }
                        : { assetId: null, kind: 'text', template: null }
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
              <div className="frames-editor__template flex items-center">
                <select
                  className="frames-editor__media -p1"
                  value={frame.template?.id ?? ''}
                  aria-label={`Template for ${frames.noun} ${i + 1}`}
                  onChange={(e) =>
                    update(i, { template: e.target.value ? { id: e.target.value } : null })
                  }
                >
                  {options.length ? null : <option value="">No template fits</option>}
                  {options.map((meta) => (
                    <option key={meta.id} value={meta.id}>
                      {meta.name}
                      {meta.kind === 'video' ? ' · video' : ''}
                    </option>
                  ))}
                </select>
                {frame.template && templateMeta(frame.template.id)?.kind === 'video' ? (
                  <label className="frames-editor__duration -p1 flex items-center">
                    <input
                      type="number"
                      min={templateMeta(frame.template.id)?.duration?.min ?? 3}
                      max={templateMeta(frame.template.id)?.duration?.max ?? 15}
                      step={0.5}
                      value={
                        frame.template.duration ??
                        templateMeta(frame.template.id)?.duration?.default ??
                        6
                      }
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
                {render?.url ? (
                  <a className="frames-editor__file -p1" href={render.url} download>
                    ↓
                  </a>
                ) : null}
              </div>
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
