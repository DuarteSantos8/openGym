// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

// The live widget v2 (lib/live-glance.js): what each surface shows for each kind of exercise and
// each moment, the settings and their migration from the v1 builder, the payload's size, and the
// buttons as events applied once, whichever surface they came from.
vi.mock('./mobile.js', () => ({ MOBILE: true, nativePlatform: async () => 'ios' }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const G = await import('./live-glance.js')
const LL = await import('./live-layout.js')
const LA = await import('./live-activity.js')
const SM = await import('./live-samples.js')

const NOW = 1_800_000_000_000
const S = (over = {}) => ({ unit: 'kg', restSec: 90, accent: 'brand', effort: 'rir', birthYear: 1990, ...over })
const bytes = o => new TextEncoder().encode(JSON.stringify(o)).length
const finiteEverywhere = o => JSON.stringify(o, (k, v) => { if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('not finite at ' + k); return v }) && true
const view = (id, over = {}, surface = 'lock') => {
  const live = SM.sampleLive(S(over), id, { now: NOW })
  return { live, v: G.glanceView(live.attributes, live.state, surface, NOW) }
}

afterEach(() => { LA._resetLiveActivity(); localStorage.clear() })

describe('settings', () => {
  it('reads junk as the defaults and keeps only what it knows', () => {
    expect(G.normalizeGlance(null)).toEqual(G.normalizeGlance({}))
    const n = G.normalizeGlance({ v: 9, look: 'neon', show: { heart: 'yes', next: false, rocket: true }, buttons: { adjust: true }, card: 1, kinds: { lift: { d: ['effort', 'laser'], b: ['wUp', 'finish'] }, yoga: { d: [] } } })
    expect(n.look).toBe('detailed')
    expect(n.show.heart).toBe(true)
    expect(n.show.next).toBe(false)
    expect(n.show.rocket).toBeUndefined()
    expect(n.buttons.adjust).toBe(true)
    expect(n.card).toBe(false)
    expect(n.kinds).toEqual({ lift: { d: ['effort'], b: ['wUp'] } })
    expect(G.isDefaultGlance(null)).toBe(true)
    expect(G.isDefaultGlance(n)).toBe(false)
  })
  it('prefers v2 and never needs v1', () => {
    expect(G.glanceOf({ liveWidget: { look: 'clean' }, liveLayout: LL.presetLayout('everything') }).look).toBe('clean')
    expect(G.glanceOf({})).toEqual(G.normalizeGlance(null))
    expect(G.glanceOf(null)).toEqual(G.normalizeGlance(null))
  })
})

describe('migration from the v1 builder', () => {
  const m = id => G.migrateV1(LL.presetLayout(id))
  it('a default or untouched layout is the v2 default', () => {
    expect(G.migrateV1(null)).toEqual(G.normalizeGlance(null))
    expect(m('default')).toEqual(G.normalizeGlance(null))
    expect(G.migrateV1({ v: 1 })).toEqual(G.normalizeGlance(null))
    expect(G.migrateV1('garbage')).toEqual(G.normalizeGlance(null))
  })
  it('maps every preset to its spirit', () => {
    expect(m('minimal').look).toBe('clean')
    expect(m('minimal').card).toBe(true)
    const lifter = m('lifter')
    expect(lifter.buttons.adjust).toBe(true)
    expect(lifter.show.effort && lifter.show.record && lifter.show.next).toBe(true)
    const cardio = m('cardio')
    expect(cardio.show.heart && cardio.show.elapsed && cardio.show.calories).toBe(true)
    expect(cardio.buttons.pause).toBe(true)
    const all = m('everything')
    expect(Object.values(all.show).every(Boolean)).toBe(true)
    expect(Object.values(all.buttons).every(Boolean)).toBe(true)
    expect(all.look).toBe('detailed')
  })
  it('keeps every hand-picked choice that still means something, switches nothing off', () => {
    const custom = LL.normalizeLayout({ lock: { t: ['ex', 'still', 'kcal'], a: ['restAdd', 'rUp', 'log'] }, island: { t: ['hrZone'] }, widget: { t: ['pr'] }, app: { t: [], a: [] } })
    const g = G.migrateV1(custom)
    expect(g.show.picture && g.show.calories && g.show.heart && g.show.record).toBe(true)
    expect(g.buttons.adjust && g.buttons.addRest).toBe(true)
    expect(g.card).toBe(false)
    for (const k of G.SHOW_KEYS) if (G.DEFAULTS.show[k]) expect(g.show[k]).toBe(true)
  })
  it('a v0 list (the first sketch) becomes the strip', () => {
    expect(G.migrateV1(['ex', 'hr']).card).toBe(true)
  })
  it('a profile synced from a v1 build loads, and v1 stays untouched for an older build', () => {
    const stored = { liveLayout: LL.presetLayout('lifter') }
    const before = JSON.stringify(stored)
    expect(G.glanceOf(stored).buttons.adjust).toBe(true)
    expect(JSON.stringify(stored)).toBe(before)
  })
})

describe('what a set is', () => {
  const e = (target, id = '0025') => ({ id, target })
  it('tells the kinds apart', () => {
    expect(G.kindOf(e({ mode: 'reps' }), { w: 80, r: 8 })).toBe('lift')
    expect(G.kindOf(e({ mode: 'reps' }), { r: 15, bands: ['b-red'] })).toBe('band')
    expect(G.kindOf(e({ mode: 'reps' }), { w: 20, r: 15, bands: ['b-red'] })).toBe('lift')
    expect(G.kindOf(e({ mode: 'time', sec: 45 }), { sec: 45 })).toBe('hold')
    expect(G.kindOf(e({ mode: 'cardio', min: 20 }), { min: 20 })).toBe('cardio')
    expect(G.kindOf(e({ mode: 'distance', m: 40 }), { m: 40, w: 24 })).toBe('carry')
  })
  it('only a plain weight × reps set gets its big line rewritten in place', () => {
    expect(G.plainLift(e({ mode: 'reps' }), { w: 80, r: 8 })).toBe(true)
    expect(G.plainLift(e({ mode: 'reps' }), { w: 80, r: 8, sides: { L: { w: 20, r: 8 }, R: { w: 20, r: 8 } } })).toBe(false)
    expect(G.plainLift(e({ mode: 'reps' }), { w: 80, r: 8, type: 'dropset', drops: [{ w: 60, r: 6 }] })).toBe(false)
    expect(G.plainLift(e({ mode: 'time' }), { sec: 30 })).toBe(false)
  })
  it('buttons follow the kind: − + on the load and the reps of a lift, on the reps of a band or a bodyweight lift, effort beside them', () => {
    const g = G.normalizeGlance({ buttons: { adjust: true, nextEx: false } })
    // TestFlight 67: the reps of a loaded lift (and its effort) could not be changed anywhere.
    expect(G.workButtons(g, 'lift')).toEqual(['log', 'wDown', 'wUp', 'rDown', 'rUp', 'effort'])
    expect(G.workButtons(g, 'lift', { bw: true })).toEqual(['log', 'rDown', 'rUp', 'effort'])
    expect(G.workButtons(g, 'band')).toEqual(['log', 'rDown', 'rUp', 'effort'])
    // Effort not shown: no effort button either.
    expect(G.workButtons(G.normalizeGlance({ show: { effort: false }, buttons: { adjust: true, nextEx: false } }), 'lift')).toEqual(['log', 'wDown', 'wUp', 'rDown', 'rUp'])
    expect(G.workButtons(g, 'hold')).toEqual(['log'])
    expect(G.workButtons(g, 'cardio')).toEqual(['log'])
    expect(G.workButtons(g, 'carry')).toEqual(['log', 'wDown', 'wUp'])
    // Customise wins for its kind only.
    const own = G.normalizeGlance({ kinds: { cardio: { b: ['pause'] } } })
    expect(G.workButtons(own, 'cardio')).toEqual(['log', 'pause'])
    expect(G.workButtons(own, 'lift')).toEqual(['log', 'next'])
  })
  it('details follow the kind and the switches', () => {
    const g = G.normalizeGlance(null)
    expect(G.detailsFor(g, 'lift')).toEqual(['effort', 'partner', 'record'])
    expect(G.detailsFor(g, 'hold')).toEqual(['partner'])
    expect(G.detailsFor(G.normalizeGlance({ show: { effort: false, record: false } }), 'lift')).toEqual(['partner'])
    expect(G.detailsFor(G.normalizeGlance({ kinds: { hold: { d: ['notes'] } } }), 'hold')).toEqual(['notes'])
  })
})

describe('each kind and moment, on every surface', () => {
  const on = { show: { elapsed: true, calories: true }, buttons: { adjust: true } }
  const cases = {
    strength: { phase: 'work', big: /^80 kg × 8$/ },
    rest: { phase: 'rest', big: /^80 kg × 8$/, next: 'Up next' },
    switch: { phase: 'switch', big: /^60 kg × 10$/, next: 'Next exercise', title: /Row/ },
    hold: { phase: 'hold', big: /^45 s$/, heading: 'Hold' },
    cardio: { phase: 'work', big: /20 min/ },
    carry: { phase: 'work', big: /^40 m · 24 kg$/ },
    band: { phase: 'work', big: /^15 × Red$/ },
    superset: { phase: 'work', big: /^80 kg × 8$/, chip: /Superset with Pull/ },
    done: { phase: 'done', title: /All sets done/ },
  }
  for (const [id, want] of Object.entries(cases)) {
    it(id, () => {
      const { live, v } = view(id, { liveWidget: on })
      expect(v.phase).toBe(want.phase)
      if (want.big) expect(v.big).toMatch(want.big)
      if (want.next) expect(v.next).toBe(want.next)
      if (want.title) expect(v.title).toMatch(want.title)
      if (want.heading) expect(v.heading).toBe(want.heading)
      if (want.chip) expect(v.chips.map(c => c.t).join(' ')).toMatch(want.chip)
      // The buttons mean something now, the primary is there, and each surface keeps to its room.
      for (const [sf, room] of Object.entries(G.BUTTON_ROOM)) {
        const b = G.glanceView(live.attributes, live.state, sf, NOW).buttons
        expect(b.length).toBeLessThanOrEqual(room)
        expect(b[0]).toBe(want.phase === 'done' ? 'finish' : 'log')
      }
      if (want.phase === 'rest' || want.phase === 'switch') expect(v.buttons).toEqual(expect.arrayContaining(['restSkip', 'restAdd']))
      if (want.phase === 'work') expect(v.buttons).not.toContain('restSkip')
      if (want.phase === 'hold' || want.phase === 'rest' || want.phase === 'switch') expect(v.clock?.endsAt).toBeGreaterThan(NOW)
      // A clean look has two details at most, a detailed one four.
      expect(v.chips.length).toBeLessThanOrEqual(4)
      expect(G.glanceView(live.attributes, { ...live.state, g: { ...live.state.g, lk: 'clean' } }, 'lock', NOW).chips.length).toBeLessThanOrEqual(2)
    })
  }
  it('− and + rewrite the big line where the Lock Screen moves them', () => {
    const { live } = view('strength', { liveWidget: on })
    const cur = live.state.cur
    const j = cur.adj.w.i + 1
    const moved = { ...cur, tv: { ...cur.tv, weight: cur.adj.w.t[j] } }
    expect(G.bigOf(moved)).toBe('82.5 kg × 8')
    expect(G.shortOf(moved)).toBe('82.5×8')
  })
  it('the weight buttons are there for a lift, not for a hold or cardio', () => {
    // iOS draws a lift's − + as steppers beside the numbers; Android keeps them as actions.
    expect(view('strength', { liveWidget: on }).v.steps.map(x => x.f)).toEqual(['w', 'r'])
    expect(view('strength', { liveWidget: on }, 'android').v.buttons).toEqual(expect.arrayContaining(['wDown', 'wUp']))
    // The samples all have an exercise after their own, so Next exercise shows (Customise, point 9).
    expect(view('hold', { liveWidget: on }).v.buttons).toEqual(['log'])
    expect(view('cardio', { liveWidget: on }).v.buttons).toEqual(['log', 'next'])
    expect(view('band', { liveWidget: on }).v.buttons).toEqual(expect.arrayContaining(['rDown', 'rUp']))
  })
  it('what’s next off: a rest shows the clock and the workout, not the next set', () => {
    const v = view('rest', { liveWidget: { show: { next: false } } }).v
    expect(v.next).toBeUndefined()
    expect(v.title).toBe('Push day')
  })
  it('heart rate shows only with a source, and only when switched on', () => {
    expect(view('cardio').v.chips.some(c => c.k === 'hr')).toBe(true)
    expect(view('cardio', { liveWidget: { show: { heart: false } } }).v.chips.some(c => c.k === 'hr')).toBe(false)
  })
  it('an effort not rated yet stays out unless its button is there', () => {
    expect(view('strength').v.chips.some(c => c.k === 'effort')).toBe(false)
    const rated = view('strength', { liveWidget: { kinds: { lift: { b: ['effort'] } } } }).v
    expect(rated.buttons).toContain('effort')
  })
  it('the picture rides along only when asked for, and is never an animation', () => {
    const off = view('strength').live
    expect(off.state.cur.img).toBeUndefined()
    const pic = view('strength', { liveWidget: { show: { picture: true } } }).live
    expect(pic.state.cur.img).toMatch(/\.(webp|png|jpe?g)$/)
    expect(pic.state.cur.img).not.toMatch(/\.(mp4|gif|webm)$/)
  })
})

describe('the payload', () => {
  const everything = { look: 'detailed', show: Object.fromEntries(G.SHOW_KEYS.map(k => [k, true])), buttons: Object.fromEntries(G.BUTTON_KEYS.map(k => [k, true])), card: true }
  it('every sample stays inside 4 KB with everything on, every number finite', () => {
    for (const id of SM.SAMPLE_IDS) {
      for (const glance of [null, everything, { look: 'clean' }]) {
        const live = SM.sampleLive(S(), id, { now: NOW, glance })
        expect(bytes(live), id).toBeLessThanOrEqual(3600)
        finiteEverywhere(live)
      }
    }
  })
  it('a long workout with long names in a three-byte script still fits', () => {
    const name = 'Тяга штанги в наклоне с паузой и широким хватом '.repeat(2)
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: 'c' + i, target: { name: name + i, mode: i % 3 === 0 ? 'time' : 'reps', sec: 40 }, sets: Array.from({ length: 6 }, () => ({ w: 40, r: 10, sec: 40, note: 'заметка '.repeat(20) })) }))
    const A = { id: 'w', name: 'День', start: NOW - 60e3, cur: 0, entries }
    const live = LA.buildLiveActivity(S({ active: A, liveWidget: { ...everything, kinds: { lift: { d: G.KIND_DETAILS.lift, b: G.KIND_BUTTONS.lift } } } }), { endsAt: NOW + 60e3, total: 90 }, {}, { now: NOW, live: { bpm: 140 } })
    expect(bytes(live)).toBeLessThanOrEqual(3600)
    expect(live.state.cur).toBeTruthy()
    finiteEverywhere(live)
  })
  it('the heart-rate source is said, and calories only with a start', () => {
    const live = SM.sampleLive(S(), 'carry', { now: NOW, glance: { show: { calories: true } } })
    expect(live.state.hs).toBe('watch')
    expect(live.state.tv.kcal).toMatch(/kcal/)
  })
})

