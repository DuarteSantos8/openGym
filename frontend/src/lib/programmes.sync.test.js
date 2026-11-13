// Programmes in the sync (#159): merged one programme at a time, the running one as a setting,
// and kept by an older app that has never heard of them.
import { describe, it, expect } from 'vitest'
import { mergeStates, stampEdits, resetIdsOf, sinceReset } from './sync-merge.js'
import { stampPut } from '../../../api/sync-stamps.js'
import { legacyProgramme, migratedFixture } from './test-fixtures.js'
import { buildSessionExposures } from './session-start.js'
import { programmeView, setRunEnd, skipSlot, startProgramme } from './programmes.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T = 1_800_000_000_000
const P = (id, name) => ({ id, name, at: 1, weeks: [{ rpe: 8 }], days: { 1: ['r'] } })
const base = () => ({ _ts: T, unit: 'kg', workouts: [], routines: [{ id: 'r', name: 'R', ex: [] }], week: {}, programmes: { a: P('a', 'A'), b: P('b', 'B') }, programme: null })
const edit = (prev, at, mut) => { const n = clone(prev); mut(n); n._ts = at; return stampEdits(prev, n, at) }

describe('programmes merge one at a time', () => {
  it('two devices editing two programmes keep both edits', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { s.programmes.a = { ...s.programmes.a, name: 'A phone' } })
    const desk = edit(s0, T + 20, s => { s.programmes.b = { ...s.programmes.b, name: 'B desk' } })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.programmes.a.name).toBe('A phone')
      expect(m.programmes.b.name).toBe('B desk')
    }
  })

  it('a removal wins over the older copy that still has it, and a new one on the other side stays', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { delete s.programmes.a })
    const desk = edit(s0, T + 5, s => { s.programmes.c = P('c', 'C') })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(Object.keys(m.programmes).sort()).toEqual(['b', 'c'])
    }
  })

  it('the running programme is one setting: the later start wins whole', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { s.programme = { id: 'a', startedOn: '2026-10-19', cycle: 1, bump: 0, saved: { week: {} } } })
    const desk = edit(s0, T + 20, s => { s.programme = { id: 'b', startedOn: '2026-10-20', cycle: 1, bump: 0, saved: { week: {} } } })
    expect(mergeStates(phone, desk).programme.id).toBe('b')
    expect(mergeStates(desk, phone).programme.id).toBe('b')
  })

  it('a reset wipes them like the other per-key maps', () => {
    const s = base()
    const ids = resetIdsOf(s)
    expect(ids.programmes.sort()).toEqual(['a', 'b'])
    expect(sinceReset(s, T + 1, ids).programmes).toEqual({})
  })
})

describe('an older app that does not know them', () => {
  it('keeps them through the server when it sends a document without them', () => {
    const cur = stampEdits(null, base(), T)
    const old = clone(cur)
    delete old.programmes
    delete old.programme
    const out = stampPut(clone(cur), old, { overRead: true, stamped: false, now: T + 100 })
    expect(out.programmes).toEqual(cur.programmes)
  })
})

describe('a programme run in the sync (engine contract 1)', () => {
  const BENCH = '0025'
  const ADVANCE = { onFailure: 'advance', onSkipped: 'advance' }
  // A running block over routine A (Monday) and B (Thursday), started Monday 2026-10-19.
  function running() {
    const s = migratedFixture({ unit: 'kg', weekStart: 1, routines: [{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60 }] }, { id: 'B', name: 'B', ex: [{ id: '0043', sets: 3, reps: 5, weight: 80 }] }], workouts: [] })
    Object.assign(s, { _ts: T, week: {}, programmes: {}, programme: null })
    const def = legacyProgramme(s, { id: 'P', name: 'Block', at: 1, weeks: [{ rpe: 7 }, { rpe: 8 }], days: { 1: ['A'], 4: ['B'] } })
    s.programmes = { P: def }
    startProgramme(s, 'P', { policies: Object.fromEntries(def.tracks.map(t => [t.id, ADVANCE])), end: 'stop', today: '2026-10-19', now: T })
    return stampEdits(null, s, T)
  }

  it('two devices: events from both merge per key and replay to the same view', () => {
    const s0 = running()
    const runId = s0.programme.runId
    // The phone logs Monday's A; the desk, offline, skips Thursday's B and sets the end policy.
    const phone = edit(s0, T + 10, s => {
      const exposures = buildSessionExposures(s, s.routines[0], { now: Date.parse('2026-10-19T17:00:00Z'), newId: x => 'ph:' + x })
      s.workouts.push({ id: 'mon', d: '2026-10-19', start: Date.parse('2026-10-19T17:00:00Z'), status: 'completed', exposures: exposures.map(x => ({ ...x, completedAt: '2026-10-19T18:00:00.000Z', actual: { sets: 3, reps: 5 }, performance: { sets: [] } })) })
    })
    const desk = edit(s0, T + 20, s => { skipSlot(s, 'p1:a1:B:o0', Date.parse('2026-10-22T18:00:00Z')); setRunEnd(s, 'extend', Date.parse('2026-10-22T18:00:00Z')) })
    const ab = mergeStates(phone, desk), ba = mergeStates(desk, phone)
    expect(Object.keys(ab.programmeEvents).sort()).toEqual(Object.keys(ba.programmeEvents).sort())
    expect(Object.values(ab.programmeEvents).map(e => e.type).sort()).toEqual(['end-policy', 'skip'])
    expect(ab.programmeRuns).toEqual(ba.programmeRuns)
    const view = S => programmeView(S, '2026-10-26')
    expect(view(ab).tracks).toEqual(view(ba).tracks)
    expect(view(ab).tracks['t:P:A:o0'].decisions[0]).toMatchObject({ period: 1, action: 'advance' })
    expect(view(ab).tracks['t:P:B:o0'].decisions[0]).toMatchObject({ period: 1, action: 'advance', reasons: { skipped: ['p1:a1:B:o0'] } })
    expect(ab.programme.runId).toBe(runId)
  })

  it('a reset wipes runs, events and reviews like the other per-key maps', () => {
    const s = running()
    s.refReviews = { 'occ:x': { candidateId: 'c', decision: 'keep', at: 1 } }
    skipSlot(s, 'p1:a1:B:o0', T)
    const ids = resetIdsOf(s)
    expect(ids.programmeRuns).toEqual([s.programme.runId])
    const after = sinceReset(s, T + 1, ids)
    expect([after.programmeRuns, after.programmeEvents, after.refReviews]).toEqual([{}, {}, {}])
  })
})
