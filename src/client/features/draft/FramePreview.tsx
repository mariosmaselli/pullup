import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { Asset, Segment } from '@shared/types.ts'
import {
  ASPECT_SIZE,
  type MediaInput,
  type TemplateInputs,
  type TemplateMeta,
} from '@shared/template.ts'
import { mediaRect, type Rect } from '../../../../templates/_lib/layout.ts'
import { backgroundOptions } from '../../../../templates/_lib/background.ts'
import { PreviewController, resolveMedia } from '../../render/client.ts'
import './FramePreview.scss'

interface Props {
  segment: Segment
  // The frame's first media, and how many it has.
  asset?: Asset
  count?: number
  aspect: '9:16' | '4:5'
  // The template's settings for this frame (defaults + changes): the stand-in follows the shared
  // media size / text position options (templates/_lib/layout.ts), type size and colours.
  params?: Record<string, unknown>
  // The frame's background image/video (templates/_lib/background.ts), under the media.
  background?: Asset
  // Draw the frame with its template, live: the stand-in shows until the first frame is drawn,
  // then every change redraws in place. One live preview at a time (it runs a render worker).
  live?: {
    meta: TemplateMeta
    inputs: TemplateInputs
    assetIds: string[]
    backgroundId?: string | null
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined)
const pct = (n: number) => `${(n * 100).toFixed(3)}%`

// Where the video preview rests: late enough that the type has come in, before any exit.
const restingTime = (duration: number) => duration * 0.4

// A still of an image/video and its size (the poster of a video, else the thumbnail).
function stillOf(asset: Asset | undefined) {
  const still =
    asset?.derivatives.find((d) => d.role === 'poster') ??
    asset?.derivatives.find((d) => d.role === 'thumb')
  const url = still?.url ?? asset?.thumbUrl ?? undefined
  const size =
    still?.width && still.height
      ? { w: still.width, h: still.height }
      : asset?.file?.width && asset.file.height
        ? { w: asset.file.width, h: asset.file.height }
        : null
  return { url, size }
}

// A rect in canvas px as a share of the frame (for absolutely placed media).
const placed = (rect: Rect, frame: { width: number; height: number }): CSSProperties => ({
  left: pct(rect.x / frame.width),
  top: pct(rect.y / frame.height),
  width: pct(rect.w / frame.width),
  height: pct(rect.h / frame.height),
})

// A quick stand-in for the rendered frame, drawn with CSS: the media sized like the template
// sizes it (Fill / Fit, scale, position), type in Mario's story style where the template's
// options put it. With `live`, the template itself draws the frame on top.
export function FramePreview({
  segment,
  asset,
  count = asset ? 1 : 0,
  aspect,
  params = {},
  background,
  live,
}: Props) {
  const { url: image, size } = stillOf(asset)
  const position =
    params.textPosition === 'Top' || params.textPosition === 'Middle'
      ? params.textPosition
      : 'Bottom'
  const fit = params.size === 'Fit' || params.framing === 'Fit' || params.fit === 'Frame'
  const frame = ASPECT_SIZE[aspect]
  // Same maths as the templates (canvas px → share of the frame).
  const rect = size
    ? mediaRect(frame.width, frame.height, size.w, size.h, {
        size: fit ? 'Fit' : 'Fill',
        scale: num(params.scale),
        focusX: num(params.focusX),
        focusY: num(params.focusY),
      })
    : null
  const typeSize = num(params.typeSize) ?? num(params.size) ?? num(params.titleSize) ?? 84
  // The background, placed and treated like the template does (blur in cqw: 1cqw = 10.8 px).
  const ground = stillOf(background)
  const groundOptions = backgroundOptions(params)
  const groundRect = ground.size
    ? mediaRect(frame.width, frame.height, ground.size.w, ground.size.h, {
        size: groundOptions.fit,
        scale: groundOptions.scale,
        focusX: groundOptions.x,
        focusY: groundOptions.y,
      })
    : null

  const { rootRef, shown, error, scrub, scrubbing } = useLivePreview(live)

  return (
    <div
      ref={rootRef}
      className="frame-preview"
      data-aspect={aspect}
      data-media={image ? 'true' : 'false'}
      data-position={position}
      data-align={params.textAlign === 'Center' ? 'center' : 'left'}
      data-fit={fit}
      data-live={live ? (shown ? 'shown' : 'loading') : undefined}
      style={
        {
          '--frame-ground': color(params.background),
          '--frame-ink': color(params.color),
          '--frame-type': (typeSize / 1080) * 100,
        } as CSSProperties
      }
      onPointerMove={scrub.move}
      onPointerLeave={scrub.leave}
      aria-hidden
    >
      {ground.url ? (
        <img
          className="frame-preview__ground"
          src={ground.url}
          alt=""
          data-sized={groundRect ? 'true' : 'false'}
          style={
            {
              ...(groundRect ? placed(groundRect, frame) : {}),
              '--ground-blur': `${(groundOptions.blur / 10.8).toFixed(3)}cqw`,
              '--ground-brightness': 1 - groundOptions.darken,
            } as CSSProperties
          }
        />
      ) : null}
      {image ? (
        <img
          className="frame-preview__media"
          src={image}
          alt=""
          data-sized={rect ? 'true' : 'false'}
          style={
            rect
              ? placed(rect, frame)
              : {
                  objectPosition: `${(num(params.focusX) ?? 0.5) * 100}% ${(num(params.focusY) ?? 0.5) * 100}%`,
                }
          }
        />
      ) : null}
      {error ? (
        <span className="frame-preview__badge" title={error}>
          Preview failed
        </span>
      ) : shown ? null : count > 1 ? (
        <span className="frame-preview__badge">{count} media</span>
      ) : asset?.kind === 'video' ? (
        <span className="frame-preview__badge">Video</span>
      ) : null}
      {segment.text ? <p className="frame-preview__text">{segment.text}</p> : null}
      {scrubbing !== null ? (
        <span className="frame-preview__scrub" style={{ width: pct(scrubbing) }} />
      ) : null}
    </div>
  )
}

// The live part: one worker and canvas while `live` is set. The canvas is added outside React
// (it is handed to the worker, which then owns it) and fades in over the stand-in once drawn.
// Videos rest on a representative time; moving the pointer across the frame scrubs it.
function useLivePreview(live: Props['live']) {
  const rootRef = useRef<HTMLDivElement>(null)
  const controller = useRef<PreviewController | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [shown, setShown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [media, setMedia] = useState<{
    key: string
    list: MediaInput[]
    background: MediaInput | null
  } | null>(null)
  const [scrubbing, setScrubbing] = useState<number | null>(null)

  const isLive = !!live
  // The media and the background, as one key (a change resolves both again).
  const idsKey = live ? JSON.stringify([live.assetIds, live.backgroundId ?? null]) : ''
  const duration = live?.meta.kind === 'video' ? live.inputs.duration : 0
  // Only a real change reloads (the editor rebuilds `live` on every render).
  const inputsKey = live ? JSON.stringify([live.meta.id, live.meta.version, live.inputs]) : ''

  useEffect(() => {
    const root = rootRef.current
    if (!isLive || !root) return
    const canvas = document.createElement('canvas')
    canvas.className = 'frame-preview__canvas'
    root.append(canvas)
    const next = new PreviewController(canvas, {
      onLoaded: () => {
        setShown(true)
        setError(null)
      },
      onError: setError,
    })
    controller.current = next
    setEpoch((n) => n + 1)
    return () => {
      next.dispose()
      canvas.remove()
      controller.current = null
      setShown(false)
      setError(null)
    }
  }, [isLive])

  // What the worker reads for the frame's media (a video's proxy is built on first use).
  useEffect(() => {
    if (!isLive || !idsKey) return
    let cancelled = false
    const [ids, backgroundId] = JSON.parse(idsKey) as [string[], string | null]
    Promise.all([resolveMedia(ids), backgroundId ? resolveMedia([backgroundId]) : []])
      .then(
        ([list, [background = null]]) => !cancelled && setMedia({ key: idsKey, list, background })
      )
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [isLive, idsKey])

  // Rest on the representative time (again whenever the duration changes).
  useEffect(() => {
    controller.current?.seek(restingTime(duration))
  }, [duration, epoch])

  useEffect(() => {
    const root = rootRef.current
    if (!live || !root || !controller.current || media?.key !== idsKey) return
    // Canvas pixels for the column's width on this screen (capped at the studio's half size).
    const width = Math.min(540, Math.round(root.clientWidth * (window.devicePixelRatio || 1)))
    controller.current.load(
      live.meta,
      { ...live.inputs, media: media.list, background: media.background },
      width
    )
    // `inputsKey` stands for `live`.
  }, [inputsKey, media, idsKey, epoch])

  const scrub = {
    move: (e: PointerEvent<HTMLDivElement>) => {
      if (!shown || !duration || e.pointerType === 'touch') return
      const box = e.currentTarget.getBoundingClientRect()
      const at = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
      setScrubbing(at)
      controller.current?.seek(at * duration)
    },
    leave: () => {
      if (scrubbing === null) return
      setScrubbing(null)
      controller.current?.seek(restingTime(duration))
    },
  }

  return { rootRef, shown, error, scrub, scrubbing }
}
