// The setup screen's one promise that is easy to break by accident: nothing AI-shaped loads
// until a mode is chosen. Asserted on the source, the way coach.test.js pins the store field —
// a static import of the core here would pass every behavioural test and still ship the
// catalogue, the prompts and the validator to a phone that never asked for a Coach.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./CoachSetup.jsx', import.meta.url), 'utf8')
const statics = [...src.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])

describe('CoachSetup keeps the core out until a mode is chosen', () => {
  it('imports only the provider table and the category names from the core', () => {
    const core = statics.filter(p => p.includes('api/coach/core'))
    expect(core.sort()).toEqual(['../../../api/coach/core/categories.js', '../../../api/coach/core/providers.js'])
  })
  it('never statically imports the phone pipeline', () => {
    expect(statics.some(p => p.includes('coach-local'))).toBe(false)
    expect(src).toMatch(/import\('\.\.\/lib\/coach-local\.js'\)/)
  })
  it('the categories module carries no catalogue', () => {
    const cat = readFileSync(new URL('../../../api/coach/core/categories.js', import.meta.url), 'utf8')
    expect(cat).not.toMatch(/^import /m)
    expect(cat.length).toBeLessThan(1500)
  })
})
