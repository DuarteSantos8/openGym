// The wire protocol with both ends in code: the phone's real snapshot (frontend/src/lib/garmin-snapshot.js)
// and a small phone page that applies events the way lib/watch-sync.js does, against this watch's
// core, over a fake radio that can drop messages, fail, or never call back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { garminSnapshot, GARMIN_MAX_BYTES } from '../../frontend/src/lib/garmin-snapshot.js'
import * as K from '../entry/src/main/js/MainAbility/common/core.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T0 = Date.UTC(2026, 10, 11, 9, 0, 0)
const syncSource = readFileSync(new URL('../../frontend/src/lib/watch-sync.js', import.meta.url), 'utf8')
const fixture = JSON.parse(readFileSync(new URL('../../frontend/garmin/test/snapshot.json', import.meta.url), 'utf8'))
// GarminMessages.toMonkey: the bridge leaves nulls out
const strip = v => (Array.isArray(v) ? v.filter(x => x != null).map(strip)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, strip(x)])) : v)

const routine = () => [
  { id: '0025', name: 'Bench', mode: 'reps', sets: [{ w: 60, r: 8 }, { w: 60, r: 8 }, { w: 60, r: 8 }] },
  { id: '0001', name: 'Sit-up', mode: 'reps', sets: [{ w: 20, r: 10 }, { w: 20, r: 10 }] },
  { id: '0003', name: 'Curl', mode: 'reps', sets: [{ w: 10, r: 12 }, { w: 10, r: 12 }] }
]
const newActive = (id, start) => ({ id: id, name: 'Push', start: start, unit: 'kg', cur: 0, restSec: 90, entries: routine().map((e, i) => Object.assign(e, { sets: e.sets.map((r, j) => Object.assign(r, { sid: 's' + i + j })) })) })

