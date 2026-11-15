// @vitest-environment happy-dom
// The watch link under random abuse. Each run is a seeded string of things a lifter and a bad link
// can do, in any order: sets ticked on the phone and at the wrist (also the same set on both),
// fixed on the watch and edited on the phone, workouts started, finished and discarded on either
// side, the two out of reach of each other, either app in the background or killed (the watch even
// between sending a set and saving it; the phone woken by a watch's message), answers lost,
// transfers and snapshots late; rests started, stretched, skipped, paused and resumed on either
// side; sets added and taken out on the watch (#1139, #1185); a watch whose clock is off; the same
// exercise twice and a superset; sometimes a second watch, sometimes a watch on the first protocol.
// Then everything is let come to rest, and:
//
//   - every set ticked anywhere is in the saved workout it belongs to, exactly once, with the
//     numbers of whoever changed it last (unless its workout was discarded and not saved);
//   - no set is done that nobody ticked, no workout is saved twice, none is left running;
//   - nothing is left in any watch's outbox, the phone's queue or the system's transfer queues;
//   - while a workout runs on the phone and a watch, the two show the same sets done with the same
//     numbers, and (protocol 2) the same rest to within a second.
//
// A failing seed prints what happened, in order, so it can be replayed (RUN_SEED=<n>).
// WATCH_SIM_RUNS=<n> runs n seeds, SEED_FROM=<k> starting at seed k (for thousands, in batches).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWorld, seeded } from './watch-sim.js'
import { _resetWatchSync } from './watch-sync.js'

const T0 = 1_800_000_000_000
const RUNS = Number(process.env.WATCH_SIM_RUNS) || 120
const FROM = Number(process.env.SEED_FROM) || 1
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
  // the same exercise twice (started on the phone only: the watch's copy then names its sets by id)
  r3: { name: 'Bench twice', entries: [
    { id: '0025', target: null, sets: [{ w: 80, r: 5, done: false }, { w: 80, r: 5, done: false }] },
    { id: '0001', target: null, sets: [{ w: 20, r: 10, done: false }] },
    { id: '0025', target: null, sets: [{ w: 60, r: 10, done: false }] },
  ] },
  // a superset
  ss: { name: 'Superset', entries: [
    { id: '0027', sg: 'a', target: null, sets: [{ w: 50, r: 8, done: false }, { w: 50, r: 8, done: false }] },
    { id: '0033', sg: 'a', target: null, sets: [{ w: 12, r: 12, done: false }, { w: 12, r: 12, done: false }] },
  ] },
}
// How often an exercise may be in one saved workout (r3 has one twice).
const MAX_SAME = 2

beforeEach(() => { vi.useFakeTimers({ now: T0 }); localStorage.clear(); _resetWatchSync() })
afterEach(() => vi.useRealTimers())

