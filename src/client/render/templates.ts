import type { TemplateFactory, TemplateMeta } from '@shared/template.ts'

// Templates live in pullup/templates/<id>/ (see src/shared/template.ts for the contract).
// meta.ts is loaded eagerly (cheap, lists templates in the UI); index.ts only inside the render
// worker, so three/gsap never load on the main thread.

const metaModules = import.meta.glob<TemplateMeta>('/templates/*/meta.ts', {
  eager: true,
  import: 'meta',
})

export const templateMetas: TemplateMeta[] = Object.values(metaModules).sort((a, b) =>
  a.name.localeCompare(b.name)
)

export const templateMeta = (id: string) => templateMetas.find((m) => m.id === id)

const factories = import.meta.glob<TemplateFactory>('/templates/*/index.ts', { import: 'default' })

export async function loadTemplate(id: string): Promise<TemplateFactory> {
  const load = factories[`/templates/${id}/index.ts`]
  if (!load) throw new Error(`Unknown template: ${id}`)
  return load()
}
