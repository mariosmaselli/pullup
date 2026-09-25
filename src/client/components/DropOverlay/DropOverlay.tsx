import './DropOverlay.scss'

export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      className="drop-overlay flex items-center justify-center"
      data-visible={visible}
      aria-hidden
    >
      <div className="drop-overlay__frame flex flex-col items-center justify-center">
        <p className="-t1">Drop to capture</p>
        <p className="drop-overlay__hint -meta">Images · videos · links — saved to your Inbox</p>
      </div>
    </div>
  )
}
