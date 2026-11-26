// The watch's logic, one behaviour per test: the CoreTest.mc cases that apply to a watch with the
// full memory, plus per-side, superset, hold, fix, effort, rest and "Still training?".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as K from '../entry/src/main/js/MainAbility/common/core.js'

const fixture = JSON.parse(readFileSync(new URL('../../frontend/garmin/test/snapshot.json', import.meta.url), 'utf8'))
const clone = v => JSON.parse(JSON.stringify(v))
const T0 = 1761742800000

// A watch with a fake radio that never answers (the outbox just fills), a clock we move, a buzz log.
function mk (stored) {
  const t = { now: T0 }
  const sent = []
  const buzzes = []
  let saved = null
  const env = {
    radio: { transmit: (m, l) => { sent.push(clone(m)); t.l = l } },
    now: () => t.now,
    random: () => 0.5,
    save: s => { saved = clone(s) },
    buzz: p => buzzes.push(p)
  }
  const c = K.createCore(env, stored)
  return { c, s: c.s, t, sent, buzzes, saved: () => saved, evs: () => c.s.ob.map(K.unpack) }
}
const ent = (id, i, sets, extra) => Object.assign({ id: id, name: id, i: i, sets: sets }, extra || {})
const act = (entries, extra) => Object.assign({ id: 'w1', name: 'Push', start: T0 - 600000, unit: 'kg', cur: 0, restSec: 90, count: entries.length, entries: entries }, extra || {})
const snapOf = (active, extra) => Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: {}, active: active, ready: null }, extra || {})
// a watch already holding a workout from the phone
function running (entries, extra, settings, stored) {
  const m = mk(stored)
  K.onPhone(m.c, snapOf(act(entries, extra), { settings: settings || {} }))
  return m
}
const two = () => [ent('a', 0, [{ w: 60, r: 8 }, { w: 60, r: 8 }]), ent('b', 1, [{ w: 20, r: 10 }])]

test('reads the snapshot (the fixture)', () => {
  const m = mk()
  K.onPhone(m.c, clone(fixture))
  assert.equal(m.s.w.id, 'w-1')
  assert.equal(m.s.pos, 0)
  assert.equal(K.setIndex(m.s, 0), 1)
  assert.equal(K.entryIdx(m.s, 1), 1)
  assert.equal(K.hasMore(m.s), false)
  assert.equal(m.s.sy, true)
})

test('a tick sends setDone with the numbers, the rest end and moves on', () => {
  const m = mk()
  K.onPhone(m.c, clone(fixture))
  K.tickSet(m.c, 0, 1, null, 62.5, 7, null, 120)
  const [ev] = m.evs()
  assert.equal(ev.type, 'setDone')
  assert.equal(ev.exId, '0025')
  assert.equal(ev.setIdx, 1)
  assert.equal(ev.w, 62.5)
  assert.equal(ev.r, 7)
  assert.equal(ev.restEnd, T0 + 120000)
  assert.match(ev.id, /^h/)
  assert.equal(m.s.rest, T0 + 120000)
  assert.equal(m.s.pos, 1) // 0025 has no set left
  assert.equal(K.progress(m.s)[0], 2) // the phone's 1 plus this one
})

test('a pending tick shows through an older snapshot', () => {
  const m = mk()
  K.onPhone(m.c, clone(fixture))
  K.tickSet(m.c, 0, 1, null, 62.5, 7, null, 120)
  K.onPhone(m.c, clone(fixture)) // stale: set 1 not done there
  const row = m.s.w.entries[0].sets[1]
  assert.equal(row.done, true)
  assert.equal(row.w, 62.5)
  assert.equal(m.s.pos, 1)
})

test('a workout finished here stays finished against a stale snapshot', () => {
  const m = mk()
  K.onPhone(m.c, clone(fixture))
  K.finishWorkout(m.c, false)
  assert.equal(m.s.w, null)
  assert.deepEqual(m.s.fh, ['w-1'])
  K.onPhone(m.c, clone(fixture))
  assert.equal(m.s.w, null)
})

test('a workout the phone ended gives a summary', () => {
  const m = mk()
  K.onPhone(m.c, clone(fixture))
  const sm = K.onPhone(m.c, snapOf(null))
  assert.equal(sm.ended, true)
  assert.equal(sm.name, 'Push day')
  assert.equal(sm.sets, 1)
  assert.equal(sm.vol, 480)
  assert.equal(m.s.w, null)
  assert.equal(m.c.g.ended, sm)
})

test('discarded on the phone: dropped, no summary', () => {
  const m = mk()
  K.onPhone(m.c, clone(fixture))
  const sm = K.onPhone(m.c, snapOf(null, { discarded: ['w-1'] }))
  assert.equal(sm, null)
  assert.equal(m.s.w, null)
})

test('a workout started here is kept until the phone reports it', () => {
  const m = mk()
  const sm = K.startWorkout(m.c, { name: 'Quick', routineIds: ['r1'], entries: [ent('a', 0, [{ w: 10, r: 5 }])] })
  assert.equal(sm.type, 'start')
  assert.match(sm.wid, /^watch-/)
  assert.deepEqual(sm.routineIds, ['r1'])
  const wid = sm.wid
  assert.equal(K.onPhone(m.c, snapOf(null)), null) // the phone knows nothing yet
  assert.equal(m.s.w.id, wid)
  K.onPhone(m.c, snapOf(act(two(), { id: 'other' })))
  assert.equal(m.s.w.id, wid) // the phone runs another one: ours stays
  K.onPhone(m.c, snapOf(act(two(), { id: wid })))
  assert.equal(m.s.sh, null) // heard back
  assert.equal(m.s.w.entries.length, 2)
})

test('a name-only start waits for the phone (the 10 s asking is in link.test.js)', () => {
  const m = mk()
  K.startWorkout(m.c, { name: 'Pull', routineIds: ['r2'], entries: [], count: 0 })
  assert.equal(K.needsPhone(m.s), true)
  assert.equal(K.entries(m.s).length, 0)
})

test('next goes on, and a skipped set is passed over', () => {
  const m = running(two())
  assert.deepEqual(K.next(m.s, 0, 0), [0, true])
  K.skipSet(m.c)
  assert.equal(K.setIndex(m.s, 0), 1)
  K.skipSet(m.c)
  assert.equal(m.s.pos, 1)
  assert.equal(m.s.sk.length, 2)
})

test('a superset goes round, a rest only after a full round', () => {
  const g = (id, i) => ent(id, i, [{ w: 1, r: 1 }, { w: 1, r: 1 }], { group: 'g1' })
  const m = running([g('a', 0), g('b', 1), ent('c', 2, [{ w: 1, r: 1 }])])
  assert.deepEqual(K.next(m.s, 0, 0), [1, false])
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(m.s.pos, 1)
  assert.equal(m.evs()[0].restEnd, 0) // mid-round: no rest, and it says so
  K.tickSet(m.c, 1, 0, null, 1, 1, null, 60)
  assert.equal(m.s.pos, 0) // a new round
  assert.equal(m.evs()[1].restEnd, T0 + 60000)
  assert.deepEqual(K.partners(m.s, 0), ['b'])
})

test('a per-side set: no rest after the first side, reps add up, one skip skips both', () => {
  const sided = ent('a', 0, [{ w: 20, r: 10, sides: { L: { w: 20, r: 10 }, R: { w: 20, r: 10 } }, sid: 's1' }, { w: 20, r: 10 }])
  const m = running([sided])
  assert.equal(K.sideUp(m.s.w.entries[0].sets[0]), 'L')
  K.tickSet(m.c, 0, 0, 'L', 20, 9, null, 60)
  assert.deepEqual([m.s.pos, m.evs()[0].side, m.evs()[0].restEnd, m.s.rest], [0, 'L', 0, null])
  assert.equal(m.s.w.entries[0].sets[0].done, false)
  assert.ok(m.s.p['s:s1#L'])
  assert.equal(K.sideUp(m.s.w.entries[0].sets[0]), 'R')
  K.tickSet(m.c, 0, 0, 'R', 22.5, 8, null, 60)
  const row = m.s.w.entries[0].sets[0]
  assert.deepEqual([row.done, row.r, row.w], [true, 17, 22.5])
  assert.equal(m.evs()[1].side, 'R')
  assert.equal(m.evs()[1].restEnd, T0 + 60000)
  assert.equal(m.evs()[1].sid, 's1')
  assert.equal(K.setIndex(m.s, 0), 1)
  // skipping a per-side set passes both sides
  const m2 = running([ent('a', 0, [{ sides: { L: {}, R: {} } }, { w: 1, r: 1 }])])
  K.skipSet(m2.c)
  assert.equal(K.setIndex(m2.s, 0), 1)
})

test('a per-side tick is reconciled with the phone side by side', () => {
  const sided = () => ent('a', 0, [{ w: 20, r: 10, sid: 's1', sides: { L: { w: 20, r: 10 }, R: { w: 20, r: 10 } } }])
  const m = running([sided()])
  K.tickSet(m.c, 0, 0, 'L', 20, 9, null, 60)
  K.onPhone(m.c, snapOf(act([sided()]))) // phone has neither side yet: ours replaces its copy
  assert.equal(m.s.w.entries[0].sets[0].sides.L.done, true)
  const phone = sided()
  phone.sets[0].sides.L.done = true
  phone.sets[0].sides.L.r = 9 // the phone applied the watch's numbers
  phone.sets[0].at = T0 + 5000
  K.onPhone(m.c, snapOf(act([phone]))) // now the phone has it: the pending tick goes
  assert.equal(m.s.p['s:s1#L'], undefined)
})

test('a side\'s pending correction waits for that side: a newer change of the other side does not clear it', () => {
  const sided = () => ent('a', 0, [{ w: 20, r: 10, sid: 's1', sides: { L: { w: 20, r: 10 }, R: { w: 20, r: 10 } } }])
  const m = running([sided()])
  K.tickSet(m.c, 0, 0, 'L', 20, 9, null, 60)
  const phone = sided()
  phone.sets[0].sides.L.done = true // the phone's L is still its own 10
  phone.sets[0].sides.R.done = true
  phone.sets[0].at = T0 + 99000 // newer than our tick: the R side's
  K.onPhone(m.c, snapOf(act([phone])))
  assert.ok(m.s.p['s:s1#L'], 'the correction is kept')
  assert.equal(m.s.w.entries[0].sets[0].sides.L.r, 9)
  phone.sets[0].sides.L.r = 9
  K.onPhone(m.c, snapOf(act([phone]))) // the phone shows it now
  assert.equal(m.s.p['s:s1#L'], undefined)
})

