// Settings search finds each module by the words people use for it (MODULE_KW). A module added
// without its words was searchable by "undefined" and by nothing it is actually about.
import { describe, expect, it } from 'vitest'
import { SEARCH } from './settings-pages.js'
import { MODULES } from '../lib/modules.js'

describe('Settings search: every module has its own words', () => {
  it('no module entry falls back to "undefined"', () => {
    const rows = SEARCH.filter(r => r.page === 'modules' && MODULES.some(m => m.title === r.title))
    expect(rows).toHaveLength(MODULES.length)
    for (const r of rows) expect(r.kw, r.title).not.toMatch(/undefined/)
  })

  it('the body picker is found by photo, body map and muscle words', () => {
    const kw = SEARCH.find(r => r.page === 'modules' && r.title === 'Body picker').kw
    for (const w of ['photo', 'body map', 'muscle', 'tap']) expect(kw).toContain(w)
  })
})
