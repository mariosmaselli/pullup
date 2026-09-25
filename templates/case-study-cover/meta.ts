import type { TemplateMeta } from '@shared/template.ts'

export const meta: TemplateMeta = {
  id: 'case-study-cover',
  name: 'Case study cover',
  description:
    'Typographic cover for a finished project: large name, one-line description and meta rows on a 12-column grid. Optional image as a framed block or full bleed.',
  version: 1,
  kind: 'still',
  aspects: ['4:5', '9:16', '1:1'],
  media: { min: 0, max: 1, kinds: ['image'], label: 'Cover image (optional)' },
  text: {
    title: { label: 'Project name', multiline: true, max: 40, default: 'Echo Labs' },
    description: {
      label: 'Description',
      max: 90,
      optional: true,
      default: 'A real-time WebGL identity for an AI research lab.',
    },
    client: { label: 'Client', max: 40, optional: true, default: '' },
    year: { label: 'Year', max: 16, optional: true, default: '2026' },
    services: {
      label: 'Services',
      max: 60,
      optional: true,
      default: 'Art direction, WebGL, Development',
    },
    role: { label: 'Role', max: 48, optional: true, default: 'Design & engineering' },
    studio: { label: 'Studio mark', max: 24, optional: true, default: 'Nonlinear' },
    label: { label: 'Label', max: 24, optional: true, default: 'Case study' },
    index: { label: 'Number', max: 10, optional: true, default: '(01)' },
  },
  params: {
    layout: {
      type: 'select',
      label: 'Layout',
      options: ['Type only', 'Image block', 'Full bleed'],
      default: 'Image block',
    },
    theme: { type: 'select', label: 'Theme', options: ['Dark', 'Light'], default: 'Dark' },
    accent: { type: 'color', label: 'Accent', default: '#ff4f1f' },
    weight: {
      type: 'select',
      label: 'Title weight',
      options: ['Regular', 'Medium', 'SemiBold'],
      default: 'Medium',
    },
    size: { type: 'number', label: 'Title size', min: 96, max: 320, step: 4, default: 216 },
    dim: {
      type: 'number',
      label: 'Darken image (full bleed)',
      min: 0,
      max: 0.8,
      step: 0.05,
      default: 0.15,
    },
  },
  fonts: [
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Regular.ttf', weight: '400' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-Medium.otf', weight: '500' },
    { family: 'PP Neue Montreal', file: 'PPNeueMontreal-SemiBold.otf', weight: '600' },
  ],
}
