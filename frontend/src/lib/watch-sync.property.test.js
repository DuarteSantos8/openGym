// @vitest-environment happy-dom
// The watch link under random abuse. Each run is a seeded string of things a lifter and a bad link
// can do, in any order: sets ticked on the phone and at the wrist (also the same set on both),
// workouts started and finished on either side, the two out of reach of each other, either app
// in the background or killed (the watch even between sending a set and saving it), answers lost,
// transfers and snapshots late. Then everything is let come to rest, and:
//
//   - every set ticked anywhere is in the saved workout it belongs to, exactly once, with the
//     numbers of whoever ticked it last;
//   - no set is done that nobody ticked, no workout is saved twice, none is left running;
//   - nothing is left in the watch's outbox, the phone's queue or the system's transfer queue;
//   - while a workout runs on both, the two show the same sets done with the same numbers.
//
// A failing seed prints what happened, in order, so it can be replayed (RUN_SEED=<n>).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWorld, seeded } from './watch-sim.js'
import { _resetWatchSync } from './watch-sync.js'

const T0 = 1_800_000_000_000
const RUNS = Number(process.env.WATCH_SIM_RUNS) || 120
const STEPS = 45
const routines = {
  r1: { name: 'Push', entries: [
    { id: '0025', target: null, sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
    { id: '0001', target: null, sets: [{ w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] },
  ] },
  r2: { name: 'Pull', entries: [
    { id: '0027', target: null, sets: [{ w: 80, r: 6, done: false }, { w: 80, r: 6, done: false }] },
    { id: '0033', target: null, sets: [{ w: 12, r: 12, done: false }] },
  ] },
}

beforeEach(() => { vi.useFakeTimers({ now: T0 }); localStorage.clear(); _resetWatchSync() })
afterEach(() => vi.useRealTimers())

async function play (seed) {
  const rand = seeded(seed)
  const pick = list => list[Math.floor(rand() * list.length)]
  const chance = p => rand() < p
  const W = makeWorld({ routines, vi })
  const { phone, watch } = W
  const log = []
  // What was ticked, by workout, exercise and set: the last tick (by its time) is what must be saved.
  const ticks = new Map()
  const note = (who, wid, exId, si, { w, r, at }) => {
    const k = `${wid}|${exId}|${si}`
    const have = ticks.get(k)
    if (!have || at >= have.at) ticks.set(k, { w, r, at, who })
    log.push(`${who} tick ${k} ${w}x${r} @${at - T0}`)
  }
  const numbers = () => ({ w: 20 + Math.floor(rand() * 40) * 2.5, r: 1 + Math.floor(rand() * 15) })
  const openSets = entries => entries.flatMap((e, ei) => e.sets.map((s, si) => (s.done ? null : [ei, si])).filter(Boolean))
  const anySets = entries => entries.flatMap((e, ei) => e.sets.map((s, si) => [ei, si]))

  await phone.launch()
  watch.launch()
  await W.run(500)

  const phoneUsable = async () => { if (!phone.page || phone.app !== 'front') { log.push('phone opens'); await phone.foreground(); await W.run(300) } }
  const ops = [
    [14, async () => { const ms = pick([200, 700, 3000, 25_000, 90_000, 400_000]); log.push(`wait ${ms}`); await W.run(ms) }],
    [5, async () => { W.setNear(!W.near); log.push(W.near ? 'in reach' : 'out of reach') }],
    [3, async () => { if (phone.app === 'front') { phone.background(); log.push('phone to background') } }],
    [2, async () => { if (phone.page) { await phone.kill(); log.push('phone app killed') } }],
    [3, async () => { await phoneUsable() }],
    [2, async () => { if (watch.running) { watch.kill(); log.push('watch app killed') } else { watch.launch(); log.push('watch app opens') } }],
    [3, async () => {
      const fate = pick(['ok', 'ok', 'lost', 'replyLost', 'mixed'])
      W.messageFate = fate === 'mixed' ? () => pick(['ok', 'lost', 'replyLost']) : () => fate
      const slow = chance(0.5)
      W.transferDelay = () => (slow ? Math.floor(rand() * 8000) : 0)
      W.contextDelay = () => (slow ? Math.floor(rand() * 5000) : 0)
      W.snapshotMessage = () => !slow || chance(0.5)
      log.push(`link: messages ${fate}${slow ? ', slow' : ''}`)
    }],
    [4, async () => {
      if (phone.S.active) return
      await phoneUsable()
      if (phone.S.active) return
      const wid = phone.start(pick(Object.keys(W.routines)))
      log.push(`phone starts ${wid}`)
    }],
    [12, async () => {
      if (!phone.S.active) return
      await phoneUsable()
      const A = phone.S.active
      if (!A) return
      const at = chance(0.12) ? pick(anySets(A.entries)) : pick(openSets(A.entries))
      if (!at) return
      const n = numbers()
      const when = phone.tick(at[0], at[1], n)
      note('phone', A.id, A.entries[at[0]].id, at[1], { ...n, at: when })
    }],
    [2, async () => {
      if (!phone.S.active) return
      await phoneUsable()
      if (!phone.S.active) return
      log.push(`phone finishes ${phone.S.active.id}`)
      phone.finish()
    }],
    [4, async () => {
      if (!watch.running || watch.workout) return
      const wid = watch.start(pick(['r1', 'r2']), { crash: chance(0.05) })
      log.push(`watch starts ${wid}${watch.running ? '' : ' and dies'}`)
    }],
    [16, async () => {
      if (!watch.running || !watch.workout) return
      const Wk = watch.workout
      const at = chance(0.12) ? pick(anySets(Wk.entries)) : pick(openSets(Wk.entries))
      if (!at) return
      const n = numbers()
      const ev = watch.tick(at[0], at[1], { ...n, crash: chance(0.04) })
      if (ev) note('watch', ev.wid, ev.exId, ev.setIdx, { ...n, at: ev.at })
      if (!watch.running) log.push('watch app died after sending')
    }],
    [2, async () => {
      if (!watch.running || !watch.workout) return
      log.push(`watch finishes ${watch.workout.id}`)
      watch.finish()
    }],
    // The plan changes on the phone (a routine edited there or on the web) and the watch, which
    // starts routines from the copy it last heard, does not know.
    [2, async () => {
      const cut = chance(0.5)
      W.routines.r1 = cut
        ? { name: 'Push', entries: [{ id: '0025', target: null, sets: [{ w: 50, r: 5, done: false }] }, { id: '0033', target: null, sets: [{ w: 12, r: 12, done: false }] }] }
        : JSON.parse(JSON.stringify(routines.r1))
      if (chance(0.3)) delete W.routines.r2; else W.routines.r2 = JSON.parse(JSON.stringify(routines.r2))
      log.push(`plan on the phone: r1 ${cut ? 'cut down' : 'as it was'}, r2 ${W.routines.r2 ? 'there' : 'deleted'}`)
    }],
    // An exercise with nothing done, or a row not done, is taken out of the running workout on the phone.
    [3, async () => {
      if (!phone.S.active) return
      await phoneUsable()
      const A = phone.S.active
      if (!A) return
      const ei = pick(A.entries.map((e, i) => i))
      if (ei == null) return
      if (chance(0.5) && A.entries[ei].sets.every(s => !s.done)) { log.push(`phone removes exercise ${A.entries[ei].id}`); phone.edit(a => { a.entries.splice(ei, 1) }) }
      else if (A.entries[ei].sets.length && !A.entries[ei].sets[A.entries[ei].sets.length - 1].done) { log.push(`phone removes the last row of ${A.entries[ei].id}`); phone.edit(a => { a.entries[ei].sets.pop() }) }
    }],
  ]
  const total = ops.reduce((a, [w]) => a + w, 0)
  for (let step = 0; step < STEPS; step++) {
    let x = rand() * total
    const op = ops.find(([w]) => (x -= w) < 0) || ops[0]
    await op[1]()
    await W.run(100)        // never two things in the same millisecond
  }

  // Everything comes to rest. A workout still running on both shows the same on both; then each
  // side finishes what it still runs (the watch's own first, as the lifter at the wrist would).
  const problems = []
  await W.settle()
  if (phone.S.active && watch.workout?.id === phone.S.active.id) {
    const rows = entries => entries.map(e => e.id + ':' + e.sets.map(s => (s.done ? `${s.w}x${s.r}` : '-')).join(','))
    const a = rows(phone.S.active.entries), b = rows(watch.workout.entries)
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`the two sides differ mid-workout: phone ${a} | watch ${b}`)
  }
  for (let i = 0; i < 6 && (phone.S.active || watch.workout); i++) {
    if (watch.workout) { log.push(`(end) watch finishes ${watch.workout.id}`); watch.finish() } else { log.push(`(end) phone finishes ${phone.S.active.id}`); phone.finish() }
    await W.settle()
  }

  if (phone.S.active) problems.push(`still running on the phone: ${phone.S.active.id}`)
  if (watch.workout) problems.push(`still running on the watch: ${watch.workout.id}`)
  if (watch.outbox.length) problems.push(`left in the watch's outbox: ${watch.outbox.map(x => x.json).join(' ')}`)
  if (phone.queueFile.length) problems.push(`left in the phone's queue: ${JSON.stringify(phone.queueFile)}`)
  if (W.link.transfers.length) problems.push(`transfers never delivered: ${W.link.transfers.length}`)
  const ids = phone.S.workouts.map(w => w.id)
  if (new Set(ids).size !== ids.length) problems.push(`a workout saved twice: ${ids}`)
  const seen = new Set()
  for (const w of phone.S.workouts) {
    const exIds = w.entries.map(e => e.id)
    if (new Set(exIds).size !== exIds.length) problems.push(`${w.id}: an exercise twice: ${exIds}`)
    for (const e of w.entries) e.sets.forEach((s, si) => {
      if (!s.done) return
      const k = `${w.id}|${e.id}|${si}`
      seen.add(k)
      const t = ticks.get(k)
      if (!t) problems.push(`${k} is done, nobody ticked it`)
      else if (t.w !== s.w || t.r !== s.r) problems.push(`${k} saved as ${s.w}x${s.r}, last ticked ${t.w}x${t.r} by the ${t.who}`)
    })
  }
  for (const [k, t] of ticks) if (!seen.has(k)) problems.push(`lost: ${k} ${t.w}x${t.r} ticked on the ${t.who}`)

  await phone.kill()
  if (process.env.WATCH_SIM_LOG) console.log(`seed ${seed}: ${ticks.size} sets, ${phone.S.workouts.length} workouts, ${log.length} steps\n` + (process.env.WATCH_SIM_LOG === 'full' ? log.join('\n') : ''))
  return { problems, log }
}

describe('whatever the link and the two apps do, every set ends up saved exactly once', () => {
  const only = Number(process.env.RUN_SEED) || 0
  const seeds = only ? [only] : Array.from({ length: RUNS }, (_, i) => i + 1)
  // In batches, so a failure names its seeds without one test running for minutes.
  for (let from = 0; from < seeds.length; from += 20) {
    const batch = seeds.slice(from, from + 20)
    it(`seeds ${batch[0]} to ${batch[batch.length - 1]}`, async () => {
      const failed = []
      for (const seed of batch) {
        vi.setSystemTime(T0); localStorage.clear(); _resetWatchSync()
        const { problems, log } = await play(seed)
        if (problems.length) failed.push(`seed ${seed}\n  ${problems.join('\n  ')}\n  --- what happened ---\n  ${log.join('\n  ')}`)
      }
      expect(failed.slice(0, 2).join('\n\n')).toBe('')
    }, 120_000)
  }
})