test('weights stay on the grid', () => {
  assert.equal(K.stepWeight(60, 2.5, 1), 62.5)
  assert.equal(K.stepWeight(61, 2.5, 1), 62.5)
  assert.equal(K.stepWeight(61, 2.5, -1), 60)
  assert.equal(K.stepWeight(0, 2.5, -1), 0)
  assert.equal(K.stepWeight(62.4999, 2.5, 1), 65)
  assert.equal(K.stepReps(0, -1), 0)
  assert.equal(K.stepReps(998, 5), 999)
  const m = running([ent('a', 0, [{}], { step: 1.25 }), ent('b', 1, [{}])])
  assert.equal(K.stepOf(m.s, m.s.w.entries[0]), 1.25)
  assert.equal(K.stepOf(m.s, m.s.w.entries[1]), 2.5)
  assert.equal(K.stepOf(m.s, { unit: 'lb' }), 5)
})

test('the outbox keeps what the phone has not confirmed', () => {
  const m = mk()
  m.s.ob = ['a', 'b', 'c', 'd'].map(id => K.pack({ id: id, type: 'setDone', at: 1 }))
  m.s.obn = 3
  K.ackOutbox(m.s, ['b', 'zzz'])
  assert.deepEqual(m.evs().map(e => e.id), ['a', 'c', 'd'])
  assert.equal(m.s.obn, 2)
  K.ackOutbox(m.s, ['a', 'c', 'd'])
  assert.deepEqual([m.s.ob.length, m.s.obn], [0, 0])
})

test('place counts work sets and warm-ups apart', () => {
  const e = ent('a', 0, [{ warmup: true }, { warmup: true }, {}, {}, {}])
  assert.deepEqual(K.place(e, 1), [2, 2])
  assert.deepEqual(K.place(e, 3), [2, 3])
  assert.deepEqual(K.planSize([e, ent('x', 1, [])]), [1, 3])
})

test('the set navigation steps through the done sets', () => {
  const m = running([ent('a', 0, [{ done: true, w: 1, r: 1 }, { done: true, w: 2, r: 2 }, {}]), ent('c', 1, [{ done: true }], { mode: 'cardio' }),
    ent('b', 2, [{ sides: { L: { done: true }, R: { done: true } }, done: true }, { sides: { L: { done: true }, R: {} } }])])
  assert.deepEqual(K.fixList(m.s), [[0, 0, null], [0, 1, null], [2, 0, 'L'], [2, 0, 'R'], [2, 1, 'L']])
  m.c.g.fix = null
  K.fixStep(m.c, -1)
  assert.deepEqual(m.c.g.fix.slice(0, 3), ['b', 1, 'L']) // (a 4th place holds the set id when it has one)
  K.fixStep(m.c, -1)
  assert.deepEqual(m.c.g.fix.slice(0, 3), ['b', 0, 'R'])
  K.fixStep(m.c, 1)
  K.fixStep(m.c, 1)
  assert.equal(m.c.g.fix, null) // past the newest: back to the set up now
  assert.equal(K.current(m.c).si, 2)
})

test('a fix is a later setDone without hr and without restEnd, and counts no new set', () => {
  const m = running(two(), { progress: [0, 3] })
  m.c.hr.setSum = 300; m.c.hr.setN = 3; m.c.hr.setMax = 130
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 90)
  const first = m.evs()[0]
  assert.deepEqual(first.hr, { avg: 100, max: 130 })
  assert.equal(K.progress(m.s)[0], 1)
  m.t.now += 5000
  m.c.g.fix = ['a', 0, null]
  K.fixSave(m.c, 62.5, 7)
  const fx = m.evs()[1]
  assert.equal(fx.setIdx, 0)
  assert.equal(fx.w, 62.5)
  assert.equal(fx.r, 7)
  assert.ok(fx.at > first.at)
  assert.equal(fx.hr, undefined)
  assert.equal(fx.restEnd, undefined)
  assert.equal(K.progress(m.s)[0], 1) // still one tick not confirmed
  assert.equal(m.c.g.fix, null)
  // confirmed by the phone, then fixed: still not counted twice
  K.onPhone(m.c, snapOf(act(two(), { progress: [1, 3] })))
  m.s.p = {}
  assert.equal(K.waiting(m.s), 1) // the fix and the tick are one set
  // not done: no event
  m.c.g.fix = ['b', 0, null]
  const n = m.s.ob.length
  K.fixSave(m.c, 1, 1)
  assert.equal(m.s.ob.length, n)
})

test('a fix of a held set sends seconds only, and the weight only if it had one', () => {
  const m = running([ent('a', 0, [{ sec: 30, w: 0, done: true, at: T0 - 5000 }], { mode: 'time' })])
  m.c.g.fix = ['a', 0, null]
  K.fixSave(m.c, 25, 40) // the boxes: weight, seconds
  const ev = m.evs()[0]
  assert.equal(ev.sec, 40)
  assert.equal(ev.r, undefined)
  assert.equal(ev.w, undefined)
})

test('effort rates the set just done and only that', () => {
  const m = running(two(), { progress: [0, 3] }, { effort: 'rir' })
  K.tickSet(m.c, 0, 0, null, 62.5, 8, null, 90)
  assert.equal(K.canRate(m.c), true)
  m.t.now += 2000 // past the 1 s button lock
  K.rate(m.c, 2)
  const ev = m.evs()[1]
  assert.equal(ev.rir, 2)
  assert.equal(ev.w, 62.5)
  assert.equal(ev.hr, undefined)
  assert.equal(ev.rpe, undefined)
  assert.equal(K.progress(m.s)[0], 1)
  assert.equal(m.c.g.rated, 2)
  assert.equal(K.chipLabel('rir', 3), '3+')
  assert.equal(K.chipLabel('rpe', 7), '<8')
  assert.equal(K.chipLabel('rpe', 9), '9')
  assert.deepEqual(K.chips('rpe'), [10, 9, 8, 7])
  assert.deepEqual(K.chips('rir'), [0, 1, 2, 3])
})

test('no effort without the setting, in the lock second, or for a warm-up or cardio', () => {
  const m = running([ent('a', 0, [{ warmup: true, w: 1, r: 1 }, { w: 1, r: 1 }, { w: 1, r: 1 }])], null, { effort: 'rpe' })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(K.canRate(m.c), false) // a warm-up
  K.tickSet(m.c, 0, 1, null, 1, 1, null, 60)
  assert.equal(K.canRate(m.c), true)
  K.rate(m.c, 8) // inside the lock second
  assert.equal(m.s.ob.length, 2)
  const m2 = running(two())
  K.tickSet(m2.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(K.canRate(m2.c), false)
  // cardio, with the setting on and the lock over: only the cardio guard says no
  const m3 = running([ent('c', 0, [{ w: 1, r: 1 }], { mode: 'cardio' })], null, { effort: 'rpe' })
  K.tickSet(m3.c, 0, 0, null, 1, 1, null, 60)
  m3.t.now += 2000
  assert.equal(K.locked(m3.c), false)
  assert.equal(K.canRate(m3.c), false)
  const n = m3.s.ob.length
  K.rate(m3.c, 8)
  assert.equal(m3.s.ob.length, n)
})

test('rest math: -15 floors at a second, then it is a Skip', () => {
  const m = running(two(), { progress: [0, 3] })
  m.s.rest = T0 + 50000
  K.restAdd(m.c, -15)
  assert.equal(m.s.rest, T0 + 35000)
  assert.equal(m.evs()[0].endsAt, T0 + 35000)
  m.s.rest = T0 + 15500 // 0.5 s would remain: a Skip
  K.restAdd(m.c, -15)
  assert.equal(m.s.rest, null)
  assert.equal(m.evs().length, 1) // the Skip took the place of the unsent +/-15
  assert.equal(m.evs()[0].type, 'rest')
  assert.equal(m.evs()[0].endsAt, undefined)
  m.s.rest = T0 + 16000 // exactly 1 s remains
  K.restAdd(m.c, -15)
  assert.equal(m.s.rest, T0 + 1000)
  K.restAdd(m.c, 15)
  assert.equal(m.s.rest, T0 + 16000)
})

test('the rest counts down, buzzes at 10 s and at the end, and sends nothing', () => {
  const m = running(two(), { progress: [0, 3] })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 12)
  const n = m.s.ob.length
  assert.equal(K.restLeft(m.c), 12)
  m.t.now += 2500
  K.second(m.c)
  assert.deepEqual(m.buzzes.slice(-1), [[[50, 150]]])
  m.t.now += 10000
  K.second(m.c)
  assert.equal(m.s.rest, null)
  assert.equal(K.restLeft(m.c), null)
  assert.deepEqual(m.buzzes.slice(-1), [[[100, 400], [0, 200], [100, 400]]])
  assert.equal(m.s.ob.length, n)
})

