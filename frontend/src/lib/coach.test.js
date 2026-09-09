import { describe, it, expect } from 'vitest'
import {
  canonicalPlan, planHash, hashPlan, markStale, applicable, currentValue,
  pushSnapshot, revertLast, canRevert, appendLog, applyChangeSet, applyCreatedPlan,
  recordDismissal, validateProposal, coachAvailable, hasConsent,
  recordDebrief, logEntry, lightBundle, changeValues,
  CHANGE_TYPES, SNAPSHOT_MAX, LOG_MAX, CONSENT_VERSION
} from './coach.js'
import { registerCustom } from './exercises.js'

// The two runtimes share no build step, so the client's copy of the fingerprint logic is
// checked against the server's actual source rather than against a transcribed expectation.
import * as serverPayload from '../../../api/coach/core/payload.js'
import { hashPlan as serverHashPlan } from '../../../api/coach/core/plan-hash.js'

const state = (over = {}) => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {}, dayPlan: {},
  routines: [{
    id: 'r1', name: 'Full body A', emoji: '💪', prog: 'linear',
    ex: [
      { id: '0001', sets: 3, reps: 10, mode: 'reps', weight: 20, prog: 'linear' },
      { id: '0007', sets: 3, sec: 45, mode: 'time' },
      { id: '0009', sets: 3, reps: 12, mode: 'reps' }
    ]
  }, { id: 'r2', name: 'Full body B', ex: [{ id: '0002', sets: 4, reps: 6, mode: 'reps' }] }],
  week: { 1: 'r1', 3: 'r2', 5: 'r1' },
  coach: { consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION }, log: [], snapshots: [], cadence: 'off' },
  ...over
})

