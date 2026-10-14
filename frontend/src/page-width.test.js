// Page width belongs to the shell. #app (and the connection row above it) is the only thing that
// sets a page's width, from --page-w; no page caps or widens itself, so every page is the same
// width as every other at every window size. These read the sources, since happy-dom does not
// apply the cascade.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const src = resolve(process.cwd(), 'src')
const css = readFileSync(join(src, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const sourcesIn = dir => readdirSync(join(src, dir))
  .filter(f => /\.jsx?$/.test(f) && !/\.test\./.test(f))
  .map(f => ({ file: `${dir}/${f}`, text: readFileSync(join(src, dir, f), 'utf8') }))
const components = [...sourcesIn('views'), ...sourcesIn('components')]

describe('page width belongs to the shell', () => {
  it('has no .narrow class in the CSS or in any view or component', () => {
    expect(css).not.toMatch(/\.narrow\b/)
    const users = components.filter(c => /\bnarrow\b/.test(c.text.replace(/\/\/.*$/gm, ''))).map(c => c.file)
    expect(users).toEqual([])
  })

  it('reads --page-w for max-width only in the #app and .conn-row shell rules', () => {
    const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), decls: m[2] }))
    const readers = rules.filter(r => /max-width:\s*var\(--page-w\)/.test(r.decls)).map(r => r.selector)
    expect(readers.sort()).toEqual(['#app', '.conn-row'])
  })

  it('defines --page-w on :root only, and widens it from 1000px up', () => {
    const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), decls: m[2] }))
    expect(rules.filter(r => /--page-w:/.test(r.decls)).map(r => r.selector)).toEqual([':root', ':root'])
  })

  it('keeps lists one column on every page', () => {
    expect(css).not.toMatch(/#app\s+\.list\s*\{[^}]*display:\s*grid/)
  })

  it('sets no inline maxWidth on a view, other than filling its parent', () => {
    const offenders = components
      .filter(c => /maxWidth:\s*(?!['"]100%['"])\S/.test(c.text))
      .map(c => c.file)
    expect(offenders).toEqual([])
  })
})