test('restHaptics off (also as 0) mutes every buzz', () => {
  const m = running(two(), null, { restHaptics: 0 })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(m.buzzes.length, 0)
  const m2 = running(two(), null, {})
  K.tickSet(m2.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(m2.buzzes.length, 1)
})

test('follows the phone\'s rest by its stamp, not its own echo', () => {
  const m = running(two(), { progress: [0, 3] })
  m.t.now = T0
  K.onPhone(m.c, snapOf(act(two(), { restAt: T0 + 100, rest: { endsAt: T0 + 60000, total: 60 } })))
  assert.equal(m.s.rest, T0 + 60000)
  assert.equal(m.c.g.restTotal, 60)
  assert.equal(m.s.ra, T0 + 100)
  // an older stamp is ignored
  K.onPhone(m.c, snapOf(act(two(), { restAt: T0 + 50, rest: { endsAt: T0 + 90000 } })))
  assert.equal(m.s.rest, T0 + 60000)
  // the phone's own end within 250 ms of ours is not restarted
  K.onPhone(m.c, snapOf(act(two(), { restAt: T0 + 200, rest: { endsAt: T0 + 60200 } })))
  assert.equal(m.s.rest, T0 + 60000)
  // paused on the phone: held
  K.onPhone(m.c, snapOf(act(two(), { restAt: T0 + 300, restPaused: true, restLeft: 42 })))
  assert.deepEqual([m.s.rest, m.s.rh, K.restPaused(m.c), K.restLeft(m.c)], [null, 42, true, 42])
  // ended on the phone: like a Skip here, nothing sent
  K.onPhone(m.c, snapOf(act(two(), { restAt: T0 + 400 })))
  assert.deepEqual([m.s.rest, m.s.rh, m.c.rx], [null, null, false])
  assert.equal(m.s.ob.length, 0)
})

test('a rest without a stamp is ignored (the fixture)', () => {
  const m = mk()
  K.onPhone(m.c, clone(fixture))
  assert.equal(m.s.rest, null)
})

test('the watch\'s own rest end is not followed back, and our changes are newer', () => {
  const m = running(two(), { progress: [0, 3] })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  const ra = m.s.ra
  assert.equal(ra, T0)
  K.onPhone(m.c, snapOf(act(two(), { restAt: T0 - 1, rest: { endsAt: T0 + 5000 } }))) // the phone's earlier rest
  assert.equal(m.s.rest, T0 + 60000)
  K.restAdd(m.c, 15) // same millisecond as the tick
  assert.ok(m.s.ra > ra)
  assert.equal(m.evs().slice(-1)[0].at, T0 + 1) // stamped after the tick that started it
})

test('only the newest rest change waits to be sent', () => {
  const m = running(two(), { progress: [0, 3] })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  K.restAdd(m.c, 15)
  K.restAdd(m.c, 15)
  K.tickSet(m.c, 0, 1, null, 1, 1, null, 60)
  assert.deepEqual(m.evs().map(e => e.type), ['setDone', 'setDone'])
  K.restAdd(m.c, 15)
  K.restAdd(m.c, 15)
  assert.deepEqual(m.evs().map(e => e.type), ['setDone', 'setDone', 'rest'])
})

test('the clock offset is the smallest recent sample, else the newest', () => {
  const m = mk()
  const snap = (now, extra) => snapOf(null, Object.assign({ now: now }, extra))
  for (let i = 0; i < 10; i++) { m.t.now += 10000; K.onPhone(m.c, snap(m.t.now - 90000 - i * 1000)) }
  assert.equal(m.s.ck.length, 8)
  assert.equal(K.off(m.c), 92000) // the smallest of what the last 5 min say (the first two samples fell out of the 8)
  m.t.now += 3600000
  assert.equal(K.off(m.c), 99000) // none recent: the newest sample
  const m2 = mk()
  assert.equal(K.off(m2.c), 0)
  K.onPhone(m2.c, snapOf(null, { now: 0 }))
  assert.equal(m2.s.ck.length, 0)
})

test('a tick carries its set id, the offset, and the rest end; the row keeps the phone clock', () => {
  const m = running([ent('a', 0, [{ w: 60, r: 8, sid: 'sx' }])], null, null)
  m.s.ck = [[T0, 2300]]
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 90)
  const ev = m.evs()[0]
  assert.equal(ev.sid, 'sx')
  assert.equal(ev.off, 2300)
  assert.equal(ev.at, T0)
  assert.equal(m.s.w.entries[0].sets[0].at, T0 - 2300)
  assert.deepEqual(m.s.p['s:sx'], [60, 8, T0 - 2300, null])
  assert.equal(m.s.ra, T0 - 2300)
  assert.equal(ev.restEnd, 0) // the last set: no rest, and the event says so
  assert.equal(m.s.rest, null)
})

test('a pending tick by place moves to the set id when the phone gives one', () => {
  const m = running([ent('a', 0, [{ w: 1, r: 1 }, { w: 1, r: 1 }])])
  K.tickSet(m.c, 0, 0, null, 5, 5, null, 60)
  assert.ok(m.s.p['e0:a#0'])
  K.onPhone(m.c, snapOf(act([ent('a', 0, [{ w: 1, r: 1, sid: 'q1' }, { w: 1, r: 1, sid: 'q2' }])])))
  assert.deepEqual(Object.keys(m.s.p), ['s:q1'])
  assert.equal(m.s.w.entries[0].sets[0].w, 5)
})

test('the phone ticking a set moves the watch on', () => {
  const m = running([ent('a', 0, [{ sid: 's1' }, { sid: 's2' }]), ent('b', 1, [{ sid: 's3' }])])
  K.onPhone(m.c, snapOf(act([ent('a', 0, [{ sid: 's1', done: true, at: T0 + 10 }, { sid: 's2', done: true, at: T0 + 20 }]), ent('b', 1, [{ sid: 's3' }])])))
  assert.equal(m.s.pos, 1)
  assert.deepEqual(m.c.g.last.slice(0, 3), ['a', 1, null])
})

test('a snapshot behind a drain does not jump the watch back', () => {
  const m = running([ent('a', 0, [{ sid: 's1' }]), ent('b', 1, [{ sid: 's2' }, { sid: 's3' }])])
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60) // on to b
  assert.equal(m.s.pos, 1)
  K.onPhone(m.c, snapOf(act([ent('a', 0, [{ sid: 's1' }])], { cur: 0, count: 2 }))) // window without b
  assert.equal(m.s.w.entries.length, 2) // the watch keeps its own exercises
  assert.equal(m.s.pos, 1)
})

test('at the end of the window the watch waits for the phone, and knows it', () => {
  const m = running([ent('a', 0, [{ w: 1, r: 1 }])], { count: 3 })
  assert.equal(K.hasMore(m.s), true)
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(m.s.pos, 1)
  assert.equal(K.needsPhone(m.s), true)
  assert.equal(m.evs()[0].restEnd, T0 + 60000) // more to come: a rest
  const m2 = running([ent('a', 0, [{ w: 1, r: 1 }])])
  K.tickSet(m2.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(K.needsPhone(m2.s), false)
  assert.equal(m2.c.g.page, 'over')
  assert.equal(m2.s.rest, null)
})

test('the rest falls back from the exercise to the workout to the phone default', () => {
  const m = running([ent('a', 0, [{}, {}, {}, {}])], { restSec: 75 })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 30)
  K.tickSet(m.c, 0, 1, null, 1, 1, null, null)
  K.tickSet(m.c, 0, 2, null, 1, 1, null, 0)
  assert.deepEqual(m.evs().map(e => e.restEnd - e.at), [30000, 75000, 75000])
  const m2 = running([ent('a', 0, [{}, {}])], { restSec: 0 })
  K.tickSet(m2.c, 0, 0, null, 1, 1, null, null)
  assert.equal(m2.evs()[0].restEnd - m2.evs()[0].at, 90000)
})

test('waiting counts a set once, however often it is fixed or rated', () => {
  const m = mk()
  const sd = (si, extra) => Object.assign({ id: 'x' + si + (extra ? 'y' : ''), type: 'setDone', wid: 'w1', exId: 'a', setIdx: si, at: 1 }, extra)
  m.s.ob = [sd(0), sd(0, { rir: 2 }), sd(1), K.pack({ id: 'f', type: 'finish', at: 1 })].map(e => (Array.isArray(e) ? e : K.pack(e)))
  assert.equal(K.waiting(m.s), 2)
  assert.equal(K.waiting(mk().s), 0)
})

test('events pack small and read back the same', () => {
  const ev = { id: 'h1', type: 'setDone', at: 1000, wid: 'w', exId: 'a', entryIdx: 2, setIdx: 1, w: 60, r: 8, sid: 's1', restEnd: 91000, off: 5, hr: { avg: 100, max: 120 }, rir: 2 }
  const p = K.pack(ev)
  assert.deepEqual(p.slice(0, 9), ['h1', 'setDone', 1000, 'w', 'a', 2, 1, 60, 8])
  assert.equal(p[9], -11) // hr is index 11: pairs from place 9 on
  assert.deepEqual(K.unpack(p), ev)
  assert.equal(K.evField(p, 16), 90000) // restEnd waits as ms after `at`
  assert.equal(K.evField(p, 4), 'a')
  const rest = K.pack({ id: 'r', type: 'rest', wid: 'w', at: 5, endsAt: null })
  assert.deepEqual(K.unpack(rest), { id: 'r', type: 'rest', wid: 'w', at: 5 }) // null left out
  assert.deepEqual(K.unpack(K.pack({ id: 'z', type: 'setDone', at: 9, restEnd: 0 })), { id: 'z', type: 'setDone', at: 9, restEnd: 0 })
  assert.deepEqual(K.pack({ id: 'x', type: 'hello', at: 3 }), ['x', 'hello', 3])
  const dict = { id: 'd', type: 'hello', at: 1 }
  assert.equal(K.unpack(dict), dict) // an older store: plain dictionaries
})

test('the outbox makes room: grows to HARD with none sent, never drops the start', () => {
  const m = mk()
  m.s.ob = [K.pack({ id: 's', type: 'start', at: 1 })]
  for (let i = 0; i < K.HARD + 10; i++) K.send(m.c, { id: 'e' + i, type: 'setDone', at: 2 + i })
  assert.equal(m.s.ob.length, K.HARD)
  assert.equal(K.evField(m.s.ob[0], 0), 's')
  assert.equal(K.evField(m.s.ob[1], 0), 'e11') // the oldest non-start went
  // some sent: the oldest sent one goes and obn follows
  const m2 = mk()
  for (let i = 0; i < K.MAX; i++) m2.s.ob.push(K.pack({ id: 'o' + i, type: 'setDone', at: 1 }))
  m2.s.obn = 10
  K.send(m2.c, { id: 'new', type: 'setDone', at: 2 })
  assert.equal(m2.s.ob.length, K.MAX)
  assert.equal(m2.s.obn, 9)
  assert.equal(K.evField(m2.s.ob[0], 0), 'o1')
})

test('a hold: the 3-2-1, then it runs, then it logs the target seconds on its own set', () => {
  const m = running([ent('a', 0, [{ sec: 30, w: 0 }, { sec: 30 }], { mode: 'time', restSec: 45 })], { progress: [0, 2] })
  assert.equal(K.pressDone(m.c, 0, 30), 'hold')
  assert.equal(m.c.g.hcd, T0)
  assert.equal(K.countNumber(0), 3)
  assert.equal(K.countNumber(2500), 1)
  assert.equal(K.countNumber(3000), 0)
  m.t.now += 3000; K.second(m.c)
  assert.equal(m.c.g.hold, null) // "Go!" still up
  m.t.now += 800; K.second(m.c)
  assert.deepEqual(m.c.g.hold, [T0 + 3800, 30])
  m.t.now += 27500; K.second(m.c)
  assert.equal(m.s.ob.length, 0) // 27 s held
  assert.equal(K.held(m.c), 27)
  m.t.now += 3000; K.second(m.c)
  const ev = m.evs()[0]
  assert.equal(ev.sec, 30)
  assert.equal(ev.r, undefined)
  assert.equal(ev.w, undefined) // no weight on the row
  assert.equal(ev.restEnd, ev.at + 45000)
  assert.equal(m.c.g.hold, null)
})