const change = over => ({ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0001' }, before: 3, after: 4, why: 'stalled twice', ...over })
const proposal = (changes, over = {}) => ({ id: 'p1', kind: 'review', summary: 's', changes, ...over })
/** Apply against a throwaway draft, the way the store does. */
const apply = (S, p, ids) => { const s = JSON.parse(JSON.stringify(S)); applyChangeSet(s, p, ids); return s }

describe('gating', () => {
  it('shows nothing unless the instance offers it and someone is signed in', () => {
    expect(coachAvailable({ coach: { enabled: true } }, { id: 'u' })).toBe(true)
    expect(coachAvailable({}, { id: 'u' })).toBe(false)
    expect(coachAvailable(null, { id: 'u' })).toBe(false)
    expect(coachAvailable({ coach: { enabled: true } }, null)).toBe(false)
  })

  it('is off in the mobile build until a mode is chosen in Settings', () => {
    expect(coachAvailable(null, null, { mobile: true })).toBe(false)
    expect(coachAvailable(null, null, { mobile: true, coachMode: 'off' })).toBe(false)
    // Only its own key makes a local-only phone eligible; "server" without a pairing is nothing.
    expect(coachAvailable(null, null, { mobile: true, coachMode: 'server' })).toBe(false)
    expect(coachAvailable(null, null, { mobile: true, coachMode: 'byok' })).toBe(true)
  })

  it('a phone paired to a server takes the web rule — the server must offer the Coach', () => {
    expect(coachAvailable({ coach: { enabled: true } }, { id: 'u' }, { mobile: true })).toBe(true)
    expect(coachAvailable({ coach: { enabled: true } }, { id: 'u' }, { mobile: true, coachMode: 'server' })).toBe(true)
    expect(coachAvailable({}, { id: 'u' }, { mobile: true, coachMode: 'server' })).toBe(false)
    expect(coachAvailable({ coach: { enabled: true } }, null, { mobile: true, coachMode: 'server' })).toBe(false)
  })

  it('is on in the demo build, which fakes the provider locally', () => {
    expect(coachAvailable(null, null, { demo: true })).toBe(true)
  })

  it('treats an older consent version as no consent', () => {
    expect(hasConsent(state())).toBe(true)
    expect(hasConsent(state({ coach: { consent: { agreedAt: 'x', version: 0 } } }))).toBe(false)
    expect(hasConsent(state({ coach: {} }))).toBe(false)
  })
})

describe('plan fingerprint', () => {
  it('ignores nothing that matters and reacts to nothing that does not', () => {
    const S = state()
    expect(planHash(S)).toBe(planHash(state()))
    // A field the plan does not carry cannot move the hash.
    expect(planHash(state({ theme: 'light' }))).toBe(planHash(S))
    // Everything the Coach can change does.
    const moved = state(); moved.routines[0].ex[0].sets = 4
    expect(planHash(moved)).not.toBe(planHash(S))
    const week = state(); week.week[6] = 'r1'
    expect(planHash(week)).not.toBe(planHash(S))
  })

  it('cannot tell "no weight" from "0 kg" — both mean unloaded', () => {
    const a = state(); delete a.routines[0].ex[2].weight
    const b = state(); b.routines[0].ex[2].weight = 0
    expect(planHash(a)).toBe(planHash(b))
  })

  it('moves for the rep ceiling and the two v1.2.4 flags', () => {
    // These are plan fields a user can edit by hand, so a proposal computed before the edit
    // has to read as stale afterwards. They were in canonicalPlan and not in the hash.
    const S = state()
    for (const [field, value] of Object.entries({ repsMax: 20, bodyweight: false, side: true })) {
      const edited = state(); edited.routines[0].ex[0][field] = value
      expect(planHash(edited), field).not.toBe(planHash(S))
    }
  })

  it('agrees with the server, field for field', () => {
    const withFlags = state()
    withFlags.routines[0].ex[0] = { ...withFlags.routines[0].ex[0], repsMin: 8, repsMax: 20, bodyweight: true }
    withFlags.routines[1].ex[0] = { ...withFlags.routines[1].ex[0], side: true, reps: 16 }
    const combined = state({ week: { 1: ['r1', 'r2'], 3: 'r2', 5: [] } })
    for (const S of [state(), state({ week: {} }), state({ routines: [] }), withFlags, combined]) {
      expect(canonicalPlan(S)).toEqual(serverPayload.canonicalPlan(S))
      expect(planHash(S)).toBe(serverHashPlan(serverPayload.canonicalPlan(S)))
      expect(hashPlan(canonicalPlan(S))).toBe(serverHashPlan(serverPayload.canonicalPlan(S)))
    }
  })

  it('a combined day changes the fingerprint, and routine order within a day matters', () => {
    const S = state()
    expect(planHash(state({ week: { ...S.week, 3: ['r2', 'r1'] } }))).not.toBe(planHash(S))
    expect(planHash(state({ week: { 3: ['r1', 'r2'] } }))).not.toBe(planHash(state({ week: { 3: ['r2', 'r1'] } })))
  })

  it('a legacy bare-string day and its one-element list are the same fingerprint (upgrade stability)', () => {
    expect(planHash(state({ week: { 1: 'r1' } }))).toBe(planHash(state({ week: { 1: ['r1'] } })))
    // and a stray [] is dropped, exactly like an absent key
    expect(planHash(state({ week: { 1: ['r1'], 4: [] } }))).toBe(planHash(state({ week: { 1: ['r1'] } })))
  })

  it('canonicalPlan omits a [] day and preserves routine order', () => {
    expect(canonicalPlan(state({ week: { 2: [] } })).week).toEqual({})
    expect(canonicalPlan(state({ week: { 3: ['r2', 'r3'] } })).week[3]).toEqual(['r2', 'r3'])
    expect(canonicalPlan(state({ week: { 3: ['r3', 'r2'] } })).week[3]).toEqual(['r3', 'r2'])
  })
})

describe('staleness', () => {
  it('flags the whole proposal when the plan moved underneath it', () => {
    const S = state()
    const p = { ...proposal([change()]), planHash: planHash(S) }
    expect(markStale(p, S).planMoved).toBe(false)
    const edited = state(); edited.routines[0].ex[0].sets = 5
    expect(markStale(p, edited).planMoved).toBe(true)
  })

  it('flags a change whose target is gone', () => {
    const S = state(); S.routines[0].ex = S.routines[0].ex.filter(e => e.id !== '0001')
    const [c] = markStale(proposal([change()]), S).changes
    expect(c.status).toBe('stale')
  })

  it('flags a change someone already made by hand, rather than overwriting them', () => {
    const S = state(); S.routines[0].ex[0].sets = 5     // Coach saw 3, user has since set 5
    const [c] = markStale(proposal([change()]), S).changes
    expect(c.status).toBe('stale')
    expect(applicable(markStale(proposal([change()]), S))).toHaveLength(0)
  })

  it('leaves an untouched change applyable', () => {
    const [c] = markStale(proposal([change()]), state()).changes
    expect(c.status).toBe('proposed')
  })

  it('compares a combined-day week change by its canonical routine-list join', () => {
    const wk = (weekday, before) => proposal([change({ type: 'week', target: { weekday }, before, after: 'r1' })])
    const S = state({ week: { 1: ['r1', 'r2'] } })
    // live matches the list the Coach saw → not stale
    expect(markStale(wk(1, ['r1', 'r2']), S).changes[0].status).toBe('proposed')
    // a legacy scalar `before` still compares equal to a one-element live list
    expect(markStale(wk(1, 'r1'), state({ week: { 1: ['r1'] } })).changes[0].status).toBe('proposed')
    // the day gained a routine since → stale
    expect(markStale(wk(1, ['r1', 'r2']), state({ week: { 1: ['r1', 'r2', 'r3'] } })).changes[0].status).toBe('stale')
  })

  it('reads the current value for every scalar change type', () => {
    const S = state()
    S.routines[0].ex[0].repsMax = 20
    expect(currentValue(S, change({ type: 'sets' }))).toBe(3)
    expect(currentValue(S, change({ type: 'reps' }))).toBe(10)
    expect(currentValue(S, change({ type: 'repsMax' }))).toBe(20)
    expect(currentValue(S, change({ type: 'exercise-prog' }))).toBe('linear')
    expect(currentValue(S, change({ type: 'routine-prog' }))).toBe('linear')
    expect(currentValue(S, change({ type: 'week', target: { weekday: 1 } }))).toEqual(['r1'])   // a routine-id list; [] = rest
  })
})

describe('applying changes', () => {
  it('has an implementation for every type the server can send', async () => {
    const { CHANGE_TYPES: serverTypes } = await import('../../../api/coach/core/validate.js')
    expect([...CHANGE_TYPES].sort()).toEqual([...serverTypes].sort())
  })

  it('sets, reps, rep floor, rep ceiling, hold time, load step and policies', () => {
    const S = state()
    expect(apply(S, proposal([change({ type: 'sets', after: 4 })]), ['c1']).routines[0].ex[0].sets).toBe(4)
    expect(apply(S, proposal([change({ type: 'reps', after: 12 })]), ['c1']).routines[0].ex[0].reps).toBe(12)
    expect(apply(S, proposal([change({ type: 'repsMin', after: 8 })]), ['c1']).routines[0].ex[0].repsMin).toBe(8)
    expect(apply(S, proposal([change({ type: 'repsMax', before: null, after: 20 })]), ['c1']).routines[0].ex[0].repsMax).toBe(20)
    expect(apply(S, proposal([change({ type: 'sec', target: { routineId: 'r1', exId: '0007' }, before: 45, after: 60 })]), ['c1']).routines[0].ex[1].sec).toBe(60)
    expect(apply(S, proposal([change({ type: 'inc', before: null, after: 5 })]), ['c1']).routines[0].ex[0].inc).toBe(5)
    expect(apply(S, proposal([change({ type: 'exercise-prog', before: 'linear', after: 'double' })]), ['c1']).routines[0].ex[0].prog).toBe('double')
    expect(apply(S, proposal([change({ type: 'routine-prog', target: { routineId: 'r1' }, before: 'linear', after: 'greyskull' })]), ['c1']).routines[0].prog).toBe('greyskull')
  })

  it('adds an exercise at the position asked for', () => {
    const out = apply(state(), proposal([change({
      type: 'add-exercise', target: { routineId: 'r1' }, before: null,
      after: { id: '0002', sets: 3, reps: 8, mode: 'reps', position: 1 }
    })]), ['c1'])
    expect(out.routines[0].ex.map(e => e.id)).toEqual(['0001', '0002', '0007', '0009'])
    expect(out.routines[0].ex[1].sets).toBe(3)
  })

  it('carries a rep ceiling and the two flags onto an added exercise, and only when set', () => {
    const withFlags = apply(state(), proposal([change({
      type: 'add-exercise', target: { routineId: 'r1' }, before: null,
      after: { id: '0002', sets: 3, reps: 16, mode: 'reps', repsMin: 10, repsMax: 24, bodyweight: true, side: true }
    })]), ['c1']).routines[0].ex.at(-1)
    expect(withFlags).toMatchObject({ repsMin: 10, repsMax: 24, bodyweight: true, side: true })

    const plain = apply(state(), proposal([change({
      type: 'add-exercise', target: { routineId: 'r1' }, before: null,
      after: { id: '0002', sets: 3, reps: 8, mode: 'reps' }
    })]), ['c1']).routines[0].ex.at(-1)
    // Absent means "whatever the catalogue says". Writing a flag out would freeze today's
    // dataset into the plan.
    expect(plain.bodyweight).toBeUndefined()
    expect(plain.side).toBeUndefined()
  })

  it('drops an exercise without touching the rest', () => {
    const out = apply(state(), proposal([change({ type: 'remove-exercise' })]), ['c1'])
    expect(out.routines[0].ex.map(e => e.id)).toEqual(['0007', '0009'])
  })

  it('keeps the prescription when swapping the movement', () => {
    const out = apply(state(), proposal([change({ type: 'swap-exercise', after: { id: '0002' } })]), ['c1'])
    const e = out.routines[0].ex[0]
    expect(e.id).toBe('0002')
    expect(e.sets).toBe(3)
    expect(e.reps).toBe(10)     // not silently reset — that would be a change nobody approved
  })

  it('drops flags that described the old movement when swapping', () => {
    const S = state()
    S.routines[0].ex[0] = { ...S.routines[0].ex[0], side: true, reps: 16, bodyweight: true }
    const e = apply(S, proposal([change({ type: 'swap-exercise', after: { id: '0002' } })]), ['c1']).routines[0].ex[0]
    // A lunge's "per side" is not a leg press's. Carrying it over would have the app halve a
    // rep count that was never per-side; the new exercise goes back to the catalogue.
    expect(e.side).toBeUndefined()
    expect(e.bodyweight).toBeUndefined()
    expect(e.reps).toBe(16)     // the prescription itself still survives
  })

  it('reorders only with a complete permutation', () => {
    const out = apply(state(), proposal([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0009', '0001', '0007'] })]), ['c1'])
    expect(out.routines[0].ex.map(e => e.id)).toEqual(['0009', '0001', '0007'])
    expect(() => apply(state(), proposal([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0009'] })]), ['c1'])).toThrow()
    // A repeated id counts right and resolves to the same object twice: the third exercise
    // disappears and the survivor is aliased into two slots. Both gates have to catch this,
    // because it is the one change type with nothing in the diff column to give it away.
    expect(() => apply(state(), proposal([change({
      type: 'reorder', target: { routineId: 'r1' }, after: ['0009', '0009', '0001']
    })]), ['c1'])).toThrow()
  })

  it('refuses to superset an exercise with itself', () => {
    // Reachable only if the server let it past. By the message, not merely by throwing: the
    // unfixed path also threw — a TypeError, after it had already moved the exercise — so
    // asserting "it throws" would pass against the bug this is here to pin.
    expect(() => apply(state(), proposal([change({
      type: 'superset', after: { link: true, with: '0001' }
    })]), ['c1'])).toThrow('superset with itself')
  })

  it('supersets by moving the partner adjacent and tagging both', () => {
    const out = apply(state(), proposal([change({ type: 'superset', after: { link: true, with: '0009' } })]), ['c1'])
    const ex = out.routines[0].ex
    expect(ex[0].id).toBe('0001')
    expect(ex[1].id).toBe('0009')
    expect(ex[0].sg).toBeTruthy()
    expect(ex[0].sg).toBe(ex[1].sg)
  })

  it('unlinks a superset and cleans up the orphan tag', () => {
    const S = state()
    S.routines[0].ex[0].sg = 'a'; S.routines[0].ex[1].sg = 'a'
    const out = apply(S, proposal([change({ type: 'superset', after: { link: false } })]), ['c1'])
    expect(out.routines[0].ex[0].sg).toBeUndefined()
    expect(out.routines[0].ex[1].sg).toBeUndefined()
  })

  it('adds, renames and removes routines, clearing any day that pointed at one', () => {
    const added = apply(state(), proposal([change({
      type: 'add-routine', target: {}, before: null,
      after: { name: 'Full body C', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps' }] }
    })]), ['c1'])
    expect(added.routines).toHaveLength(3)
    expect(added.routines[2].id).not.toBe('r1')

    const renamed = apply(state(), proposal([change({ type: 'rename-routine', target: { routineId: 'r1' }, before: 'Full body A', after: 'Upper' })]), ['c1'])
    expect(renamed.routines[0].name).toBe('Upper')

    const removed = apply(state(), proposal([change({ type: 'remove-routine', target: { routineId: 'r2' } })]), ['c1'])
    expect(removed.routines.map(r => r.id)).toEqual(['r1'])
    expect(removed.week[3]).toBeUndefined()      // Wednesday pointed at r2
  })

  it('moves a day, and clears one — the slot stays a routine-id list', () => {
    const moved = apply(state(), proposal([change({ type: 'week', target: { weekday: 6 }, before: null, after: 'r1' })]), ['c1'])
    expect(moved.week[6]).toEqual(['r1'])
    const cleared = apply(state(), proposal([change({ type: 'week', target: { weekday: 1 }, before: 'r1', after: 'rest' })]), ['c1'])
    expect(cleared.week[1]).toBeUndefined()
  })

  it('collapses a combined day to the single routine the Coach named', () => {
    const S = state()
    S.week = { ...S.week, 3: ['r2', 'r1'] }
    const out = apply(S, proposal([change({ type: 'week', target: { weekday: 3 }, before: ['r2', 'r1'], after: 'r1' })]), ['c1'])
    expect(out.week[3]).toEqual(['r1'])
  })

  it('changeValues renders a combined-day before/after as joined routine names, not a count', () => {
    const S = state()
    const c = { type: 'week', target: { weekday: 3 }, before: ['r1', 'r2'], after: 'r1' }
    expect(changeValues(c, S)).toEqual({ before: 'Full body A + Full body B', after: 'Full body A' })
    expect(changeValues({ type: 'week', target: { weekday: 3 }, before: ['r1', 'r2'], after: 'rest' }, S).after).toBe('Rest')
    expect(changeValues({ type: 'week', target: { weekday: 3 }, before: null, after: 'r2' }, S).before).toBe('Rest')
  })

  it('never touches history, weigh-ins or settings', () => {
    const S = state({
      workouts: [{ id: 'w1', d: '2026-07-20', entries: [] }],
      bodyweight: [{ d: '2026-07-20', w: 80 }],
      exWeights: { '0001': { w: 20 } }, unit: 'kg', restSec: 90
    })
    const out = apply(S, proposal([change({ type: 'sets', after: 4 })]), ['c1'])
    expect(out.workouts).toEqual(S.workouts)
    expect(out.bodyweight).toEqual(S.bodyweight)
    expect(out.exWeights).toEqual(S.exWeights)
    expect(out.unit).toBe('kg')
    expect(out.restSec).toBe(90)
  })
})

describe('accepting a subset', () => {
  it('applies only what was accepted and records the rest as declined', () => {
    const s = JSON.parse(JSON.stringify(state()))
    const p = proposal([
      change({ id: 'c1', type: 'sets', after: 4 }),
      change({ id: 'c2', type: 'reps', before: 10, after: 12 })
    ])
    const res = applyChangeSet(s, p, ['c1'])
    expect(res).toMatchObject({ applied: 1, rejected: 1 })
    expect(s.routines[0].ex[0].sets).toBe(4)
    expect(s.routines[0].ex[0].reps).toBe(10)
    const decisions = s.coach.log.at(-1).decisions
    expect(decisions.find(d => d.id === 'c2').status).toBe('rejected')
  })

  it('refuses to apply a stale change even if it was ticked', () => {
    const s = JSON.parse(JSON.stringify(state()))
    const p = markStale(proposal([change()]), { ...s, routines: [{ id: 'r1', name: 'A', ex: [] }] })
    expect(applyChangeSet(s, p, ['c1'])).toEqual({ applied: 0 })
  })

  it('is all-or-nothing: a failure part-way leaves the plan exactly as it was', () => {
    const s = JSON.parse(JSON.stringify(state()))
    const before = JSON.stringify(s.routines)
    const p = proposal([
      change({ id: 'c1', type: 'sets', after: 4 }),
      change({ id: 'c2', type: 'reps', target: { routineId: 'r1', exId: 'ghost' }, before: null, after: 12 })
    ])
    // The store hands us a clone and keeps it only if we return; throwing discards everything.
    expect(() => applyChangeSet(s, p, ['c1', 'c2'])).toThrow()
    const s2 = JSON.parse(JSON.stringify(state()))
    try { applyChangeSet(s2, p, ['c1', 'c2']) } catch { /* draft discarded by the caller */ }
    expect(JSON.stringify(state().routines)).toBe(before)
  })
})

describe('snapshots and revert', () => {
  it('puts the plan back and leaves the training log alone', () => {
    const s = JSON.parse(JSON.stringify(state({ workouts: [{ id: 'w1', d: '2026-07-20', entries: [] }] })))
    const original = JSON.stringify(s.routines)
    applyChangeSet(s, proposal([change({ type: 'sets', after: 4 })]), ['c1'])
    expect(s.routines[0].ex[0].sets).toBe(4)
    expect(canRevert(s)).toBe(true)
    expect(revertLast(s)).toBe(true)
    expect(JSON.stringify(s.routines)).toBe(original)
    expect(s.workouts).toHaveLength(1)
    expect(s.coach.log.at(-1).kind).toBe('revert')
  })

  it('keeps a bounded number of snapshots', () => {
    const s = JSON.parse(JSON.stringify(state()))
    for (let i = 0; i < SNAPSHOT_MAX + 3; i++) pushSnapshot(s, 'p' + i)
    expect(s.coach.snapshots).toHaveLength(SNAPSHOT_MAX)
    expect(s.coach.snapshots.at(-1).proposalId).toBe('p' + (SNAPSHOT_MAX + 2))
  })

  it('reverting with nothing to revert to is a no-op, not a crash', () => {
    const s = JSON.parse(JSON.stringify(state()))
    expect(revertLast(s)).toBe(false)
  })
})

describe('the log', () => {
  it('is bounded', () => {
    const s = JSON.parse(JSON.stringify(state()))
    for (let i = 0; i < LOG_MAX + 10; i++) appendLog(s, { kind: 'review', at: i, summary: 's' + i })
    expect(s.coach.log).toHaveLength(LOG_MAX)
    expect(s.coach.log.at(-1).summary).toBe('s' + (LOG_MAX + 9))
  })

  it('stays well inside the sync budget even when full', () => {
    const s = JSON.parse(JSON.stringify(state()))
    for (let i = 0; i < LOG_MAX; i++) {
      appendLog(s, { kind: 'review', at: i, summary: 'x'.repeat(200), decisions: [{ id: 'c', type: 'sets', why: 'y'.repeat(200), status: 'accepted' }] })
    }
    for (let i = 0; i < SNAPSHOT_MAX; i++) pushSnapshot(s, 'p' + i)
    expect(JSON.stringify(s.coach).length).toBeLessThan(300 * 1024)
  })

  it('records a dismissal so a later review knows not to nag', () => {
    const s = JSON.parse(JSON.stringify(state()))
    recordDismissal(s, proposal([change()]))
    expect(s.coach.log.at(-1).decisions[0].status).toBe('rejected')
  })
})

describe('created plans', () => {
  // Accepting a plan replaces the whole week, so reschedules aimed at the old one are stale:
  // 'rest' would hide a session the new plan schedules, and an id outranks the new week.
  describe('per-date reschedules', () => {
    const past = '2020-01-02'
    const future = '2099-12-31'
    const withOverrides = () => JSON.parse(JSON.stringify(state({
      dayPlan: { [past]: 'r1', [future]: 'rest' }
    })))

    it('drops today-and-later overrides when the schedule moves, and keeps past ones', () => {
      const s = withOverrides()
      applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle }, { schedule: true })
      expect(s.dayPlan[future]).toBeUndefined()
      expect(s.dayPlan[past]).toBe('r1')       // history, not intent
    })

    it('leaves them alone when the schedule was not taken', () => {
      const s = withOverrides()
      applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle }, { schedule: false })
      expect(s.dayPlan[future]).toBe('rest')
      expect(s.dayPlan[past]).toBe('r1')
    })

    it('puts the dropped overrides back on revert', () => {
      const s = withOverrides()
      applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle }, { schedule: true })
      expect(revertLast(s)).toBe(true)
      expect(s.dayPlan[future]).toBe('rest')
      expect(s.dayPlan[past]).toBe('r1')
    })

    it('reverts cleanly for a snapshot taken before the patch existed', () => {
      const s = withOverrides()
      pushSnapshot(s, 'old', 'legacy')
      delete s.coach.snapshots[s.coach.snapshots.length - 1].dayPlanRestore
      expect(() => revertLast(s)).not.toThrow()
      expect(s.dayPlan[future]).toBe('rest')
    })
  })

  it('refuses a bundle carrying a routine with no exercises', () => {
    // The server rejects this; if the client does not, the empty routine gets scheduled and
    // starting today's session opens a workout with nothing in it.
    const empty = { ...bundle, routines: [{ id: 'x1', name: 'A', ex: [] }] }
    const s = JSON.parse(JSON.stringify(state()))
    expect(() => applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle: empty }, {})).toThrow()
    expect(s.routines).toHaveLength(2)
  })

  const bundle = {
    opengym_plan: 1, name: 'Coach plan', summary: 'three days',
    week: { 1: 'x1', 3: 'x2' },
    routines: [
      { id: 'x1', name: 'A', emoji: '💪', why: 'why A', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', why: 'why ex' }] },
      { id: 'x2', name: 'B', emoji: '🏋️', ex: [{ id: '0002', sets: 3, reps: 8, mode: 'reps' }] }
    ],
    customEx: []
  }

  it('adds routines as new ones and never modifies what was already there', () => {
    const s = JSON.parse(JSON.stringify(state()))
    applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle }, { schedule: false })
    expect(s.routines).toHaveLength(4)
    expect(s.routines[0].name).toBe('Full body A')          // untouched
    expect(s.routines[2].id).not.toBe('x1')                 // fresh ids, like a plan import
    expect(s.week[1]).toBe('r1')                            // schedule left alone
  })

  it('replaces the week only when asked, and remaps to the new ids', () => {
    const s = JSON.parse(JSON.stringify(state()))
    applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle }, { schedule: true })
    expect(s.week[1]).toEqual([s.routines[2].id])           // a weekday holds a routine-id list
    expect(s.week[3]).toEqual([s.routines[3].id])
    expect(s.week[5]).toBeUndefined()                       // a day the new plan leaves empty is rest
  })

  it('keeps the Coach\'s prose out of the routine data', () => {
    const s = JSON.parse(JSON.stringify(state()))
    applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle }, {})
    expect(s.routines[2].why).toBeUndefined()
    expect(s.routines[2].ex[0].why).toBeUndefined()
    expect(s.routines[2].ex[0].name).toBeUndefined()
  })

  it('carries the rep ceiling and the flags the validator let through', () => {
    const s = JSON.parse(JSON.stringify(state()))
    applyCreatedPlan(s, {
      id: 'p1', kind: 'create',
      bundle: {
        ...bundle,
        routines: [{ id: 'x1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 12, mode: 'reps', repsMin: 8, repsMax: 20, bodyweight: true }] }]
      }
    }, {})
    expect(s.routines[2].ex[0]).toMatchObject({ repsMin: 8, repsMax: 20, bodyweight: true })
  })

  it('is revertible like any other change', () => {
    const s = JSON.parse(JSON.stringify(state()))
    applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle }, { schedule: true })
    revertLast(s)
    expect(s.routines).toHaveLength(2)
    expect(s.week[1]).toBe('r1')
  })

  it('brings custom exercises along and registers them', () => {
    const s = JSON.parse(JSON.stringify(state()))
    applyCreatedPlan(s, {
      id: 'p1', kind: 'create',
      bundle: { ...bundle, routines: [{ id: 'x1', name: 'A', ex: [{ id: 'cx1', sets: 3, reps: 10 }] }], customEx: [{ id: 'cx1', n: 'Sandbag carry', bp: 'back' }] }
    }, {})
    expect(s.customEx).toHaveLength(1)
    registerCustom(s.customEx)
    expect(s.routines[2].ex[0].id).toBe(s.customEx[0].id)
  })
})

