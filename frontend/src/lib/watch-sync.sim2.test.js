// @vitest-environment happy-dom
// The watch link end to end, the second round (watch-sync, 1.4.5): the rest as one rest on both
// sides, the two clocks, the end of a workout from either side while the other is away, edits,
// a set's identity (#1162) and the watch's set menu, supersets, the same exercise twice, a phone
// that is woken by a watch, and two watches at once. The real page against lib/watch-sim.js, whose
// protocol-2 watch is what docs/WATCH_SYNC.md asks of the native sides.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWorld } from './watch-sim.js'
import { _resetWatchSync } from './watch-sync.js'

const T0 = 1_800_000_000_000
const routines = {
  r1: { name: 'Push', entries: [
    { id: '0025', target: null, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
    { id: '0001', target: null, sets: [{ w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] },
  ] },
  // the same exercise twice: heavy, then a back-off
  r3: { name: 'Bench twice', entries: [
    { id: '0025', target: null, sets: [{ w: 80, r: 5, done: false }, { w: 80, r: 5, done: false }] },
    { id: '0001', target: null, sets: [{ w: 20, r: 10, done: false }] },
    { id: '0025', target: null, sets: [{ w: 60, r: 10, done: false }, { w: 60, r: 10, done: false }] },
  ] },
  // a superset: two exercises in turns
  ss: { name: 'Superset', entries: [
    { id: '0027', sg: 'a', target: null, sets: [{ w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }] },
    { id: '0033', sg: 'a', target: null, sets: [{ w: 12, r: 12, done: false }, { w: 12, r: 12, done: false }] },
  ] },
}

let W
async function world (opts = {}) {
  if (W) await W.phone.kill()
  localStorage.clear()
  _resetWatchSync()
  const { skew = 0, ...rest } = opts
  W = makeWorld({ routines, vi, restSec: 90, ...rest })
  W.watch.skew = skew
  await W.phone.launch()
  W.watch.launch()
  await W.run(1000)
  return W
}
beforeEach(async () => { vi.useFakeTimers({ now: T0 }); W = null; await world() })
afterEach(async () => { await W.phone.kill(); W = null; vi.useRealTimers() })

const saved = id => W.phone.S.workouts.find(w => w.id === id)
const doneOf = w => w.entries.flatMap(e => e.sets.map((s, i) => (s.done ? `${e.id}#${i}:${s.w}x${s.r}` : null)).filter(Boolean))
const atRest = () => {
  expect(W.phone.S.active).toBeNull()
  for (const w of W.watches) { expect(w.workout).toBeNull(); expect(w.outbox).toEqual([]); expect(w.link.transfers).toEqual([]) }
  expect(W.phone.queueFile).toEqual([])
}
/** The rest agrees on both sides to within a second (or neither has one). */
const restAgrees = (watch = W.watch) => { const g = W.restGap(watch); expect(g === null || g <= 1000, `rest gap ${g}`).toBe(true) }

describe('one rest on both sides', () => {
  it('a rest started on the watch is on the phone at once, to the same end', async () => {
    W.phone.start('r1')
    await W.run(1000)
    const ev = W.watch.tick(0, null, {})
    await W.run(500)
    expect(W.phone.timer.endsAt).toBe(ev.at + 90_000)
    restAgrees()
  })

  it('the phone in a pocket: the rest the watch started is there when the app opens, not started again on either side', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.phone.background()
    const ev = W.watch.tick(0, null, {})
    await W.run(40_000)
    // the page slept through it: nothing on the phone yet
    expect(W.phone.timer).toBeNull()
    await W.phone.foreground()
    await W.run(500)
    // the phone counts from the tick at the wrist, and the watch's own countdown was not touched
    expect(W.phone.timer.endsAt).toBe(ev.at + 90_000)
    expect(W.watch.restEndsAt).toBe(ev.at + 90_000)
    restAgrees()
  })

  it('+15 on the watch while the phone sleeps: the phone app opening takes the +15, it does not put the watch back', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.phone.background()
    const ev = W.watch.tick(0, null, {})
    await W.run(5000)
    W.watch.addRest(15)
    await W.run(20_000)
    await W.phone.foreground()
    await W.run(1000)
    expect(W.watch.restEndsAt).toBe(ev.at + 105_000)
    expect(W.phone.timer.endsAt).toBe(ev.at + 105_000)
    // and a cold launch (the app was killed meanwhile) restores that rest without restarting it
    await W.phone.kill()
    await W.run(3000)
    await W.phone.launch()
    await W.run(1000)
    expect(W.watch.restEndsAt).toBe(ev.at + 105_000)
    restAgrees()
  })

  it('Skip on the phone ends the rest on the watch (#1149); a pause holds it, a resume runs it again', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.phone.tick(0, 0, {})
    await W.run(500)
    expect(W.watch.rest).not.toBeNull()
    W.phone.ui.pauseRest()
    await W.run(3000)
    // paused, not over: the watch shows the seconds it holds at
    expect(W.watch.rest).toBeNull()
    expect(W.watch.restPausedLeft).toBe(W.phone.timer.left)
    W.phone.ui.resumeRest()
    await W.run(500)
    restAgrees()
    expect(W.watch.rest).not.toBeNull()
    W.phone.ui.skipRest()
    await W.run(500)
    expect(W.watch.rest).toBeNull()
    expect(W.phone.timer).toBeNull()
  })

  it('+15 and Skip on either side reach the other', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, null, {})
    await W.run(500)
    W.phone.ui.addRest(15)
    await W.run(500)
    restAgrees()
    W.watch.addRest(15)
    await W.run(500)
    restAgrees()
    W.watch.addRest(-15)
    await W.run(500)
    restAgrees()
    W.watch.skipRest()
    await W.run(500)
    expect(W.phone.timer).toBeNull()
    W.phone.tick(0, 1, {})
    await W.run(500)
    restAgrees()
    W.phone.ui.skipRest()
    await W.run(500)
    expect(W.watch.rest).toBeNull()
  })

  it('an old snapshot applied again (the watch app relaunched with the last context) does not bring a skipped rest back', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.phone.tick(0, 0, {})
    await W.run(500)
    // the context the watch holds carries that rest; the contexts after it are slow to come
    expect(JSON.parse(W.link.received.snapshot).active.rest).not.toBeNull()
    W.contextDelay = () => 60_000
    W.watch.skipRest()
    await W.run(500)
    expect(W.phone.timer).toBeNull()
    // watchOS ends the app and it is opened again: the old context is applied once more
    W.watch.kill()
    W.watch.launch()
    await W.run(500)
    expect(W.watch.rest).toBeNull()
    await W.run(70_000)
    expect(W.watch.rest).toBeNull()
    expect(W.phone.timer).toBeNull()
  })

  it('a tick from the watch that arrives late does not take away a rest started on the phone since', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(0, null, {})
    await W.run(120_000)
    // the phone ticks the next exercise's set on its own and rests for it
    const at = W.phone.tick(1, 0, {})
    await W.run(5000)
    W.setNear(true)
    await W.run(3000)
    expect(W.phone.timer.endsAt).toBe(at + 90_000)
    expect(W.phone.S.active.entries[0].sets[0].done).toBe(true)
    restAgrees()
  })

  it('a first-protocol watch still works with this phone: its rest is the one it counts', async () => {
    await world({ protocol: 1 })
    W.phone.start('r1')
    await W.run(1000)
    const ev = W.watch.tick(0, null, {})
    await W.run(1000)
    expect(W.phone.timer.endsAt).toBeGreaterThanOrEqual(ev.at + 89_000)
    expect(W.watch.restEndsAt).toBe(ev.at + 90_000)
  })
})

