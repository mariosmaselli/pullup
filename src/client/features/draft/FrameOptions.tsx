import type { TemplateMeta } from '@shared/template.ts'
import { ParamField } from '../../components/ParamField/ParamField.tsx'
import { changedParams } from '../../lib/frame-templates.ts'
import './FrameOptions.scss'

interface Props {
  meta: TemplateMeta
  // Only the settings this frame changed; everything else is the template's default.
  params: Record<string, unknown>
  onChange: (params: Record<string, unknown>) => void
}

// The chosen template's settings for one frame (framing, type size, colours…).
export function FrameOptions({ meta, params, onChange }: Props) {
  return (
    <div className="frame-options">
      {Object.entries(meta.params ?? {}).map(([key, spec]) => (
        <ParamField
          key={key}
          spec={spec}
          value={params[key] ?? spec.default}
          onChange={(value) => onChange(changedParams(meta, { ...params, [key]: value }))}
        />
      ))}
    </div>
  )
}
