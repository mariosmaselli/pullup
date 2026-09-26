import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import {
  ASPECT_LABEL,
  ASPECT_SIZE,
  paramVisible,
  resolveOutputKind,
  type Aspect,
  type MediaInput,
  type Render,
  type TemplateInputs,
  type TemplateMeta,
} from '@shared/template.ts'
import { AnimationExport } from '../../components/AnimationExport/AnimationExport.tsx'
import { BackgroundPicker } from '../../components/BackgroundPicker/BackgroundPicker.tsx'
import { Button } from '../../components/Button/Button.tsx'
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx'
import { MediaPicker } from '../../components/MediaPicker/MediaPicker.tsx'
import { ParamField } from '../../components/ParamField/ParamField.tsx'
import { Segmented } from '../../components/Segmented/Segmented.tsx'
import { bytes, relativeTime } from '../../lib/format.ts'
import { useAssets, useDeleteRender, useRenders } from '../../lib/queries.ts'
import {
  PreviewController,
  previewWidth,
  renderTemplate,
  resolveMedia,
} from '../../render/client.ts'
import { templateMeta } from '../../render/templates.ts'
import { BACKGROUND_PARAMS, takesBackground } from '../../../../templates/_lib/background.ts'
import './TemplateStudio.scss'

interface StudioState {
  aspect: Aspect
  duration: number
  text: Record<string, string>
  params: Record<string, unknown>
  seed: number
}

const initialState = (meta: TemplateMeta): StudioState => ({
  aspect: meta.aspects[0]!,
  duration: meta.duration?.default ?? 0,
  text: Object.fromEntries(Object.entries(meta.text ?? {}).map(([k, s]) => [k, s.default ?? ''])),
  params: Object.fromEntries(Object.entries(meta.params ?? {}).map(([k, s]) => [k, s.default])),
  seed: 1,
})

export function TemplateStudio() {
  const { id } = useParams({ from: '/templates/$id' })
  const meta = templateMeta(id)
  if (!meta) {
    return (
      <EmptyState title="Template not found">
        <Link to="/templates">Back to templates</Link>
      </EmptyState>
    )
  }
  return <Studio key={meta.id} meta={meta} />
}

