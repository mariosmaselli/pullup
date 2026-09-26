import { useState } from 'react'
import type { AiSpend } from '@shared/storage.ts'
import { Button } from '../../components/Button/Button.tsx'
import { useAiUsage } from '../../lib/queries.ts'
import './AiSpendPanel.scss'

const ALL = 'all'

const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`
const count = (n: number) => n.toLocaleString('en-GB')
const tokens = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 })

const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (month: string) => {
  const [year, m] = month.split('-').map(Number)
  return new Date(year!, m! - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

const TASK_LABELS: Record<string, string> = {
  'analyze-asset': 'Analyze asset',
  'generate-ideas': 'Post ideas',
  'draft-package': 'Write drafts',
  'revise-post': 'Revise draft',
}

// AI spend from the ai_runs log: per month, and per task for the month you pick.
export function AiSpendPanel() {
  const { data: usage } = useAiUsage()
  const [month, setMonth] = useState<string>(thisMonth)
  const [open, setOpen] = useState(false)

  const current = usage?.months.find((m) => m.month === thisMonth())
  const tasks =
    month === ALL
      ? (usage?.tasks ?? [])
      : (usage?.monthTasks.filter((t) => t.month === month) ?? [])

  // One line until asked for the breakdown, so loading never shifts the sections below.
  return (
    <div className="ai-spend-panel flex flex-col">
      <div className="ai-spend-panel__row flex items-center justify-between">
        <p className="ai-spend-panel__summary -p1">
          {!usage ? (
            '—'
          ) : !usage.total.calls ? (
            <span className="ai-spend-panel__muted">No AI calls yet</span>
          ) : (
            <>
              This month <strong>{usd(current?.costUsd ?? 0)}</strong>
              <span className="ai-spend-panel__muted">
                {' '}
                · {count(current?.calls ?? 0)} call{current?.calls === 1 ? '' : 's'} · all time{' '}
                {usd(usage.total.costUsd)}
              </span>
            </>
          )}
        </p>
        <Button
          size="s"
          variant="ghost"
          disabled={!usage?.total.calls}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide breakdown' : 'By month and task'}
        </Button>
      </div>

      {open && usage ? (
        <>
          <SpendTable
            heading="Month"
            rows={[
              ...usage.months.map((m) => ({ key: m.month, label: monthLabel(m.month), ...m })),
              { key: ALL, label: 'All time', ...usage.total },
            ]}
            selected={month}
            onSelect={setMonth}
          />

          <h3 className="ai-spend-panel__heading -meta">
            By task · {month === ALL ? 'all time' : monthLabel(month)}
          </h3>
          {tasks.length ? (
            <SpendTable
              heading="Task"
              rows={tasks.map((t) => ({ key: t.task, label: TASK_LABELS[t.task] ?? t.task, ...t }))}
            />
          ) : (
            <p className="ai-spend-panel__muted -p1">No AI calls that month.</p>
          )}
          <p className="ai-spend-panel__muted -p1">
            Cost is what Pullup logged for each call. Failed calls are counted; any cost logged for
            them is included. Pick a month to see its tasks.
          </p>
        </>
      ) : null}
    </div>
  )
}

function SpendTable({
  heading,
  rows,
  selected,
  onSelect,
}: {
  heading: string
  rows: (AiSpend & { key: string; label: string })[]
  selected?: string
  onSelect?: (key: string) => void
}) {
  return (
    <div className="ai-spend-panel__scroll">
      <table className="ai-spend-panel__table -p1">
        <thead className="-meta">
          <tr>
            <th>{heading}</th>
            <th>Calls</th>
            <th>Tokens in / out</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.key === selected ? 'is-selected' : undefined}>
              <td>
                {onSelect ? (
                  <button
                    type="button"
                    className="ai-spend-panel__pick"
                    onClick={() => onSelect(row.key)}
                  >
                    {row.label}
                  </button>
                ) : (
                  row.label
                )}
              </td>
              <td>
                {count(row.calls)}
                {row.failed ? (
                  <span className="ai-spend-panel__failed -meta">{row.failed} failed</span>
                ) : null}
              </td>
              <td>
                {tokens.format(row.tokensIn)} / {tokens.format(row.tokensOut)}
              </td>
              <td>{usd(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
