// @vitest-environment happy-dom
// The watch link, end to end: the real page (lib/watch-sync.js) against a simulated iPhone native
// side, WatchConnectivity and Apple Watch (lib/watch-sim.js, a port of the Swift). Each case is a
// thing that happens at a gym: the phone in the locker, the app force-quit, an answer that never
// came back, both sides touching the same set. After each, the two sides are let come to rest and
// the history has to hold every set exactly once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWorld, readyOf } from './watch-sim.js'
import { _resetWatchSync } from './watch-sync.js'

const T0 = 1_800_000_000_000
const routines = {
  r1: { name: 'Push', entries: [
    { id: '0025', target: { sets: 3, reps: 8 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
    { id: '0001', target: { sets: 2, reps: 10 }, sets: [{ w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] },
  ] },
  r2: { name: 'Pull', entries: [
    { id: '0027', target: { sets: 2, reps: 6 }, sets: [{ w: 80, r: 6, done: false }, { w: 80, r: 6, done: false }] },
  ] },
}

let W
beforeEach(async () => {
  vi.useFakeTimers({ now: T0 })
  localStorage.clear()
  _resetWatchSync()
  W = makeWorld({ routines, vi })
  await W.phone.launch()
  W.watch.launch()
  await W.run(1000)
})
afterEach(async () => { await W.phone.kill(); vi.useRealTimers() })

const saved = id => W.phone.S.workouts.find(w => w.id === id)
const doneOf = w => w.entries.flatMap(e => e.sets.map((s, i) => (s.done ? `${e.id}#${i}:${s.w}x${s.r}` : null)).filter(Boolean))
/** Nothing is left anywhere: no workout running, nothing waiting on either side. */
const atRest = () => {
  expect(W.phone.S.active).toBeNull()
  expect(W.watch.workout).toBeNull()
  expect(W.watch.outbox).toEqual([])
  expect(W.phone.queueFile).toEqual([])
  expect(W.link.transfers).toEqual([])
  const ids = W.phone.S.workouts.map(w => w.id)
  expect(new Set(ids).size).toBe(ids.length)
}

describe('a workout led from the phone', () => {
  it('shows up on the watch, its ticks come back, and Finish on the phone ends it on both', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    expect(W.watch.workout.id).toBe(wid)
    W.watch.tick(0, null, { w: 62.5, r: 7 })
    await W.run(1000)
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ w: 62.5, r: 7, done: true })
    W.phone.tick(0, 1, { w: 60, r: 8 })
    await W.run(1000)
    expect(W.watch.workout.entries[0].sets.map(s => s.done)).toEqual([true, true, false])
    W.phone.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:62.5x7', '0025#1:60x8'])
  })

  it('the phone goes into the locker: every set from the watch is there when it comes back', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.phone.background()
    W.setNear(false)
    for (let i = 0; i < 3; i++) { W.watch.tick(0, null, { r: 8 - i }); await W.run(90_000) }
    W.watch.tick(1, null, {})
    expect(W.phone.queueFile).toEqual([])
    expect(W.watch.outbox.filter(x => !x.delivered).length).toBeGreaterThanOrEqual(4)
    W.setNear(true)
    await W.run(2000)
    // on the phone's disk already, the app still asleep in the pocket
    expect(W.phone.queueFile.filter(e => e.type === 'setDone')).toHaveLength(4)
    expect(W.phone.S.active.entries[0].sets[0].done).toBe(false)
    await W.phone.foreground()
    await W.run(2000)
    expect(W.phone.S.active.entries[0].sets.map(s => s.r)).toEqual([8, 7, 6])
    W.watch.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x7', '0025#2:60x6', '0001#0:20x10'])
  })

  it('the phone app is force-quit mid-workout: the watch goes on, and the sets land when the app is opened', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    await W.phone.kill()
    W.watch.tick(0, null, {})
    W.watch.tick(0, null, {})
    await W.run(5000)
    // iOS woke the app's native side for them: stored, not applied
    expect(W.phone.queueFile.filter(e => e.type === 'setDone')).toHaveLength(2)
    expect(W.watch.outbox.filter(x => x.delivered).length).toBeGreaterThanOrEqual(2)
    await W.phone.launch()
    await W.run(2000)
    expect(W.phone.S.active.entries[0].sets.map(s => s.done)).toEqual([true, true, false])
    W.phone.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toHaveLength(2)
  })

  it('finished on the phone while the watch was out of reach: the watch\'s later sets land in the saved workout', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, null, {})
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(0, null, { w: 65, r: 5 })
    W.watch.tick(1, null, { w: 22.5, r: 9 })
    W.phone.finish()
    await W.run(60_000)
    expect(W.watch.workout?.id).toBe(wid)
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:65x5', '0001#0:22.5x9'])
    expect(W.phone.S.workouts).toHaveLength(1)
  })

  it('finished on the watch while the phone was away: saved on the phone once it hears, never brought back on the watch', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(0, null, {})
    W.watch.finish()
    expect(W.watch.workout).toBeNull()
    // the phone changes something meanwhile: its snapshot still shows the workout running
    W.phone.edit(A => { A.cur = 1 })
    await W.run(5000)
    W.setNear(true)
    await W.run(200)
    expect(W.watch.workout).toBeNull()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8'])
  })

  it('discarded on the phone while the watch was away: gone on the watch too, its late sets save nothing', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(0, null, {})
    W.phone.discard()
    await W.settle()
    atRest()
    expect(W.phone.S.workouts).toEqual([])
  })

  it('the plan changes on the phone mid-workout: the watch follows, and a set it logged for an exercise the phone removed is kept', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    // on the phone: the second exercise is taken out, a set is added to the first
    W.phone.edit(A => { A.entries.splice(1, 1); A.entries[0].sets.push({ w: 60, r: 8, done: false }) })
    // on the watch, which has not heard: a set of the exercise that is gone
    W.watch.tick(1, null, { w: 25, r: 12 })
    await W.run(2000)
    W.setNear(true)
    await W.run(2000)
    expect(W.watch.workout.entries[0].sets).toHaveLength(4)
    W.phone.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0001#0:25x12'])
  })
})