function Studio({ meta }: { meta: TemplateMeta }) {
  const { data: allAssets = [] } = useAssets('all')
  const { data: renders = [] } = useRenders()
  const remove = useDeleteRender()
  const [state, setState] = useState<StudioState>(() => initialState(meta))
  const [mediaIds, setMediaIds] = useState<string[]>([])
  const [media, setMedia] = useState<MediaInput[]>([])
  const [preparing, setPreparing] = useState(false)
  // Background image/video (templates that spread BACKGROUND_PARAMS).
  const takes = takesBackground(meta)
  const [backgroundId, setBackgroundId] = useState<string | null>(null)
  const [background, setBackground] = useState<MediaInput | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [time, setTime] = useState({ t: 0, playing: false, duration: 0 })
  const [progress, setProgress] = useState<number | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [latest, setLatest] = useState<Render | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const preview = useRef<PreviewController | null>(null)
  const abort = useRef<AbortController | null>(null)

  const pickable = useMemo(
    () =>
      allAssets.filter(
        (a) =>
          (a.kind === 'image' || a.kind === 'video') &&
          a.processingStatus === 'ready' &&
          meta.media.kinds.includes(a.kind)
      ),
    [allAssets, meta.media.kinds]
  )
  const visual = useMemo(
    () =>
      allAssets.filter(
        (a) => (a.kind === 'image' || a.kind === 'video') && a.processingStatus === 'ready'
      ),
    [allAssets]
  )
  const needsMedia = mediaIds.length < meta.media.min
  // What the render will be — a still or a video — for these settings ('auto' templates decide per
  // render: e.g. a JPEG when nothing moves). From the picked assets, so it follows a pick at once.
  const kindOf = (id: string) =>
    visual.find((a) => a.id === id)?.kind === 'video' ? 'video' : 'image'
  const output = resolveOutputKind(meta, {
    media: mediaIds.map((id) => ({ kind: kindOf(id) })),
    background: takes && backgroundId ? { kind: kindOf(backgroundId) } : null,
    text: state.text,
    params: state.params,
  })
  const isVideo = output === 'video'
  // Text fields: the multiline ones, then the one-line ones (labels) side by side.
  const textFields = Object.entries(meta.text ?? {})
  const labelFields = textFields.filter(([, spec]) => !spec.multiline)
  const groupLabels = labelFields.length > 1
  // The chosen background isn't resolved yet (a video's proxy may be building).
  const backgroundAsset = visual.find((a) => a.id === backgroundId)
  const backgroundPending = !!backgroundId && background?.assetId !== backgroundId

  // Resolve what the worker reads for the picked assets (videos get a proxy on first use).
  useEffect(() => {
    let cancelled = false
    if (!mediaIds.length) {
      setMedia([])
      return
    }
    setPreparing(true)
    resolveMedia(mediaIds)
      .then((resolved) => !cancelled && setMedia(resolved))
      .catch((err: Error) => !cancelled && setPreviewError(err.message))
      .finally(() => !cancelled && setPreparing(false))
    return () => {
      cancelled = true
    }
  }, [mediaIds])

  // The same for the background.
  useEffect(() => {
    let cancelled = false
    if (!backgroundId) {
      setBackground(null)
      return
    }
    resolveMedia([backgroundId])
      .then(([resolved]) => !cancelled && setBackground(resolved ?? null))
      .catch((err: Error) => !cancelled && setPreviewError(err.message))
    return () => {
      cancelled = true
    }
  }, [backgroundId])

  const inputs: TemplateInputs = useMemo(
    () => ({
      aspect: state.aspect,
      duration: state.duration,
      media,
      text: state.text,
      params: state.params,
      seed: state.seed,
      background: takes ? background : null,
    }),
    [state, media, background, takes]
  )

  // One worker per canvas. A canvas can be handed to a worker only once, so each run of this
  // effect (React may run it twice in development) creates its own <canvas>.
  const [previewEpoch, setPreviewEpoch] = useState(0)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const canvas = document.createElement('canvas')
    canvas.className = 'template-studio__canvas'
    stage.prepend(canvas)
    const controller = new PreviewController(canvas, {
      onLoaded: (info) => {
        setPreviewError(null)
        setTime((current) => ({ ...current, t: info.t, duration: info.duration }))
      },
      onTime: (t, playing) => setTime((current) => ({ ...current, t, playing })),
      onError: setPreviewError,
    })
    preview.current = controller
    setPreviewEpoch((n) => n + 1)
    return () => {
      controller.dispose()
      canvas.remove()
      preview.current = null
    }
  }, [])

  // Reload the preview on every change: the controller coalesces them to one per animation frame
  // and keeps the time, play state and last frame (a slider drag updates live, video keeps going).
  useEffect(() => {
    if (needsMedia || preparing || backgroundPending || media.length !== mediaIds.length) return
    preview.current?.load(meta, inputs, previewWidth(inputs.aspect))
  }, [
    meta,
    inputs,
    needsMedia,
    preparing,
    backgroundPending,
    media.length,
    mediaIds.length,
    previewEpoch,
  ])

  const templateRenders = renders.filter((r) => r.templateId === meta.id)
  const shown = latest ?? templateRenders[0] ?? null

  const startRender = async () => {
    setRenderError(null)
    setProgress(0)
    abort.current = new AbortController()
    try {
      const render = await renderTemplate({
        meta,
        inputs,
        signal: abort.current.signal,
        onProgress: (done, total) => setProgress(done / total),
      })
      setLatest(render)
    } catch (err) {
      setRenderError((err as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const setText = (key: string, value: string) =>
    setState((s) => ({ ...s, text: { ...s.text, [key]: value } }))
  const setParam = (key: string, value: unknown) =>
    setState((s) => ({ ...s, params: { ...s.params, [key]: value } }))

  return (
    <div className="template-studio">
      <Link to="/templates" className="template-studio__back -meta">
        ← Templates
      </Link>

      <div className="template-studio__layout flex">
        {/* Inputs */}
        <aside className="template-studio__inputs flex flex-col shrink-0">
          <header className="flex flex-col">
            <h1 className="-t2">{meta.name}</h1>
            <p className="template-studio__muted -p1">{meta.description}</p>
          </header>

          {meta.aspects.length > 1 ? (
            <div className="template-studio__field flex flex-col">
              <span className="template-studio__label -meta">Format</span>
              <Segmented<Aspect>
                label="Format"
                value={state.aspect}
                options={meta.aspects.map((a) => ({ value: a, label: ASPECT_LABEL[a] }))}
                onChange={(aspect) => setState((s) => ({ ...s, aspect }))}
              />
            </div>
          ) : null}

          {meta.media.max > 0 ? (
            <div className="template-studio__field flex flex-col">
              <span className="template-studio__label -meta">
                {meta.media.label ?? 'Media'} · {mediaIds.length}/{meta.media.max}
                {meta.media.min ? ` (at least ${meta.media.min})` : ''}
              </span>
              <MediaPicker
                assets={pickable}
                selected={mediaIds}
                max={meta.media.max}
                onChange={setMediaIds}
              />
            </div>
          ) : null}

          {textFields
            .filter(([, spec]) => spec.multiline || !groupLabels)
            .map(([key, spec]) => (
              <TextField
                key={key}
                spec={spec}
                value={state.text[key] ?? ''}
                onChange={(v) => setText(key, v)}
              />
            ))}

          {groupLabels ? (
            <div className="template-studio__field flex flex-col">
              <span className="template-studio__label -meta">Labels</span>
              <div className="template-studio__labels">
                {labelFields.map(([key, spec]) => (
                  <TextField
                    key={key}
                    spec={spec}
                    value={state.text[key] ?? ''}
                    onChange={(v) => setText(key, v)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {isVideo && meta.duration ? (
            <label className="template-studio__field flex flex-col">
              <span className="template-studio__label -meta">Duration · {state.duration}s</span>
              <input
                type="range"
                min={meta.duration.min}
                max={meta.duration.max}
                step={0.5}
                value={state.duration}
                onChange={(e) => setState((s) => ({ ...s, duration: Number(e.target.value) }))}
              />
            </label>
          ) : null}

          {Object.entries(meta.params ?? {})
            .filter(([key]) => !(takes && key in BACKGROUND_PARAMS))
            .filter(([, spec]) =>
              paramVisible(spec, { params: state.params, media: mediaIds.length })
            )
            .map(([key, spec]) => (
              <ParamField
                key={key}
                spec={spec}
                value={state.params[key]}
                onChange={(v) => setParam(key, v)}
              />
            ))}

          {takes ? (
            <BackgroundPicker
              meta={meta}
              params={state.params}
              onParam={setParam}
              assetId={backgroundId}
              asset={backgroundAsset}
              assets={visual}
              onAsset={setBackgroundId}
            />
          ) : null}
        </aside>

        {/* Preview */}
        <section className="template-studio__stage flex flex-col items-center flex-1">
          <div
            ref={stageRef}
            className="template-studio__frame"
            data-aspect={state.aspect}
            data-wide={ASPECT_SIZE[state.aspect].width > ASPECT_SIZE[state.aspect].height}
          >
            {needsMedia ? (
              <p className="template-studio__overlay -p1">
                Pick {meta.media.min} {meta.media.kinds.join(' or ')}
                {meta.media.min === 1 ? '' : 's'} to preview.
              </p>
            ) : preparing || (backgroundPending && backgroundAsset?.kind === 'video') ? (
              <p className="template-studio__overlay -p1">Preparing video…</p>
            ) : null}
          </div>
          {isVideo ? (
            <div className="template-studio__transport flex items-center">
              <Button
                variant="ghost"
                size="s"
                onClick={() => (time.playing ? preview.current?.pause() : preview.current?.play())}
              >
                {time.playing ? 'Pause' : 'Play'}
              </Button>
              <input
                type="range"
                className="flex-1"
                min={0}
                max={time.duration || 1}
                step={1 / 30}
                value={time.t}
                onChange={(e) => {
                  preview.current?.pause()
                  preview.current?.seek(Number(e.target.value))
                }}
              />
              <span className="-meta template-studio__muted">
                {time.t.toFixed(1)}s / {time.duration.toFixed(1)}s
              </span>
            </div>
          ) : null}
          {previewError ? <p className="template-studio__error -p1">{previewError}</p> : null}
        </section>

        {/* Output */}
        <aside className="template-studio__output flex flex-col shrink-0">
          <Button
            variant="primary"
            disabled={needsMedia || preparing || backgroundPending || progress !== null}
            onClick={startRender}
          >
            {progress !== null
              ? `Rendering… ${Math.round(progress * 100)}%`
              : isVideo
                ? 'Render MP4'
                : 'Render JPEG'}
          </Button>
          {progress !== null && isVideo ? (
            <Button variant="ghost" size="s" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          ) : null}
          {renderError ? <p className="template-studio__error -p1">{renderError}</p> : null}

          {shown ? <RenderResult render={shown} /> : null}

          {templateRenders.length ? (
            <div className="flex flex-col">
              <span className="template-studio__label -meta">Recent renders</span>
              <ul className="template-studio__renders flex flex-col">
                {templateRenders.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <button
                      type="button"
                      className="template-studio__render-link -p1"
                      onClick={() => setLatest(r)}
                    >
                      {r.aspect} · {r.status === 'ready' ? bytes(r.sizeBytes ?? 0) : r.status} ·{' '}
                      {relativeTime(r.createdAt)}
                    </button>
                    <Button variant="ghost" size="s" onClick={() => remove.mutate(r.id)}>
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

// One text field of the template (a textarea for multiline ones), with its character count.
function TextField({
  spec,
  value,
  onChange,
}: {
  spec: NonNullable<TemplateMeta['text']>[string]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="template-studio__field flex flex-col">
      <span className="template-studio__label -meta">
        {spec.label}
        {spec.max ? ` · ${[...value].length}/${spec.max}` : ''}
      </span>
      {spec.multiline ? (
        <textarea
          className="template-studio__input -p1"
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="template-studio__input -p1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

function RenderResult({ render }: { render: Render }) {
  if (render.status === 'failed') {
    return <p className="template-studio__error -p1">Render failed: {render.error}</p>
  }
  if (render.status !== 'ready' || !render.url) return null
  return (
    <div className="template-studio__result flex flex-col">
      {render.kind === 'video' ? (
        <video src={render.url} poster={render.posterUrl ?? undefined} controls loop playsInline />
      ) : (
        <img src={render.url} alt="" />
      )}
      <div className="flex items-center justify-between">
        <span className="-meta template-studio__muted">
          {render.width}×{render.height} · {bytes(render.sizeBytes ?? 0)}
          {render.elapsedMs ? ` · ${(render.elapsedMs / 1000).toFixed(1)}s` : ''}
        </span>
        <a className="template-studio__download -p1" href={render.url} download>
          Download
        </a>
      </div>
      {render.warnings.length ? (
        <ul className="template-studio__warnings -p1">
          {render.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : (
        <span className="-meta template-studio__ok">Passes Instagram’s upload checks</span>
      )}
      {render.kind === 'video' ? <AnimationExport key={render.id} render={render} /> : null}
    </div>
  )
}
