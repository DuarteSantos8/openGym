import { describe, expect, it } from 'vitest'
import { EXDB, EXIDX } from './exercises.js'
import V13_IDS from './catalogue-v13-ids.json' with { type: 'json' }

// Workouts, routines, records and backups store exercise ids, so an id that ever shipped must
// resolve forever (catalogue/README.md). This is every id of the v1.3 dataset, frozen.
describe('catalogue continuity', () => {
  it('still knows every exercise id openGym shipped before v1.4.0', () => {
    expect(V13_IDS).toHaveLength(1324)
    const gone = V13_IDS.filter(id => !EXIDX[id])
    expect(gone).toEqual([])
  })

  it('never lists one id twice', () => {
    expect(new Set(EXDB.map(e => e.id)).size).toBe(EXDB.length)
  })

  it('links every second drawing both ways, never to an unrelated exercise', () => {
    for (const e of EXDB) {
      // a hidden drawing resolves to this very exercise; a visible one points back with `mv`
      if (e.fv) expect(EXIDX[e.fv]?.id === e.id || EXIDX[e.fv]?.mv === e.id, e.id).toBe(true)
      if (e.mv) expect(EXIDX[e.mv]?.fv, e.id).toBe(e.id)
    }
  })
})
