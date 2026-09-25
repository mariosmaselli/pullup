import type { ParamSpec } from '@shared/template.ts'
import './ParamField.scss'

interface Props {
  spec: ParamSpec
  value: unknown
  onChange: (value: unknown) => void
}

// One template parameter, rendered from its spec in the template's meta.ts.
export function ParamField({ spec, value, onChange }: Props) {
  return (
    <label className="param-field flex flex-col">
      <span className="param-field__label flex items-center justify-between -meta">
        <span>{spec.label}</span>
        {spec.type === 'number' ? <span>{String(value)}</span> : null}
      </span>
      {spec.type === 'color' ? (
        <span className="param-field__color flex items-center">
          <input type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} />
          <span className="-meta">{String(value)}</span>
        </span>
      ) : spec.type === 'number' ? (
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      ) : spec.type === 'select' ? (
        <select
          className="param-field__select -p1"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {spec.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
    </label>
  )
}