describe('buttons are events applied once, from any surface', () => {
  it('Log set from the Lock Screen and the same tap again log one set', () => {
    let state = { S: S({ active: { id: 'w', start: NOW, cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 80, r: 8 }, { w: 80, r: 8 }] }] } }) }
    const getState = () => state
    const done = []
    LA.bindLiveActions({ setDone: (i, j) => { done.push([i, j]); state.S.active.entries[i].sets[j].done = true } })
    const ev = LA.liveActionEvent('log', state.S, { now: NOW })
    expect(LA.applyLiveEvents([ev, ev], getState)).toEqual([ev.id, ev.id])
    expect(LA.applyLiveEvents([ev], getState)).toEqual([ev.id])
    expect(done).toEqual([[0, 0]])
    // A second tap made for the set already ticked (the surface had not moved on yet) does nothing.
    const late = { ...ev, id: 'other' }
    LA.applyLiveEvents([late], getState)
    expect(done).toEqual([[0, 0]])
  })
  it('a weight step is an absolute value, so applying it twice changes nothing more', () => {
    let state = { S: S({ active: { id: 'w', start: NOW, cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 80, r: 8 }] }] } }) }
    const getState = () => ({ ...state, update: fn => { const d = structuredClone(state.S); fn(d); state = { ...state, S: d } } })
    const ev = LA.liveActionEvent('wUp', state.S, { now: NOW })
    expect(ev.value).toBe(82.5)
    LA.applyLiveEvents([ev], getState)
    LA.applyLiveEvents([{ ...ev, id: 'again' }], getState)
    expect(state.S.active.entries[0].sets[0].w).toBe(82.5)
  })
})

