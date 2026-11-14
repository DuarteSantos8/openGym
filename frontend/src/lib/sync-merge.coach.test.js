/* The Coach's history across two devices (#779). `coach` is one stamped setting, so the copy that
   changed it last used to win it whole: a device that wrote one line into its older copy dropped
   the other device's messages, log entries and Undo snapshots. These merge two diverged copies in
   both directions, the way a 409 does on either device. */
import { describe, expect, it } from 'vitest'
import { COACH_CAPS, mergeCoach, mergeStates, stampChange } from './sync-merge.js'
import { appendChat, appendLog, pushSnapshot, revertLast, CHAT_MAX, LOG_MAX, SNAPSHOT_MAX, CONSENT_VERSION } from './coach.js'
import * as server from '../../../api/sync-stamps.js'

const T = 1_800_000_000_000
const clone = o => JSON.parse(JSON.stringify(o))
const base = () => ({
  _ts: T, unit: 'kg', lang: 'en', workouts: [], bodyweight: [], customEx: [], exWeights: {}, dayPlan: {},
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0001', sets: 3, reps: 10 }], _ts: T }], week: { 1: ['r1'] },
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION }, profile: { goal: 'muscle' }, cadence: 'off',
    chat: [{ id: 'c0', role: 'user', kind: 'intake', at: T - 100 }], log: [], snapshots: [], timings: []
  },
  edited: { coach: T - 100 },
})
// A change made on one device, stamped the way the store stamps it. `wall` is that device's clock.
const change = (prev, wall, mut) => { const n = clone(prev); mut(n); n._ts = stampChange(prev, n, wall); return n }
const chatIds = S => S.coach.chat.map(m => m.id)
const logIds = S => S.coach.log.map(e => e.id)

describe('two devices talking to the Coach', () => {
  // Device A asks, B gets the proposal, applies it, asks again and applies that too; A then
  // writes its stale "nothing to change" line (the exact sequence in #779).
  const diverged = () => {
    const S0 = base()
    const B = change(change(S0, T + 10, s => {
      appendChat(s, { id: 'b1', role: 'user', kind: 'text', text: 'more legs', at: T + 10 })
      pushSnapshot(s, 'p1', 'before p1')
      s.coach.snapshots.at(-1).at = T + 11
      appendLog(s, { id: 'l1', kind: 'review', at: T + 11, proposalId: 'p1' })
      appendChat(s, { id: 'b2', role: 'coach', kind: 'applied', ref: 'l1', at: T + 12 })
    }), T + 20, s => {
      appendChat(s, { id: 'b3', role: 'user', kind: 'text', text: 'and arms', at: T + 20 })
      pushSnapshot(s, 'p2', 'before p2')
      s.coach.snapshots.at(-1).at = T + 21
      appendLog(s, { id: 'l2', kind: 'review', at: T + 21, proposalId: 'p2' })
      appendChat(s, { id: 'b4', role: 'coach', kind: 'applied', ref: 'l2', at: T + 22 })
    })
    const A = change(S0, T + 800, s => {
      appendChat(s, { id: 'a1', role: 'coach', kind: 'nochange', text: 'all good', at: T + 800 })
    })
    return { A, B }
  }

  it('keeps every line, log entry and snapshot of both, in either direction', () => {
    const { A, B } = diverged()
    for (const out of [mergeStates(A, B), mergeStates(B, A)]) {
      expect(chatIds(out)).toEqual(['c0', 'b1', 'b2', 'b3', 'b4', 'a1'])
      expect(logIds(out)).toEqual(['l1', 'l2'])
      expect(out.coach.snapshots.map(x => x.proposalId)).toEqual(['p1', 'p2'])
    }
    expect(mergeStates(A, B).coach).toEqual(mergeStates(B, A).coach)
  })

  it('the rest of the namespace still comes from the copy that changed it last', () => {
    const { A, B } = diverged()
    const B2 = change(B, T + 900, s => { s.coach.cadence = { everyWorkouts: 4 } })
    for (const out of [mergeStates(A, B2), mergeStates(B2, A)]) {
      expect(out.coach.cadence).toEqual({ everyWorkouts: 4 })
      expect(chatIds(out)).toContain('a1')
    }
  })

  it('merging again changes nothing: shared entries once', () => {
    const { A, B } = diverged()
    const once = mergeStates(A, B)
    const twice = mergeStates(once, B)
    expect(twice.coach).toEqual(once.coach)
    expect(new Set(chatIds(twice)).size).toBe(chatIds(twice).length)
  })

  it('keeps the newest ones within the caps', () => {
    const S0 = base()
    const many = (prev, wall, tag) => change(prev, wall, s => {
      for (let i = 0; i < 35; i++) {
        appendChat(s, { id: `${tag}${i}`, role: 'user', kind: 'text', text: 'x', at: wall + i * 2 })
        appendLog(s, { id: `L${tag}${i}`, kind: 'review', at: wall + i * 2 })
      }
      for (let i = 0; i < 3; i++) { pushSnapshot(s, `${tag}p${i}`); s.coach.snapshots.at(-1).at = wall + i }
    })
    const A = many(S0, T + 1, 'a'), B = many(S0, T + 2, 'b')
    for (const out of [mergeStates(A, B), mergeStates(B, A)]) {
      expect(out.coach.chat).toHaveLength(CHAT_MAX)
      expect(out.coach.log).toHaveLength(LOG_MAX)
      expect(out.coach.snapshots).toHaveLength(SNAPSHOT_MAX)
      expect(chatIds(out).at(-1)).toBe('b34')                 // the newest stays
      expect(chatIds(out)).not.toContain('c0')                 // the oldest goes first
    }
  })

  it('an Undo used on one device is not offered again by the other', () => {
    const { B } = diverged()
    // Both devices synced; then A undoes p2 while B, offline, chats on.
    const A = change(B, T + 1000, s => { expect(revertLast(s)).toBe(true) })
    const B2 = change(B, T + 1001, s => { appendChat(s, { id: 'b5', role: 'user', kind: 'text', at: T + 1001 }) })
    for (const out of [mergeStates(A, B2), mergeStates(B2, A)]) {
      expect(out.coach.snapshots.map(x => x.proposalId)).toEqual(['p1'])
      expect(chatIds(out)).toContain('b5')
      expect(out.coach.log.some(e => e.kind === 'revert')).toBe(true)
    }
  })

  it('an older app’s Undo (no snapshot named) still takes its snapshot off', () => {
    const { B } = diverged()
    const A = change(B, T + 1000, s => {
      s.coach.snapshots.pop()
      s.coach.log.push({ id: 'r', kind: 'revert', at: T + 1000, proposalId: 'p2' })
    })
    expect(mergeStates(B, A).coach.snapshots.map(x => x.proposalId)).toEqual(['p1'])
  })

  it('a reset this copy has not seen takes its Coach history with it', () => {
    const { B } = diverged()
    const R = change(base(), T + 2000, s => { s.coach.chat = []; s.coach.log = []; s.coach.snapshots = [] })
    R.resetAt = T + 2000
    const R2 = change(R, T + 2100, s => appendChat(s, { id: 'n1', role: 'user', kind: 'text', at: T + 2100 }))
    const B2 = change(B, T + 2200, s => appendChat(s, { id: 'late', role: 'user', kind: 'text', at: T + 2200 }))
    for (const out of [mergeStates(R2, B2), mergeStates(B2, R2)]) {
      expect(chatIds(out)).toEqual(['n1', 'late'])            // only what came after the reset
      expect(out.coach.snapshots).toEqual([])
    }
  })

  it('a sign-in (prefer) keeps the preferred side as it is', () => {
    const { A, B } = diverged()
    expect(chatIds(mergeStates(A, B, { prefer: 'b' }))).toEqual(chatIds(B))
  })
})

