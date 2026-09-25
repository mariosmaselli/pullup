import { readFileSync } from 'node:fs'

// Prompts are versioned markdown files: ai/tasks/<task>/prompt.vN.md plus the shared voice.md.
// The version is logged with every AI run (ai_runs.prompt_version).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').trim()

const voice = read('./prompts/voice.md')

export function loadPrompt(task: string, version: string) {
  return {
    version: `${task}@${version}`,
    system: `${read(`./tasks/${task}/prompt.${version}.md`)}\n\n${voice}`,
  }
}
