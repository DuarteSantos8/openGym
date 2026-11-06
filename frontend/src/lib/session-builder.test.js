import { describe, expect, it } from 'vitest'
import { buildSession, swapPick, sessionRoutine, targetMuscles, estimateMinutes, capOf } from './session-builder.js'
import { EXIDX } from './exercises.js'
import { musclesOf } from './muscles.js'
import { exAvailable } from './equipment.js'

const base = () => ({ unit: 'kg', workouts: [], routines: [], customEx: [], bodyweight: [] })
const NOW = Date.parse('2026-11-06T12:00:00Z')
const opts = o => ({ now: NOW, today: '2026-11-06', ...o })

describe('session builder', () => {
  it('is the same session for the same inputs, and every pick trains a picked muscle', () => {
    const a = buildSession(base(), opts({ terms: ['chest'], minutes: 40 }))
    const b = buildSession(base(), opts({ terms: ['chest'], minutes: 40 }))
    expect(a.picks.map(p => p.id)).toEqual(b.picks.map(p => p.id))
    expect(a.picks.length).toBeGreaterThanOrEqual(3)
    for (const p of a.picks) expect(musclesOf(EXIDX[p.id]).chest).toBeGreaterThanOrEqual(1)
  })

  it('fills about the minutes asked for', () => {
    for (const minutes of [20, 40, 60]) {
      const s = buildSession(base(), opts({ terms: ['group:legs'], minutes }))
      expect(Math.abs(s.minutes - minutes), String(minutes)).toBeLessThanOrEqual(8)
      expect(s.minutes).toBe(estimateMinutes(s.picks.map(p => p.cfg)))
    }
  })

  it('keeps to the active gym: a hotel room gets only what it can do, no bench and no bars', () => {
    const S = { ...base(), equipFilterOn: true, activeEquipId: 'h', equipProfiles: [{ id: 'h', name: 'Hotel', equipment: [], accV: 3 }] }
    const s = buildSession(S, opts({ terms: ['chest', 'abs'], minutes: 40 }))
    expect(s.profileName).toBe('Hotel')
    expect(s.picks.length).toBeGreaterThan(0)
    for (const p of s.picks) {
      expect(exAvailable(S, EXIDX[p.id])).toBe(true)
      expect(EXIDX[p.id].n).not.toMatch(/\bdips?\b/)
    }
  })

  it('a flat bench gets no incline work', () => {
    const S = { ...base(), equipFilterOn: true, activeEquipId: 'g', equipProfiles: [{ id: 'g', name: 'Home', equipment: ['dumbbell', 'bench'], accV: 3 }] }
    const s = buildSession(S, opts({ terms: ['chest'], minutes: 60 }))
    for (const p of s.picks) expect(EXIDX[p.id].n).not.toMatch(/incline|decline/)
  })

  it('leaves out a muscle still recovering, and says so', () => {
    const S = { ...base(), workouts: [{ d: '2026-11-05', start: NOW - 86400000, entries: [{ id: '0025', sets: Array(10).fill({ w: 100, r: 8, done: true }) }] }] }
    const s = buildSession(S, opts({ terms: ['chest', 'biceps'] }))
    expect(s.tired).toContain('chest')
    for (const p of s.picks) expect(musclesOf(EXIDX[p.id]).chest || 0).toBeLessThan(1)
  })

  it('puts what you logged and your favourites first, with the reason', () => {
    const S = { ...base(), favEx: ['0047'], workouts: Array.from({ length: 4 }, (_, i) => ({ d: `2026-10-0${i + 1}`, entries: [{ id: '0289', sets: [{ w: 30, r: 8, done: true }] }] })) }
    const s = buildSession(S, opts({ terms: ['chest'] }))
    const ids = s.picks.map(p => p.id)
    expect(ids).toContain('0047')
    expect(ids).toContain('0289')
    expect(s.picks.find(p => p.id === '0289').why).toContainEqual(['You did it {0} times', 4])
    expect(s.picks.find(p => p.id === '0047').why).toContainEqual(['One of your favourites'])
  })

  it('a group leaves its minor muscles to be tapped by name', () => {
    expect(targetMuscles(['group:legs']).muscles).not.toContain('hip-flexors')
    expect(targetMuscles(['hip-flexors']).muscles).toEqual(['hip-flexors'])
    expect(capOf('chest', false)).toBe(3)
    expect(capOf('biceps', false)).toBe(2)
  })

  it('swaps one pick for another that trains the same muscle, keeping its sets, and saves as a routine', () => {
    const s = buildSession(base(), opts({ terms: ['lats', 'biceps'], minutes: 40 }))
    const out = swapPick(base(), s, 0, opts({ seed: 5 }))
    expect(out.picks[0].id).not.toBe(s.picks[0].id)
    expect(out.picks.slice(1).map(p => p.id)).toEqual(s.picks.slice(1).map(p => p.id))
    expect(out.picks[0].cfg.sets).toBe(s.picks[0].cfg.sets)
    expect(out.picks[0].muscles.some(m => s.picks[0].muscles.includes(m))).toBe(true)
    const r = sessionRoutine(out, { id: 'r1', name: 'Lats + Biceps' })
    expect(r.ex.map(e => e.id)).toEqual(out.picks.map(p => p.id))
    expect(r.ex[0]).toMatchObject({ sets: expect.any(Number), mode: 'reps' })
  })

  it('a different seed can shuffle the picks', () => {
    const seen = new Set()
    for (let seed = 1; seed <= 6; seed++) seen.add(buildSession(base(), opts({ terms: ['group:shoulders'], seed })).picks.map(p => p.id).join())
    expect(seen.size).toBeGreaterThan(1)
  })

  it('nothing picked, nothing built', () => {
    expect(buildSession(base(), opts({ terms: [] })).picks).toEqual([])
  })
})