describe('the server joins what an older app sends', () => {
  it('an unstamped push of an older coach copy keeps the stored lines', () => {
    const stored = base()
    stored.coach.chat.push({ id: 'b1', role: 'user', kind: 'text', at: T + 10 })
    stored.coach.log.push({ id: 'l1', kind: 'review', at: T + 11 })
    const sent = clone(base())
    sent.coach.chat.push({ id: 'a1', role: 'coach', kind: 'nochange', at: T + 20 })
    server.stampPut(stored, sent, { overRead: true, stamped: false, now: T + 30 })
    expect(sent.coach.chat.map(m => m.id)).toEqual(['c0', 'b1', 'a1'])
    expect(sent.coach.log.map(e => e.id)).toEqual(['l1'])
  })

  it('an app that stamps its own changes merged already, and is taken as sent', () => {
    const stored = base()
    stored.coach.chat.push({ id: 'b1', role: 'user', kind: 'text', at: T + 10 })
    const sent = clone(base())
    server.stampPut(stored, sent, { overRead: true, stamped: true, now: T + 30 })
    expect(sent.coach.chat.map(m => m.id)).toEqual(['c0'])
  })

  it('matches the app’s mergeCoach and caps', () => {
    expect(server.COACH_CAPS).toEqual(COACH_CAPS)
    expect(COACH_CAPS).toEqual({ chat: CHAT_MAX, log: LOG_MAX, snapshots: SNAPSHOT_MAX })
    let seed = 7
    const R = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
    for (let n = 0; n < 200; n++) {
      const side = () => ({
        cadence: R() < 0.5 ? 'off' : { everyWorkouts: 4 },
        chat: Array.from({ length: Math.floor(R() * 50) }, () => ({ id: 'c' + Math.floor(R() * 60), at: Math.floor(R() * 100) })),
        log: Array.from({ length: Math.floor(R() * 60) }, () => R() < 0.1
          ? { id: 'r' + Math.floor(R() * 9), kind: 'revert', at: Math.floor(R() * 100), ...(R() < 0.5 ? { snap: `${Math.floor(R() * 5)}|p` } : { proposalId: 'p' }) }
          : { id: 'l' + Math.floor(R() * 70), at: Math.floor(R() * 100) }),
        snapshots: Array.from({ length: Math.floor(R() * 4) }, () => ({ at: Math.floor(R() * 5), proposalId: 'p', routines: [] })),
      })
      const a = side(), b = side()
      expect(server.mergeCoach(clone(a), clone(b))).toEqual(mergeCoach(clone(a), clone(b)))
    }
  })
})