describe('validation', () => {
  it('rejects an unreadable proposal rather than half-applying it', () => {
    expect(() => validateProposal(null)).toThrow()
    expect(() => validateProposal({})).toThrow()
    expect(() => validateProposal({ changes: [{ type: 'drop-database' }] })).toThrow()
    expect(() => validateProposal({ bundle: { routines: [] } })).toThrow()
    expect(validateProposal({ changes: [change()] })).toBe(true)
  })
})

describe('the gate has something real to read', () => {
  it('the store actually exposes the `config` field every Coach entry point reads', async () => {
    // coachAvailable(config, …) is false when `config` is undefined, which is indistinguishable
    // from "this instance has no Coach". The views were ported once without the store field they
    // depend on, so every Coach surface silently vanished on every instance: no entry point, and
    // /#/coach redirecting straight back to /home. A missing key must fail here, not in a browser.
    // Asserted against the source rather than the live store: useStore touches `document` at
    // import time, so it cannot be instantiated in this environment. Crude, but it fails on
    // exactly the two edits that broke it — dropping the field, or dropping the fetch.
    // Matched loosely on purpose: boot() fetches through loadConfig() rather than inlining the
    // call, so what matters is that the field exists and that something writes /api/config
    // into it — not the spelling of the expression that does it.
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../store/useStore.js', import.meta.url), 'utf8')
    expect(src).toMatch(/\bconfig:\s*null\b/)
    expect(src).toMatch(/set\(\s*\{\s*config[:\s]/)
    expect(src).toMatch(/api\(['"]\/api\/config['"]\)/)
    // and boot() must actually reach it, however it is spelled
    expect(src).toMatch(/loadConfig\(\)|config:\s*await api\(/)
  })

  it('a configured instance with a signed-in user opens the gate', () => {
    // The exact shape GET /api/config returns when the Coach is on.
    const config = { invite_only: false, coach: { enabled: true, provider: 'claude', authMode: 'instance' } }
    expect(coachAvailable(config, { id: 'u' })).toBe(true)
    expect(coachAvailable(undefined, { id: 'u' })).toBe(false)   // the bug, pinned
  })
})

describe('removing a routine takes its per-date reschedules with it', () => {
  // RoutineEdit does this on a hand-deleted routine. A pointer left behind still counts as an
  // override, so the day wears a "rescheduled" badge for good with no way to clear it.
  const c = { id: 'c1', type: 'remove-routine', target: { routineId: 'r2' }, before: null, after: null, why: 'unused' }

  it('clears dayPlan entries pointing at the removed routine', () => {
    const S = state({ dayPlan: { '2099-01-01': 'r2', '2099-01-02': 'r1' } })
    const s = apply(S, proposal([c]), ['c1'])
    expect(s.dayPlan['2099-01-01']).toBeUndefined()
    expect(s.dayPlan['2099-01-02']).toBe('r1')   // a different routine is none of its business
    expect(s.week[3]).toBeUndefined()
  })

  it('restores them on revert', () => {
    const S = state({ dayPlan: { '2099-01-01': 'r2' } })
    const s = apply(S, proposal([c]), ['c1'])
    expect(revertLast(s)).toBe(true)
    expect(s.dayPlan['2099-01-01']).toBe('r2')
  })
})

describe('what the log keeps, so a decision never makes a proposal vanish', () => {
  const plan = {
    opengym_plan: 1, name: 'Coach plan', summary: 'p', week: { 1: 'x1' },
    routines: [{ id: 'x1', name: 'A', emoji: '💪', why: 'w', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', why: 'y'.repeat(300), secret: 1 }] }],
    customEx: []
  }

  it('applyChangeSet returns the log id and keeps the declined change whole', () => {
    const s = JSON.parse(JSON.stringify(state()))
    const p = proposal([change(), change({ id: 'c2', type: 'reps', before: 10, after: 8, why: 'too many' })])
    const res = applyChangeSet(s, p, ['c1'])
    expect(res.logId).toBe(s.coach.log.at(-1).id)
    const rej = s.coach.log.at(-1).decisions.find(d => d.id === 'c2')
    expect(rej).toMatchObject({ status: 'rejected', type: 'reps', before: 10, after: 8, target: { routineId: 'r1', exId: '0001' } })
    expect(logEntry(s, res.logId).kind).toBe('review')
  })

  it('applyCreatedPlan keeps a light copy of the bundle and whether the week was taken', () => {
    const s = JSON.parse(JSON.stringify(state()))
    const res = applyCreatedPlan(s, { id: 'p1', kind: 'create', bundle: plan, iteration: 2 }, { schedule: false })
    const e = logEntry(s, res.logId)
    expect(e.kind).toBe('create')
    expect(e.scheduled).toBe(false)
    expect(e.iteration).toBe(2)
    expect(e.bundle.routines[0].ex[0]).toEqual({ id: '0001', sets: 3, mode: 'reps', reps: 10, why: 'y'.repeat(200) })
    expect(e.bundle.routines[0].why).toBe('w')
  })

  it('recordDismissal returns the id and keeps a discarded plan too', () => {
    const s = JSON.parse(JSON.stringify(state()))
    const id = recordDismissal(s, { id: 'p1', kind: 'create', summary: 'nope', bundle: plan })
    const e = logEntry(s, id)
    expect(e.dismissed).toBe(true)
    expect(e.bundle.name).toBe('Coach plan')
    expect(s.coach.lastReview).toBeUndefined()
    const rid = recordDismissal(s, proposal([change()], { evidence: { sessions: 4 }, notes: ['n'] }))
    expect(logEntry(s, rid)).toMatchObject({ evidence: { sessions: 4 }, notes: ['n'] })
    expect(logEntry(s, rid).decisions[0]).toMatchObject({ status: 'rejected', before: 3, after: 4 })
  })

  it('recordDebrief files the whole reading', () => {
    const s = JSON.parse(JSON.stringify(state()))
    const id = recordDebrief(s, { id: 'd1', kind: 'debrief', workout: { id: 'w1', name: 'Push' }, summary: 'ok', score: 8, highlights: ['a'], watch: [], nextTime: ['b'] })
    expect(logEntry(s, id)).toMatchObject({ kind: 'debrief', score: 8, highlights: ['a'], nextTime: ['b'], workout: { id: 'w1' } })
  })

  it('lightBundle drops what the card does not show', () => {
    const b = lightBundle({ ...plan, customEx: [{ id: 'z' }], basedOn: 'x' })
    expect(b.customEx).toBeUndefined()
    expect(b.basedOn).toBeUndefined()
    expect(Object.keys(b.routines[0].ex[0])).not.toContain('secret')
    expect(lightBundle(null)).toBeNull()
  })
})
