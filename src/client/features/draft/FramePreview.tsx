import type { Asset, Segment } from '@shared/types.ts'
import './FramePreview.scss'

interface Props {
  segment: Segment
  asset?: Asset
  aspect: '9:16' | '4:5'
}

// A quick stand-in for the rendered frame: Mario's text-story layout (dark canvas, large white
// type bottom-left). The real output comes from the template engine.
export function FramePreview({ segment, asset, aspect }: Props) {
  const image =
    asset?.derivatives.find((d) => d.role === 'poster')?.url ?? asset?.thumbUrl ?? undefined

  return (
    <div
      className="frame-preview"
      data-aspect={aspect}
      data-media={image ? 'true' : 'false'}
      aria-hidden
    >
      {image ? <img className="frame-preview__media" src={image} alt="" /> : null}
      {asset?.kind === 'video' ? <span className="frame-preview__badge">Video</span> : null}
      {segment.text ? <p className="frame-preview__text">{segment.text}</p> : null}
    </div>
  )
}
