// The live workout widget, v2 (1.4.5): what the running workout shows away from the workout
// screen (the iPhone's Lock Screen and Dynamic Island, Android's notification, the Home Screen
// widget's set line, and an optional strip in the app), worked out from the set you are on.
//
// v1 (lib/live-layout.js) had people build each surface tile by tile. Nobody wants to do that
// between sets, and a list built for a bench press says nothing useful during a plank. So the
// content now follows the exercise and the moment:
//
//   kind   lift (weight × reps), band (reps with bands), hold (a timed set), cardio, carry
//   phase  work (a set to do), hold (a hold or its count-in running), rest, switch (a rest before
//          a new exercise), done (every set ticked)
//
// and the settings are a handful of plain choices (S.liveWidget):
//
//   { v: 2, look: 'clean' | 'detailed',
//     show: { heart, next, elapsed, picture, effort, record, calories },
//     buttons: { adjust, addRest, nextEx, pause },
//     card,                                     // the strip on the workout screen
//     kinds: { lift: { d: [details], b: [buttons] }, ... } }   // "Customise", optional
//
// S.liveLayout (v1) is never written or deleted here: an older build reading a synced profile still
// finds what it knows. A profile with only v1 is read through migrateV1, which keeps every choice
// that has a meaning now. normalizeGlance is the one way in, so anything stored, synced or
// imported comes out valid.
import { modeOf, isBw } from './history.js'
import { setBandsOf } from './bands.js'
import { isWarmupRow, isSideSet, dropsOf, clustersOf } from './workout-model.js'
import { normalizeLayout, presetMatches } from './live-layout.js'

export const GLANCE_VERSION = 2
export const KINDS = ['lift', 'band', 'hold', 'cardio', 'carry']
export const LOOKS = ['clean', 'detailed']
export const SHOW_KEYS = ['heart', 'next', 'elapsed', 'picture', 'effort', 'record', 'calories']
export const BUTTON_KEYS = ['adjust', 'addRest', 'nextEx', 'pause']

export const DEFAULTS = Object.freeze({
  v: GLANCE_VERSION,
  look: 'detailed',
  show: Object.freeze({ heart: true, next: true, elapsed: false, picture: false, effort: true, record: true, calories: false }),
  buttons: Object.freeze({ adjust: false, addRest: true, nextEx: true, pause: false }),
  card: false,
  kinds: Object.freeze({}),
})

// What "Customise" offers per kind: the details (keys of lib/live-tiles.js setValues) and the
// buttons a set of that kind can use. Log set is always there and is not a choice.
export const KIND_DETAILS = {
  lift: ['effort', 'record', 'partner', 'equip', 'notes'],
  band: ['effort', 'record', 'partner', 'notes'],
  hold: ['partner', 'equip', 'notes'],
  cardio: ['partner', 'notes'],
  carry: ['partner', 'equip', 'notes'],
}
export const KIND_BUTTONS = {
  lift: ['wDown', 'wUp', 'rDown', 'rUp', 'effort', 'next', 'warm', 'addSet', 'pause'],
  band: ['rDown', 'rUp', 'effort', 'next', 'addSet', 'pause'],
  hold: ['next', 'addSet', 'pause'],
  cardio: ['next', 'pause'],
  carry: ['wDown', 'wUp', 'next', 'addSet', 'pause'],
}
// The order buttons are kept in when a surface has less room than the list: Log set first, then
// a − + pair together, then the rest. iOS draws Log set last (the primary on the right), Android first.
const PRIORITY = ['log', 'wDown', 'wUp', 'rDown', 'rUp', 'effort', 'restAdd', 'restSkip', 'next', 'pause', 'warm', 'addSet', 'finish']
export const byPriority = list => [...new Set(list)].sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b))
// Buttons each surface has room for (Apple: Lock Screen about 160 pt tall; Android: three actions).
export const BUTTON_ROOM = { lock: 4, island: 3, android: 3 }

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const bool = (v, d) => (typeof v === 'boolean' ? v : d)