test('stopping a hold early logs the seconds held; Finish mid-hold logs it too', () => {
  const m = running([ent('a', 0, [{ sec: 30, w: 20 }], { mode: 'time' })])
  K.holdCount(m.c, 30)
  m.t.now += 3800; K.second(m.c)
  m.t.now += 12400
  K.holdStop(m.c)
  assert.equal(m.evs()[0].sec, 12)
  assert.equal(m.evs()[0].w, 20)
  const m2 = running([ent('a', 0, [{ sec: 30 }], { mode: 'time' })])
  K.holdCount(m2.c, null)
  m2.t.now += 3800; K.second(m2.c)
  m2.t.now += 400
  K.finishWorkout(m2.c, false)
  assert.deepEqual(m2.evs().map(e => [e.type, e.sec]), [['setDone', 1], ['finish', undefined]])
})

test('a hold whose set the phone logged first ends unlogged (#1403)', () => {
  const mkTimed = done => [ent('a', 0, [{ sec: 30, sid: 'h1', done: done, at: T0 + 10 }, { sec: 30, sid: 'h2' }], { mode: 'time' })]
  const m = running(mkTimed(false))
  K.holdCount(m.c, 30)
  m.t.now += 3800; K.second(m.c)
  assert.ok(m.c.g.hold)
  K.onPhone(m.c, snapOf(act(mkTimed(true)))) // the phone's own hold ended first
  assert.equal(m.c.g.hold, null)
  assert.equal(m.c.g.hfor, null)
  assert.equal(m.s.ob.length, 0)
  // a hold the watch ends later has nothing to log either
  const m2 = running(mkTimed(false))
  K.holdCount(m2.c, 30)
  m2.t.now += 3800; K.second(m2.c)
  m2.s.w.entries[0].sets[0].done = true
  m2.t.now += 31000; K.second(m2.c)
  assert.equal(m2.s.ob.length, 0)
})

test('a hold on the up-next side of a per-side set logs that side', () => {
  const m = running([ent('a', 0, [{ sec: 20, sid: 'p', sides: { L: { done: true }, R: {} } }], { mode: 'time' })])
  assert.equal(K.setIndex(m.s, 0), 0)
  K.holdCount(m.c, 20)
  assert.equal(m.c.g.hfor[1], 'R')
  m.t.now += 3800; K.second(m.c)
  m.t.now += 21000; K.second(m.c)
  assert.equal(m.evs()[0].side, 'R')
  assert.equal(m.evs()[0].sec, 20)
})

test('auto holds start after the rest only when the phone says so', () => {
  const entries = () => [ent('a', 0, [{ w: 1, r: 1 }]), ent('t', 1, [{ sec: 20 }], { mode: 'time' })]
  const m = running(entries(), { progress: [0, 2] }, { autoHolds: true })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 5)
  assert.equal(m.s.pos, 1)
  m.t.now += 6000; K.second(m.c) // rest out
  assert.equal(m.c.g.hcd, T0 + 6000)
  const m2 = running(entries(), { progress: [0, 2] }, {})
  K.tickSet(m2.c, 0, 0, null, 1, 1, null, 5)
  m2.t.now += 6000; K.second(m2.c)
  assert.equal(m2.c.g.hcd, null)
})

test('a rest the phone shortened to a time already past ends like a skip: the auto hold starts', () => {
  const entries = () => [ent('a', 0, [{ w: 1, r: 1 }]), ent('t', 1, [{ sec: 20 }], { mode: 'time' })]
  const m = running(entries(), { progress: [0, 2] }, { autoHolds: true })
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  assert.ok(m.s.rest > T0)
  m.t.now += 5000
  K.onPhone(m.c, snapOf(act(entries(), { restAt: T0 + 5000, rest: { endsAt: T0 + 1000 } }), { settings: { autoHolds: true } }))
  assert.equal(m.s.rest, null)
  assert.equal(m.c.g.hcd, T0 + 5000)
  // a paused rest is not an end
  const m2 = running(entries(), { progress: [0, 2] }, { autoHolds: true })
  K.tickSet(m2.c, 0, 0, null, 1, 1, null, 60)
  K.onPhone(m2.c, snapOf(act(entries(), { restAt: T0 + 100, restPaused: true, restLeft: 30 })))
  assert.deepEqual([m2.s.rh, m2.c.g.hcd], [30, null])
})

test('a skipped per-side set is left for the next exercise, not kept on screen for its open side', () => {
  const m = running([ent('a', 0, [{ w: 5, r: 5, sid: 'u', sides: { L: {}, R: {} } }]), ent('b', 1, [{ w: 1, r: 1 }])])
  assert.equal(m.s.pos, 0)
  K.skipSet(m.c)
  assert.equal(m.s.pos, 1)
  // without a skip the other side stays up after the first
  const m2 = running([ent('a', 0, [{ w: 5, r: 5, sid: 'u', sides: { L: {}, R: {} } }]), ent('b', 1, [{ w: 1, r: 1 }])])
  K.tickSet(m2.c, 0, 0, 'L', 5, 5, null, 30)
  assert.equal(m2.s.pos, 0)
})

test('the set count adds a warm-up never, and a per-side set once when both sides are done', () => {
  const sided = () => ent('a', 0, [{ warmup: true, w: 20, r: 5 }, { w: 5, r: 5, sid: 'u', sides: { L: {}, R: {} } }, { w: 5, r: 5 }])
  const m = running([sided()], { progress: [0, 2] })
  K.tickSet(m.c, 0, 0, null, 20, 5, null, 0) // the warm-up
  assert.equal(K.progress(m.s)[0], 0)
  K.tickSet(m.c, 0, 1, 'L', 5, 5, null, 0)
  assert.equal(K.progress(m.s)[0], 0) // one side of two
  K.tickSet(m.c, 0, 1, 'R', 5, 5, null, 0)
  assert.equal(K.progress(m.s)[0], 1)
  K.tickSet(m.c, 0, 2, null, 5, 5, null, 0)
  assert.deepEqual(K.progress(m.s), [2, 2])
})

test('Still training compares the phone\'s times on the phone\'s clock: a watch 30 minutes ahead is not idle', () => {
  const ahead = 30 * 60000
  const m = running(two(), { activeAt: T0 - ahead - 60000 }, {}) // the phone's clock: a minute ago
  m.s.ck = [[T0, ahead]]
  for (let i = 0; i < 10; i++) K.second(m.c)
  assert.equal(m.c.g.ask, false)
  m.t.now += 21 * 60000
  for (let i = 0; i < 10; i++) K.second(m.c)
  assert.equal(m.c.g.ask, true)
  // the snooze is the watch's own clock: keep going waits another 20 minutes, not a shifted one
  K.keepGoing(m.c, false)
  m.t.now += 19 * 60000
  for (let i = 0; i < 10; i++) K.second(m.c)
  assert.equal(m.c.g.ask, false)
})

test('a snapshot of another workout drops the old one\'s Still training prompt and snooze', () => {
  const m = running(two(), { activeAt: T0 - 21 * 60000 }, {})
  for (let i = 0; i < 10; i++) K.second(m.c)
  assert.equal(m.c.g.ask, true)
  K.keepGoing(m.c, false)
  assert.notEqual(m.c.g.snooze, null)
  m.c.g.ask = true
  K.onPhone(m.c, snapOf(act(two(), { id: 'w2', activeAt: T0 })))
  assert.deepEqual([m.s.w.id, m.c.g.ask, m.c.g.askLeft, m.c.g.snooze], ['w2', false, false, null])
})

test('cardio is logged on the phone: Done on it just moves on, sends nothing', () => {
  const m = running([ent('c', 0, [{ r: 10 }], { mode: 'cardio' }), ent('b', 1, [{ w: 1, r: 1 }])])
  m.s.pos = 0 // (the phone's own up-now would be b: cardio is last)
  assert.equal(K.pressDone(m.c, 0, 10), 'next')
  assert.equal(m.s.pos, 1)
  assert.equal(m.s.ob.length, 0)
  assert.deepEqual(K.progress(m.s), [0, 2])
  assert.equal(K.pressDone(m.c, 1, 1), 'tick')
  m.s.w.entries[0].sets[0].done = true // logged on the phone
  m.s.pos = 2 // the end page
  assert.equal(K.pressDone(m.c, 1, 1), 'confirmFinish')
  assert.equal(K.pressDone(mk().c, 1, 1), 'none')
})

test('Still training: when it asks and when it stops', () => {
  const now = 100 * 60000
  assert.equal(K.asks(now - 60000, null, now, null), false)
  assert.equal(K.asks(now - 20 * 60000, null, now, null), true)
  assert.equal(K.asks(now - 20 * 60000, now - 60000, now, null), false)
  assert.equal(K.asks(null, null, now, null), false)
  assert.equal(K.asks(now - 20 * 60000, null, now, 30), false)
  assert.equal(K.asks(now - 30 * 60000, null, now, 30), true)
  assert.equal(K.asks(now - 999 * 60000, null, now, 0), false)
  assert.equal(K.lastSet({ start: 5, activeAt: 7, entries: [{ sets: [{ at: 9 }, { at: 3 }] }] }), 9)
  assert.equal(K.lastSet({ start: 5 }), 5)
})

test('Still training asks after the quiet time, keep going tells the phone, finish tells nothing', () => {
  const m = running(two(), { activeAt: T0 - 21 * 60000 }, {})
  for (let i = 0; i < 9; i++) K.second(m.c)
  assert.equal(m.c.g.ask, false) // checked every 10th second
  K.second(m.c)
  assert.equal(m.c.g.ask, true)
  assert.equal(m.c.g.askLeft, false)
  assert.equal(m.c.g.page, 'set')
  assert.deepEqual(m.buzzes.slice(-1), [[[60, 300]]])
  K.keepGoing(m.c, true)
  const ev = m.evs()[0]
  assert.deepEqual([ev.type, ev.wid, ev.at], ['stillHere', 'w1', T0])
  assert.equal(m.c.g.ask, false)
  for (let i = 0; i < 20; i++) K.second(m.c)
  assert.equal(m.c.g.ask, false) // snoozed
  m.t.now += 20 * 60000
  for (let i = 0; i < 10; i++) K.second(m.c)
  assert.equal(m.c.g.ask, true)
  K.keepGoing(m.c, false) // "Finish workout": no event
  assert.equal(m.s.ob.length, 1)
})