describe('a workout led from the watch', () => {
  it('started and finished at the wrist with the phone in reach: the phone has it, once', async () => {
    const wid = W.watch.start('r1')
    await W.run(2000)
    expect(W.phone.S.active.id).toBe(wid)
    W.watch.tick(0, null, {})
    W.watch.tick(0, null, { r: 6 })
    await W.run(2000)
    W.watch.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x6'])
  })

  it('a whole workout without the phone, merged hours later: every set once, ending when the watch ended it', async () => {
    W.setNear(false)
    await W.phone.kill()
    const wid = W.watch.start('r1')
    const startAt = Date.now()
    for (let i = 0; i < 3; i++) { await W.run(120_000); W.watch.tick(0, null, { r: 8 - i }) }
    for (let i = 0; i < 2; i++) { await W.run(120_000); W.watch.tick(1, null, {}) }
    await W.run(60_000)
    const fin = W.watch.finish()
    await W.run(5 * 3600e3)
    await W.settle()
    atRest()
    const w = saved(wid)
    expect(doneOf(w)).toEqual(['0025#0:60x8', '0025#1:60x7', '0025#2:60x6', '0001#0:20x10', '0001#1:20x10'])
    expect(w.start).toBe(startAt)
    expect(w.end).toBe(fin.at)
  })

  it('two workouts without the phone, one after the other: both saved, in order, nothing mixed', async () => {
    W.setNear(false)
    const a = W.watch.start('r1')
    W.watch.tick(0, null, {})
    await W.run(60_000)
    W.watch.finish()
    await W.run(3600e3)
    const b = W.watch.start('r2')
    W.watch.tick(0, null, { w: 85, r: 5 })
    await W.run(60_000)
    W.watch.finish()
    await W.settle()
    atRest()
    expect(W.phone.S.workouts.map(w => w.id)).toEqual([a, b])
    expect(doneOf(saved(a))).toEqual(['0025#0:60x8'])
    expect(doneOf(saved(b))).toEqual(['0027#0:85x5'])
  })

  it('started at the wrist while another workout runs on the phone: both are kept', async () => {
    const p = W.phone.start('r2')
    await W.run(1000)
    // the watch finishes the phone's one for itself, then starts its own; the phone hears neither yet
    W.setNear(false)
    W.watch.finish()
    const b = W.watch.start('r1')
    W.watch.tick(0, null, {})
    W.phone.tick(0, 0, {})
    await W.run(1000)
    await W.settle()
    // the phone's own workout was finished by the watch's finish; then the watch's started
    if (W.phone.S.active) { W.watch.finish(); await W.settle() }
    atRest()
    expect(W.phone.S.workouts.map(w => w.id).sort()).toEqual([p, b].sort())
    expect(doneOf(saved(b))).toEqual(['0025#0:60x8'])
    expect(doneOf(saved(p))).toEqual(['0027#0:80x6'])
  })

  it('the routine was changed on the phone since the watch last heard: the sets the watch logged are still all kept', async () => {
    W.setNear(false)
    await W.phone.kill()
    // the phone's plan now: the first exercise has two sets, the second is another exercise
    W.routines.r1 = { name: 'Push', entries: [
      { id: '0025', target: { sets: 2, reps: 8 }, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
      { id: '0033', target: { sets: 2, reps: 12 }, sets: [{ w: 10, r: 12, done: false }, { w: 10, r: 12, done: false }] },
    ] }
    const wid = W.watch.start('r1')
    for (let i = 0; i < 3; i++) W.watch.tick(0, null, {})
    W.watch.tick(1, null, { w: 22.5, r: 9 })
    W.watch.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid)).sort()).toEqual(['0025#0:60x8', '0025#1:60x8', '0025#2:60x8', '0001#0:22.5x9'].sort())
  })

  it('the routine is gone on the phone: the workout is still saved with what was logged', async () => {
    W.setNear(false)
    delete W.routines.r2
    const wid = W.watch.start('r2')
    W.watch.tick(0, null, { w: 85, r: 5 })
    W.watch.tick(0, null, { w: 85, r: 4 })
    W.watch.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0027#0:85x5', '0027#1:85x4'])
  })
})