function cleanKinds (raw) {
  const out = {}
  if (!isObj(raw)) return out
  for (const k of KINDS) {
    const x = raw[k]
    if (!isObj(x)) continue
    const d = Array.isArray(x.d) ? [...new Set(x.d.filter(y => KIND_DETAILS[k].includes(y)))] : null
    const b = Array.isArray(x.b) ? [...new Set(x.b.filter(y => KIND_BUTTONS[k].includes(y)))] : null
    if (d || b) out[k] = { ...(d ? { d } : {}), ...(b ? { b } : {}) }
  }
  return out
}

/** A valid v2 setting from whatever is stored (null or junk: the defaults). */
export function normalizeGlance (raw) {
  const src = isObj(raw) ? raw : {}
  const show = isObj(src.show) ? src.show : {}
  const buttons = isObj(src.buttons) ? src.buttons : {}
  return {
    v: GLANCE_VERSION,
    look: LOOKS.includes(src.look) ? src.look : DEFAULTS.look,
    show: Object.fromEntries(SHOW_KEYS.map(k => [k, bool(show[k], DEFAULTS.show[k])])),
    buttons: Object.fromEntries(BUTTON_KEYS.map(k => [k, bool(buttons[k], DEFAULTS.buttons[k])])),
    card: bool(src.card, DEFAULTS.card),
    kinds: cleanKinds(src.kinds),
  }
}

/**
 * The v1 builder's layout as v2 choices. A layout left at its default (or never touched) is the v2
 * default. Otherwise every tile and button the person added that still means something switches
 * its v2 choice on; nothing they had is switched off. The presets map to their spirit: Minimal is
 * the clean look, Everything turns everything on.
 */
export function migrateV1 (raw) {
  if (raw == null) return normalizeGlance(null)
  const L = normalizeLayout(raw)
  if (presetMatches(L, 'default')) return normalizeGlance(null)
  const out = normalizeGlance(null)
  const tiles = new Set(), acts = new Set()
  for (const sf of ['lock', 'island', 'compact', 'android', 'widget', 'app']) {
    for (const x of L[sf]?.t || []) tiles.add(x.k)
    for (const a of L[sf]?.a || []) acts.add(a)
  }
  const on = k => tiles.has(k)
  if (on('hr') || on('hrZone')) out.show.heart = true
  if (on('next')) out.show.next = true
  if (on('elapsed')) out.show.elapsed = true
  if (on('still')) out.show.picture = true
  if (on('effort')) out.show.effort = true
  if (on('pr')) out.show.record = true
  if (on('kcal')) out.show.calories = true
  if (['wDown', 'wUp', 'rDown', 'rUp', 'effort'].some(a => acts.has(a))) out.buttons.adjust = true
  if (acts.has('restAdd')) out.buttons.addRest = true
  if (acts.has('next')) out.buttons.nextEx = true
  if (acts.has('pause')) out.buttons.pause = true
  if ((L.app.t.length || L.app.a.length)) out.card = true
  if (presetMatches(L, 'minimal')) out.look = 'clean'
  if (presetMatches(L, 'everything')) {
    out.look = 'detailed'
    for (const k of SHOW_KEYS) out.show[k] = true
    for (const k of BUTTON_KEYS) out.buttons[k] = true
  }
  return out
}

/** The profile's setting, always valid: v2 when there is one, else the v1 layout migrated. */
export function glanceOf (S) {
  if (S && isObj(S.liveWidget)) return normalizeGlance(S.liveWidget)
  return migrateV1(S ? S.liveLayout : null)
}

/** Whether `G` is the default (Settings shows "Reset" only when it is not). */
export const isDefaultGlance = G => JSON.stringify(normalizeGlance(G)) === JSON.stringify(normalizeGlance(null))