describe('two clocks', () => {
  it('a watch whose clock is set while it runs follows the new offset within five minutes', async () => {
    W.phone.start('r1')
    await W.run(1000)
    expect(W.watch.off).toBe(0)
    W.watch.skew = 4000
    for (let i = 0; i < 7; i++) { W.phone.edit(A => { A.name = 'Push ' + i }); await W.run(60_000) }
    expect(Math.abs(W.watch.off - 4000)).toBeLessThan(50)
  })

  for (const skew of [3_000, -3_000, 90_000, -90_000]) {
    it(`a watch ${skew > 0 ? 'ahead' : 'behind'} by ${Math.abs(skew) / 1000} s: the rest agrees to the second, both ways`, async () => {
      await world({ skew })
      W.phone.start('r1')
      await W.run(2000)
      // the watch has heard the phone's clock by now
      expect(Math.abs(W.watch.off - skew)).toBeLessThan(50)
      W.watch.tick(0, null, {})
      await W.run(500)
      restAgrees()
      W.phone.tick(0, 1, {})
      await W.run(500)
      restAgrees()
      W.watch.addRest(15)
      await W.run(500)
      restAgrees()
    })
  }

  it('the later of two ticks of one set wins by real time, with the watch 30 s ahead', async () => {
    await world({ skew: 30_000 })
    const wid = W.phone.start('r1')
    await W.run(2000)
    W.setNear(false)
    // the phone ticks first, the watch ten seconds later (its clock says 40 s later)
    W.phone.tick(0, 0, { w: 60, r: 8 })
    await W.run(10_000)
    W.watch.tick(0, 0, { w: 65, r: 6 })
    await W.run(1000)
    W.setNear(true)
    await W.settle()
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ w: 65, r: 6 })
    W.phone.finish()
    await W.settle()
    expect(doneOf(saved(wid))).toEqual(['0025#0:65x6'])
  })

  it('…and the phone\'s wins when it was the later, with the watch 30 s ahead', async () => {
    await world({ skew: 30_000 })
    W.phone.start('r1')
    await W.run(2000)
    W.setNear(false)
    W.watch.tick(0, 0, { w: 65, r: 6 })
    await W.run(10_000)
    W.phone.tick(0, 0, { w: 60, r: 8 })
    await W.run(1000)
    W.setNear(true)
    await W.settle()
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ w: 60, r: 8 })
    expect(W.watch.workout.entries[0].sets[0]).toMatchObject({ w: 60, r: 8 })
  })
})