// The world: the phone page, the radio between, and the watch. Nothing moves except in step().
function world (skew) {
  const w = {
    t: T0, skew: skew || 0,
    inRange: true, alive: true, swallow: 0, loseSnapshots: 0, huawei: false, settings: {}, weighIns: [], forms: [], statuses: [], starts: [],
    pending: [], toWatch: [], transmits: [],
    A: null, workouts: [], discarded: [], acked: [], applied: {}, applyCount: {}, restEvents: [], stillHere: 0,
    watch: null
  }
  w.phoneNow = () => w.t
  const ready = () => ({ today: { routineIds: ['r1'], name: 'Push', entries: routine() }, others: [] })
  w.snapshot = () => {
    const input = { unit: 'kg', restSec: 90, settings: clone(w.settings), streak: null, discarded: w.discarded, acked: w.acked, now: w.phoneNow(), active: clone(w.A), ready: ready() }
    const snap = garminSnapshot(input)
    assert.ok(new TextEncoder().encode(JSON.stringify(snap)).length <= GARMIN_MAX_BYTES)
    return strip(snap)
  }
  w.send = () => { if (w.inRange && w.alive) w.queue.push(w.snapshot()) }
  w.queue = []
  const rowOf = ev => {
    if (!w.A) return null
    for (const e of w.A.entries) { const r = e.sets.find(x => x.sid === ev.sid); if (r) return r }
    const e = w.A.entries[ev.entryIdx]
    return e && e.id === ev.exId ? e.sets[ev.setIdx] : null
  }
  // lib/watch-sync.js applyEach, in short
  const apply = ev => {
    const off = Number.isFinite(ev.off) && Math.abs(ev.off) <= 12 * 3600000 ? ev.off : 0
    const at = ev.at - off
    if (ev.type === 'start') { if (!w.A) w.A = newActive(ev.wid, at) } else if (ev.type === 'setDone') {
      const row = rowOf(ev)
      if (!row) return
      if (row.done && row.at > at) return
      Object.assign(row, { done: true, at: at }, ev.w != null ? { w: ev.w } : {}, ev.r != null ? { r: ev.r } : {}, ev.sec != null ? { sec: ev.sec } : {}, ev.rir != null ? { rir: ev.rir } : {})
    } else if (ev.type === 'start') { /* (above) */ } else if (ev.type === 'addSet' || ev.type === 'removeSet') {
      // lib/watch-sync.js addWatchSet / removeWatchSet, as quoted in core.js
      if (!w.A || (ev.wid && ev.wid !== w.A.id)) return
      if (ev.type === 'addSet') {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(ev.sid || '') || w.A.entries.some(e => e.sets.some(r => r.sid === ev.sid))) return
        const e = w.A.entries[ev.entryIdx] && w.A.entries[ev.entryIdx].id === ev.exId ? w.A.entries[ev.entryIdx] : w.A.entries.find(x => x.id === ev.exId)
        if (!e || e.sets.length >= 100) return
        const last = e.sets[e.sets.length - 1]
        const row = { w: last.w, r: last.r, sid: ev.sid }
        if (ev.w != null) row.w = ev.w
        if (ev.r != null) row.r = ev.r
        e.sets.push(row)
      } else {
        for (const e of w.A.entries) {
          const j = e.sets.findIndex(r => r.sid === ev.sid)
          if (j >= 0 && !e.sets[j].done && e.sets.length > 1) e.sets.splice(j, 1)
        }
      }
    } else if (ev.type === 'setHr') {
      const row = rowOf(ev)
      const ok = v => v && v.avg >= 25 && v.max <= 250 && v.max >= v.avg && Number.isInteger(v.avg) && Number.isInteger(v.max)
      if (row && ok(ev.hr)) row.hr = ev.hr
      if (row && ok(ev.restHr)) row.restHr = ev.restHr
    } else if (ev.type === 'weighIn') { if (ev.w > 0 && ev.w < 700) w.weighIns.push(ev.w) } else if (ev.type === 'dailyForm') w.forms.push(ev)
    else if (ev.type === 'watchStatus') w.statuses.push(ev)
    else if (ev.type === 'finish') { w.workouts.push(w.A); w.A = null } else if (ev.type === 'discard') { w.discarded.push(w.A.id); w.A = null } else if (ev.type === 'rest') w.restEvents.push(ev)
    else if (ev.type === 'stillHere') w.stillHere += 1
  }
  w.onMessage = msg => {
    const evs = msg.events.filter(e => e && typeof e.id === 'string')
    assert.ok(evs.length <= K.BATCH)
    if (evs.some(e => e.type === 'hello')) w.send()
    let any = false
    for (const ev of evs) {
      if (ev.type === 'hello') continue
      w.applyCount[ev.id] = (w.applyCount[ev.id] || 0) + (w.applied[ev.id] ? 0 : 1)
      if (!w.applied[ev.id]) { w.applied[ev.id] = true; apply(ev) }
      w.acked = w.acked.filter(x => x !== ev.id).concat([ev.id]).slice(-16) // duplicates are acked again
      any = true
    }
    if (any) w.send()
  }
  const radio = {
    transmit (msg, l) {
      w.transmits.push(clone(msg))
      if (w.swallow > 0) { w.swallow -= 1; return }
      w.pending.push({ msg: clone(msg), l: l })
    }
  }
  const stored = { s: null }
  const env = () => ({ radio: radio, now: () => w.t + w.skew, random: Math.random, save: s => { stored.s = clone(s) } })
  w.stored = () => clone(stored.s)
  w.newWatch = st => { w.watch = K.createCore(env(), st); K.launch(w.watch); return w.watch }
  // deliver what is on the way, until nothing moves
  w.settle = () => {
    for (let n = 0; n < 50 && (w.pending.length || w.queue.length); n++) {
      while (w.pending.length) {
        const p = w.pending.shift()
        if (!w.inRange) p.l.onError()
        else { p.l.onComplete(); if (w.alive) w.onMessage(p.msg) }
      }
      while (w.queue.length) {
        const snap = w.queue.shift()
        if (w.loseSnapshots > 0) { w.loseSnapshots -= 1; continue }
        w.toWatch.push(snap)
        K.onPhone(w.watch, clone(snap))
      }
    }
  }
  w.run = sec => { for (let i = 0; i < sec; i++) { w.t += 1000; K.second(w.watch); w.settle() } }
  return w
}
const startOnPhone = w => { w.A = newActive('w-phone', w.phoneNow() - 60000); w.send() }