// Owner's report on TestFlight 67 (Settings > Workout > Live widget), one test per point.
describe('TestFlight 67: what the switches change', () => {
  const ALL = { look: 'detailed', show: { heart: true, next: true, elapsed: true, picture: true, effort: true, record: true, calories: true }, buttons: { adjust: true, addRest: true, nextEx: true, pause: true } }
  it('time since start shows in a set and through a rest, on the Lock Screen and the island', () => {
    const on = { liveWidget: { show: { elapsed: true } } }
    expect(view('strength', on).v.clock).toMatchObject({ kind: 'elapsed' })
    expect(view('strength', on, 'island').v.clock).toMatchObject({ kind: 'elapsed' })
    const rest = view('rest', on).v
    expect(rest.clock.kind).toBe('rest')
    expect(rest.since).toBe(rest && view('rest', on).live.attributes.start)
    expect(view('hold', on).v.since).toBeGreaterThan(0)
    // Off: nowhere.
    expect(view('rest').v.since).toBeNull()
    expect(view('strength').v.clock).toBeNull()
  })
  it('effort shows before the set is rated: the last rated set of the exercise', () => {
    const v = view('strength', { liveWidget: { show: { effort: true } } }).v
    expect(v.chips.map(c => c.t)).toContain('Last set: RIR 2')
    expect(view('strength', { liveWidget: { show: { effort: false } } }).v.chips.some(c => /RIR/.test(c.t))).toBe(false)
    // The first set of an exercise has nothing to go by: no "RIR –" chip saying nothing.
    expect(view('switch', { liveWidget: { show: { effort: true } } }).live.state.cur.ck || []).not.toContain('effort')
  })
  it('a rated set with the effort button there has no chip repeating it', () => {
    const live = SM.sampleLive(S({ liveWidget: ALL }), 'strength', { now: NOW })
    expect(live.state.cur.b).toContain('effort')
    expect(live.state.cur.ck).not.toContain('effort')
    expect(live.state.cur.ck).toContain('effortLast')
  })
  it('Resting is a rest whenever you look: the sample clock starts again before 0', () => {
    const base = NOW
    for (const after of [0, 30e3, 80e3, 10 * 60e3]) {
      const now = base + after
      const live = SM.sampleLive(S(), 'rest', { now: SM.sampleBase('rest', base, now) })
      const v = G.glanceView(live.attributes, live.state, 'lock', now)
      expect(v.phase).toBe('rest')
      expect(v.clock.kind).toBe('rest')
      expect(v.next).toBeTruthy()
    }
    // The strength set is not a rest, and nothing without a clock is moved.
    expect(view('strength').v.phase).toBe('work')
    expect(SM.sampleBase('strength', base, base + 9e5)).toBe(base)
    const h = SM.sampleLive(S(), 'hold', { now: SM.sampleBase('hold', base, base + 5 * 60e3) })
    expect(G.glanceView(h.attributes, h.state, 'lock', base + 5 * 60e3).phase).toBe('hold')
  })
  it('everything on: steppers on iOS instead of four − + buttons, the record line goes first, Log set an icon', () => {
    const lock = view('strength', { liveWidget: ALL }).v
    expect(lock.steps.map(x => [x.f, x.t])).toEqual([['w', '80 kg'], ['r', '8']])
    expect(lock.buttons).toEqual(['log', 'effort', 'next', 'pause'])
    expect(lock.buttons.length).toBeLessThanOrEqual(G.BUTTON_ROOM.lock)
    expect(lock.note).toBe('')
    expect(lock.logWords).toBe(false)
    // The numbers are never cut: the big line is still whole for screen readers and Android.
    expect(lock.big).toBe('80 kg × 8')
    const isl = view('strength', { liveWidget: ALL }, 'island').v
    expect(isl.steps.length).toBe(2)
    expect(isl.buttons.length).toBeLessThanOrEqual(G.BUTTON_ROOM.island)
    const and = view('strength', { liveWidget: ALL }, 'android').v
    expect(and.steps).toEqual([])
    expect(and.buttons).toEqual(['log', 'wDown', 'wUp'])
  })
  it('the picture alone drops the record line, never the numbers', () => {
    const v = view('strength', { liveWidget: { show: { picture: true, record: true } } }).v
    expect(v.still).toBeTruthy()
    expect(v.big).toBe('80 kg × 8')
    expect(v.note).toBe('')
  })
  it('Log set says its words only when it is the only button', () => {
    expect(view('strength', { liveWidget: { buttons: { nextEx: false } } }).v).toMatchObject({ buttons: ['log'], logWords: true })
    expect(view('strength').v.logWords).toBe(false)
    expect(view('hold').v.logWords).toBe(true)
  })
  it('a − + pair needs both halves to become a stepper', () => {
    const v = view('strength', { liveWidget: { kinds: { lift: { b: ['wUp', 'rDown', 'rUp'] } } } }).v
    expect(v.steps).toEqual([])
    expect(v.buttons).toContain('wUp')
  })
})

