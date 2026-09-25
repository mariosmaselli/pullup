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

// Built-in rules per platform (prompts/platforms.md, one "## <platform>" section each), plus
// Mario's own notes from Settings. Goes in the user message — it varies per request.
const platformSections = new Map(
  read('./prompts/platforms.md')
    .split(/^## /m)
    .filter(Boolean)
    .map((section) => {
      const [name, ...body] = section.split('\n')
      return [name!.trim(), body.join('\n').trim()] as const
    })
)

export function platformRules(
  platforms: string[],
  styles: Record<string, string | undefined> = {}
) {
  return platforms
    .map((platform) => {
      const rules = platformSections.get(platform)
      if (!rules) throw new Error(`No platform rules for ${platform}`)
      const own = styles[platform]?.trim()
      return [
        `<platform id="${platform}">`,
        rules,
        own && `Mario's own notes for this platform (follow them):\n${own}`,
        '</platform>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}
