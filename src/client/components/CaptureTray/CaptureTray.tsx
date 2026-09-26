import { useCapture, type Activity } from '../../lib/capture.tsx'
import './CaptureTray.scss'

const STATUS: Record<Activity['status'], string> = {
  queued: 'Waiting',
  uploading: 'Saving',
  done: 'Saved',
  duplicate: 'Already in library',
  error: 'Failed',
}

// Bottom-right list of in-flight and recent captures.
export function CaptureTray() {
  const { activities, dismiss } = useCapture()
  if (!activities.length) return null

  return (
    <div className="capture-tray flex flex-col" role="status" aria-live="polite">
      {activities.map((activity) => (
        <div key={activity.id} className="capture-tray__item" data-status={activity.status}>
          <div className="flex items-center justify-between">
            <span className="capture-tray__label -p1">{activity.label}</span>
            {activity.status === 'error' ? (
              <button
                type="button"
                className="capture-tray__dismiss -meta"
                onClick={() => dismiss(activity.id)}
              >
                Dismiss
              </button>
            ) : (
              <span className="capture-tray__status -meta">
                {activity.status === 'uploading' && activity.kind === 'upload'
                  ? activity.progress < 1
                    ? `${Math.round(activity.progress * 100)}%`
                    : 'Processing'
                  : STATUS[activity.status]}
                {activity.pages
                  ? ` · ${activity.pages} page${activity.pages === 1 ? '' : 's'}`
                  : ''}
              </span>
            )}
          </div>
          {activity.error ? (
            <p className="capture-tray__error -meta">{activity.error}</p>
          ) : activity.message ? (
            <p className="capture-tray__message -meta">{activity.message}</p>
          ) : (
            <div className="capture-tray__bar">
              <div
                className="capture-tray__progress"
                style={{ transform: `scaleX(${activity.progress})` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