test('hello gets the latest snapshot, and a hello is never queued for the phone', () => {
  const w = world()
  w.newWatch()
  w.settle()
  assert.equal(w.transmits[0].events[0].type, 'hello')
  assert.equal(w.watch.s.sy, true)
  assert.equal(w.watch.s.rd.today.name, 'Push')
  assert.deepEqual(w.watch.s.rd.today.entries.map(e => e.id), ['0025', '0001', '0003'])
  assert.equal(w.watch.link.ask, false)
  assert.equal(Object.keys(w.applied).length, 0)
  assert.equal(JSON.stringify(w.toWatch).includes('null'), false)
})

test('a silent phone is asked again at a minute, two, four... and never stormed', () => {
  const w = world()
  w.alive = false
  w.newWatch()
  w.run(5)
  assert.equal(w.transmits.length, 1)
  w.run(60)
  assert.equal(w.transmits.length, 2)
  w.run(60)
  assert.equal(w.transmits.length, 2)
  w.run(65)
  assert.equal(w.transmits.length, 3)
  w.alive = true
  w.send()
  w.run(3)
  assert.equal(w.watch.s.sy, true)
  const n = w.transmits.length
  w.run(600)
  assert.equal(w.transmits.length, n) // answered: no more asking
})

test('a watch out of range: the hello fails and is tried again', () => {
  const w = world()
  w.inRange = false
  w.newWatch()
  w.run(70)
  assert.equal(w.watch.link.busy, false)
  assert.ok(w.watch.g.awayAt > 0)
  w.inRange = true
  w.run(130)
  assert.equal(w.watch.s.sy, true)
  assert.equal(w.watch.g.awayAt, null)
})

test('a set logged with the phone away is sent again until `acked` names it', () => {
  const w = world()
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  assert.equal(w.watch.s.w.id, 'w-phone')
  w.inRange = false
  K.tickSet(w.watch, 0, 0, null, 62.5, 7, null, 90)
  w.run(100)
  assert.equal(K.waiting(w.watch.s), 1)
  assert.equal(w.A.entries[0].sets[0].done, undefined)
  const id = w.watch.s.ob.map(K.unpack)[0].id
  // back in reach, but the snapshot that names it is lost: the watch sends it again, the phone applies it once
  w.inRange = true
  w.loseSnapshots = 1
  w.run(40)
  assert.equal(w.A.entries[0].sets[0].done, true)
  assert.equal(w.A.entries[0].sets[0].w, 62.5)
  assert.equal(w.applyCount[id], 1)
  assert.equal(w.watch.s.ob.length, 1) // not named yet
  w.run(300)
  assert.equal(w.watch.s.ob.length, 0)
  assert.equal(w.applyCount[id], 1)
  assert.ok(w.transmits.filter(m => m.events.some(e => e.id === id)).length >= 2)
})

test('a workout logged away drains in order, 4 events per message, each set once', () => {
  const w = world()
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  w.inRange = false
  const c = w.watch
  for (let e = 0; e < 2; e++) { // the window holds two exercises: the third needs the phone
    const n = c.s.w.entries[c.s.pos].sets.length
    for (let i = 0; i < n; i++) { w.t += 70000; K.tickSet(c, c.s.pos, K.setIndex(c.s, c.s.pos), null, 50, 5, null, 60); K.second(c); w.settle() }
  }
  w.t += 1000
  assert.equal(K.waiting(c.s), 5)
  assert.equal(K.needsPhone(c.s), true)
  w.inRange = true
  w.run(200)
  const done = w.A.entries.flatMap(e => e.sets.filter(s => s.done))
  assert.equal(done.length, 5)
  assert.ok(Object.values(w.applyCount).every(n => n === 1))
  assert.ok(w.transmits.every(m => m.events.length <= K.BATCH))
  assert.equal(c.s.ob.length, 0)
  assert.equal(K.waiting(c.s), 0)
})

