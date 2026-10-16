// @vitest-environment node
/* The app has one loading animation, the G (components/Loader.jsx). A page that says "Loading…" in a
 * line of its own does it with <Loading>, not with a bare word in a div: this finds the bare ones.
 * The string itself is fine where it is not a line (a button's label, a row's subtitle, a tile's
 * value, an aria-label). */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)))
const SKIP = new Set(['locales', 'instr', 'exercise-desc', 'exercise-names', 'node_modules'])
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (!SKIP.has(name)) walk(p, out) } else if (/\.jsx$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

// A line of its own: the words alone in an element, whatever the element is.
// (A `/>` before it is a loader or an icon with the words beside it, which is what we want.)
const BARE = /(?<!\/)>\s*\{t\('Loading…'\)\}\s*<\//g

describe('loading lines', () => {
  it('no page draws "Loading…" as a bare word in an element', () => {
    const bare = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(BARE)) bare.push(`${relative(SRC, file)}:${text.slice(0, m.index).split('\n').length}`)
    }
    expect(bare, 'use <Loading> from components/Loader.jsx').toEqual([])
  })

  it('the pattern does catch the old shapes', () => {
    for (const old of [
      `<div className="muted small fp-note" role="status">{t('Loading…')}</div>`,
      `<EmptyState><div role="status">{t('Loading…')}</div></EmptyState>`,
      `<EmptyState className="small">{t('Loading…')}</EmptyState>`,
    ]) expect(old.match(BARE), old).not.toBeNull()
    // and leaves a label or a value alone
    expect(`{busy ? <><Loader size="xs" />{t('Loading…')}</> : x}`.match(BARE)).toBeNull()
    expect(`{ value: t('Loading…'), note: null }`.match(BARE)).toBeNull()
  })
})