/* ---------- what a set is ---------- */

/** The kind of set `s` of entry `e`: lift, band, hold, cardio or carry. */
export function kindOf (e, s) {
  const cfg = { ...(e?.target || {}), id: e?.id }
  let mode = 'reps'
  try { mode = modeOf(cfg) } catch { mode = 'reps' }
  if (mode === 'time') return 'hold'
  if (mode === 'cardio') return 'cardio'
  if (mode === 'distance') return 'carry'
  if (setBandsOf(s).length && !(Number(s?.w) > 0)) return 'band'
  return 'lift'
}

/** A set whose big line is just weight × reps, so − and + on a surface can rewrite it in place. */
export function plainLift (e, s) {
  if (!s || isSideSet(s) || setBandsOf(s).length) return false
  if (dropsOf(s).length || clustersOf(s).length) return false
  return kindOf(e, s) === 'lift'
}

/** The details a set of `kind` shows, in order: Customise's choice, or the defaults from `show`. */
export function detailsFor (G, kind) {
  const own = G.kinds[kind]?.d
  if (own) return own
  const out = []
  if (G.show.effort && (kind === 'lift' || kind === 'band')) out.push('effort')
  out.push('partner')
  if (G.show.record && (kind === 'lift' || kind === 'band')) out.push('record')
  return out
}

/**
 * The buttons while a set of `kind` is up next (no clock running), Log set included, by priority.
 * `bw` the exercise carries no load of its own: − + change the reps then.
 */
export function workButtons (G, kind, { bw = false } = {}) {
  const own = G.kinds[kind]?.b
  let list
  if (own) list = own
  else {
    list = []
    // "Weight and reps": both for a loaded lift (until 1.4.5 TestFlight 67 only the weight, so the
    // reps of a barbell set could not be changed anywhere), the reps for a body-weight one, and
    // the effort button beside them when effort is shown (one tap steps RIR or RPE along). On
    // iOS a − + pair sits beside its number and costs no button room (glanceView `steps`).
    if (G.buttons.adjust) {
      if (kind === 'lift') list.push(...(bw ? ['rDown', 'rUp'] : ['wDown', 'wUp', 'rDown', 'rUp']))
      else if (kind === 'band') list.push('rDown', 'rUp')
      else if (kind === 'carry') list.push('wDown', 'wUp')
      if (G.show.effort && (kind === 'lift' || kind === 'band')) list.push('effort')
    }
    if (G.buttons.nextEx) list.push('next')
    if (G.buttons.pause) list.push('pause')
  }
  return byPriority(['log', ...list])
}

/** The buttons while a rest runs: +15 s when wanted, Skip rest, and Log set (the rest may outlast you). */
export const restButtons = G => byPriority(['log', 'restSkip', ...(G.buttons.addRest ? ['restAdd'] : [])])

/** The session details in order (heart rate, its zone in the detailed look, calories). */
export function sessionDetails (G) {
  const out = []
  if (G.show.heart) out.push('hr')
  if (G.show.heart && G.look === 'detailed') out.push('hrZone')
  if (G.show.calories) out.push('kcal')
  return out
}

/** How many details fit beside the set: the clean look keeps to two, the detailed one to four. */
export const detailRoom = G => (G.look === 'clean' ? 2 : 4)

/** Whether `s` is a warm-up row (re-exported for the views). */
export const isWarm = s => !!isWarmupRow(s)

/** Whether entry `e` takes added weight rather than carrying a load of its own. */
export const bodyweightOf = e => { try { return isBw({ ...(e?.target || {}), id: e?.id }) } catch { return false } }

/* ---------- what is happening ---------- */

/**
 * The moment: 'done' (nothing left), 'hold' (a hold or its count-in counting), 'switch' (a rest
 * before a different exercise), 'rest', or 'work'. `fresh` the set up next is the first of its exercise.
 */
