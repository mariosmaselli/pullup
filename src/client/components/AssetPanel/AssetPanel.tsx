import { useEffect, useRef, useState } from 'react'
import type { Asset } from '@shared/types.ts'
import { assetTitle, bytes, dateTime, duration, hostname } from '../../lib/format.ts'
import {
  useDeleteAsset,
  useReprocessAsset,
  useUpdateAsset,
  type AssetPatch,
} from '../../lib/queries.ts'
import { Button } from '../Button/Button.tsx'
import { ProjectPicker } from '../ProjectPicker/ProjectPicker.tsx'
import { Segmented } from '../Segmented/Segmented.tsx'
import './AssetPanel.scss'

const SOURCE_LABEL: Record<Asset['source'], string> = {
  drop: 'Dropped',
  paste: 'Pasted',
  inbox_folder: 'Inbox folder',
  url: 'Link',
  note: 'Quick capture',
  shortcut: 'Shortcut',
}

// Browsers can't display HEIC — show the generated JPEG preview instead.
const browserImage = (asset: Asset) =>
  asset.file && /image\/hei[cf]/.test(asset.file.mime)
    ? (asset.derivatives.find((d) => d.role === 'poster')?.url ?? asset.thumbUrl)
    : asset.file?.url

function Preview({ asset }: { asset: Asset }) {
  const video = useRef<HTMLVideoElement>(null)
  const frames = asset.derivatives.filter((d) => d.role === 'frame')
  const poster = asset.derivatives.find((d) => d.role === 'poster')?.url

  if (asset.kind === 'image') {
    const src = browserImage(asset)
    return src ? <img className="asset-panel__image" src={src} alt="" /> : null
  }

  if (asset.kind === 'video') {
    return (
      <>
        <video
          ref={video}
          className="asset-panel__video"
          src={asset.file?.url}
          poster={poster}
          controls
          playsInline
          preload="metadata"
        />
        {frames.length > 1 ? (
          <div className="asset-panel__frames flex">
            {frames.map((frame) => (
              <button
                key={frame.url}
                type="button"
                className="asset-panel__frame flex-1"
                title={`Jump to ${duration(frame.timeMs ?? 0)}`}
                onClick={() => {
                  if (!video.current) return
                  video.current.currentTime = (frame.timeMs ?? 0) / 1000
                }}
              >
                <img src={frame.url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}
      </>
    )
  }

  if (asset.kind === 'link' && asset.link) {
    const meta = asset.link.meta
    const image = asset.derivatives.find((d) => d.role === 'og_image')?.url ?? asset.thumbUrl
    return (
      <a
        className="asset-panel__link flex flex-col"
        href={asset.link.url}
        target="_blank"
        rel="noreferrer"
      >
        {image ? <img src={image} alt="" /> : null}
        <span className="asset-panel__link-body flex flex-col">
          <span className="-meta asset-panel__muted">
            {meta?.siteName ?? hostname(asset.link.url)}
          </span>
          <span className="-p">{meta?.title ?? asset.link.url}</span>
          {meta?.description ? (
            <span className="-p1 asset-panel__muted">{meta.description}</span>
          ) : null}
        </span>
      </a>
    )
  }

  return null
}

function Field({
  label,
  value,
  placeholder,
  multiline,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  multiline?: boolean
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = () => {
    if (draft !== value) onSave(draft)
  }
  const props = {
    className: `asset-panel__input ${multiline ? '-p1' : '-p'}`,
    value: draft,
    placeholder,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  }

  return (
    <label className="asset-panel__field flex flex-col">
      <span className="asset-panel__label -meta">{label}</span>
      {multiline ? (
        <textarea {...props} rows={4} />
      ) : (
        <input
          {...props}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
    </label>
  )
}

interface Props {
  asset: Asset
  onClose: () => void
}

export function AssetPanel({ asset, onClose }: Props) {
  const update = useUpdateAsset()
  const remove = useDeleteAsset()
  const reprocess = useReprocessAsset()

  const save = (values: Omit<AssetPatch, 'id'>) => update.mutate({ id: asset.id, ...values })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (e.key === 'Escape' && !editing && !document.querySelector('dialog[open]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const file = asset.file
  const details: [string, string | null][] = [
    ['Captured', dateTime(asset.capturedAt)],
    ['Source', SOURCE_LABEL[asset.source]],
    ['File', file?.originalName ?? null],
    ['Size', file ? bytes(file.sizeBytes) : null],
    ['Dimensions', file?.width && file.height ? `${file.width} × ${file.height}` : null],
    ['Duration', file?.durationMs ? duration(file.durationMs) : null],
    ['Stored at', file?.path ?? null],
  ]

  return (
    <aside className="asset-panel flex flex-col" aria-label="Asset details">
      <header className="asset-panel__header flex items-center justify-between">
        <span className="-meta asset-panel__muted">
          {asset.kind.toUpperCase()} · {asset.triagedAt ? 'Reviewed' : 'In inbox'}
        </span>
        <Button variant="ghost" size="s" onClick={onClose} aria-label="Close">
          Close <span className="button__kbd">Esc</span>
        </Button>
      </header>

      <div className="asset-panel__scroll flex flex-col">
        <div className="asset-panel__preview">
          <Preview asset={asset} />
        </div>

        {asset.processingStatus === 'failed' ? (
          <div className="asset-panel__error flex items-center justify-between">
            <span className="-p1">{asset.processingError ?? 'Processing failed'}</span>
            <Button size="s" onClick={() => reprocess.mutate(asset.id)}>
              Retry
            </Button>
          </div>
        ) : null}

        <div className="asset-panel__fields flex flex-col">
          <div className="asset-panel__field flex flex-col">
            <span className="asset-panel__label -meta">Project</span>
            <ProjectPicker value={asset.projectId} onChange={(projectId) => save({ projectId })} />
          </div>
          <div className="asset-panel__field flex flex-col">
            <span className="asset-panel__label -meta">Visibility</span>
            <Segmented
              label="Visibility"
              value={asset.visibility}
              options={[
                { value: 'private', label: 'Private' },
                { value: 'approved', label: 'Approved for public' },
              ]}
              onChange={(visibility) => save({ visibility })}
            />
          </div>
          <Field
            label="Title"
            value={asset.title}
            placeholder={assetTitle(asset)}
            onSave={(title) => save({ title })}
          />
          {asset.kind === 'note' ? (
            <Field
              label="Note"
              value={asset.body ?? ''}
              multiline
              onSave={(body) => body.trim() && save({ body })}
            />
          ) : null}
          <Field
            label={asset.kind === 'note' ? 'Context' : 'Notes'}
            value={asset.notes}
            placeholder="What is this? Why is it interesting?"
            multiline
            onSave={(notes) => save({ notes })}
          />
        </div>

        <dl className="asset-panel__details">
          {details
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="asset-panel__detail flex">
                <dt className="-p1 asset-panel__muted shrink-0">{label}</dt>
                <dd className="-p1">{value}</dd>
              </div>
            ))}
        </dl>
      </div>

      <footer className="asset-panel__footer flex items-center justify-between">
        <Button
          variant="danger"
          size="s"
          disabled={remove.isPending}
          onClick={() => {
            if (!confirm('Delete this asset? The original file moves to the library trash folder.'))
              return
            remove.mutate(asset.id, { onSuccess: onClose })
          }}
        >
          Delete
        </Button>
        <div className="flex items-center">
          {asset.kind !== 'note' ? (
            <Button variant="ghost" size="s" onClick={() => reprocess.mutate(asset.id)}>
              Reprocess
            </Button>
          ) : null}
          <Button variant="primary" size="s" onClick={() => save({ triaged: !asset.triagedAt })}>
            {asset.triagedAt ? 'Back to inbox' : 'Mark reviewed'}
          </Button>
        </div>
      </footer>
    </aside>
  )
}
