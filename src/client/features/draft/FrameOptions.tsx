import type { Asset } from '@shared/types.ts'
import { paramVisible, withDefaultParams, type TemplateMeta } from '@shared/template.ts'
import { BackgroundPicker } from '../../components/BackgroundPicker/BackgroundPicker.tsx'
import { ParamField } from '../../components/ParamField/ParamField.tsx'
import { changedParams, extraTextFields } from '../../lib/frame-templates.ts'
import { BACKGROUND_PARAMS, takesBackground } from '../../../../templates/_lib/background.ts'
import './FrameOptions.scss'

interface Props {
  meta: TemplateMeta
  // Only the settings this frame changed; everything else is the template's default.
  params: Record<string, unknown>
  // How many media the frame has (some settings only show with media).
  media: number
  onChange: (params: Record<string, unknown>) => void
  // The template's text fields after the first (the frame's own text) — the corner labels.
  text?: {
    values: Record<string, string>
    onChange: (key: string, value: string) => void
  }
  // The frame's background image/video, for templates that take one.
  background?: {
    assetId: string | null
    asset?: Asset
    // Images and videos to choose from.
    assets: Asset[]
    onChange: (assetId: string | null) => void
  }
}

// The chosen template's settings for one frame: its labels (optional, empty until written), its
// settings (framing, type, animation, colours… — those that do something for this frame) and,
// when the template takes one, its background (colour, image or video).
export function FrameOptions({ meta, params, media, onChange, text, background }: Props) {
  const specs = Object.entries(meta.params ?? {})
  const values = withDefaultParams(meta, params)
  const withBackground = !!background && takesBackground(meta)
  const fields = text ? extraTextFields(meta) : []
  const set = (key: string, value: unknown) =>
    onChange(changedParams(meta, { ...params, [key]: value }))
  return (
    <div className="frame-options flex flex-col">
      {text && fields.length ? (
        <div className="frame-options__text">
          {fields.map(([key, spec]) => {
            const value = text.values[key] ?? ''
            return (
              <label key={key} className="frame-options__field flex flex-col">
                <span className="frame-options__label flex items-center justify-between -meta">
                  <span>{spec.label}</span>
                  {spec.max && value ? (
                    <span>
                      {[...value].length}/{spec.max}
                    </span>
                  ) : null}
                </span>
                {spec.multiline ? (
                  <textarea
                    className="frame-options__input -p1"
                    rows={2}
                    value={value}
                    onChange={(e) => text.onChange(key, e.target.value)}
                  />
                ) : (
                  <input
                    className="frame-options__input -p1"
                    value={value}
                    onChange={(e) => text.onChange(key, e.target.value)}
                  />
                )}
              </label>
            )
          })}
        </div>
      ) : null}
      <div className="frame-options__params">
        {specs
          .filter(([key]) => !(withBackground && key in BACKGROUND_PARAMS))
          .filter(([, spec]) => paramVisible(spec, { params: values, media }))
          .map(([key, spec]) => (
            <ParamField
              key={key}
              spec={spec}
              value={values[key]}
              onChange={(value) => set(key, value)}
            />
          ))}
      </div>
      {withBackground ? (
        <div className="frame-options__background">
          <BackgroundPicker
            meta={meta}
            params={values}
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