describe('the end of a workout from either side', () => {
  it('finished on the phone while the watch app is not running: it ends on the watch when it opens, its sets land', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, null, { r: 7 })
    await W.run(500)
    W.watch.kill()
    W.phone.finish()
    await W.run(2000)
    W.watch.launch()
    await W.run(1000)
    expect(W.watch.workout).toBeNull()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x7'])
  })

  it('Finish on the phone and the lock button at once: the watch hears before the app is asleep', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.phone.tick(0, 0, {})
    await W.run(100)
    W.phone.tick(0, 1, {})
    W.phone.finish()
    W.phone.background()
    await vi.advanceTimersByTimeAsync(0)
    expect(W.watch.workout).toBeNull()
  })

  it('finished on the watch while the phone app was killed: a message wakes it, and it saves the workout once', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    await W.phone.kill()
    W.coldLaunch = true
    W.pageInBackground = true
    W.watch.tick(0, null, {})
    W.watch.tick(0, null, {})
    W.watch.finish()
    await W.run(3000)
    expect(saved(wid)).toBeTruthy()
    expect(W.phone.S.active).toBeNull()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x8'])
  })

  it('discarded on the watch while out of reach: the phone discards it when it hears, nothing saved', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(0, null, {})
    W.watch.discard()
    await W.run(60_000)
    expect(W.phone.S.active?.id).toBe(wid)
    await W.settle()
    atRest()
    expect(saved(wid)).toBeUndefined()
  })

  it('finished on the phone while the watch was out of reach, the watch logs on and finishes too: one workout, every set', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.phone.tick(0, 0, {})
    await W.run(500)
    W.setNear(false)
    W.phone.finish()
    W.watch.tick(0, null, { r: 6 })
    W.watch.tick(1, null, { r: 9 })
    W.watch.finish()
    await W.run(30_000)
    await W.settle()
    atRest()
    expect(W.phone.S.workouts.filter(w => w.id === wid)).toHaveLength(1)
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x6', '0001#0:20x9'])
  })
})