test('finished with the phone away: start, sets and finish reach it in order', () => {
  const w = world()
  w.newWatch()
  w.settle()
  w.inRange = false
  const c = w.watch
  K.startWorkout(c, c.s.rd.today)
  const wid = c.s.w.id
  K.tickSet(c, 0, 0, null, 60, 8, null, 90)
  K.finishWorkout(c, false)
  w.inRange = true
  w.run(150)
  assert.equal(w.workouts.length, 1)
  assert.equal(w.workouts[0].id, wid)
  assert.equal(w.workouts[0].entries[0].sets[0].done, true)
  assert.equal(w.A, null)
  assert.equal(c.s.ob.length, 0)
  assert.equal(c.s.w, null)
})

test('a restart from stored state keeps the outbox: nothing lost, nothing twice', () => {
  const w = world()
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  w.alive = false // openGym is dead: Connect IQ takes the message, nobody hears it
  const c = w.watch
  K.tickSet(c, 0, 0, null, 60, 8, null, 90)
  w.t += 5000
  K.tickSet(c, 0, 1, null, 60, 8, null, 90)
  w.run(40)
  assert.equal(w.A.entries[0].sets[0].done, undefined)
  // the watch app closes and opens again
  const again = w.newWatch(w.stored())
  assert.equal(again.s.ob.length, 2)
  assert.equal(again.s.w.entries[0].sets[0].done, true) // the pending tick shows through
  w.alive = true
  w.send()
  w.run(120)
  assert.equal(w.A.entries[0].sets.filter(s => s.done).length, 2)
  assert.ok(Object.values(w.applyCount).every(n => n === 1))
  assert.equal(again.s.ob.length, 0)
})

test('a transmit that never calls back is given up after 45 s', () => {
  const w = world()
  w.swallow = 1
  w.newWatch()
  w.run(40)
  assert.equal(w.watch.link.busy, true)
  w.run(10)
  assert.equal(w.watch.link.busy, false)
  assert.equal(w.watch.link.gen, 2)
})

test('the retry: unsent goes again after 30 s, and a silent phone gets longer pauses', () => {
  const w = world()
  w.inRange = false
  w.newWatch()
  w.settle()
  const c = w.watch
  const at = []
  const orig = c.env.radio.transmit
  c.env.radio.transmit = (m, l) => { if (m.events.some(e => e.id === 'x1')) at.push(w.t); orig(m, l) }
  K.send(c, { id: 'x1', type: 'setDone', wid: 'w', exId: 'e', setIdx: 0, at: w.t })
  w.settle()
  w.run(300)
  assert.ok(at.length >= 4, String(at.length))
  assert.ok(at[1] - at[0] >= 30000 && at[1] - at[0] < 33000, 'first retry after 30 s: ' + (at[1] - at[0]))
  // out of range: the radio says so each time and the wait stays 30 s; with the phone silent (range but dead) it grows
  const w2 = world()
  w2.alive = false
  w2.newWatch()
  w2.settle()
  const t2 = []
  const o2 = w2.watch.env.radio.transmit
  w2.watch.env.radio.transmit = (m, l) => { if (m.events.some(e => e.id === 'x1')) t2.push(w2.t); o2(m, l) }
  K.send(w2.watch, { id: 'x1', type: 'setDone', wid: 'w', exId: 'e', setIdx: 0, at: w2.t })
  w2.run(3600)
  const gaps = t2.slice(1).map((x, i) => x - t2[i])
  assert.ok(gaps.length >= 3 && gaps.length < 8, String(gaps))
  assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1]), 'pauses grow: ' + gaps)
  assert.equal(w2.watch.s.ob.length, 1) // nothing let go of
})

