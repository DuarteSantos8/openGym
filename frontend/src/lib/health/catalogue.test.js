/* The shared catalogue (api/health/catalogue.js) holds the names of a hundred-odd kinds of
   reading, outside src/, where scripts/check-source-strings.mjs does not look: this is the check
   that every one of them, and every level, activity and tab, is in every language pack. And the
   cap on imported readings leaves every copy of a profile with the same records. */
import { describe, expect, it } from 'vitest'
import { LEVELS, MAX_IMPORTED, TYPES, WORKOUTS, trimImported } from '../../../../api/health/catalogue.js'
import { GROUPS, HEALTH_METRICS } from './metrics.js'
import { normalizeHealthState } from './records.js'
import { mergeHealth } from '../sync-merge.js'

const packs = import.meta.glob('../../locales/*.js', { eager: true })

describe('every name the health area shows is translated', () => {
  const keys = new Set([
    ...Object.values(TYPES).map(x => x.label),
    ...Object.values(HEALTH_METRICS).map(x => x.label),
    ...Object.values(LEVELS).flat().filter(Boolean),
    ...Object.values(WORKOUTS).map(([, label]) => label),
    ...Object.values(GROUPS).map(g => g.label),
  ])
  for (const [file, mod] of Object.entries(packs)) {
    it(file.replace(/.*\//, ''), () => {
      const pack = mod.default
      expect([...keys].filter(k => !(k in pack))).toEqual([])
    })
  }
})

describe('the cap on imported readings', () => {
  const rec = (i, type, src = 'apple-health') => ({ id: `${src}:${type}:${i}`, type, v: 1, u: '', t: i, d: '2026-01-01', src, sid: `${type}:${i}`, c: 1, _ts: 1 })
  it('drops the oldest of the other kinds first, keeps the core ones and never touches what was typed', () => {
    const health = [rec(1, 'spo2'), rec(2, 'steps'), rec(3, 'spo2'), rec(4, 'steps'), rec(0, 'bodyFat', 'manual')]
    const out = trimImported(health, 2)
    expect(out.map(r => r.id).sort()).toEqual(['apple-health:steps:2', 'apple-health:steps:4', 'manual:bodyFat:0'])
    expect(trimImported(health, 10)).toBe(health)
  })
  it('two copies that each trimmed and then merged end on the same records', () => {
    const many = n => Array.from({ length: n }, (_, i) => rec(i, i % 2 ? 'spo2' : 'steps'))
    const a = { health: many(MAX_IMPORTED + 50) }
    const b = { health: many(MAX_IMPORTED + 80) }
    normalizeHealthState(a)
    normalizeHealthState(b)
    expect(a.health.length).toBe(MAX_IMPORTED)
    const ab = mergeHealth(a.health, b.health), ba = mergeHealth(b.health, a.health)
    expect(ab.length).toBe(MAX_IMPORTED)
    expect(ab.map(r => r.id)).toEqual(ba.map(r => r.id))
  })
})
