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

// catalogue/demos (scripts/catalogue/exercise-demos.mjs): Commons videos and U.S. Army photo sequences.
const demoDir = fileURLToPath(new URL('../../../catalogue/demos/', import.meta.url))
const demos = JSON.parse(fs.readFileSync(demoDir + 'index.json', 'utf8'))
const demoNotice = fs.readFileSync(demoDir + 'NOTICE.md', 'utf8')
const demoEntries = Object.entries(demos)

describe('catalogue/demos (videos and step-by-step photos)', () => {
  it('covers catalogue exercises that exist, each with something to show', () => {
    expect(demoEntries.length).toBeGreaterThan(30)
    for (const [id, ps] of demoEntries) {
      expect(fs.existsSync(catDir + id + '.json'), id).toBe(true)
      expect(picturesFor(demos, id), id).toHaveLength(ps.length)
    }
  })

  it('videos are small muted-ready MP4s with a poster, from Wikimedia Commons under CC BY or CC BY-SA', () => {
    const videos = demoEntries.flatMap(([, ps]) => ps.filter(p => p.kind === 'video'))
    expect(videos.length).toBeGreaterThan(4)
    for (const v of videos) {
      expect(v.f).toMatch(/^files\/video-\d{4,5}\.mp4$/)
      expect(v.poster).toBe(v.f.replace(/\.mp4$/, '.webp'))
      expect(fs.statSync(demoDir + v.f).size).toBeLessThan(3_000_000)
      expect(fs.statSync(demoDir + v.poster).size).toBeLessThan(150_000)
      expect(Math.max(v.w, v.h)).toBeLessThanOrEqual(1280)
      expect(['CC-BY-SA-4.0', 'CC-BY-SA-3.0', 'CC-BY-3.0', 'CC-BY-4.0']).toContain(v.license)
      expect(v.author.length).toBeGreaterThan(1)
      expect(v.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
    }
  })

  it('photo sequences are U.S. Army ATP 7-22.02 figures (public domain), each pointing at its page', () => {
    const photos = demoEntries.flatMap(([, ps]) => ps.filter(p => p.kind !== 'video'))
    expect(photos.length).toBeGreaterThan(30)
    for (const p of photos) {
      expect(p.pose).toBe('sequence')
      expect(p.f).toMatch(/^files\/atp-\d+-\d+\.webp$/)
      expect(fs.statSync(demoDir + p.f).size).toBeLessThan(250_000)
      expect(p.license).toBe('PD-USGov')
      expect(p.caption).toMatch(/^Figure \d+-\d+\. /)
      expect(p.source).toMatch(/^https:\/\/armypubs\.army\.mil\/epubs\/.+\.pdf#page=\d+$/)
    }
  })

  it('has no file the index does not name, and NOTICE.md credits every file', () => {
    const named = new Set(demoEntries.flatMap(([, ps]) => ps.flatMap(p => [p.f, p.poster].filter(Boolean))))
    for (const f of fs.readdirSync(demoDir + 'files')) expect(named.has('files/' + f), f).toBe(true)
    for (const f of named) {
      expect(fs.existsSync(demoDir + f), f).toBe(true)
      expect(demoNotice).toContain(f)
    }
    expect(demoNotice).toMatch(/public domain/i)
    expect(demoNotice).toMatch(/re-encoded as H\.264 MP4/)
  })
})