test('Still training at once when the phone says the lifter left the gym, never when paused', () => {
  const m = running(two(), { activeAt: T0, leftGymAt: T0 - 1000 }, {})
  for (let i = 0; i < 10; i++) K.second(m.c)
  assert.deepEqual([m.c.g.ask, m.c.g.askLeft], [true, true])
  const m2 = running(two(), { activeAt: T0 - 99 * 60000, pausedAt: T0 - 1000 }, {})
  for (let i = 0; i < 10; i++) K.second(m2.c)
  assert.equal(m2.c.g.ask, false)
  const m3 = running(two(), { activeAt: T0 - 99 * 60000 }, { askMin: 0 })
  for (let i = 0; i < 10; i++) K.second(m3.c)
  assert.equal(m3.c.g.ask, false)
  const m4 = running(two(), { activeAt: T0 - 99 * 60000 }, {})
  m4.c.g.hold = [T0, 30] // never mid-hold
  for (let i = 0; i < 10; i++) K.second(m4.c)
  assert.equal(m4.c.g.ask, false)
})

test('a set ticked clears Still training', () => {
  const m = running(two(), { activeAt: T0 - 21 * 60000 }, {})
  for (let i = 0; i < 10; i++) K.second(m.c)
  assert.equal(m.c.g.ask, true)
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(m.c.g.ask, false)
})

test('booleans arrive as 1 or 0 on some platforms', () => {
  const m = running([ent('a', 0, [{ done: 1 }, { warmup: 1 }, { w: 1, r: 1 }])], null, { autoHolds: 1, restHaptics: 1 })
  assert.equal(K.setIndex(m.s, 0), 1)
  assert.deepEqual(K.place(m.s.w.entries[0], 1), [1, 1])
  K.tickSet(m.c, 0, 1, null, 1, 1, null, 60)
  assert.equal(m.buzzes.length, 1) // 1 is not off
})

test('summary: sets, volume with unit conversion, the phone\'s totals when larger, no warm-ups', () => {
  const m = running([
    ent('a', 0, [{ w: 100, r: 5, done: true }, { w: 50, r: 5, done: true, warmup: true }]),
    ent('b', 1, [{ w: 220.46226218, r: 1, done: true }], { unit: 'lb' }),
    ent('t', 2, [{ sec: 30, done: true, w: 5, r: 5 }], { mode: 'time' })
  ], { progress: [3, 6], volume: 100 })
  const sm = K.summary(m.c, m.s.w, false)
  assert.equal(sm.sets, 3)
  assert.ok(Math.abs(sm.vol - 600) < 0.001)
  assert.equal(sm.dur, 600)
  assert.equal(sm.unit, 'kg')
  const sm2 = K.summary(m.c, Object.assign({}, m.s.w, { progress: [9, 12], volume: 5000 }), true)
  assert.deepEqual([sm2.sets, sm2.vol, sm2.ended], [9, 5000, true])
})

test('finishing sends finish (or discard) and keeps the last 5 ids', () => {
  const m = running(two())
  m.s.fh = ['1', '2', '3', '4', '5']
  const sm = K.finishWorkout(m.c, false)
  assert.deepEqual(m.s.fh, ['2', '3', '4', '5', 'w1'])
  assert.equal(m.evs()[0].type, 'finish')
  assert.equal(m.c.g.ended, sm)
  assert.equal(m.s.w, null)
  const m2 = running(two())
  assert.equal(K.finishWorkout(m2.c, true), null)
  assert.equal(m2.evs()[0].type, 'discard')
  assert.equal(m2.c.g.ended, null)
  assert.equal(K.finishWorkout(m2.c, false), null) // nothing running
})

test('the heart rate of a set is its average since the last set, rest end or hold start', () => {
  const m = running(two(), { progress: [0, 3] })
  ;[100, 110, 120].forEach(b => K.hrSample(m.c, b))
  K.hrSample(m.c, 0) // no reading
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  const sets = () => m.evs().filter(e => e.type === 'setDone') // (the rest's heart rate rides in setHr events)
  assert.deepEqual(sets()[0].hr, { avg: 110, max: 120 })
  K.hrSample(m.c, 90)
  K.tickSet(m.c, 0, 1, null, 1, 1, null, 60)
  assert.deepEqual(sets()[1].hr, { avg: 90, max: 90 })
  K.tickSet(m.c, 1, 0, null, 1, 1, null, 60)
  assert.equal(sets()[2].hr, undefined)
  assert.deepEqual(K.hrTotals(m.c), [105, 120])
  assert.equal(K.hrTotals(m.c), null)
})

test('state and outbox survive a restart through the stored copy', () => {
  const m = running(two(), { progress: [0, 3] })
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 90)
  const stored = m.saved()
  const m2 = mk(stored)
  assert.equal(m2.s.w.id, 'w1')
  assert.equal(m2.s.ob.length, 1)
  assert.equal(m2.s.rest, T0 + 90000)
  assert.equal(K.waiting(m2.s), 1)
  assert.equal(K.normalize({ ob: [1], obn: 5 }).obn, 1)
  assert.deepEqual(K.normalize(null), K.emptyState())
})

test('smaller details: unit of an exercise, ids unique per tick', () => {
  const m = running(two())
  assert.equal(K.unitOf(m.s, { unit: 'lb' }), 'lb')
  assert.equal(K.unitOf(m.s, {}), 'kg')
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60)
  K.tickSet(m.c, 0, 1, null, 1, 1, null, 60)
  const ids = m.evs().map(e => e.id)
  assert.notEqual(ids[0], ids[1])
})

/* ---------- review fixes ---------- */
const pk = (id, type, extra) => K.pack(Object.assign({ id: id, type: type, at: 1 }, extra || {}))

test('a full outbox gives up a rest change first, then a correction, then the oldest set; the start stays', () => {
  const mkFull = () => {
    const m = mk()
    m.s.ob = [pk('start', 'start')]
    for (let i = 0; i < K.MAX - 1; i++) m.s.ob.push(pk('o' + i, 'setDone', { wid: 'w', exId: 'e' + i, setIdx: 0 }))
    m.s.obn = 20 // sent, none of them named by the phone
    return m
  }
  const ids = m => m.s.ob.map(e => K.evField(e, 0))
  const m = mkFull()
  m.s.ob[30] = pk('rest1', 'rest', { wid: 'w' })
  K.send(m.c, { id: 'new', type: 'setDone', at: 2 })
  assert.equal(ids(m).indexOf('rest1'), -1)
  assert.equal(ids(m)[0], 'start')
  assert.equal(m.s.ob.length, K.MAX)
  assert.equal(m.s.obn, 20) // the dropped one was after the sent mark
  const m2 = mkFull()
  m2.s.ob[6] = pk('fixed', 'setDone', { wid: 'w', exId: 'e4', setIdx: 0, rir: 2 }) // an effort of the set before it
  K.send(m2.c, { id: 'new', type: 'setDone', at: 2 })
  assert.equal(ids(m2).indexOf('fixed'), -1)
  assert.ok(ids(m2).indexOf('o0') >= 0)
  const m3 = mkFull()
  K.send(m3.c, { id: 'new', type: 'setDone', at: 2 })
  assert.deepEqual([ids(m3)[0], ids(m3)[1], m3.s.obn], ['start', 'o1', 19]) // oldest SET went, mark follows
  assert.equal(ids(m3).indexOf('o0'), -1)
})

test('a full outbox of nothing but start and finish still lets one go, never the start first', () => {
  const m = mk()
  m.s.ob = [pk('s', 'start')]
  for (let i = 0; i < K.MAX - 1; i++) m.s.ob.push(pk('f' + i, 'finish', { wid: 'w' + i }))
  m.s.obn = 5
  K.send(m.c, { id: 'n', type: 'finish', wid: 'z', at: 2 })
  assert.equal(K.evField(m.s.ob[0], 0), 's')
  assert.equal(m.s.ob.length, K.MAX)
})

test('the sent mark moves only over events that really went out: a superseded rest in flight', () => {
  const m = running(two(), { progress: [0, 3] })
  m.s.rest = T0 + 50000
  K.restSkip(m.c) // a rest event goes out
  assert.equal(m.sent.length, 1)
  const out = m.t.l
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 90) // its restEnd supersedes the rest event still in flight
  assert.deepEqual(m.evs().map(e => e.type), ['setDone'])
  out.onComplete()
  assert.equal(m.s.obn, 0) // the set was never transmitted
  assert.equal(m.sent.length, 2) // so it goes now
  assert.equal(m.sent[1].events[0].type, 'setDone')
})

test('the sent mark: events acked while in flight do not push it over unsent ones', () => {
  const m = mk()
  for (let i = 0; i < 6; i++) m.s.ob.push(pk('e' + i, 'setDone', { wid: 'w', exId: 'x', setIdx: i }))
  K.flush(m.c)
  assert.deepEqual(m.sent[0].events.map(e => e.id), ['e0', 'e1', 'e2', 'e3'])
  const out = m.t.l
  K.ackOutbox(m.s, ['e0', 'e1', 'e2', 'e3'])
  out.onComplete()
  assert.equal(m.s.obn, 0)
  assert.deepEqual(m.sent[1].events.map(e => e.id), ['e4', 'e5'])
})

test('Done on a set being fixed saves the fix and logs no new tick', () => {
  const m = running(two(), { progress: [0, 3] })
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 90)
  const rest = m.s.rest
  K.fixLast(m.c)
  assert.equal(K.current(m.c).fixing, true)
  m.t.now += 2000
  assert.equal(K.pressDone(m.c, 65, 8), 'fix')
  const evs = m.evs()
  assert.equal(evs.length, 2)
  assert.equal(evs[1].w, 65)
  assert.equal(evs[1].restEnd, undefined)
  assert.equal(evs[1].hr, undefined)
  assert.equal(m.s.rest, rest)
  assert.equal(m.c.g.fix, null)
})

test('numbers from the page reach the event only as finite numbers', () => {
  const m = running(two(), { progress: [0, 3] })
  K.tickSet(m.c, 0, 0, null, '62.5', NaN, 'x', '90')
  const ev = m.evs()[0]
  assert.equal(ev.w, undefined)
  assert.equal(ev.r, undefined)
  assert.equal(ev.sec, undefined)
  assert.equal(ev.restEnd, ev.at + 90000) // '90' is read as the number it is not: the default rest applies
  K.tickSet(m.c, 0, 1, null, 60, Infinity, null, null)
  assert.equal(m.evs()[1].r, undefined)
  assert.ok(m.evs().every(e => ['w', 'r', 'sec', 'restEnd'].every(k => e[k] === undefined || typeof e[k] === 'number')))
})

test('a radio that throws does not leave the link busy or the action half done', () => {
  const m = running(two(), { progress: [0, 3] })
  m.c.env.radio = { transmit: () => { throw new Error('radio gone') } }
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 90)
  assert.equal(m.c.link.busy, false)
  assert.equal(m.s.ob.length, 1) // stored for the retry
  assert.equal(m.buzzes.length, 1) // the action ran to its end
  assert.ok(m.c.g.awayAt > 0)
  assert.equal(K.hello(m.c), true)
  assert.equal(m.c.link.busy, false)
})

