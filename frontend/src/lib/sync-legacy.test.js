/* The first merge of a copy v1.3.9 still owed the server, after another device synced
   (lib/sync-legacy.js). QA retest 2026-10-06: the old app's offline setting changes were undone. */
import { describe, expect, it } from 'vitest'
import { mergeStates, stampChange } from './sync-merge.js'
import { legacyBase, liftLegacy, restHash139 } from './sync-legacy.js'

// v1.3.9's `s` fingerprint, as that app computed it (lib/sync-changes.js at the v1.3.9 tag).
const NOT_CONTENT = new Set(['_ts', '_rev', 'active', 'workouts', 'bodyweight', 'routines', 'customEx'])
function fp139(S) {
  const rest = {}
  for (const f of Object.keys(S || {}).sort()) if (!NOT_CONTENT.has(f)) rest[f] = S[f]
  const s = JSON.stringify(rest) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return { w: {}, b: {}, r: {}, c: {}, s: h.toString(36) }
}

const c = x => JSON.parse(JSON.stringify(x))
const T = Date.UTC(2026, 9, 6, 8)
const W = (id, t) => ({ id, d: '2026-10-0' + (1 + id.length % 5), start: t, end: t + 3600e3, entries: [{ id: 'bench', sets: [{ w: 60, r: 5 }] }] })
const base = {
  _ts: T, unit: 'kg', restSec: 90, week: { 1: 'r1' }, exNotes: { bench: 'old' }, favEx: ['squat'],
  edited: { restSec: T - 5e6 },
  workouts: [W('w1', T - 9e6), W('w2', T - 8e6)], routines: [{ id: 'r1', name: 'Push', ex: [], _ts: T - 1e7 }],
  bodyweight: [], customEx: [],
}

describe('a v1.3.9 copy owed at the update', () => {
  it('restHash139 is v1.3.9\'s fingerprint of the rest', () => {
    expect(restHash139(base)).toBe(fp139(base).s)
  })

  it('keeps the old app\'s offline setting, plan and note changes when another device synced meanwhile', () => {
    const fp = fp139(base)
    // v1.3.9 offline: rest time, a plan day and a note, no stamps
    const old = c(base)
    old.restSec = 140; old.week = { 1: 'r1', 3: 'r1' }; old.exNotes = { bench: 'new note' }; old._ts = T + 1000
    // an updated device logs a workout and changes another setting later
    const srv = c(base); srv.workouts.push(W('w3x', T + 5000)); srv.sound = false
    srv._ts = stampChange(base, srv, T + 5000)
    // before: the server's stamps won and the old app's changes went back
    const plain = mergeStates(old, srv)
    expect(plain.restSec).toBe(90)
    const { state, resolved } = liftLegacy(old, srv, fp, T + 9000)
    expect(resolved).toBe(true)
    for (const m of [mergeStates(state, srv), mergeStates(srv, state)]) {
      expect(m.restSec).toBe(140)
      expect(m.week).toEqual({ 1: 'r1', 3: 'r1' })
      expect(m.exNotes.bench).toBe('new note')
      expect(m.sound).toBe(false)                      // the other device's change stays too
      expect(m.workouts.map(w => w.id).sort()).toEqual(['w1', 'w2', 'w3x'])
    }
  })

  it('a setting the other device changed (and this one did not) stays the other device\'s', () => {
    const fp = fp139(base)
    const old = c(base); old.restSec = 140
    const srv = c(base); srv.exNotes = { bench: 'server note' }; srv._ts = stampChange(base, srv, T + 5000)
    const { state } = liftLegacy(old, srv, fp, T + 9000)
    const m = mergeStates(state, srv)
    expect(m.restSec).toBe(140)
    expect(m.exNotes.bench).toBe('server note')
  })

  it('both sides changed the same setting: nothing is guessed, the caller keeps the copy aside', () => {
    const fp = fp139(base)
    const old = c(base); old.restSec = 140
    const srv = c(base); srv.restSec = 60; srv._ts = stampChange(base, srv, T + 5000)
    expect(legacyBase(old, srv, fp.s)).toBe(null)
    expect(liftLegacy(old, srv, fp, T + 9000).resolved).toBe(false)
  })

  it('no fingerprint: not resolved; no setting changed here: resolved with nothing stamped', () => {
    const old = c(base); old.restSec = 140
    expect(liftLegacy(old, c(base), null).resolved).toBe(false)
    const same = c(base); same.workouts = same.workouts.slice(0, 1)
    const r = liftLegacy(same, c(base), fp139(base), T + 9000)
    expect(r.resolved).toBe(true)
    expect(r.state.edited).toEqual(base.edited)
  })

  it('never removes anything: a workout the old app deleted offline comes back', () => {
    const fp = fp139(base)
    const old = c(base); old.workouts = old.workouts.filter(w => w.id !== 'w2'); old.restSec = 140
    const srv = c(base); srv.workouts.push(W('w3x', T + 5000)); srv._ts = stampChange(base, srv, T + 5000)
    const m = mergeStates(liftLegacy(old, srv, fp, T + 9000).state, srv)
    expect(m.workouts.map(w => w.id).sort()).toEqual(['w1', 'w2', 'w3x'])
  })
})
