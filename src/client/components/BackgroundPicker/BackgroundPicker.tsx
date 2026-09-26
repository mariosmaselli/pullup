import { useState } from 'react'
import type { Asset } from '@shared/types.ts'
import type { ParamSpec, TemplateMeta } from '@shared/template.ts'
import { BACKGROUND_MEDIA_KEYS } from '../../../../templates/_lib/background.ts'
import { assetTitle } from '../../lib/format.ts'
import { Button } from '../Button/Button.tsx'
import { MediaPicker } from '../MediaPicker/MediaPicker.tsx'
import { ParamField } from '../ParamField/ParamField.tsx'
import './BackgroundPicker.scss'

interface Props {
  // A template that takes a background (takesBackground(meta)).
  meta: TemplateMeta
  // The template's settings, defaults filled in.
  params: Record<string, unknown>
  onParam: (key: string, value: unknown) => void
  // The chosen image/video: its id (null = the colour only) and, when known, the asset.
  assetId: string | null
  asset?: Asset
  // Images and videos to choose from.
  assets: Asset[]
  onAsset: (id: string | null) => void
}

// Inside the group the "Background" prefix goes without saying.
const short = (spec: ParamSpec, label?: string): ParamSpec => ({
  ...spec,
  label: label ?? spec.label.replace(/^Background\s+/i, ''),
})

// A template's background: its colour, an image or video from the library on demand, and — once
// one is chosen — how it sits (size, position, darken, blur: templates/_lib/background.ts).
export function BackgroundPicker({
  meta,
  params,
  onParam,
  assetId,
  asset,
  assets,
  onAsset,
}: Props) {
  const [open, setOpen] = useState(false)
  const specs = meta.params ?? {}
  const color = specs.background
  // The chosen media stays pickable even when it isn't in the list.
  const pickable = asset && !assets.includes(asset) ? [asset, ...assets] : assets

  return (
    <div className="background-picker flex flex-col">
      <span className="background-picker__title -meta">Background</span>
      <div className="background-picker__source flex items-center">
        <span className="background-picker__thumb shrink-0" data-video={asset?.kind === 'video'}>
          {asset?.thumbUrl ? <img src={asset.thumbUrl} alt="" /> : null}
        </span>
        <span className="background-picker__name -p1 flex-1">
          {asset ? assetTitle(asset) : assetId ? 'Media not found' : 'Colour only'}
        </span>
        <Button variant="ghost" size="s" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Done' : assetId ? 'Change' : 'Image or video'}
        </Button>
        {assetId ? (
          <Button variant="ghost" size="s" onClick={() => onAsset(null)}>
            Remove
          </Button>
        ) : null}
      </div>
      {open ? (
        <MediaPicker
          assets={pickable}
          selected={assetId ? [assetId] : []}
          max={1}
          onChange={(ids) => onAsset(ids[0] ?? null)}
        />
      ) : null}
      <div className="background-picker__settings">
        {color ? (
          <ParamField
            spec={short(color, 'Colour')}
            value={params.background ?? color.default}
            onChange={(value) => onParam('background', value)}
          />
        ) : null}
        {assetId
          ? BACKGROUND_MEDIA_KEYS.map((key) => {
              const spec = specs[key]
              return spec ? (
                <ParamField
                  key={key}
                  spec={short(spec)}
                  value={params[key] ?? spec.default}
                  onChange={(value) => onParam(key, value)}
                />
              ) : null
            })
          : null}
      </div>
    </div>
  )
}
