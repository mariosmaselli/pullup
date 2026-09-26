import './DropOverlay.scss'

interface Props {
  visible: boolean
  // Dropping on a project page adds to that project.
  projectName?: string | null
}

export function DropOverlay({ visible, projectName }: Props) {
  return (
    <div
      className="drop-overlay flex items-center justify-center"
      data-visible={visible}
      aria-hidden
    >
      <div className="drop-overlay__frame flex flex-col items-center justify-center">
        <p className="-t1">Drop to capture</p>
        <p className="drop-overlay__hint -meta">
          Images · videos · PDFs · links — saved to your Inbox
          {projectName ? ` and added to “${projectName}”` : ''}
        </p>
      </div>
    </div>
  )
}