describe('edits to a set that is logged', () => {
  it('a weight corrected on the phone after the tick is not undone by an older fix from the wrist', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, null, { w: 60, r: 8 })
    await W.run(1000)
    W.setNear(false)
    // the fix on the watch first …
    W.watch.tick(0, 0, { w: 62.5, r: 8 })
    await W.run(5000)
    // … then the phone's own correction, later
    W.phone.edit(A => { A.entries[0].sets[0].w = 65 })
    await W.run(5000)
    W.setNear(true)
    await W.settle()
    expect(W.phone.S.active.entries[0].sets[0].w).toBe(65)
    expect(W.watch.workout.entries[0].sets[0].w).toBe(65)
  })

  it('a fix on the watch made after the phone\'s edit wins on both', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.phone.tick(0, 0, { w: 60, r: 8 })
    await W.run(1000)
    W.phone.edit(A => { A.entries[0].sets[0].r = 7 })
    await W.run(1000)
    W.watch.tick(0, 0, { w: 60, r: 6 })
    await W.run(1000)
    expect(W.phone.S.active.entries[0].sets[0].r).toBe(6)
    expect(W.watch.workout.entries[0].sets[0].r).toBe(6)
  })
})

describe('a set\'s identity (#1162) and the watch\'s set menu', () => {
  it('every row has an id in the snapshot, and it stays the same through edits', async () => {
    W.phone.start('r1')
    await W.run(1000)
    const ids = W.watch.workout.entries.flatMap(e => e.sets.map(s => s.sid))
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    W.phone.tick(0, 0, {})
    await W.run(1000)
    expect(W.watch.workout.entries.flatMap(e => e.sets.map(s => s.sid))).toEqual(ids)
  })

  it('a copied row gets an id of its own; the original keeps its', async () => {
    W.phone.start('r1')
    await W.run(1000)
    const first = W.phone.S.active.entries[0].sets[0].sid
    W.phone.edit(A => { A.entries[0].sets.push({ ...A.entries[0].sets[0] }) })
    await W.run(1000)
    const sets = W.phone.S.active.entries[0].sets
    expect(sets[0].sid).toBe(first)
    expect(sets[3].sid).not.toBe(first)
  })

  it('a tick from the watch lands on its set after the phone took out a row above it (case 1)', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    // the watch logs the third set, the phone meanwhile takes out the first
    W.watch.tick(0, 2, { w: 70, r: 5 })
    W.phone.edit(A => { A.entries[0].sets.splice(0, 1) })
    await W.run(5000)
    W.setNear(true)
    await W.settle()
    const sets = W.phone.S.active.entries[0].sets
    expect(sets.map(s => !!s.done)).toEqual([false, true])
    expect(sets[1]).toMatchObject({ w: 70, r: 5 })
    W.phone.finish()
    await W.settle()
    expect(doneOf(saved(wid))).toEqual(['0025#1:70x5'])
  })

  it('the same exercise twice: a tick on the back-off sets marks those, not the heavy ones (case 3)', async () => {
    W.phone.start('r3')
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(2, 0, { w: 60, r: 10 })
    // the watch shows it on the back-off only, before the phone has it
    expect(W.watch.workout.entries[0].sets[0].done).toBe(false)
    expect(W.watch.workout.entries[2].sets[0].done).toBe(true)
    // the phone takes out the exercise between them: the positions move
    W.phone.edit(A => { A.entries.splice(1, 1) })
    await W.run(2000)
    W.setNear(true)
    await W.settle()
    const A = W.phone.S.active
    expect(A.entries[0].sets.map(s => !!s.done)).toEqual([false, false])
    expect(A.entries[1].sets.map(s => !!s.done)).toEqual([true, false])
    expect(W.watch.workout.entries[0].sets.map(s => !!s.done)).toEqual([false, false])
  })

  it('a set added on the watch is on the phone with its id, and its tick lands on it, even offline', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    const add = W.watch.addSet(1, { afterSi: 1, w: 22.5, r: 8 })
    expect(W.watch.workout.entries[1].sets).toHaveLength(3)
    W.watch.tick(1, 0, {})
    W.watch.tick(1, 1, {})
    W.watch.tick(1, 2, { w: 22.5, r: 8 })
    await W.run(5000)
    W.setNear(true)
    await W.settle()
    const sets = W.phone.S.active.entries[1].sets
    expect(sets).toHaveLength(3)
    expect(sets[2]).toMatchObject({ sid: add.sid, done: true, w: 22.5, r: 8 })
    expect(W.watch.workout.entries[1].sets).toHaveLength(3)
    // the add came twice (a resend): still one row
    W.phone.queueFile.push({ ...add, id: add.id })
    W.phone.foreground()
    await W.run(1000)
    expect(W.phone.S.active.entries[1].sets).toHaveLength(3)
    W.phone.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0001#0:20x10', '0001#1:20x10', '0001#2:22.5x8'])
  })

  it('a set taken out on the watch goes on the phone; one the phone ticked meanwhile stays, and the tick after it lands right', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.watch.removeSet(0, 2)
    await W.run(1000)
    expect(W.phone.S.active.entries[0].sets).toHaveLength(2)
    expect(W.watch.workout.entries[0].sets).toHaveLength(2)
    // now with the phone ticking the set the watch takes out, while the two are apart
    W.setNear(false)
    W.watch.removeSet(1, 1)
    W.phone.tick(1, 1, { w: 25, r: 6 })
    W.watch.tick(1, 0, { w: 20, r: 9 })
    await W.run(5000)
    W.setNear(true)
    await W.settle()
    // the phone refused to take out a set it has done; the watch's tick is on the first set
    const sets = W.phone.S.active.entries[1].sets
    expect(sets.map(s => `${s.done ? 'x' : '-'}${s.w}x${s.r}`)).toEqual(['x20x9', 'x25x6'])
    expect(W.watch.workout.entries[1].sets.map(s => `${s.done ? 'x' : '-'}${s.w}x${s.r}`)).toEqual(['x20x9', 'x25x6'])
  })
})

