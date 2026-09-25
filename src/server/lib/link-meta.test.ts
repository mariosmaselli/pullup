import { describe, expect, it } from 'vitest'
import { parseLinkMeta } from './link-meta.ts'

describe('parseLinkMeta', () => {
  it('prefers Open Graph tags and resolves relative URLs', () => {
    const html = `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Tallinn in 3D &amp; WebGL">
      <meta content='A map experiment' property='og:description'>
      <meta property="og:image" content="/share.jpg">
      <link rel="shortcut icon" href="/icon.png">
    </head><body><meta property="og:title" content="ignored"></body></html>`
    const meta = parseLinkMeta(html, 'https://www.example.com/work/tallinn')
    expect(meta).toEqual({
      url: 'https://www.example.com/work/tallinn',
      title: 'Tallinn in 3D & WebGL',
      description: 'A map experiment',
      siteName: 'example.com',
      image: 'https://www.example.com/share.jpg',
      icon: 'https://www.example.com/icon.png',
    })
  })

  it('falls back to <title>, meta description and /favicon.ico', () => {
    const meta = parseLinkMeta(
      '<head><title>  Plain\n page </title><meta name="description" content="Desc"></head>',
      'https://site.dev/'
    )
    expect(meta.title).toBe('Plain page')
    expect(meta.description).toBe('Desc')
    expect(meta.image).toBeNull()
    expect(meta.icon).toBe('https://site.dev/favicon.ico')
  })
})
