import type { InboxIssue } from '@shared/types.ts'
import { bytes, relativeTime } from '../../lib/format.ts'
import { useInboxIssueAction } from '../../lib/queries.ts'
import { Button } from '../../components/Button/Button.tsx'
import './InboxIssues.scss'

// Files sitting in the inbox folder that Pullup couldn't import — so they don't wait unnoticed.
export function InboxIssues({ issues, folder }: { issues: InboxIssue[]; folder: string }) {
  const action = useInboxIssueAction()
  const pending = action.isPending ? action.variables : null

  return (
    <section className="inbox-issues flex flex-col" aria-label="Files that weren't imported">
      <header className="inbox-issues__header flex flex-col">
        <h2 className="-p">
          {issues.length} file{issues.length === 1 ? '' : 's'} in the inbox folder couldn’t be
          imported
        </h2>
        <p className="inbox-issues__muted -p1">
          They stay in <code>{folder}</code> until you fix, remove or trash them.
        </p>
      </header>
      <ul className="inbox-issues__list flex flex-col">
        {issues.map((issue) => (
          <li key={issue.name} className="inbox-issues__item flex items-center justify-between">
            <div className="inbox-issues__body flex flex-col min-w-0">
              <span className="inbox-issues__name -p1">{issue.name}</span>
              <span className="inbox-issues__reason -p1">{issue.reason}</span>
              <span className="inbox-issues__muted -meta">
                {bytes(issue.sizeBytes)} · saved {relativeTime(issue.modifiedAt)}
              </span>
            </div>
            <div className="flex items-center shrink-0">
              <Button
                variant="ghost"
                size="s"
                disabled={pending?.name === issue.name}
                onClick={() => action.mutate({ name: issue.name, action: 'retry' })}
              >
                Try again
              </Button>
              <Button
                variant="ghost"
                size="s"
                disabled={pending?.name === issue.name}
                onClick={() => action.mutate({ name: issue.name, action: 'trash' })}
              >
                Move to trash
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {action.error ? <p className="inbox-issues__error -p1">{action.error.message}</p> : null}
    </section>
  )
}