export function phaseOf ({ cur, resting = false, holding = false, fresh = false }) {
  if (!cur) return 'done'
  if (holding) return 'hold'
  if (resting) return fresh ? 'switch' : 'rest'
  return 'work'
}

/* ---------- what a surface draws ---------- */

const FIELD = { wDown: 'w', wUp: 'w', rDown: 'r', rUp: 'r', effort: 'e' }

/** The set's big line: weight × reps for a plain lift (rewritten in place by − and +), else its own. */
export function bigOf (set) {
  if (!set) return ''
  const tv = set.tv || {}
  if (!set.kd && !set.bg && tv.weight && tv.reps) return `${tv.weight} × ${tv.reps}`
  return set.bg || set.target || ''
}

/** A few letters for the Dynamic Island's pill: "80×8", "45 s", "20 min". */
export function shortOf (set) {
  if (!set) return ''
  const tv = set.tv || {}
  if (!set.kd && !set.sh && tv.weight && tv.reps) return `${String(tv.weight).replace(/\s*[a-z]+$/i, '')}×${tv.reps}`
  return set.sh || ''
}

/**
 * What a surface ('lock', 'island', 'android', 'app') draws from the activity's state (the very
 * payload lib/live-activity.js sends), the same rules the Swift and Java views follow, so the
 * preview in Settings is the real thing:
 *
 *   phase    work | hold | rest | switch | done
 *   clock    { kind: 'rest' | 'hold' | 'countin' | 'elapsed', endsAt?, left?, start? } or null
 *   heading  the word over the clock or over what comes next ("Rest", "Up next", "Next exercise")
 *   title, sub, big, chips [{ k, t }], note (the record line), progress (0..1 or null), buttons
 */