async function play (seed) {
  const rand = seeded(seed)
  const pick = list => list[Math.floor(rand() * list.length)]
  const chance = p => rand() < p
  // What this seed's world is like: the phone's rest for each set, a watch on the first protocol,
  // its clock off, a second watch, a phone app woken by a watch's message.
  const restSec = pick([0, 90, 90, 60])
  const protocol = chance(0.15) ? 1 : 2
  const W = makeWorld({ routines, vi, restSec, protocol, pageInBackground: chance(0.3) })
  const { phone } = W
  W.coldLaunch = chance(0.5)
  // (a first-protocol watch sends no offset: "the later wins" follows its clock, so it is kept right)
  const skew = pick([0, 0, 0, 2000, -2000, 40_000, -40_000, 700])
  W.watch.skew = protocol >= 2 ? skew : 0
  // the watch starts what it last heard of, and never the routine with an exercise twice (it would
  // only have positions for those sets, which is what #1162 is about)
  W.watch.sessions = W.watch.sessions.filter(r => r.routineIds[0] !== 'r3')
  const two = chance(0.25) ? W.addWatch({ protocol: 2 }) : null
  if (two) { two.skew = pick([0, 1500, -30_000]); two.sessions = W.watch.sessions }
  const watches = W.watches
  const log = [`world: rest ${restSec}, protocol ${protocol}, skew ${W.watch.skew}, ${two ? `second watch (skew ${two.skew})` : 'one watch'}, cold launch ${W.coldLaunch}, page in background ${W.pageInBackground}`]
  // What was ticked, by workout and set (its id when the side that ticked it knew one, else
  // exercise and place): the last change (by its time, on the phone's clock) is what must be saved.
  const ticks = new Map()
  const discarded = new Set()
  // Exercises with a set ticked by its place (no id known to that side yet): a set added before it
  // or taken out would move the place this bookkeeping knows it by (not the set itself, which the
  // phone has by then), so the set menu leaves those exercises alone.
  const byPlace = new Set()
  const note = (who, wid, exId, si, sid, { w, r, at }) => {
    const k = sid ? `${wid}|sid:${sid}` : `${wid}|${exId}|${si}`
    if (!sid) byPlace.add(`${wid}|${exId}`)
    const have = ticks.get(k)
    if (!have || at >= have.at) ticks.set(k, { w, r, at, who })
    log.push(`${who} tick ${k} (${exId}#${si}) ${w}x${r} @${at - T0}`)
  }
  const numbers = () => ({ w: 20 + Math.floor(rand() * 40) * 2.5, r: 1 + Math.floor(rand() * 15) })
  const openSets = entries => entries.flatMap((e, ei) => e.sets.map((s, si) => (s.done ? null : [ei, si])).filter(Boolean))
  const anySets = entries => entries.flatMap((e, ei) => e.sets.map((s, si) => [ei, si]))
  const doneSets = entries => entries.flatMap((e, ei) => e.sets.map((s, si) => (s.done ? [ei, si] : null)).filter(Boolean))

  await phone.launch()
  for (const w of watches) w.launch()
  await W.run(500)

  const phoneUsable = async () => { if (!phone.page || phone.app !== 'front') { log.push('phone opens'); await phone.foreground(); await W.run(300) } }
  const aWatch = () => (two && chance(0.4) ? two : W.watch)
  const name = w => (w === W.watch ? 'watch' : 'watch2')
  const ops = [
    [14, async () => { const ms = pick([200, 700, 3000, 25_000, 90_000, 400_000]); log.push(`wait ${ms}`); await W.run(ms) }],
    [5, async () => { W.setNear(!W.near); log.push(W.near ? 'in reach' : 'out of reach') }],
    [two ? 2 : 0, async () => { W.setAway(two, !two.away); log.push(two.away ? 'watch2 alone out of reach' : 'watch2 back in reach') }],
    [3, async () => { if (phone.app === 'front') { phone.background(); log.push('phone to background') } }],
    [2, async () => { if (phone.page) { await phone.kill(); log.push('phone app killed') } }],
    [3, async () => { await phoneUsable() }],
    [2, async () => { const w = aWatch(); if (w.running) { w.kill(); log.push(`${name(w)} app killed`) } else { w.launch(); log.push(`${name(w)} app opens`) } }],
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
      // (a first-protocol watch names sets by their place only: no exercise twice for it)
      const wid = phone.start(pick(Object.keys(W.routines).filter(r => protocol >= 2 || r !== 'r3')))
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
      const sid = A.entries[at[0]].sets[at[1]].sid
      const when = phone.tick(at[0], at[1], n)
      note('phone', A.id, A.entries[at[0]].id, at[1], sid, { ...n, at: when })
    }],
    // A done set's numbers changed on the phone.
    [3, async () => {
      if (!phone.S.active) return
      await phoneUsable()
      const A = phone.S.active
      const at = A && pick(doneSets(A.entries))
      if (!at) return
      const row = A.entries[at[0]].sets[at[1]]
      const w = row.w + 2.5
      log.push('phone edits a done set')
      phone.edit(a => { a.entries[at[0]].sets[at[1]].w = w })
      note('phone edit', A.id, A.entries[at[0]].id, at[1], row.sid, { w, r: row.r, at: Date.now() })
    }],
    // The rest, on the phone.
    [4, async () => {
      if (!phone.S.active || !phone.timer) return
      await phoneUsable()
      if (!phone.timer) return
      const what = pick(['+15', '-15', 'skip', 'pause', 'resume'])
      log.push(`phone rest ${what}`)
      if (what === '+15') phone.ui.addRest(15)
      else if (what === '-15') phone.ui.addRest(-15)
      else if (what === 'skip') phone.ui.skipRest(Date.now())
      else if (what === 'pause') phone.ui.pauseRest()
      else phone.ui.resumeRest()
    }],
    [2, async () => {
      if (!phone.S.active) return
      await phoneUsable()
      if (!phone.S.active) return
      log.push(`phone finishes ${phone.S.active.id}`)
      phone.finish()
    }],
    [1, async () => {
      if (!phone.S.active) return
      await phoneUsable()
      if (!phone.S.active) return
      log.push(`phone discards ${phone.S.active.id}`)
      discarded.add(phone.S.active.id)
      phone.discard()
    }],
    [4, async () => {
      const w = aWatch()
      if (!w.running || w.workout) return
      const wid = w.start(pick(['r1', 'r2', 'ss']), { crash: chance(0.05) })
      log.push(`${name(w)} starts ${wid}${w.running ? '' : ' and dies'}`)
    }],
    [16, async () => {
      const w = aWatch()
      if (!w.running || !w.workout) return
      const Wk = w.workout
      const at = chance(0.12) ? pick(anySets(Wk.entries)) : pick(openSets(Wk.entries))
      if (!at) return
      const n = numbers()
      const ev = w.tick(at[0], at[1], { ...n, crash: chance(0.04) })
      if (ev) note(name(w), ev.wid, ev.exId, ev.setIdx, ev.sid, { ...n, at: ev.at - (ev.off || 0) })
      if (!w.running) log.push(`${name(w)} app died after sending`)
    }],
    // The rest, on a watch.
    [4, async () => {
      const w = aWatch()
      if (!w.running || !w.rest) return
      const what = pick(['+15', '-15', 'skip'])
      log.push(`${name(w)} rest ${what}`)
      if (what === 'skip') w.skipRest(); else w.addRest(what === '+15' ? 15 : -15)
    }],
    // The watch's set menu: a set added, or one not done taken out.
    [3, async () => {
      const w = aWatch()
      if (!w.running || !w.workout || w.protocol < 2) return
      const ei = pick(w.workout.entries.map((e, i) => i))
      if (ei == null) return
      const sets = w.workout.entries[ei].sets
      if (byPlace.has(`${w.workout.id}|${w.workout.entries[ei].id}`)) return
      if (chance(0.6) || sets.length < 2) {
        const ev = w.addSet(ei, { afterSi: chance(0.5) ? Math.floor(rand() * sets.length) : null })
        if (ev) log.push(`${name(w)} adds a set to ${ev.exId} (${ev.sid})`)
      } else {
        const si = Math.floor(rand() * sets.length)
        const ev = w.removeSet(ei, si)
        if (ev) log.push(`${name(w)} takes out ${ev.exId}#${si} (${ev.sid})`)
      }
    }],
    [2, async () => {
      const w = aWatch()
      if (!w.running || !w.workout) return
      log.push(`${name(w)} finishes ${w.workout.id}`)
      w.finish()
    }],
    [1, async () => {
      const w = aWatch()
      if (!w.running || !w.workout) return
      log.push(`${name(w)} discards ${w.workout.id}`)
      discarded.add(w.workout.id)
      w.discard()
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
      else if (A.entries[ei].sets.length > 1 && !A.entries[ei].sets[A.entries[ei].sets.length - 1].done) { log.push(`phone removes the last row of ${A.entries[ei].id}`); phone.edit(a => { a.entries[ei].sets.pop() }) }
    }],
  ]
  const total = ops.reduce((a, [w]) => a + w, 0)
  for (let step = 0; step < STEPS; step++) {
    let x = rand() * total
    const op = ops.find(([w]) => (x -= w) < 0) || ops[0]
    await op[1]()
    await W.run(100)        // never two things in the same millisecond
  }

  // Everything comes to rest. A workout still running on the phone and a watch shows the same on
  // both; then each side finishes what it still runs (the watches' own first, as the lifter at the
  // wrist would).
  const problems = []
  await W.settle()
  const rows = entries => entries.map(e => e.id + ':' + e.sets.map(s => (s.done ? `${s.w}x${s.r}` : '-')).join(','))
  for (const w of watches) {
    if (!phone.S.active || w.workout?.id !== phone.S.active.id) continue
    const a = rows(phone.S.active.entries), b = rows(w.workout.entries)
    if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`the phone and ${name(w)} differ mid-workout: phone ${a} | ${name(w)} ${b}`)
    if (w.protocol >= 2) {
      const gap = W.restGap(w)
      if (gap !== null && gap > 1000) problems.push(`the rest differs between the phone and ${name(w)} by ${gap} ms (phone ${JSON.stringify(phone.timer)}, ${name(w)} ${w.restEndsAt})`)
    }
  }
  for (let i = 0; i < 8 && (phone.S.active || watches.some(w => w.workout)); i++) {
    const w = watches.find(x => x.workout)
    if (w) { log.push(`(end) ${name(w)} finishes ${w.workout.id}`); w.finish() } else { log.push(`(end) phone finishes ${phone.S.active.id}`); phone.finish() }
    await W.settle()
  }

  if (phone.S.active) problems.push(`still running on the phone: ${phone.S.active.id}`)
  for (const w of watches) {
    if (w.workout) problems.push(`still running on ${name(w)}: ${w.workout.id}`)
    if (w.outbox.length) problems.push(`left in ${name(w)}'s outbox: ${w.outbox.map(x => x.json).join(' ')}`)
    if (w.link.transfers.length) problems.push(`transfers never delivered to the phone from ${name(w)}: ${w.link.transfers.length}`)
  }
  if (phone.queueFile.length) problems.push(`left in the phone's queue: ${JSON.stringify(phone.queueFile)}`)
  const ids = phone.S.workouts.map(w => w.id)
  if (new Set(ids).size !== ids.length) problems.push(`a workout saved twice: ${ids}`)
  const seen = new Set()
  for (const w of phone.S.workouts) {
    const count = {}
    for (const e of w.entries) count[e.id] = (count[e.id] || 0) + 1
    if (Object.values(count).some(c => c > MAX_SAME)) problems.push(`${w.id}: an exercise too often: ${w.entries.map(e => e.id)}`)
    const sids = w.entries.flatMap(e => e.sets.map(s => s.sid).filter(Boolean))
    if (new Set(sids).size !== sids.length) problems.push(`${w.id}: a set id twice: ${sids}`)
    for (const e of w.entries) e.sets.forEach((s, si) => {
      if (!s.done) return
      const keys = [...(s.sid ? [`${w.id}|sid:${s.sid}`] : []), `${w.id}|${e.id}|${si}`]
      // The same set can have been ticked by its id on one side and by its place on the other (a
      // watch that had no ids for it yet, or a first-protocol one): the later of the two counts.
      const k = keys.filter(x => ticks.has(x)).sort((a, b) => ticks.get(b).at - ticks.get(a).at)[0]
      keys.forEach(x => seen.add(x))
      const t = k && ticks.get(k)
      if (!t) problems.push(`${keys.join(' / ')} is done, nobody ticked it`)
      else if (t.w !== s.w || t.r !== s.r) problems.push(`${k} saved as ${s.w}x${s.r}, last changed to ${t.w}x${t.r} by the ${t.who}`)
    })
  }
  for (const [k, t] of ticks) {
    const wid = k.split('|')[0]
    if (discarded.has(wid) && !ids.includes(wid)) continue
    if (!seen.has(k)) problems.push(`lost: ${k} ${t.w}x${t.r} ticked on the ${t.who}`)
  }

  if (process.env.WATCH_SIM_DUMP) console.log(JSON.stringify({ workouts: phone.S.workouts, ticks: [...ticks] }, null, 1))
  await phone.kill()
  if (process.env.WATCH_SIM_LOG) console.log(`seed ${seed}: ${ticks.size} sets, ${phone.S.workouts.length} workouts, ${log.length} steps\n` + (process.env.WATCH_SIM_LOG === 'full' ? log.join('\n') : ''))
  return { problems, log }
}

describe('whatever the link and the two apps do, every set ends up saved exactly once', () => {
  const only = Number(process.env.RUN_SEED) || 0
  const seeds = only ? [only] : Array.from({ length: RUNS }, (_, i) => i + FROM)
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
