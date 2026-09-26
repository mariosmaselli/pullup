import { useState, type CSSProperties } from 'react'
import {
  EXPORT_PRESET_IDS,
  EXPORT_PRESETS,
  exportSize,
  type ExportFormat,
  type ExportPreset,
  type RenderExport,
} from '@shared/render-exports.ts'
import type { Render } from '@shared/template.ts'
import { bytes } from '../../lib/format.ts'
import { useCreateRenderExport, useRenderExports } from '../../lib/queries.ts'
import { Button } from '../Button/Button.tsx'
import { Segmented } from '../Segmented/Segmented.tsx'
import './AnimationExport.scss'

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'gif', label: 'GIF' },
  { value: 'webp', label: 'WebP' },
]
const SIZES = EXPORT_PRESET_IDS.map((id) => ({ value: id, label: EXPORT_PRESETS[id].label }))
const formatLabel = (format: ExportFormat) => FORMATS.find((f) => f.value === format)!.label

interface Props {
  // A finished video render.
  render: Render
}

// Looping GIF / animated WebP of a video render: pick a format and size, export (made on the
// server, progress polled), then download. Made files are kept and listed.
export function AnimationExport({ render }: Props) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('gif')
  const [preset, setPreset] = useState<ExportPreset>('small')
  const create = useCreateRenderExport()
  const asked = create.variables
  const askedHere = (f: ExportFormat, p: ExportPreset) =>
    asked?.renderId === render.id && asked.format === f && asked.preset === p
  const { data: exports = [] } = useRenderExports(
    open ? render.id : null,
    create.isPending && asked?.renderId === render.id
  )

  const selected = exports.find((e) => e.format === format && e.preset === preset)
  const size = selected ?? exportSize(render, preset)
  const pending = selected?.status === 'pending' || (create.isPending && askedHere(format, preset))
  const progress = selected?.status === 'pending' ? (selected.progress ?? 0) : 0
  const error = create.isError && askedHere(format, preset) ? create.error.message : null
  const others = exports.filter((e) => e.status === 'ready' && e !== selected)

  return (
    <div className="animation-export flex flex-col">
      <button
        type="button"
        className="animation-export__toggle -p1 flex items-center"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="animation-export__caret" aria-hidden />
        Export GIF / WebP
      </button>

      {open ? (
        <div className="animation-export__panel flex flex-col">
          <Segmented<ExportFormat>
            label="Export format"
            value={format}
            options={FORMATS}
            onChange={setFormat}
          />
          <Segmented<ExportPreset>
            label="Export size"
            value={preset}
            options={SIZES}
            onChange={setPreset}
          />
          <span className="animation-export__muted -meta">
            {size.width}×{size.height} · {size.fps} fps · loops
          </span>

          <div className="animation-export__action flex items-center">
            {selected?.status === 'ready' ? (
              <a className="animation-export__download -p1" href={selected.url!} download>
                Download {formatLabel(format)} · {bytes(selected.sizeBytes ?? 0)}
              </a>
            ) : pending ? (
              <div
                className="animation-export__progress flex items-center flex-1"
                role="progressbar"
                aria-label={`Exporting ${formatLabel(format)}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <span className="animation-export__track flex-1">
                  <span
                    className="animation-export__bar"
                    style={{ '--progress': progress } as CSSProperties}
                  />
                </span>
                <span className="animation-export__percent -meta">
                  {Math.round(progress * 100)}%
                </span>
              </div>
            ) : (
              <Button
                size="s"
                onClick={() => create.mutate({ renderId: render.id, format, preset })}
              >
                Export {formatLabel(format)}
              </Button>
            )}
          </div>

          {selected?.status === 'ready' && selected.warnings.length ? (
            <Warnings warnings={selected.warnings} />
          ) : null}
          {error ? <p className="animation-export__error -p1">{error}</p> : null}

          {others.length ? (
            <ul className="animation-export__made flex flex-col">
              {others.map((e) => (
                <MadeExport key={`${e.format}:${e.preset}`} made={e} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <ul className="animation-export__warnings -p1">
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  )
}

function MadeExport({ made }: { made: RenderExport }) {
  return (
    <li className="flex items-center justify-between">
      <span className="animation-export__muted -meta">
        {formatLabel(made.format)} · {EXPORT_PRESETS[made.preset].label} · {made.width}×
        {made.height}
      </span>
      <a
        className="animation-export__file -meta"
        href={made.url!}
        download
        title={made.warnings.join(' · ') || undefined}
      >
        {bytes(made.sizeBytes ?? 0)} ↓
      </a>
    </li>
  )
}