test('waiting for the phone asks every 10 s at first, then less and less', () => {
  const w = world()
  w.alive = false
  w.newWatch()
  w.settle()
  const hellos = []
  const orig = w.watch.env.radio.transmit
  w.watch.env.radio.transmit = (m, l) => { if (m.events[0].type === 'hello') hellos.push(w.t); orig(m, l) }
  K.startWorkout(w.watch, { name: 'Pull', routineIds: ['r2'], entries: [], count: 0 })
  w.settle()
  const t0 = w.t
  w.run(400)
  const gaps = hellos.map((x, i) => x - (i ? hellos[i - 1] : t0))
  assert.ok(gaps[0] >= 10000 && gaps[0] <= 12000, String(gaps))
  assert.ok(gaps.length >= 3 && gaps.length <= 7, String(gaps))
  assert.ok(gaps.slice(1).every((g, i) => g > gaps[i]), 'doubling: ' + gaps)
})

test('a watch 90 s ahead stamps its sets in phone time and the rest ends together', () => {
  const w = world(90000)
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  assert.equal(K.off(w.watch), 90000 + 0) // learned from the snapshot's `now`
  const c = w.watch
  K.tickSet(c, 0, 0, null, 60, 8, null, 90)
  const ev = K.unpack(c.s.ob[0])
  assert.equal(ev.off, 90000)
  assert.equal(ev.restEnd - ev.at, 90000)
  w.run(10)
  const row = w.A.entries[0].sets[0]
  assert.equal(row.done, true)
  assert.ok(Math.abs(row.at - (w.t - 10000)) <= 2000, 'stamped on the phone clock')
})

