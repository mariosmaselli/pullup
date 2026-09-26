import type { FontSpec } from '@shared/template.ts'
import { bytes } from '../../lib/format.ts'
import { useFontFolder } from '../../lib/queries.ts'
import { templateMetas } from '../../render/templates.ts'
import './FontsPanel.scss'

interface Needed {
  file: string
  spec: FontSpec
  templates: string[]
}

// Every font file the templates ask for (meta.fonts), once, with the templates that use it.
function neededFonts(): Needed[] {
  const byFile = new Map<string, Needed>()
  for (const meta of templateMetas) {
    for (const spec of meta.fonts ?? []) {
      const entry = byFile.get(spec.file) ?? { file: spec.file, spec, templates: [] }
      if (!entry.templates.includes(meta.name)) entry.templates.push(meta.name)
      byFile.set(spec.file, entry)
    }
  }
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file))
}

// Licensed fonts never go in the repo: templates load them from <library>/fonts.
export function FontsPanel() {
  const { data: folder } = useFontFolder()
  const needed = neededFonts()
  const present = new Map(folder?.files.map((f) => [f.name.toLowerCase(), f]) ?? [])
  const missing = folder ? needed.filter((n) => !present.has(n.file.toLowerCase())) : []
  const extra =
    folder?.files.filter(
      (f) => !needed.some((n) => n.file.toLowerCase() === f.name.toLowerCase())
    ) ?? []

  return (
    <div className="fonts-panel flex flex-col">
      <ul className="fonts-panel__list">
        {needed.map((font) => {
          const file = present.get(font.file.toLowerCase())
          return (
            <li key={font.file} className="fonts-panel__row flex items-baseline">
              <div className="flex flex-col flex-1 min-w-0">
                <span className="fonts-panel__file -meta">{font.file}</span>
                <span className="fonts-panel__used -p1">
                  {font.spec.family}
                  {font.spec.weight ? ` ${font.spec.weight}` : ''} · {font.templates.join(', ')}
                </span>
              </div>
              <span
                className={`fonts-panel__status -p1 shrink-0 ${folder ? (file ? '-ok' : '-missing') : ''}`}
              >
                {!folder ? '—' : file ? `Present · ${bytes(file.sizeBytes)}` : 'Missing'}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="fonts-panel__note -p1">
        {!folder
          ? ' '
          : missing.length
            ? `${missing.length} font file${missing.length === 1 ? '' : 's'} missing — the templates that use ${missing.length === 1 ? 'it' : 'them'} can’t render (“Font file not found”) until ${missing.length === 1 ? 'it’s' : 'they’re'} in this folder, named exactly as above:`
            : 'Every font the templates need is in this folder:'}
      </p>
      <code className="fonts-panel__folder -meta">{folder?.folder ?? ' '}</code>
      {extra.length ? (
        <p className="fonts-panel__note -p1">
          Also in the folder, unused by any template: {extra.map((f) => f.name).join(', ')}
        </p>
      ) : null}
    </div>
  )
}
