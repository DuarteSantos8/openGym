// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

// The live widget's payloads and buttons (lib/live-tiles.js, lib/live-adjust.js, the v1.4.5 part
// of lib/live-activity.js): every text finite and short, the Live Activity inside 4 KB whatever
// the layout, and every button an event that is applied once, by its id, from any surface.
vi.mock('./mobile.js', () => ({ MOBILE: true, nativePlatform: async () => 'ios' }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const LA = await import('./live-activity.js')
const T = await import('./live-tiles.js')
const J = await import('./live-adjust.js')
const LL = await import('./live-layout.js')
const G = await import('./live-glance.js')

const set = (over = {}) => ({ w: 60, r: 8, done: false, ...over })
const entry = (id, sets, over = {}) => ({ id, target: { mode: 'reps', restSec: 120 }, sets, ...over })
const S = (active, over = {}) => ({ unit: 'kg', restSec: 90, accent: 'lime', effort: 'rir', active, ...over })
const bytes = o => new TextEncoder().encode(JSON.stringify(o)).length
const finiteEverywhere = o => JSON.stringify(o, (k, v) => { if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('not finite at ' + k); return v }) && true

afterEach(() => { LA._resetLiveActivity(); localStorage.clear() })

describe('clip', () => {
  it('makes one short line of anything, never half an emoji', () => {
    expect(T.clip(null)).toBe('')
    expect(T.clip('  a\n\tb  ')).toBe('a b')
    const long = '💪'.repeat(80)
    const c = T.clip(long, 10)
    expect(Array.from(c).length).toBe(10)
    expect(c.endsWith('…')).toBe(true)
    expect(c).not.toMatch(/�/)
  })
})

describe('tile texts', () => {
  const A = { id: 'w', name: 'Legs', start: Date.now() - 600e3, cur: 0, entries: [
    entry('0025', [set({ done: true, rir: 2, at: 5, hr: { avg: 130, max: 150 } }), set({ w: 80, r: 6, rir: 1, bands: ['b-red'], note: 'slow down' })]),
    entry('0043', [set({ w: 100, r: 5 })], { sg: 'g' }),
    entry('0001', [set()], { sg: 'g' }),
  ] }
  it('works out the set tiles of one set, leaving out what it has nothing to say about', () => {
    const v = T.setValues(S(A, { bands: [{ id: 'b-red', name: 'Red', color: '#eb5757' }] }), A, 0, 1, ['weight', 'reps', 'effort', 'warm', 'band', 'notes', 'speed', 'dist', 'next', 'partner', 'equip'])
    expect(v.weight).toBe('80 kg')
    expect(v.reps).toBe('6')
    expect(v.effort).toBe('RIR 1')
    expect(v.band).toBe('Red')
    expect(v.notes).toBe('slow down')
    expect(v.speed).toBeUndefined()
    expect(v.dist).toBeUndefined()
    expect(v.next).toMatch(/\+/)
    expect(v.partner).toBeUndefined()
    expect(T.setValues(S(A), A, 1, 0, ['partner']).partner).toBeTruthy()
  })
  it('reads cardio as time, distance, speed and incline', () => {
    const C = { id: 'c', start: 1, cur: 0, entries: [{ id: '0685', target: { mode: 'cardio', min: 20, speed: 8 }, sets: [{ min: 25, speed: 9.5, km: 4, incline: 3, done: false }] }] }
    const v = T.setValues(S(C), C, 0, 0, ['time', 'dist', 'speed', 'incline', 'weight', 'reps'])
    expect(v.time).toBe('25 min')
    expect(v.dist).toMatch(/^4 km/)
    expect(v.speed).toMatch(/9\.5/)
    expect(v.incline).toBe('3%')
    expect(v.weight).toBeUndefined()
  })
  it('takes the live heart rate first, else the watch\'s last set, and hides it without either', () => {
    expect(T.heartNow(A, { bpm: 141 })).toEqual({ bpm: 141, src: 'live' })
    expect(T.heartNow(A, null)).toEqual({ bpm: 130, src: 'watch' })
    expect(T.heartNow({ entries: [] }, { bpm: NaN })).toBeNull()
    expect(T.sessionValues(S({ ...A, entries: [entry('0025', [set()])] }), { entries: [entry('0025', [set()])] }, ['hr', 'hrZone']).hr).toBeUndefined()
  })
  it('gives a zone only with a birth year', () => {
    const now = new Date('2026-06-01').getTime()
    expect(T.hrZone(150, { birthYear: 1996 }, now)).toBe(4)
    expect(T.hrZone(120, { birthYear: 1996 }, now)).toBe(2)
    expect(T.hrZone(150, {}, now)).toBeNull()
    expect(T.hrZone(NaN, { birthYear: 1996 }, now)).toBeNull()
  })
  it('counts sets and keeps every session text short', () => {
    const v = T.sessionValues(S(A), A, ['sets', 'workout', 'gym', 'kcal', 'volume'])
    expect(v.sets).toBe('1/4')
    expect(v.workout).toBe('Legs')
    expect(v.gym).toBeUndefined()
    for (const x of Object.values(v)) expect(Array.from(x).length).toBeLessThanOrEqual(T.TEXT_MAX)
  })
})

describe('− and + lists', () => {
  const A = { id: 'w', cur: 0, entries: [entry('0025', [set({ w: 80, r: 8, rir: 2 })]), { id: '0685', target: { mode: 'cardio' }, sets: [{ min: 20 }] }] }
  it('walks the weight on its step and the reps by one, a few steps either side', () => {
    const adj = J.adjustFor(S(A), A, 0, 0, ['w', 'r', 'e'])
    expect(adj.w.v[adj.w.i]).toBe(80)
    expect(adj.w.v.length).toBeLessThanOrEqual(2 * J.LIVE_STEPS + 1)
    expect(adj.w.t[adj.w.i]).toBe('80 kg')
    expect(adj.r.v[adj.r.i]).toBe(8)
    expect(adj.e.t[adj.e.i]).toBe('RIR 2')
    expect(J.stepped(adj, 'w', 1)).toBeGreaterThan(80)
    expect(J.stepped(adj, 'r', -1)).toBe(7)
    finiteEverywhere(adj)
  })
  it('has nothing for cardio, and no effort with effort off', () => {
    expect(J.adjustFor(S(A), A, 1, 0, ['w', 'r', 'e'])).toEqual({})
    expect(J.adjustFor(S(A, { effort: 'none' }), A, 0, 0, ['e'])).toEqual({})
  })
  it('goes round the effort scale, through "not rated"', () => {
    const lad = J.effortLadder(S(null), 5)
    expect(lad.v[0]).toBe(J.NO_EFFORT)
    expect(J.stepped({ e: lad }, 'e', 1)).toBe(J.NO_EFFORT)
  })
})

describe('the Live Activity with the glance', () => {
  const big = () => {
    const long = 'Ultra wide single arm landmine rotational press with a pause '.repeat(3)
    const entries = Array.from({ length: 10 }, (_, i) => entry('c' + i, Array.from({ length: 6 }, () => set({ bands: ['b-red'], note: 'ноты '.repeat(30) })), { target: { name: long + i, mode: 'reps' } }))
    const everything = { look: 'detailed', show: Object.fromEntries(G.SHOW_KEYS.map(k => [k, true])), buttons: Object.fromEntries(G.BUTTON_KEYS.map(k => [k, true])), kinds: { lift: { d: G.KIND_DETAILS.lift, b: G.KIND_BUTTONS.lift } } }
    return S({ id: 'w', name: 'Day', start: 1, cur: 0, entries }, { liveWidget: everything, bands: [{ id: 'b-red', name: 'красная лента '.repeat(2), color: '#eb5757' }] })
  }
  it('stays inside 4 KB with every tile and button on, and every number finite', () => {
    const live = LA.buildLiveActivity(big(), { endsAt: 5000, total: 90 }, {}, { live: { bpm: 150 }, now: 1e6 })
    expect(bytes(live)).toBeLessThanOrEqual(3600)
    expect(live.state.cur).toBeTruthy()
    finiteEverywhere(live)
  })
  it('sends each set its kind, its words and its buttons, and the settings once', () => {
    const A = { id: 'w', start: 1, cur: 0, entries: [entry('0025', [set({ w: 80, r: 8 }), set({ w: 82.5, r: 8 })]), entry('0043', [set({ w: 100, r: 5 })])] }
    const live = LA.buildLiveActivity(S(A, { liveWidget: { buttons: { adjust: true } } }))
    const st = live.state
    expect(st.cur.kd).toBeUndefined()
    expect(st.cur.tv.weight).toBe('80 kg')
    expect(st.ahead[0].tv.weight).toBe('82.5 kg')
    expect(st.cur.b).toEqual(['log', 'wDown', 'wUp', 'rDown', 'rUp', 'effort', 'next'])
    expect(st.cur.adj.r.v[st.cur.adj.r.i]).toBe(8)
    expect(st.cur.adj.w.v[st.cur.adj.w.i]).toBe(80)
    // − and + lists only for the set shown and the one right after it, to stay small.
    expect(st.ahead[1]?.adj).toBeUndefined()
    expect(st.g).toMatchObject({ lk: 'detailed', nx: true, rb: ['log', 'restAdd', 'restSkip'] })
    expect(st.tl['a.log']).toBe('Log set')
    expect(st.tl['a.wUp']).toBe('More weight')
    expect(st.lay).toBeUndefined()
  })
  it('carries the 180 px still the app ships, by its path in the package, only when the picture is on', () => {
    const A = { id: 'w', start: 1, cur: 0, entries: [entry('0025', [set()])] }
    const on = LA.buildLiveActivity(S(A, { liveWidget: { show: { picture: true } } }))
    expect(on.state.cur.img).toMatch(/^exercise-media\/still\/[\w-]+\.(webp|png|jpe?g)$/)
    expect(on.state.g.pic).toBe(true)
    const off = LA.buildLiveActivity(S(A))
    expect(off.state.cur.img).toBeUndefined()
  })
  it('falls back to the classic card rather than going over', () => {
    const live = { attributes: {}, state: { cur: { exName: 'x'.repeat(5000) }, ahead: [], unitStarts: [], g: { lk: 'clean' }, tl: {} } }
    LA.fitLive(live)
    expect(live.state.g).toBeUndefined()
  })
})

describe('the buttons, from any surface', () => {
  const mk = () => {
    let state = { S: S({ id: 'w', start: 1, cur: 0, entries: [entry('0025', [set({ w: 80, r: 8 }), set()]), entry('0043', [set()])] }) }
    const st = () => ({ ...state, update: fn => { const d = structuredClone(state.S); fn(d); state = { ...state, S: d } } })
    return { st, get S () { return state.S } }
  }
  const handlersFor = box => {
    const calls = []
    LA.bindLiveActions({
      setDone: (i, j) => { calls.push(['done', i, j]); box.st().update(s => { s.active.entries[i].sets[j].done = true }) },
      next: i => calls.push(['next', i]),
      restSkip: () => calls.push(['skip']),
      restAdd: sec => calls.push(['add', sec]),
      addSet: i => calls.push(['addSet', i]),
      pause: on => calls.push(['pause', on]),
      finish: () => calls.push(['finish']),
      timer: () => ({ endsAt: Date.now() + 60e3, total: 90 }),
    })
    return calls
  }
  it('applies a weight step once, whatever the queue sends twice', () => {
    const box = mk()
    handlersFor(box)
    const ev = { id: 'n1', type: 'adjust', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0, field: 'w', value: 82.5 }
    expect(LA.applyLiveEvents([ev, ev], box.st)).toEqual(['n1', 'n1'])
    expect(box.S.active.entries[0].sets[0].w).toBe(82.5)
    expect(LA.applyLiveEvents([ev], box.st)).toEqual(['n1'])
  })
  it('leaves a logged set alone and refuses junk numbers', () => {
    const box = mk()
    handlersFor(box)
    box.st().update(s => { s.active.entries[0].sets[0].done = true })
    LA.applyLiveEvents([{ id: 'n2', type: 'adjust', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0, field: 'w', value: 200 }], box.st)
    LA.applyLiveEvents([{ id: 'n3', type: 'adjust', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 1, field: 'r', value: NaN }], box.st)
    expect(box.S.active.entries[0].sets[0].w).toBe(80)
    expect(box.S.active.entries[0].sets[1].r).toBe(8)
  })
  it('sets the effort on the profile\'s scale, and clears it with "not rated"', () => {
    const box = mk()
    handlersFor(box)
    LA.applyLiveEvents([{ id: 'e1', type: 'adjust', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0, field: 'e', value: 3 }], box.st)
    expect(box.S.active.entries[0].sets[0].rir).toBe(3)
    LA.applyLiveEvents([{ id: 'e2', type: 'adjust', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0, field: 'e', value: J.NO_EFFORT }], box.st)
    expect(box.S.active.entries[0].sets[0].rir).toBeUndefined()
  })
  it('runs the in-app card\'s Log set through the same path, so a Lock Screen tap for that set does nothing more', () => {
    const box = mk()
    const calls = handlersFor(box)
    expect(LA.runLiveAction('log', box.st)).toBe(true)
    LA.applyLiveEvents([{ id: 'lock-1', type: 'setDone', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0 }], box.st)
    expect(calls.filter(c => c[0] === 'done')).toEqual([['done', 0, 0]])
  })
  it('pauses to the state asked for, not as a toggle', () => {
    const box = mk()
    const calls = handlersFor(box)
    LA.applyLiveEvents([{ id: 'p1', type: 'pause', wid: 'w', on: true }, { id: 'p2', type: 'pause', wid: 'w', on: false }], box.st)
    expect(calls).toEqual([['pause', true]])
  })
  it('adds rest only to the rest it was tapped on, a minute at the most', () => {
    const box = mk()
    const calls = handlersFor(box)
    LA.applyLiveEvents([{ id: 'r1', type: 'restAdd', wid: 'w', sec: 9999, at: Date.now() }], box.st)
    expect(calls).toEqual([['add', 60]])
  })
  it('goes back an exercise, adds a set, and makes a set a warm-up', () => {
    const box = mk()
    const calls = handlersFor(box)
    box.st().update(s => { s.active.cur = 1 })
    LA.applyLiveEvents([{ id: 'v1', type: 'prev', wid: 'w', fromEntryIdx: 1 }, { id: 'v2', type: 'addSet', wid: 'w', exId: '0043', entryIdx: 1 }], box.st)
    expect(calls).toEqual([['next', 0], ['addSet', 1]])
    LA.applyLiveEvents([{ id: 'v3', type: 'warm', wid: 'w', exId: '0025', entryIdx: 0, setIdx: 0 }], box.st)
    expect(box.S.active.entries[0].sets.some(x => x.phase === 'warmup' || x.warmup === true)).toBe(true)
  })
  it('makes no event for a button that means nothing now', () => {
    const box = mk()
    expect(LA.liveActionEvent('restSkip', box.S, { timer: null })).toBeNull()
    expect(LA.liveActionEvent('restAdd', box.S, { timer: { endsAt: 1, total: 1 } })).toMatchObject({ type: 'restAdd', sec: LL.REST_ADD_SEC })
    expect(LA.liveActionEvent('wUp', box.S)).toMatchObject({ type: 'adjust', field: 'w' })
    expect(LA.liveActionEvent('nope', box.S)).toBeNull()
  })
  it('opens the Finish sheet once the workout screen is there', async () => {
    const box = mk()
    LA.requestLiveFinish()
    const calls = handlersFor(box)
    await new Promise(r => setTimeout(r, 1))
    expect(calls).toEqual([['finish']])
  })
})