describe('a bad link', () => {
  it('answers that never come back, messages that never arrive: nothing lost, nothing twice', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    const fates = ['replyLost', 'lost', 'ok', 'lost', 'replyLost']
    let i = 0
    W.messageFate = () => fates[i++ % fates.length]
    W.transferDelay = () => 4000
    for (let k = 0; k < 3; k++) { W.watch.tick(0, null, { r: 10 + k }); await W.run(700) }
    W.watch.tick(1, null, {})
    W.watch.tick(1, null, {})
    await W.run(30_000)
    expect(W.phone.S.active.entries[0].sets.map(s => s.r)).toEqual([10, 11, 12])
    W.watch.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x10', '0025#1:60x11', '0025#2:60x12', '0001#0:20x10', '0001#1:20x10'])
  })

  it('a snapshot from before the watch\'s tick arrives after it (the context is slow): the tick stays done', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.snapshotMessage = () => false
    W.contextDelay = () => 3000
    W.phone.edit(A => { A.cur = 1 })       // a snapshot goes out, slowly
    await W.run(500)
    W.watch.tick(0, null, { r: 9 })
    await W.run(4000)
    expect(W.watch.workout.entries[0].sets[0]).toMatchObject({ done: true, r: 9 })
    await W.run(4000)
    expect(W.watch.workout.entries[0].sets[0]).toMatchObject({ done: true, r: 9 })
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ done: true, r: 9 })
  })

  it('the watch app is killed with sets in its outbox: they go out when it is opened again', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(0, null, {})
    W.watch.tick(0, null, { r: 7 })
    W.watch.kill()
    await W.run(3600e3)
    W.setNear(true)
    await W.run(2000)
    // the system's own queue delivered them without the watch app
    expect(W.phone.S.active.entries[0].sets.map(s => s.done)).toEqual([true, true, false])
    W.watch.launch()
    await W.run(2000)
    expect(W.watch.workout.id).toBe(wid)
    expect(W.watch.workout.entries[0].sets.map(s => s.done)).toEqual([true, true, false])
    W.phone.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x7'])
  })

  it('the watch app dies between sending a tick and saving it: the phone has it, and gives it back', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, null, { r: 5, crash: true })
    await W.run(2000)
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ done: true, r: 5 })
    W.watch.launch()
    await W.run(2000)
    expect(W.watch.workout.entries[0].sets[0]).toMatchObject({ done: true, r: 5 })
  })

  it('the phone app is killed in the middle of a drain (applied, not yet acknowledged): applied once', async () => {
    const wid = W.watch.start('r1')
    await W.run(2000)
    W.phone.background()
    W.watch.tick(0, null, {})
    W.watch.tick(0, null, { r: 6 })
    await W.run(2000)
    expect(W.phone.queueFile.filter(e => e.type === 'setDone')).toHaveLength(2)
    // the page comes up, applies, and dies before its ack reaches the native queue
    const realAck = W.phone.queueFile.slice()
    await W.phone.foreground()
    await W.run(300)
    await W.phone.kill()
    W.phone.queueFile = realAck          // the queue file as it was: the ack never happened
    await W.phone.launch()
    await W.run(2000)
    expect(W.phone.S.active.entries[0].sets.map(s => [s.done, s.r])).toEqual([[true, 8], [true, 6], [false, 8]])
    W.watch.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x6'])
  })
})

