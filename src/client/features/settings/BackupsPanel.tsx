import { Button } from '../../components/Button/Button.tsx'
import type { ApiError } from '../../lib/api.ts'
import { bytes, dateTime, relativeTime } from '../../lib/format.ts'
import { useBackUpNow, useBackups } from '../../lib/queries.ts'
import './BackupsPanel.scss'

// Database snapshots (ideas, drafts, history, settings) — daily while Pullup runs, or on demand.
export function BackupsPanel() {
  const { data: status } = useBackups()
  const backUp = useBackUpNow()
  const latest = status?.latest

  return (
    <div className="backups-panel flex flex-col">
      <div className="backups-panel__row flex items-center justify-between">
        <p className="-p1">
          {status === undefined ? (
            '—'
          ) : latest ? (
            <>
              Last backup{' '}
              <span title={dateTime(latest.createdAt)}>{relativeTime(latest.createdAt)}</span>
              <span className="backups-panel__muted">
                {' '}
                · {bytes(latest.sizeBytes)} · {status.snapshots} of {status.keep} kept
              </span>
            </>
          ) : (
            'No backup yet'
          )}
        </p>
        <Button size="s" disabled={backUp.isPending} onClick={() => backUp.mutate()}>
          {backUp.isPending ? 'Backing up…' : 'Back up now'}
        </Button>
      </div>
      {status ? <code className="backups-panel__folder -meta">{status.folder}</code> : null}
      <p className="backups-panel__muted -p1">
        Pullup copies its database here once a day while it runs, and before every update. Your
        media files aren’t copied — they’re the originals in the library folder. These copies live
        on this Mac: back the whole library folder up with Time Machine or another drive to be safe
        if the Mac is lost.
      </p>
      {backUp.error ? (
        <p className="backups-panel__error -p1">{(backUp.error as ApiError).message}</p>
      ) : null}
    </div>
  )
}