export function glanceView (attributes, state, surface = 'lock', now = Date.now()) {
  const a = attributes || {}
  const st = state || {}
  const L = a.labels || {}
  const g = st.g || {}
  const tl = st.tl || {}
  const cur = st.cur || null
  const restLeft = Number.isFinite(st.restLeft) ? st.restLeft : null
  const holdLeft = Number.isFinite(st.holdLeft) ? st.holdLeft : null
  const resting = restLeft != null || (Number.isFinite(st.restEndsAt) && st.restEndsAt > now)
  const holding = holdLeft != null || (Number.isFinite(st.holdEndsAt) && st.holdEndsAt > now)
  const phase = phaseOf({ cur, resting, holding, fresh: !!cur?.fr })
  const out = { phase, clock: null, since: null, heading: '', title: '', sub: '', big: '', chips: [], note: '', progress: null, buttons: [], steps: [], logWords: true, still: null, paused: !!st.paused }
  const elapsedOn = !!g.el && Number.isFinite(a.start) && a.start > 0
  const total = Math.max(0, Number(st.total) || 0)
  const done = Math.min(total, Math.max(0, Number(st.done) || 0))
  out.count = `${done}/${total}`
  if (g.lk === 'detailed') out.progress = total ? done / total : 0
  const room = g.lk === 'clean' ? 2 : 4
  const chipsOf = set => {
    const list = []
    for (const k of set?.ck || []) if (set.tv?.[k]) list.push({ k, t: set.tv[k] })
    for (const k of g.sx || []) if (st.tv?.[k]) list.push({ k, t: st.tv[k] })
    return list.slice(0, room)
  }
  if (phase === 'done') {
    out.title = done < total ? (L.openApp || '') : (L.allDone || '')
    out.sub = st.name || ''
    if (elapsedOn) out.clock = { kind: 'elapsed', start: a.start }
    out.buttons = g.lk ? ['finish'] : []
    return out
  }
  out.still = g.pic ? cur.img || null : null
  if (phase === 'hold') {
    out.clock = { kind: st.holdKind === 'countin' ? 'countin' : 'hold', endsAt: st.holdEndsAt ?? null, left: holdLeft }
    out.heading = st.holdKind === 'countin' ? (L.getReady || '') : (L.hold || '')
    out.title = cur.exName
    out.sub = cur.setLine
    out.big = bigOf(cur)
    out.buttons = [...(st.auto ? ['stopAuto'] : []), 'log']
    // The time since the start under the hold's clock, as during a rest.
    if (elapsedOn) out.since = a.start
    out.logWords = out.buttons.length === 1
    return out
  }
  if (phase === 'rest' || phase === 'switch') {
    out.clock = { kind: 'rest', endsAt: st.restEndsAt ?? null, left: restLeft }
    out.heading = L.rest || ''
    if (g.nx !== false) {
      out.next = phase === 'switch' ? (tl.nextEx || L.nextExercise || '') : (L.next || '')
      out.title = cur.exName
      out.sub = cur.setLine
      out.big = bigOf(cur)
    } else {
      out.title = st.name || ''
      out.sub = ''
    }
    out.chips = chipsOf({ tv: {}, ck: [] })
    // "Time since start" counts on through a rest, under the rest's clock (it showed in no moment
    // but a set before, so switching it on while previewing a rest changed nothing).
    if (elapsedOn) out.since = a.start
    out.buttons = (g.rb || ['restSkip', 'log']).filter(k => k !== 'restAdd' || resting)
  } else {
    out.title = cur.exName
    out.sub = cur.setLine
    out.big = bigOf(cur)
    out.chips = chipsOf(cur)
    if (g.lk === 'detailed' && cur.tv?.pr) out.note = cur.tv.pr
    if (elapsedOn) out.clock = { kind: 'elapsed', start: a.start }
    out.buttons = cur.b || ['log']
  }
  const nextOpen = (st.unitStarts || []).some(x => (x.unit ?? x.entryIdx) !== (cur.unit ?? cur.entryIdx))
  out.buttons = out.buttons.filter(k => {
    if (k === 'next') return nextOpen
    if (FIELD[k]) return !!cur.adj?.[FIELD[k]]
    return true
  })
  // iOS (the Lock Screen and the island) draws a − + pair beside its number, a stepper in place
  // of the big line, so weight, reps and the effort button all fit: four − + buttons in the row
  // left no room for anything else and squeezed it (TestFlight 67). Only for a plain lift, whose
  // big line is just those numbers; Android has no room for steppers and keeps them as actions.
  if (phase === 'work' && (surface === 'lock' || surface === 'island') && !cur.kd && !cur.bg && cur.tv?.weight && cur.tv?.reps) {
    for (const [f, down, up] of [['w', 'wDown', 'wUp'], ['r', 'rDown', 'rUp']]) {
      const list = cur.adj?.[f]
      if (!out.buttons.includes(down) || !out.buttons.includes(up) || !list) continue
      out.steps.push({ f, t: (list.t || [])[list.i] || (f === 'w' ? cur.tv.weight : cur.tv.reps) })
    }
    if (out.steps.length === 2) out.buttons = out.buttons.filter(k => !FIELD[k] || k === 'effort')
    else out.steps = []
  }
  out.buttons = byPriority(out.buttons).slice(0, BUTTON_ROOM[surface] ?? Infinity)
  // Room on the Lock Screen (160 points): with the still or the steppers on, the record line is
  // the first extra to go, never the numbers or the buttons (all switches on squeezed it).
  if (out.still || out.steps.length) out.note = ''
  // "Log set" in words only when it is the only button; beside others, the check mark alone.
  out.logWords = out.buttons.length === 1 && !out.steps.length
  return out
}

/**
 * The chips the Dynamic Island's expanded view has room for: two beside up to two buttons, one once
 * a third button is there (WidgetViews.swift GlanceIslandBottom). The Lock Screen draws them all.
 */
export const islandChips = view => (view?.chips || []).slice(0, (view?.buttons?.length || 0) >= 3 ? 1 : 2)