test('a fix is dropped when the phone unticked its set, and Save then buzzes nothing', () => {
  const m = running(two(), { progress: [0, 3] })
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 90)
  K.fixLast(m.c)
  m.s.w.entries[0].sets[0].done = false // unticked on the phone
  assert.equal(K.current(m.c).fixing, false)
  assert.equal(m.c.g.fix, null)
  const m2 = running(two(), { progress: [0, 3] })
  m2.c.g.fix = ['a', 0, null]
  K.fixSave(m2.c, 1, 1)
  assert.equal(m2.buzzes.length, 0)
})

test('start, finish, discard and stillHere carry the clock offset like sets do', () => {
  const m = running(two(), { activeAt: T0 - 21 * 60000 }, {})
  m.s.ck = [[T0, 90000]]
  K.keepGoing(m.c, false)
  m.c.g.ask = true
  K.keepGoing(m.c, true)
  K.finishWorkout(m.c, false)
  K.startWorkout(m.c, { name: 'x', routineIds: [], entries: [ent('a', 0, [{}])] })
  K.finishWorkout(m.c, true)
  assert.deepEqual(m.evs().map(e => [e.type, e.off]), [['stillHere', 90000], ['finish', 90000], ['start', 90000], ['discard', 90000]])
  const m2 = running(two())
  K.finishWorkout(m2.c, false)
  assert.equal(m2.evs()[0].off, undefined) // no offset known: none sent
})

test('the 3-2-1 before a hold buzzes each number and Go, and starts the hold at 3.7 s', () => {
  const m = running([ent('a', 0, [{ sec: 30 }], { mode: 'time' })])
  K.holdCount(m.c, 30)
  const at = ms => { m.t.now = T0 + ms; K.countTick(m.c) }
  at(0); at(100); at(1000); at(2000); at(3000)
  assert.deepEqual(m.buzzes, [[[30, 40]], [[30, 40]], [[30, 40]], [[100, 250]]])
  at(3600)
  assert.equal(m.c.g.hold, null)
  at(3700)
  assert.deepEqual(m.c.g.hold, [T0 + 3700, 30])
  assert.equal(m.c.g.hcd, null)
})

test('durations use env.tick() when there is one: the wall clock set back changes nothing', () => {
  const m = running([ent('a', 0, [{ sec: 30 }], { mode: 'time' })])
  let tick = 5000
  m.c.env.tick = () => tick
  K.holdCount(m.c, 30)
  tick += 3800; K.countTick(m.c)
  assert.deepEqual(m.c.g.hold, [8800, 30])
  m.t.now -= 3600000 // the watch's clock is set back an hour
  tick += 12000
  assert.equal(K.held(m.c), 12)
  K.holdStop(m.c)
  assert.equal(m.evs()[0].sec, 12)
  K.tickSet(m.c, 0, 0, null, 1, 1, null, 60) // (a set already done: nothing) lock is monotonic too
  const m2 = running(two())
  m2.c.env.tick = () => tick
  K.tickSet(m2.c, 0, 0, null, 1, 1, null, 60)
  assert.equal(K.locked(m2.c), true)
  m2.t.now += 5000
  assert.equal(K.locked(m2.c), true) // the wall clock does not count
  tick += 1001
  assert.equal(K.locked(m2.c), false)
})

test('a transmit left hanging is given up after 45 s, also when the clock goes back; a late callback is ignored', () => {
  const m = mk()
  K.hello(m.c)
  const late = m.t.l
  m.t.now += 44000; K.second(m.c)
  assert.equal(m.c.link.busy, true)
  m.t.now += 2000; K.second(m.c)
  assert.equal(m.c.link.busy, false)
  const gen = m.c.link.gen
  K.send(m.c, { id: 'x', type: 'setDone', at: 1 })
  late.onComplete() // the old message's callback must not mark the new one sent
  assert.equal(m.s.obn, 0)
  assert.equal(m.c.link.gen, gen + 1)
  const m2 = mk()
  K.hello(m2.c)
  m2.t.now -= 3600000; K.second(m2.c)
  assert.equal(m2.c.link.busy, false)
})

/* ======================================================================================
 * Step 1 of the parity work: the whole-workout snapshot (since replaced by lib/garmin-snapshot.js), the new events,
 * heart rate, weigh-in, check-in, add / remove a set, the note.
 * ==================================================================================== */
const sid = (id, n) => id + n
// a workout of exercises with set ids; entries[i].i = i (the whole-workout snapshot)
const wex = (id, i, n, extra) => ent(id, i, Array.apply(null, Array(n)).map((_, j) => ({ w: 50, r: 8, sid: sid(id, j) })), extra)
const whole4 = () => [wex('a', 0, 2), wex('b', 1, 2), wex('c', 2, 2), wex('d', 3, 2)]
const windowOf = (all, from, to, count) => all.slice(from, to + 1)
const snapWith = (active, settings, extra) => Object.assign({ v: 1, unit: 'kg', restSec: 90, settings: settings || {}, active: active, ready: null }, extra || {})

test('1: a whole-workout snapshot has no window: nothing more to come, every exercise there', () => {
  const m = running(whole4(), { cur: 1 })
  assert.equal(K.hasMore(m.s), false)
  assert.equal(K.needsPhone(m.s), false)
  assert.equal(m.s.pos, 1) // the phone's exercise up now
  K.tickSet(m.c, 1, 0, null, 50, 8, null, 60)
  K.tickSet(m.c, 1, 1, null, 50, 8, null, 60)
  assert.equal(m.s.pos, 2)
  K.tickSet(m.c, 2, 0, null, 50, 8, null, 60)
  K.tickSet(m.c, 2, 1, null, 50, 8, null, 60)
  assert.equal(m.s.pos, 3)
  K.tickSet(m.c, 3, 0, null, 50, 8, null, 60)
  K.tickSet(m.c, 3, 1, null, 50, 8, null, 60)
  assert.equal(m.s.pos, 0) // on to the first exercise still open
  assert.equal(m.evs().slice(-1)[0].restEnd, T0 + 60000) // a still has sets: a rest
})

test('1: the exercise up now is the first one with a set to do from the phone\'s cur on', () => {
  const all = whole4()
  all[1].sets.forEach(r => { r.done = true; r.at = T0 - 1000 })
  const m = running(all, { cur: 1 })
  assert.equal(m.s.pos, 2) // b is done: c is up
  const m2 = running(whole4().map((e, i) => (i === 3 ? Object.assign(e, { mode: 'cardio' }) : e)), { cur: 3 })
  assert.equal(m2.s.pos, 3) // cardio up on the phone: the watch says to log it there
  const done = whole4(); done.forEach(e => e.sets.forEach(r => { r.done = true; r.at = T0 - 5 }))
  assert.equal(running(done, { cur: 2 }).s.pos, 2) // nothing left anywhere: where the phone is
})

test('1: the phone moving to another exercise moves the watch along in a whole workout too', () => {
  const m = running(whole4(), { cur: 0 })
  K.onPhone(m.c, snapWith(act(whole4(), { cur: 2 })))
  assert.equal(m.s.pos, 2)
  K.onPhone(m.c, snapWith(act(whole4(), { cur: 2 }))) // the same again: stays
  assert.equal(m.s.pos, 2)
})

test('1: a window and a whole workout read the same: the same exercise on screen', () => {
  const all = whole4()
  const win = running(all.slice(1, 3), { cur: 1, count: 4 })
  assert.equal(K.hasMore(win.s), true)
  assert.equal(win.s.pos, 0) // b, the first of the window
  assert.equal(K.entryIdx(win.s, 0), 1)
  const full = running(whole4(), { cur: 1 })
  assert.equal(K.entryAt(full.s, full.s.pos).id, K.entryAt(win.s, win.s.pos).id)
  K.tickSet(win.c, 0, 0, null, 50, 8, null, 60)
  K.tickSet(full.c, 1, 0, null, 50, 8, null, 60)
  assert.equal(win.evs()[0].entryIdx, full.evs()[0].entryIdx)
  assert.equal(win.evs()[0].sid, full.evs()[0].sid)
})

test('1: whole to window mid-workout: position, pending ticks, skipped sets stay; a fix on an exercise that left the window goes', () => {
  const m = running(whole4(), { cur: 1 })
  K.tickSet(m.c, 1, 0, null, 51, 8, null, 60) // pending tick on b
  K.skipSet(m.c) // skips b's second set
  assert.equal(m.s.pos, 2) // on to c
  m.c.g.fix = ['b', 0, null]
  assert.equal(K.current(m.c).fixing, true)
  // the phone has not applied the tick; its window is c and d, count 4
  K.onPhone(m.c, snapWith(act(whole4().slice(2, 4), { cur: 2, count: 4 })))
  assert.equal(K.entryAt(m.s, m.s.pos).id, 'c')
  assert.equal(K.setIndex(m.s, m.s.pos), 0)
  assert.equal(K.current(m.c).fixing, false) // b is not in the window any more: no fix to show
  assert.equal(m.c.g.fix, null)
  // and back to the whole workout: b's skip is still known, its tick still pending over the phone's older row
  K.onPhone(m.c, snapWith(act(whole4(), { cur: 2 })))
  assert.equal(K.entryAt(m.s, m.s.pos).id, 'c')
  assert.equal(K.setIndex(m.s, 1), null) // b: set 0 done by the pending tick, set 1 skipped
  assert.equal(m.s.w.entries[1].sets[0].done, true)
  assert.equal(m.s.w.entries[1].sets[0].w, 51)
})

test('1: window to whole keeps the exercise on screen, also when an exercise is in the workout twice', () => {
  // the two copies have set ids of their own, so an event can only come from the one it was ticked on
  const twice = () => { const a = [wex('x', 0, 2), wex('y', 1, 1), wex('x', 2, 2)]; a[2].sets.forEach((r, j) => { r.sid = 'z' + j }); return a }
  const m = running(twice().slice(2), { cur: 2, count: 3 })
  assert.equal(m.s.pos, 0)
  assert.equal(K.entryIdx(m.s, 0), 2)
  K.onPhone(m.c, snapWith(act(twice(), { cur: 2, count: 3 })))
  assert.equal(K.entryIdx(m.s, m.s.pos), 2) // the second x, not the first
  K.tickSet(m.c, m.s.pos, 0, null, 50, 8, null, 60)
  assert.equal(m.evs()[0].entryIdx, 2)
  assert.equal(m.evs()[0].sid, 'z0')
  assert.equal(m.s.w.entries[2].sets[0].done, true)
  assert.notEqual(m.s.w.entries[0].sets[0].done, true) // the first copy is untouched
  // whole to a window of the second x again: still the second x
  K.onPhone(m.c, snapWith(act(twice().slice(1), { cur: 2, count: 3 })))
  assert.equal(K.entryIdx(m.s, m.s.pos), 2)
})