test('the fixture parses and the first Done is the setDone event the phone accepts', () => {
  const snap = strip(fixture)
  assert.equal(snap.active.entries[0].sets[1].done, undefined)
  const t = { now: T0 }
  const c = K.createCore({ radio: { transmit: () => {} }, now: () => t.now, random: () => 0.123456, save: () => {} }, null)
  K.onPhone(c, clone(snap))
  const cur = K.current(c)
  assert.deepEqual([cur.pos, cur.si, cur.e.id], [0, 1, '0025'])
  assert.equal(K.pressDone(c, cur.row.w, cur.row.r), 'tick')
  const ev = K.unpack(c.s.ob[0])
  assert.deepEqual(ev, {
    id: ev.id, type: 'setDone', wid: 'w-1', exId: '0025', entryIdx: 0, setIdx: 1, at: T0, w: 60, r: 8, restEnd: T0 + 120000
  })
  assert.match(ev.id, /^h\d+-\d+-\d+$/)
  // the wire: the phone reads each of these fields of an event (lib/watch-sync.js applyEvents)
  // every field of an event is read as `ev.<field>` by watch-sync.js (rir and rpe through effortFrom)
  // (version is read by writeWatchStatus in watch-settings.js, sleep / energy / sore by formFromWatch through FORM_KEYS)
  const settingsSource = readFileSync(new URL('../../frontend/src/lib/watch-settings.js', import.meta.url), 'utf8')
  const formSource = readFileSync(new URL('../../frontend/src/lib/daily-form.js', import.meta.url), 'utf8')
  K.EV_KEYS.filter(k => k !== 'rir' && k !== 'rpe').forEach(k => {
    const viaForm = ['sleep', 'energy', 'sore'].indexOf(k) >= 0 && new RegExp("FORM_KEYS = \\[[^\\]]*'" + k + "'").test(formSource)
    const viaStatus = k === 'version' && /ev\?\.version/.test(settingsSource)
    assert.ok(viaForm || viaStatus || new RegExp('\\bev\\??\\.' + k + '\\b').test(syncSource), k + ' is not read by the phone')
  })
  assert.match(syncSource, /for \(const k of \['rpe', 'rir'\]\)\s*\{\s*const v = num\(ev\?\.\[k\]\)/)
  Object.keys(ev).forEach(k => assert.ok(K.EV_KEYS.indexOf(k) >= 0, k))
  // and the phone's own check: a string id, the workout, the exercise by id and the set
  assert.equal(typeof ev.id, 'string')
  const w = world()
  w.A = Object.assign(newActive('w-1', T0 - 600000), {})
  w.onMessage({ events: [ev] })
  assert.equal(w.A.entries[0].sets[1].done, true)
  assert.equal(w.A.entries[0].sets[1].w, 60)
  assert.deepEqual(w.acked, [ev.id])
})

test('a rest change goes to the phone as a rest event it can follow', () => {
  const w = world()
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  const c = w.watch
  K.tickSet(c, 0, 0, null, 60, 8, null, 90)
  w.run(3)
  K.restAdd(c, 15)
  w.run(3)
  K.restSkip(c)
  w.run(3)
  const r = w.restEvents
  assert.ok(r.length >= 1)
  assert.equal(r[r.length - 1].endsAt, undefined)
  assert.equal(r[r.length - 1].wid, 'w-phone')
})

test('Still training: Keep going reaches the phone as stillHere', () => {
  const w = world()
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  w.watch.s.w.activeAt = w.t - 30 * 60000
  w.run(10)
  assert.equal(w.watch.g.ask, true)
  K.keepGoing(w.watch, true)
  w.run(3)
  assert.equal(w.stillHere, 1)
})

test('everything the watch queued reaches the phone: ids unique, each set once, no nulls on the wire', () => {
  const w = world()
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  w.inRange = false
  const c = w.watch
  const planned = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1]]
  planned.forEach((p, i) => {
    K.tickSet(c, c.s.pos, K.setIndex(c.s, c.s.pos), null, 50 + i, 5, null, 60)
    K.restAdd(c, 15)
    w.t += 1000
    K.second(c)
  })
  assert.equal(K.waiting(c.s), 5)
  w.inRange = true
  w.run(120)
  const done = w.A.entries.flatMap(e => e.sets.filter(s => s.done).map(s => s.sid))
  assert.deepEqual(done.sort(), ['s00', 's01', 's02', 's10', 's11'])
  const ids = w.transmits.flatMap(m => m.events.map(e => e.id)).filter(id => id.charAt(0) === 'h')
  const sentSets = {}
  w.transmits.forEach(m => m.events.forEach(e => { if (e.type === 'setDone') sentSets[e.id] = e }))
  assert.equal(Object.keys(sentSets).length, 5) // five different ids
  assert.ok(ids.length >= 5)
  assert.ok(Object.values(w.applyCount).every(n => n === 1))
  assert.ok(w.transmits.every(m => m.events.length <= 4 && !JSON.stringify(m).includes('null')))
  assert.equal(c.s.ob.length, 0)
})

/* ---------- the Huawei snapshot and the new events, both ends ---------- */
const huaweiWorld = settings => { const w = world(); w.huawei = true; w.settings = settings || {}; return w }

test('a set ticked on the phone gets the watch\'s heart rate (setHr), and the rest\'s once it is over', () => {
  const w = huaweiWorld()
  w.newWatch()
  startOnPhone(w)
  w.run(2)
  const c = w.watch
  for (let i = 0; i < 30; i++) { w.t += 1000; K.hrSample(c, 100 + i); K.second(c); w.settle() }
  const row = w.A.entries[0].sets[0]
  Object.assign(row, { done: true, at: w.phoneNow() - 5000 })
  w.send()
  w.run(3)
  assert.ok(row.hr, 'the phone has a heart rate for the set')
  assert.ok(row.hr.avg >= 100 && row.hr.max <= 130 && row.hr.max >= row.hr.avg)
})

