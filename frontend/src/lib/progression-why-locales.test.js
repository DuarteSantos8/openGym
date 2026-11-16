// The progression line's reasons (`why: ['Stuck for {0} sessions. …', …]` in progression.js) reach
// t() as a variable, so check-source-strings.mjs, which collects only t('literal'), cannot see
// them: two of them rendered in English in every language until this test. Every such reason
// must be in every locale pack.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = readFileSync(new URL('./progression.js', import.meta.url), 'utf8')
// A reason is the first string of an array literal that also holds a placeholder value: ['…', x]
const reasons = [...new Set([...src.matchAll(/\[\s*'([^'\n]*\{0\}[^'\n]*)'\s*,/g)].map(m => m[1]))]

describe('progression reasons', () => {
  it('are found in progression.js', () => {
    expect(reasons.length).toBeGreaterThan(5)
    expect(reasons).toContain('Stuck for {0} sessions. Deload to {1} {2}.')
  })
  const dir = new URL('../locales/', import.meta.url)
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    it(`are all translated in ${file}`, async () => {
      const pack = (await import(new URL(file, dir).href)).default
      expect(reasons.filter(k => !(k in pack))).toEqual([])
    })
  }
})