test('1: the phone\'s settings come through; nothing of its language is kept', () => {
  const m = mk()
  K.onPhone(m.c, snapWith(act(two()), { lang: 'de', lastBw: 80.5, forgotten: { graceMin: 5, leaveGym: true }, show: { hr: true } }))
  assert.equal(m.s.set.lastBw, 80.5)
  assert.equal(m.s.set.forgotten.graceMin, 5)
  assert.equal(m.s.pl, undefined)
})

test('1: skipped sets are known by their set id: two copies of one exercise skip apart', () => {
  const twice = [wex('x', 0, 2), wex('x', 1, 2)]
  twice[1].sets.forEach((r, j) => { r.sid = 'y' + j })
  const m = running(twice, { cur: 0 })
  K.skipSet(m.c) // x copy 0, set 0
  assert.equal(K.setIndex(m.s, 0), 1)
  assert.equal(K.setIndex(m.s, 1), 0) // the other copy is untouched
  assert.ok(m.s.sk.length === 1 && m.s.sk[0] === 's:x0')
  // an old store with index keys still works
  const old = running([ent('a', 0, [{ w: 1, r: 1 }, { w: 1, r: 1 }])], null, null, null)
  old.s.sk = ['a#0']
  assert.equal(K.setIndex(old.s, 0), 1)
})

/* ---------- 2: the outbox format ---------- */
test('2: a stored outbox in the old layout is read as before and sent unchanged', () => {
  const oldSetDone = ['h1-1-5', 'setDone', 1000, 'w1', 'a', 2, 1, 60, 8, -11, [100, 120], -15, 's1', -16, 90000, -18, 5]
  const oldRest = ['h1-2-5', 'rest', 2000, 'w1']
  const oldRestEnd = ['h1-3-5', 'rest', 3000, 'w1', null, null, null, null, null, -17, 63000]
  const stored = Object.assign(K.emptyState(), { w: act(two()), ob: [oldSetDone, oldRest, oldRestEnd], obn: 1 })
  const m = mk(stored)
  assert.deepEqual(K.unpack(m.s.ob[0]), { id: 'h1-1-5', type: 'setDone', at: 1000, wid: 'w1', exId: 'a', entryIdx: 2, setIdx: 1, w: 60, r: 8, hr: { avg: 100, max: 120 }, sid: 's1', restEnd: 91000, off: 5 })
  assert.deepEqual(K.unpack(m.s.ob[1]), { id: 'h1-2-5', type: 'rest', at: 2000, wid: 'w1' })
  assert.equal(K.unpack(m.s.ob[2]).endsAt, 63000)
  K.flush(m.c) // from obn: the second and third go as they were
  assert.deepEqual(m.sent[0].events.map(e => e.id), ['h1-2-5', 'h1-3-5'])
  // and the same events packed now make the same arrays
  assert.deepEqual(K.pack(K.unpack(oldSetDone)), oldSetDone)
  assert.deepEqual(K.pack(K.unpack(oldRestEnd)), oldRestEnd)
  // the old indices are unchanged
  assert.deepEqual(K.EV_KEYS.slice(0, 19), ['id', 'type', 'at', 'wid', 'exId', 'entryIdx', 'setIdx', 'w', 'r', 'sec', 'side', 'hr', 'rir', 'rpe', 'routineIds', 'sid', 'restEnd', 'endsAt', 'off'])
})

test('2: the new events pack small and read back the same', () => {
  const evs = [
    { id: 'h1', type: 'watchStatus', at: 5, version: '0.1.0' },
    { id: 'h6', type: 'start', at: 5, wid: 'watch-5', routineIds: ['r'] },
    { id: 'h3', type: 'setHr', at: 5, wid: 'w', exId: 'a', entryIdx: 1, setIdx: 2, restHr: { avg: 90, max: 99 } } // an outbox an older watch stored
  ]
  evs.forEach(ev => assert.deepEqual(K.unpack(K.pack(ev)), ev, ev.type))
  assert.equal(K.evField(K.pack(evs[2]), 19).length, 2)
  assert.ok(K.EV_KEYS.indexOf('restHr') > 18)
  assert.deepEqual(['bw', 'sleep', 'energy', 'sore', 'note'].filter(k => K.EV_KEYS.indexOf(k) >= 0), []) // no check-in, weigh-in or note here
})

/* ---------- 3: watchStatus ---------- */
test('3: watchStatus at launch carries the version; not again soon, again on a new version or after 6 hours', () => {
  const m = mk()
  m.c.env.version = '0.1.0'
  K.launch(m.c)
  const ev = m.evs()[0]
  assert.deepEqual(Object.keys(ev).sort(), ['at', 'id', 'type', 'version'])
  assert.deepEqual([ev.type, ev.version, ev.at], ['watchStatus', '0.1.0', T0])
  assert.equal(K.watchStatus(m.c), null)
  m.t.now += 5 * 3600000
  assert.equal(K.watchStatus(m.c), null)
  m.t.now += 3600000
  assert.equal(K.watchStatus(m.c).type, 'watchStatus')
  assert.equal(m.evs().length, 1) // only the newest waits
  m.c.env.version = '0.2.0'
  assert.equal(K.watchStatus(m.c).version, '0.2.0')
  m.t.now -= 7 * 86400000 // the clock went back: asked again
  assert.ok(K.watchStatus(m.c))
  // the state is saved: a restart does not send it again
  const m2 = mk(m.saved())
  m2.t.now = m.t.now
  m2.c.env.version = '0.2.0'
  K.launch(m2.c)
  assert.equal(m2.evs().filter(e => e.type === 'watchStatus').length, 1)
  const m3 = mk()
  K.launch(m3.c) // no version in env: nothing to say
  assert.equal(m3.evs().length, 0)
})

test('3: watchStatus carries the clock offset like the other events, and is dropped first when the outbox is full', () => {
  const m = mk()
  m.c.env.version = '1'
  m.s.ck = [[T0, 4000]]
  K.watchStatus(m.c)
  assert.equal(m.evs()[0].off, 4000)
  const m2 = mk()
  m2.s.ob = [pk('s1', 'watchStatus')]
  m2.s.obn = 1
  for (let i = 0; i < K.MAX - 1; i++) m2.s.ob.push(pk('o' + i, 'setDone', { wid: 'w', exId: 'e' + i, setIdx: 0 }))
  K.send(m2.c, { id: 'new', type: 'setDone', at: 2 })
  assert.equal(K.evField(m2.s.ob[0], 0), 'o0')
  assert.equal(m2.s.ob.length, K.MAX)
})

/* ---------- 4: heart rate ---------- */
const beat = (m, at, bpm) => { m.t.now = T0 + at; K.hrSample(m.c, bpm) }
const hrEvs = m => m.evs().filter(e => e.type === 'setHr')
const sidWorkout = () => [ent('a', 0, [{ w: 60, r: 8, sid: 'p1' }, { w: 60, r: 8, sid: 'p2' }, { w: 60, r: 8, sid: 'p3' }]), ent('b', 1, [{ w: 20, r: 10, sid: 'q1' }])]
const phoneDid = (m, marks, extra) => {
  const es = sidWorkout()
  marks.forEach(mk2 => { Object.assign(es[mk2[0]].sets[mk2[1]], { done: true, at: mk2[2] }) })
  K.onPhone(m.c, snapWith(act(es, extra || {})))
}

test('4: a reading outside 25..250 is no reading; the sums give the average and the maximum so far', () => {
  const m = running(sidWorkout())
  beat(m, 1000, 100); beat(m, 2000, 24); beat(m, 3000, 251); beat(m, 4000, 110); beat(m, 6500, 120)
  assert.deepEqual(K.hrSoFar(m.c), [110, 120])
  assert.equal(K.hrSoFar(mk().c), null)
  assert.equal(m.c.g.bpm, 120)
  assert.deepEqual(K.hrTotals(m.c), [110, 120]) // and the finish takes them and starts over
  assert.equal(K.hrSoFar(m.c), null)
})

test('4: the workout\'s heart-rate sums start over when the phone swaps in another workout, or a workout starts', () => {
  const m = running(sidWorkout())
  beat(m, 1000, 100); beat(m, 2000, 140)
  assert.deepEqual(K.hrSoFar(m.c), [120, 140])
  K.onPhone(m.c, snapWith(act(sidWorkout(), { id: 'w2' })))
  assert.equal(K.hrSoFar(m.c), null)
  beat(m, 3000, 90)
  assert.deepEqual(K.hrSoFar(m.c), [90, 90])
  m.c.s.w = null
  K.startWorkout(m.c, { name: 'Quick', routineIds: [], entries: [ent('a', 0, [{ w: 10, r: 5 }])] })
  assert.equal(K.hrSoFar(m.c), null)
})

test('4: a set the watch ticked itself gets no setHr when the phone\'s snapshot shows it', () => {
  const m = running(sidWorkout())
  beat(m, 1000, 100)
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 0)
  m.t.now = T0 + 2000
  phoneDid(m, [[0, 0, T0 + 1000]])
  assert.equal(hrEvs(m).length, 0)
})

test('4: the sensor may rest after 3 hours with nothing happening, never during a rest or a hold, and wakes on the next action', () => {
  const m = running(sidWorkout(), { start: T0 - 4 * 3600000 })
  assert.equal(K.sensorShouldRest(m.c), false) // the app was just opened
  m.t.now = T0 + 3 * 3600000 - 1000
  assert.equal(K.sensorShouldRest(m.c), false)
  m.t.now = T0 + 3 * 3600000
  assert.equal(K.sensorShouldRest(m.c), true)
  m.s.rest = m.t.now + 60000
  assert.equal(K.sensorShouldRest(m.c), false)
  m.s.rest = null
  m.c.g.hold = [m.t.now, 30]
  assert.equal(K.sensorShouldRest(m.c), false)
  m.c.g.hold = null
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 0)
  assert.equal(K.sensorShouldRest(m.c), false)
  assert.equal(K.sensorShouldRest(mk().c), false) // no workout
  // a set the phone ticked 1 h ago counts as activity too (rows carry the phone's time)
  const m2 = running(sidWorkout().map((e, i) => (i ? e : Object.assign(e, { sets: e.sets.map((r, j) => (j ? r : Object.assign(r, { done: true, at: T0 + 2 * 3600000 }))) }))), { start: T0 - 9 * 3600000 })
  m2.t.now = T0 + 4 * 3600000
  assert.equal(K.sensorShouldRest(m2.c), false)
  m2.t.now = T0 + 5 * 3600000
  assert.equal(K.sensorShouldRest(m2.c), true)
})