describe('supersets, holds and circuits', () => {
  it('a superset: no rest between the partners, the round\'s rest on both after the second', async () => {
    W.phone.start('ss')
    await W.run(1000)
    W.watch.tick(0, 0, { rest: 0 })
    await W.run(500)
    // the watch went to the partner without a rest: so does the phone
    expect(W.phone.timer).toBeNull()
    W.watch.tick(1, 0, { rest: 90 })
    await W.run(500)
    restAgrees()
    expect(W.phone.timer).not.toBeNull()
  })

  it('a hold\'s rest skipped on the watch skips it on the phone, which counts the next hold in (skipRest)', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, null, {})
    await W.run(500)
    const skip = vi.spyOn(W.phone.ui, 'skipRest')
    const ev = W.watch.skipRest()
    await W.run(500)
    expect(skip).toHaveBeenCalledWith(ev.at)
    expect(W.phone.timer).toBeNull()
  })
})

describe('two watches at once', () => {
  it('both log into the one workout, each set once, and both follow the rest', async () => {
    const two = W.addWatch()
    two.launch()
    const wid = W.phone.start('r1')
    await W.run(1000)
    expect(two.workout.id).toBe(wid)
    W.watch.tick(0, null, { r: 8 })
    await W.run(500)
    two.tick(0, null, { r: 7 })
    await W.run(500)
    restAgrees(W.watch)
    restAgrees(two)
    two.addRest(15)
    await W.run(500)
    restAgrees(W.watch)
    W.watch.skipRest()
    await W.run(500)
    expect(two.rest).toBeNull()
    expect(W.phone.timer).toBeNull()
    W.setAway(two, true)
    two.tick(1, null, { r: 9 })
    W.watch.finish()
    await W.run(5000)
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x7', '0001#0:20x9'])
  })
})
