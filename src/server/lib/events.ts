import { EventEmitter } from 'node:events'

// In-process change notifications, streamed to the UI over /api/events.
export type ChangeTopic = 'assets' | 'projects'

export const changes = new EventEmitter<{ change: [ChangeTopic] }>()
changes.setMaxListeners(50)

export const notify = (topic: ChangeTopic) => changes.emit('change', topic)
