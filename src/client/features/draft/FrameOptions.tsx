import type { Asset } from '@shared/types.ts'
import type { TemplateMeta } from '@shared/template.ts'
import { BackgroundPicker } from '../../components/BackgroundPicker/BackgroundPicker.tsx'
import { ParamField } from '../../components/ParamField/ParamField.tsx'
import { changedParams } from '../../lib/frame-templates.ts'
import { BACKGROUND_PARAMS, takesBackground } from '../../../../templates/_lib/background.ts'
import './FrameOptions.scss'

interface Props {
  meta: TemplateMeta
  // Only the settings this frame changed; everything else is the template's default.
  params: Record<string, unknown>
  onChange: (params: Record<string, unknown>) => void
  // The frame's background image/video, for templates that take one.
  background?: {
    assetId: string | null
    asset?: Asset
    // Images and videos to choose from.
    assets: Asset[]
    onChange: (assetId: string | null) => void
  }
}

// The chosen template's settings for one frame (framing, type size, colours…) and, when the
// template takes one, its background (colour, image or video).
export function FrameOptions({ meta, params, onChange, background }: Props) {
  const specs = Object.entries(meta.params ?? {})
  const withBackground = !!background && takesBackground(meta)
  const set = (key: string, value: unknown) =>
    onChange(changedParams(meta, { ...params, [key]: value }))
  return (
    <div className="frame-options flex flex-col">
      <div className="frame-options__params">
        {specs
          .filter(([key]) => !(withBackground && key in BACKGROUND_PARAMS))
          .map(([key, spec]) => (
            <ParamField
              key={key}
              spec={spec}
              value={params[key] ?? spec.default}
              onChange={(value) => set(key, value)}
            />
          ))}
      </div>
      {withBackground ? (
        <div className="frame-options__background">
          <BackgroundPicker
            meta={meta}
            params={Object.fromEntries(
              specs.map(([key, spec]) => [key, params[key] ?? spec.default])
            )}
            onParam={set}
            assetId={background.assetId}
            asset={background.asset}
            assets={background.assets}
            onAsset={background.onChange}
          />
        </div>
      ) : null}
    </div>
  )
}
