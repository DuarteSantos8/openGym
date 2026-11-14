import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { planPacks, splitParts, moduleName, packIndex, moduleGradle, write, clean, PART_MAX_BYTES } from '../../../scripts/android/make-asset-packs.mjs'
import { buildPacks } from '../../../scripts/media/make-pack-manifests.mjs'
import { EXDB } from './exercises-data.js'
import { packDrawingId } from './anim-quality.js'

/* The Google Play asset packs scripts/android/make-asset-packs.mjs puts into the Android project
   on the release machine: the same drawings per pack as the iPhone's, Play-valid names, split under
   Play's 1.5 GB per-pack limit. File sizes are made up here: nothing reads a media file. */
const sizeOf = () => 100_000
const srcFor = px => `/media/${px}`

describe('Play asset packs', () => {
  it('hold exactly the drawings of the iPhone packs, at <packId>/<drawing>.webp', () => {
    const plan = planPacks({ qualities: [480], srcFor, sizeOf })
    const ios = Object.fromEntries(buildPacks(EXDB, { qualities: [480] }).packs.map(p => [p.id, p.ids]))
    expect(plan.map(p => p.id).sort()).toEqual(['anim-480-female', 'anim-480-male'])
    for (const p of plan) {
      const ids = p.parts.flatMap(x => x.files.map(f => f.id))
      expect(ids).toEqual(ios[p.id])
      expect(p.parts[0].files[0].src).toBe(`/media/480/${ids[0]}.webp`)
    }
  })

  it('have Play-valid names: anim-480-male is the module anim_480_male', () => {
    expect(moduleName('anim-480-male')).toBe('anim_480_male')
    expect(moduleName('anim-1080-female', 2)).toBe('anim_1080_female_p2')
    expect(moduleGradle('anim_480_male')).toMatch(/packName = "anim_480_male"[\s\S]*deliveryType = "on-demand"/)
  })

  it('split a pack over the limit into parts, each under it, nothing lost', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ id: String(i), bytes: 400 }))
    const parts = splitParts(files, 1000)
    expect(parts.map(p => p.length)).toEqual([2, 2, 2, 2, 2])
    expect(parts.flat()).toEqual(files)
    const plan = planPacks({ qualities: [1080], srcFor, sizeOf: () => 400 * 1024, max: 1024 * 1024 * 1024 })
    const male = plan.find(p => p.id === 'anim-1080-male')
    expect(male.parts.length).toBeGreaterThan(1)
    expect(male.parts.map(x => x.module)).toEqual(male.parts.map((_, i) => `anim_1080_male_p${i + 1}`))
    for (const part of male.parts) expect(part.files.reduce((n, f) => n + f.bytes, 0)).toBeLessThanOrEqual(1024 * 1024 * 1024)
    expect(PART_MAX_BYTES).toBeLessThan(1.5 * 1024 * 1024 * 1024)
  })

  it('refuse a pack with a drawing missing', () => {
    expect(() => planPacks({ qualities: [480], srcFor, sizeOf: f => (f.endsWith('/0001.webp') ? null : 1) })).toThrow(/missing 480 px drawing 0001/)
  })

  it('a test set keeps the drawing the app probes a pack by', () => {
    const plan = planPacks({ qualities: [240], srcFor, sizeOf, limit: 2 })
    for (const p of plan) {
      const probe = packDrawingId(EXDB.find(e => e.id === '0001'), p.figure)
      expect(p.parts[0].files.map(f => f.id)).toContain(probe)
    }
  })

  it('tell the app which Play packs make up each of its packs', () => {
    const plan = planPacks({ qualities: [480], srcFor, sizeOf })
    expect(packIndex(plan)['anim-480-male']).toMatchObject({ parts: ['anim_480_male'], files: plan[0].parts[0].files.length })
  })

  it('go into the project and out again, with nothing else touched', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'))
    const src = path.join(dir, 'src')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'a.webp'), 'x')
    fs.writeFileSync(path.join(dir, 'settings.gradle'), 'keep')
    const plan = [{ id: 'anim-480-male', bytes: 1, parts: [{ module: 'anim_480_male', files: [{ id: 'a', src: path.join(src, 'a.webp'), bytes: 1 }] }] }]
    write(plan, dir)
    expect(fs.existsSync(path.join(dir, 'anim_480_male/src/main/assets/anim-480-male/a.webp'))).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'asset-packs.settings.gradle'), 'utf8')).toMatch(/include ':anim_480_male'/)
    expect(fs.readFileSync(path.join(dir, 'asset-packs.app.gradle'), 'utf8')).toMatch(/assetPacks = \[":anim_480_male"\]/)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'app/src/play/assets/anim-packs.json'), 'utf8'))['anim-480-male'].parts).toEqual(['anim_480_male'])
    clean(dir)
    expect(fs.readdirSync(dir).sort()).toEqual(['app', 'settings.gradle', 'src'])
    expect(fs.existsSync(path.join(dir, 'app/src/play/assets/anim-packs.json'))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