// The Dynamic Island's expanded view (WidgetViews.swift GlanceIslandBottom): two chips beside up to
// two buttons, one once a third button is there. The preview and the "why not" notes share it.
describe('islandChips', () => {
  const chips = n => Array.from({ length: n }, (_, i) => ({ k: 'c' + i, t: String(i) }))
  it('two chips beside up to two buttons, one beside three', () => {
    expect(G.islandChips({ chips: chips(4), buttons: ['log'] }).map(c => c.k)).toEqual(['c0', 'c1'])
    expect(G.islandChips({ chips: chips(4), buttons: ['log', 'next'] })).toHaveLength(2)
    expect(G.islandChips({ chips: chips(4), buttons: ['log', 'next', 'pause'] }).map(c => c.k)).toEqual(['c0'])
    expect(G.islandChips({ chips: chips(1), buttons: [] })).toHaveLength(1)
    expect(G.islandChips(null)).toEqual([])
  })
  it('is what the island of the strength sample keeps once Pause joins', () => {
    const live = SM.sampleLive(S(), 'strength', { now: NOW, glance: { ...G.normalizeGlance(null), buttons: { ...G.normalizeGlance(null).buttons, pause: true } } })
    const v = G.glanceView(live.attributes, live.state, 'island', NOW)
    expect(v.buttons).toHaveLength(3)
    expect(v.chips.length).toBeGreaterThan(1)
    expect(G.islandChips(v)).toEqual(v.chips.slice(0, 1))
  })
})

// A profile with no history on the sample's exercise has no record to be close to: the sample then
// carries the line itself, so "Record hints" has something to show in the preview and in "Try it".
describe('the sample’s record line', () => {
  const lock = (over, glance) => { const live = SM.sampleLive(S(over), 'strength', { now: NOW, glance }); return G.glanceView(live.attributes, live.state, 'lock', NOW) }
  it('is there in the detailed look on a profile without history', () => {
    expect(lock().note).toBe('2 more reps for a record at this weight')
  })
  it('goes with the switch, with the profile’s record hints, and with the clean look', () => {
    const off = G.normalizeGlance(null); off.show.record = false
    expect(lock({}, off).note).toBe('')
    expect(lock({ recordHints: false }).note).toBe('')
    expect(lock({}, { ...G.normalizeGlance(null), look: 'clean' }).note).toBe('')
  })
  it('is never added to a hold, cardio, a carry or the end', () => {
    for (const id of ['hold', 'cardio', 'carry', 'done']) expect(SM.sampleLive(S(), id, { now: NOW }).state.cur?.tv?.pr, id).toBeUndefined()
  })
})
