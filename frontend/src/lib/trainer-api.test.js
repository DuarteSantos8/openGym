// The trainer dashboard's pure helpers: who shows first, flags and changes in words, how an
// assignment will land, whether the dashboard shows at all. And the server's trainer write
// (api/trainers/ops.js) merging on a member's device like any second device's change, `_by` and all.
import { describe, expect, it } from 'vitest'
import { sortMembers, flagText, changeText, changeLines, assignOutcome, assignResult, showsDashboard, trainerRoles, trainerError, initials, attentionOf } from './trainer-api.js'
import { mergeStates } from './sync-merge.js'
import { applyOps, cleanOps } from '../../../api/trainers/ops.js'

const m = (id, name, summary = {}, extra = {}) => ({ grantId: 'g' + id, member: { id, name }, summary: { flags: [], ...summary }, ...extra })

describe('sortMembers', () => {
  const list = [
    m('a', 'Anna', { lastWorkout: '2026-11-04', streak: 3 }),
    m('b', 'Ben', { lastWorkout: '2026-10-20', streak: 0, flags: [{ kind: 'inactive', days: 16 }, { kind: 'missed', n: 2 }] }),
    m('c', 'Cleo', { lastWorkout: '2026-11-05', streak: 9, flags: [{ kind: 'pr', n: 1 }] }),
    m('d', 'Dan', {}, { paused: 'left-gym' }),
  ]
  it('puts who needs a nudge first and paused connections last', () => {
    expect(sortMembers(list).map(x => x.member.name)).toEqual(['Ben', 'Anna', 'Cleo', 'Dan'])
    expect(attentionOf(list[3])).toBe(-1)
  })
  it('sorts by name, last workout and streak, and searches', () => {
    expect(sortMembers(list, 'last').map(x => x.member.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(sortMembers(list, 'streak').map(x => x.member.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(sortMembers(list, 'name', 'le').map(x => x.member.id)).toEqual(['c'])
  })
  it('filters', () => {
    expect(sortMembers(list, 'name', '', 'pr').map(x => x.member.id)).toEqual(['c'])
    expect(sortMembers(list, 'name', '', 'attention').map(x => x.member.id)).toEqual(['b'])
    expect(sortMembers(list, 'name', '', 'inactive').map(x => x.member.id)).toEqual(['b'])
  })
})

describe('words', () => {
  it('flags', () => {
    expect(flagText({ kind: 'missed', n: 2 }).text).toBe('Missed 2 planned')
    expect(flagText({ kind: 'weight', delta: -1.2 }).text).toBe('-1.2 kg in 2 weeks')
    expect(flagText({ kind: 'weight', delta: 1.5 }).text).toBe('+1.5 kg in 2 weeks')
    expect(flagText({ kind: 'pr', n: 1, ex: ['c_x'] }, [{ id: 'c_x', name: 'Landmine' }]).text).toBe('PR: Landmine')
    expect(flagText({ kind: 'pr', n: 3 }).tone).toBe('good')
  })
  it('changes', () => {
    expect(changeText({ kind: 'routine.put', isNew: true, name: 'Legs' })).toBe('New routine: Legs')
    expect(changeText({ kind: 'week.add', day: 1, name: 'Legs' })).toBe('On Mondays: Legs')
    expect(changeText({ kind: 'bodyweight.put', w: 68.1, d: '2026-11-05' }, 'kg')).toBe('Weigh-in: 68.1 kg on 2026-11-05')
    // A custom exercise they already had is not news.
    expect(changeLines([{ kind: 'custom.put', kept: true, name: 'x' }, { kind: 'routine.remove', name: 'Push' }])).toEqual(['Routine removed: Push'])
  })
  it('assignments', () => {
    expect(assignOutcome({ plans: 'apply' })).toBe('applied')
    expect(assignOutcome({ plans: 'suggest' })).toBe('suggested')
    expect(assignOutcome({ plans: 'view' })).toBe('skipped')
    expect(assignResult({ applied: 2, suggested: 1, skipped: 0 })).toBe('2 added directly, 1 sent as a suggestion')
  })
  it('errors and initials', () => {
    expect(trainerError({ data: { code: 'not-shared' } })).toBe('They do not share that with you any more.')
    expect(initials('Lea Sommer')).toBe('LS')
    expect(initials('lea')).toBe('L')
  })
})

describe('showsDashboard', () => {
  it('only for a trainer or gym lead on a server with trainers on', () => {
    expect(showsDashboard(null)).toBe(false)
    expect(showsDashboard({ trainers: { on: true, roles: { trainer: false, lead: false } } })).toBe(false)
    expect(showsDashboard({ trainers: { on: true, roles: { trainer: true, lead: false } } })).toBe(true)
    expect(showsDashboard({ trainers: { on: true, roles: { trainer: false, lead: true } } })).toBe(true)
    expect(trainerRoles({ trainers: { on: false, roles: { trainer: true } } }).trainer).toBe(false)
  })
})

describe('a trainer change merges on the member’s device like a second device', () => {
  it('keeps the routine with its _by label and the phone’s own offline edit of another field', () => {
    const base = { unit: 'kg', routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'bench' }], _ts: 10 }], week: {}, workouts: [], bodyweight: [] }
    const server = JSON.parse(JSON.stringify(base))
    applyOps(server, cleanOps([{ op: 'routine.put', id: 'r1', routine: { name: 'Push', ex: [{ id: 'bench' }, { id: 'dip' }] } }]), { by: { id: 'u_marco', name: 'Marco' }, t: 100 })
    // Meanwhile the phone renamed it, offline, later.
    const phone = JSON.parse(JSON.stringify(base))
    phone.routines[0] = { ...phone.routines[0], name: 'Push day', _ts: 200, _f: { name: 200 } }
    const merged = mergeStates(phone, server)
    const r = merged.routines.find(x => x.id === 'r1')
    expect(r.name).toBe('Push day')
    expect(r.ex.map(e => e.id)).toEqual(['bench', 'dip'])
    expect(r._by).toMatchObject({ kind: 'trainer', name: 'Marco' })
  })
})
