import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { picturesFor } from './exercise-pictures.js'

// The shipped catalogue/photos/ (scripts/catalogue/everkinetic-pictures.mjs) checked against the
// catalogue and the files on disk, so a regenerated or hand-edited index cannot point at nothing.
const dir = fileURLToPath(new URL('../../../catalogue/photos/', import.meta.url))
const index = JSON.parse(fs.readFileSync(dir + 'index.json', 'utf8'))
const catDir = fileURLToPath(new URL('../../../catalogue/exercises/', import.meta.url))
const notice = fs.readFileSync(dir + 'NOTICE.md', 'utf8')
const entries = Object.entries(index)

describe('catalogue/photos (Everkinetic drawings)', () => {
  it('has pictures, each for a catalogue exercise that exists', () => {
    expect(entries.length).toBeGreaterThan(80)
    for (const [id] of entries) expect(fs.existsSync(catDir + id + '.json'), id).toBe(true)
  })

  it('every exercise has a start and an end drawing: small WebP files, CC BY-SA 4.0, credited', () => {
    for (const [id, ps] of entries) {
      expect(picturesFor(index, id)).toHaveLength(2)
      expect(ps.map(p => p.pose)).toEqual(['start', 'end'])
      for (const p of ps) {
        expect(p.f).toMatch(/^files\/\d{4}-(relaxation|tension)\.webp$/)
        expect(fs.statSync(dir + p.f).size).toBeLessThan(150_000)
        expect(p.license).toBe('CC-BY-SA-4.0')
        expect(p.author).toBe('Greg Priday (Everkinetic)')
        expect(p.source).toMatch(/^https:\/\/github\.com\/everkinetic\/data\/blob\/main\/dist\/png\/\d{4}-(relaxation|tension)\.png$/)
      }
    }
  })

  it('has no file the index does not name', () => {
    const named = new Set(entries.flatMap(([, ps]) => ps.map(p => p.f)))
    for (const f of fs.readdirSync(dir + 'files')) expect(named.has('files/' + f), f).toBe(true)
  })

  it('NOTICE.md credits every file and states the licence and the change made', () => {
    for (const [, ps] of entries) for (const p of ps) expect(notice).toContain(p.f)
    expect(notice).toMatch(/CC BY-SA 4\.0/)
    expect(notice).toMatch(/resized to fit 480×480 px and re-encoded as WebP/)
  })
})
