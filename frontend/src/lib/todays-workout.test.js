import { describe, expect, it } from 'vitest'
import { suggestTerms, groupFatigue } from './todays-workout.js'
import { buildSession } from './session-builder.js'
import { exAvailable } from './equipment.js'
import { EXIDX } from './exercises.js'
import { MUSCLE_GROUPS } from './muscle-filter.js'

const NOW = Date.parse('2026-11-06T12:00:00Z')
const base = () => ({ unit: 'kg', workouts: [], routines: [], customEx: [], bodyweight: [] })
// A finished workout `daysAgo` days back doing the first catalogue exercise whose name matches.
const idOf = re => Object.values(EXIDX).find(e => re.test(e.n))?.id
const done = (re, daysAgo) => {
  const t = NOW - daysAgo * 86400000
  return { id: 'w' + daysAgo + re.source, d: new Date(t).toISOString().slice(0, 10), start: t, entries: [{ id: idOf(re), sets: [1, 2, 3].map(() => ({ r: 8, w: 80, done: true })) }] }
}

describe("today's workout", () => {
  it('is a full-body session until something is logged', () => {
    const r = suggestTerms(base(), { now: NOW })
    expect(r.fullBody).toBe(true)
    expect(r.terms).toEqual(['group:chest', 'group:back', 'group:legs'])
  })

  it('leaves out the group you hit yesterday', () => {
    const S = { ...base(), workouts: [done(/^barbell bench press$/i, 1), done(/^barbell bench press$/i, 1)] }
    const r = suggestTerms(S, { now: NOW })
    expect(r.fullBody).toBe(false)
    expect(r.terms).not.toContain('group:chest')
    expect(r.terms.length).toBeGreaterThan(0)
  })

  it('leads with legs alone when they are the most rested', () => {
    const S = { ...base(), workouts: [done(/^barbell bench press$/i, 1), done(/^pull-up$/i, 1)] }
    const r = suggestTerms(S, { now: NOW })
    expect(r.terms).toEqual(['group:legs'])
  })

  it('is the same answer for the same inputs', () => {
    const S = { ...base(), workouts: [done(/^barbell bench press$/i, 2)] }
    expect(suggestTerms(S, { now: NOW })).toEqual(suggestTerms(S, { now: NOW }))
  })

  it('feeds the builder: the session only has what the active gym has', () => {
    const S = { ...base(), equipFilterOn: true, activeEquipId: 'h', equipProfiles: [{ id: 'h', name: 'Work', equipment: ['dumbbell', 'bench'], accV: 3 }], workouts: [done(/^barbell bench press$/i, 1)] }
    const { terms } = suggestTerms(S, { now: NOW })
    const s = buildSession(S, { terms, minutes: 40, now: NOW, today: '2026-11-06' })
    expect(s.profileName).toBe('Work')
    expect(s.picks.length).toBeGreaterThan(0)
    for (const p of s.picks) expect(exAvailable(S, EXIDX[p.id])).toBe(true)
  })

  it('scores a rested group at 0', () => {
    for (const g of MUSCLE_GROUPS) expect(groupFatigue(g, {})).toBe(0)
  })
})