describe('both sides on the same set', () => {
  it('ticked on the phone, then with other numbers on the watch that had not heard: the later one stands on both', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    W.phone.tick(0, 0, { w: 60, r: 8 })
    await W.run(30_000)
    W.watch.tick(0, 0, { w: 62.5, r: 6 })
    W.setNear(true)
    await W.run(3000)
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ w: 62.5, r: 6 })
    expect(W.watch.workout.entries[0].sets[0]).toMatchObject({ w: 62.5, r: 6 })
    W.phone.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:62.5x6'])
  })

  it('ticked on the watch, then corrected on the phone later: the phone\'s numbers stand on both', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.setNear(false)
    W.watch.tick(0, 0, { w: 62.5, r: 6 })
    await W.run(30_000)
    W.phone.tick(0, 0, { w: 60, r: 8 })
    W.setNear(true)
    await W.run(3000)
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ w: 60, r: 8 })
    expect(W.watch.workout.entries[0].sets[0]).toMatchObject({ w: 60, r: 8 })
  })

  it('a set unticked on the phone after the watch\'s tick was applied stays unticked on the watch', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, 0, {})
    await W.run(2000)
    W.phone.untick(0, 0)
    await W.run(2000)
    expect(W.watch.workout.entries[0].sets[0].done).toBe(false)
    expect(W.phone.S.active.entries[0].sets[0].done).toBe(false)
  })

  it('a set fixed on the watch after it was logged: the phone takes the fix', async () => {
    W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, 0, { r: 8 })
    await W.run(2000)
    W.watch.tick(0, 0, { r: 9 })
    await W.run(2000)
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ done: true, r: 9 })
  })
})

describe('the rest timer', () => {
  it('a rest started on the phone runs on the watch to the same end', async () => {
    W.phone.start('r1')
    await W.run(1000)
    const at = W.phone.tick(0, 0, { rest: 90 })
    await W.run(1000)
    expect(W.watch.restEndsAt).toBe(at + 90_000)
  })

  it('+15 on the watch right after its own Done is not undone by the phone\'s echo of that rest', async () => {
    W.phone.start('r1')
    await W.run(1000)
    const ev = W.watch.tick(0, null, { rest: 90 })
    W.watch.restEndsAt += 15_000
    // the phone applies the tick and starts its own rest for it
    await W.run(200)
    W.phone.tick(0, 0, { rest: 90 })
    await W.run(2000)
    expect(W.watch.restEndsAt).toBe(ev.at + 105_000)
  })
})

describe('clocks', () => {
  it('a watch whose clock runs two minutes behind still wins the set it ticked last, within the minute of slack it cannot', async () => {
    W.watch.skew = -120_000
    const wid = W.phone.start('r1')
    await W.run(1000)
    W.watch.tick(0, null, { r: 5 })
    W.watch.tick(1, null, { r: 4 })
    await W.run(2000)
    expect(W.phone.S.active.entries[0].sets[0]).toMatchObject({ done: true, r: 5 })
    W.watch.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x5', '0001#0:20x4'])
  })

  it('the phone\'s clock jumps back a day (set by hand, a flight): the watch still takes its snapshots', async () => {
    W.phone.start('r1')
    await W.run(1000)
    vi.setSystemTime(Date.now() - 24 * 3600e3)
    W.phone.tick(0, 0, {})
    await W.run(2000)
    expect(W.watch.workout.entries[0].sets[0].done).toBe(true)
  })

  it('the phone\'s clock goes back an hour (a wrong manual time): the watch does not stay deaf', async () => {
    W.phone.start('r1')
    await W.run(1000)
    vi.setSystemTime(Date.now() - 3600e3)
    W.phone.tick(0, 0, {})
    await W.run(2000)
    expect(W.watch.workout.entries[0].sets[0].done).toBe(true)
  })
})

describe('a watch that is opened again and again while the phone app stays closed', () => {
  it('keeps one status waiting, not one per launch, and its sets all arrive', async () => {
    const wid = W.phone.start('r1')
    await W.run(1000)
    await W.phone.kill()
    W.setNear(false)
    W.watch.tick(0, null, {})
    for (let i = 0; i < 30; i++) { W.watch.kill(); await W.run(60_000); W.watch.launch() }
    W.watch.tick(0, null, { r: 7 })
    const types = W.watch.outbox.map(x => JSON.parse(x.json).type)
    expect(types.filter(t => t === 'watchStatus')).toHaveLength(1)
    expect(types.filter(t => t === 'setDone')).toHaveLength(2)
    await W.settle()
    expect(W.phone.S.active.entries[0].sets.map(s => [s.done, s.r])).toEqual([[true, 8], [true, 7], [false, 8]])
    W.phone.finish()
    await W.settle()
    atRest()
    expect(doneOf(saved(wid))).toEqual(['0025#0:60x8', '0025#1:60x7'])
  })
})

describe('the watch\'s own list of what it can start', () => {
  it('readyOf gives a session per routine', () => {
    expect(readyOf(routines).map(r => r.routineIds[0])).toEqual(['r1', 'r2'])
  })
})