/* ---------- 5: weigh-in and check-in before a start ---------- */
const session = () => ({ name: 'Push', routineIds: ['r1'], entries: [ent('a', 0, [{ w: 60, r: 8 }])] })
const DAY = (() => { const d = new Date(T0); const p = n => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
const withSettings = (settings, stored) => { const m = mk(stored); K.onPhone(m.c, snapWith(null, settings)); return m }

/* ---------- 6: add and remove a set (phone: addWatchSet / removeWatchSet) ---------- */
const SIDOK = /^[A-Za-z0-9_-]{1,40}$/ // the phone's sidOk
const editEvs = m => m.evs().filter(e => e.type === 'addSet' || e.type === 'removeSet')
const rowsOf = (m, pos) => m.s.w.entries[pos].sets
// what a phone that applied the edit(s) shows: the same workout with them done, `acked` naming them
const phoneAdd = (es, pos, sidNew, w, r) => { es[pos].sets.push({ w: w, r: r, sid: sidNew }); return es }

/* ---------- 7 and 8: the note, supersets in the overview ---------- */
test('8: supersetStart tells the Overview where a superset heading goes', () => {
  const g = (id, i, group) => ent(id, i, [{}], group ? { group: group } : {})
  const m = running([g('a', 0), g('b', 1, 'g1'), g('c', 2, 'g1'), g('d', 3, 'g1'), g('e', 4, 'g2'), g('f', 5)])
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => K.supersetStart(m.s, i)), [false, true, false, false, false, false]) // g2 is a group of one
  assert.equal(K.supersetStart(m.s, 9), false)
})

/* ======================================================================================
 * Review of step 1: the outbox order, set ids, rest heart rate, safe removal, the up counter, stop.
 * ==================================================================================== */
const sdEv = (id, sid, extra) => pk(id, 'setDone', Object.assign({ wid: 'w', exId: 'a', setIdx: 0, sid: sid }, extra || {}))

test('R1: a full outbox gives up the least valuable first, a logged set nearly last, a start last', () => {
  const s = K.emptyState()
  s.ob = [
    pk('start', 'start', { wid: 'w' }),
    sdEv('setX', 'x1'),
    sdEv('setY', 'y2', { setIdx: 1 }),
    pk('ws', 'watchStatus'),
    pk('rest', 'rest', { wid: 'w' }),
    pk('still', 'stillHere', { wid: 'w' }),
    pk('other', 'someNewKind', { wid: 'w' }),
    sdEv('fixX', 'x1', { rir: 2 }), // a correction of setX
    pk('fin', 'finish', { wid: 'w' })
  ]
  s.obn = 1
  const dropped = []
  while (s.ob.length > 1) { const before = s.ob.map(e => K.evField(e, 0)); K.room(s, 0, 0); const after = s.ob.map(e => K.evField(e, 0)); dropped.push(before.filter(x => after.indexOf(x) < 0)[0]) }
  assert.deepEqual(dropped, ['ws', 'rest', 'still', 'fixX', 'setX', 'setY', 'other', 'fin'])
  assert.equal(K.evField(s.ob[0], 0), 'start')
})

test('the outbox is the Garmin\'s size: 60 events, 90 when nothing has been sent', () => {
  assert.deepEqual([K.MAX, K.HARD], [60, 90])
  const m = mk()
  for (let i = 0; i < 100; i++) K.send(m.c, { id: 'e' + i, type: 'setDone', wid: 'w', exId: 'a', setIdx: i, sid: 'q' + i, at: i + 1 })
  assert.equal(m.s.ob.length, K.HARD) // nothing was sent (the radio never answers)
  assert.equal(K.evField(m.s.ob[0], 0), 'e10') // the oldest went
})

test('R2: a set is told from its fix by its set id, not by its row number, after rows were removed', () => {
  const rows = () => [{ w: 1, r: 1, sid: 'a0' }, { w: 1, r: 1, sid: 'a1' }, { w: 1, r: 1, sid: 'a2' }]
  const m = running([ent('a', 0, rows())], { progress: [0, 3] })
  K.tickSet(m.c, 0, 1, null, 50, 5, null, 0) // a1, row 1
  K.onPhone(m.c, snapWith(act([ent('a', 0, rows().slice(1))], { progress: [0, 2] }))) // a0 is taken out on the phone: a1 is row 0, a2 row 1
  K.tickSet(m.c, 0, 1, null, 50, 5, null, 0) // a2 says row 1 too
  assert.equal(K.waiting(m.s), 2)
  // a fix of a1 now says row 0: one set, not a second
  m.c.g.fix = ['a', 0, null, 'a1']
  m.t.now += 2000
  K.fixSave(m.c, 55, 5)
  assert.equal(K.waiting(m.s), 2)
  // a fix without ids still goes by the place
  const old = mk()
  old.s.ob = [pk('p', 'setDone', { wid: 'w', exId: 'a', setIdx: 1 }), pk('q', 'setDone', { wid: 'w', exId: 'a', setIdx: 1, rir: 1 })]
  assert.equal(K.waiting(old.s), 1)
})

test('R2: with a full outbox the newest real set is not taken for a fix after a removal', () => {
  const s = K.emptyState()
  s.ob = [sdEv('a1', 'a1', { setIdx: 1 }), sdEv('a2', 'a2', { setIdx: 1 })] // same row number, other sets
  assert.equal(K.waiting(s), 2)
  s.obn = 1
  K.room(s, 0, 0)
  assert.deepEqual(s.ob.map(e => K.evField(e, 0)), ['a2']) // the oldest set goes, not "the fix"
})

test('R5: a counter says when the set up may have changed: every snapshot that changes it', () => {
  const m = running(sidWorkout(), { progress: [0, 4] })
  const r0 = m.c.g.up
  assert.equal(typeof r0, 'number')
  K.onPhone(m.c, snapWith(act(sidWorkout(), { progress: [0, 4] }))) // nothing changed
  assert.equal(m.c.g.up, r0)
  const es = sidWorkout(); es[0].sets[0].done = true; es[0].sets[0].at = T0 + 5
  K.onPhone(m.c, snapWith(act(es, { progress: [1, 4] }))) // the phone ticked the set up
  assert.ok(m.c.g.up > r0)
  const r1 = m.c.g.up
  K.onPhone(m.c, snapWith(act(es, { progress: [1, 4] })))
  assert.equal(m.c.g.up, r1)
})

test('R7: a core that was replaced can be switched off: late callbacks save and send nothing', () => {
  const m = running(sidWorkout(), { progress: [0, 4] })
  K.tickSet(m.c, 0, 0, null, 60, 8, null, 0)
  const l = m.t.l
  const sentBefore = m.sent.length
  m.c.env.save = () => { throw new Error('saved by a stopped core') }
  K.stop(m.c)
  l.onComplete()
  l.onError()
  K.second(m.c)
  K.onPhone(m.c, snapWith(act(sidWorkout())))
  K.send(m.c, { id: 'x', type: 'rest', at: 1 })
  K.launch(m.c)
  assert.equal(m.sent.length, sentBefore)
  assert.equal(m.c.link.busy, true) // nothing was touched
})

test('R9: lockFor puts the 1 s lock on the clock locked() reads', () => {
  const m = running(two())
  let tick = 5000
  m.c.env.tick = () => tick
  K.lockFor(m.c, 1000)
  assert.equal(K.locked(m.c), true)
  m.t.now += 5000 // the wall clock does not count
  assert.equal(K.locked(m.c), true)
  tick += 1001
  assert.equal(K.locked(m.c), false)
})

/* ======================================================================================
 * Step 2: records collected as the workout goes (the medal), effort, muscles, streak, reach, small ones.
 * ==================================================================================== */
const brow = (w, r, sec) => ({ w: w, r: r, sec: sec })
const withBest = (id, i, name, best, sets, extra) => Object.assign({ id: id, name: name, i: i, best: best, sets: sets.map((r, j) => Object.assign({ sid: id + j }, r)) }, extra || {})
const sixEntries = () => [
  withBest('b', 0, 'Bench', { w: 100, r: 5 }, [brow(102.5, 3), brow(105, 2), brow(100, 6)]),
  withBest('r', 1, 'Row', { w: 70, r: 8 }, [brow(70, 9), brow(70, 10), brow(60, 15)]),
  withBest('d', 2, 'Assisted dip', { w: 25, r: 8 }, [brow(20, 8), brow(15, 6)], { assisted: true }),
  withBest('p', 3, 'Plank', { sec: 60 }, [brow(null, null, 75), brow(null, null, 70)], { mode: 'time' }),
  withBest('c', 4, 'Curl', { w: 30, r: 10 }, [brow(35, 8)], { unit: 'lb' }),
  withBest('n', 5, 'Squat', { w: 140, r: 5 }, [brow(140, 5)])
]
const tickAll = m => m.s.w.entries.forEach((e, pos) => e.sets.forEach((r, si) => K.tickSet(m.c, pos, si, null, r.w, r.r, r.sec, 0)))

test('summary: the time is the Metrics time: it stands at the pause and reads the phone start on the watch\'s clock', () => {
  const m = running(sixEntries().slice(0, 1), { start: T0 - 1800000, pausedAt: T0 - 1200000 }) // started 30 min ago, paused 20 min ago
  assert.equal(K.summary(m.c, m.s.w, false).dur, 600)
  delete m.s.w.pausedAt
  m.s.ck = [[T0, 90000]] // the watch's clock is 90 s ahead of the phone's
  assert.equal(K.summary(m.c, m.s.w, false).dur, 1800 - 90)
  m.s.w.start = null
  assert.equal(K.summary(m.c, m.s.w, false).dur, null)
})

test('finish haptic: one short buzz, none with restHaptics off; the phone ending it buzzes too', () => {
  const p = running(two(), { cur: 0 })
  p.buzzes.length = 0
  K.finishWorkout(p.c, false)
  assert.deepEqual(p.buzzes, [[[40, 60]]])
  const q = running(sixEntries().slice(0, 1), { cur: 0 }, { restHaptics: false })
  tickAll(q)
  q.buzzes.length = 0
  K.finishWorkout(q.c, false)
  assert.deepEqual(q.buzzes, [])
  const e = running(sixEntries().slice(0, 1), { cur: 0 })
  tickAll(e)
  e.buzzes.length = 0
  K.onPhone(e.c, snapWith(null))
  assert.deepEqual(e.buzzes, [[[40, 60]]])
})
