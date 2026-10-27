// The app tour and its tutorials (components/Tour.jsx): coach marks on the real screens. The tour
// is offered once after the first setup; it and four short tutorials (build a plan, make an
// exercise, edit your data, export & import) run again from Settings → About & updates →
// Tutorials. This file is what the main bundle carries: the steps, the record of where this
// device stands, and a tiny store saying whether one is open. The overlay is its own chunk,
// fetched only when it opens.
//
// The record lives on this device only (localStorage), never in the synced state: a tour seen
// on the phone says nothing about the laptop. Nothing about it leaves the device.
import { useSyncExternalStore } from 'react'
import { t } from './i18n.js'

const KEY = 'gym_tour_v1'

/* One stop each.
   `route`: the screen it is on; the tour goes there itself on Back, on a resume and on a jump
     (null: wherever the user is).
   `anchor`: the data-tour="..." of the element it points at (null: a card in the middle).
   `go`: a way to another screen. The spotlight sits on the real control (a tab, the gear, a back
     button) and the stop waits for the user to tap it; "Show me" taps it for them. A string is a
     path, a RegExp matches one. A stop whose screen is already on is passed over.
   `intercept`: the tap on the element is the tour's, not the app's (Start, which here opens the
     practice workout instead of a real one).
   `tap`: tapping the element is a fine way on (it does what it does, then the tour moves).
   `open`: the element takes taps and typing while the stop shows (a field to fill in).
   `free`: the screen is the user's: no dimming, a small bar instead of a card, for the stops where
     a sheet has to be used (picking exercises, giving a routine a day).
   `until(ctx)`: the stop moves on by itself once this holds (see ctxOf in Tour.jsx for ctx).
   `lost(ctx)` + `back`: the stop no longer makes sense (its sheet was closed): go back to `back`.
   `sheet`: the element lives in a bottom sheet, which stays open for it. Any other stop closes
     what sheets are open, so the next spotlight is not under one.
   `skip(ctx)`: passed over when this holds at the moment it is reached.
   `sandbox`: what the store shows meanwhile (useStore enterTourSandbox): 'practice', the sample
     session; 'plan', a copy the new routine is built in until Save; 'edit', a copy with a pretend
     workout and weigh-in. Nothing in a sandbox is saved or synced, and it is gone when the stops
     that need it are.
   `commit`: the stop whose button saves the sandbox's routine for real.
   `when(profile)`: a stop that only makes sense for some profiles, decided once at the start.
   `optional`: a stop whose element may not be there (no rest timer after a Next instead of a
     tick, a row this device does not have) is passed over rather than shown pointing at nothing. */
export const STEPS = [
  { id: 'today', route: '/home', anchor: 'today' },
  { id: 'go-plan', route: '/home', anchor: 'tab-plan', go: '/plan' },
  { id: 'plan-mode', route: '/plan', anchor: 'plan-mode' },
  { id: 'plan-views', route: '/plan', anchor: 'plan-views' },
  { id: 'plan-body', route: '/plan', anchor: 'plan-body', when: c => c.plannedDays, optional: true },
  { id: 'plan-menu', route: '/plan', anchor: 'plan-menu' },
  { id: 'go-library', route: '/plan', anchor: 'tab-library', go: '/library' },
  { id: 'lib-search', route: '/library', anchor: 'lib-search' },
  { id: 'lib-filters', route: '/library', anchor: 'lib-filters' },
  { id: 'start', route: '/library', anchor: 'start', intercept: true },
  { id: 'set', route: '/workout', anchor: 'set', sandbox: 'practice' },
  { id: 'tick', route: '/workout', anchor: 'tick', sandbox: 'practice', tap: true },
  { id: 'rest', route: '/workout', anchor: 'rest', sandbox: 'practice', when: c => c.rest, optional: true },
  { id: 'swipe', route: '/workout', anchor: 'swipe', sandbox: 'practice', when: c => c.swipe, optional: true },
  { id: 'more', route: '/workout', anchor: 'workout-more', sandbox: 'practice' },
  { id: 'finish', route: '/workout', anchor: 'finish', sandbox: 'practice' },
  { id: 'go-stats', route: '/home', anchor: 'tab-stats', go: '/stats' },
  { id: 'stats', route: '/stats', anchor: 'stats-tiles' },
  { id: 'stats-body', route: '/stats', anchor: 'stats-body', when: c => c.balance, optional: true },
  { id: 'stats-records', route: '/stats', anchor: 'stats-records', when: c => c.workouts, optional: true },
  { id: 'go-home', route: '/stats', anchor: 'tab-home', go: '/home' },
  { id: 'go-settings', route: '/home', anchor: 'settings-gear', go: '/settings' },
  { id: 'look', route: '/settings', anchor: 'settings-look' },
  { id: 'units', route: '/settings', anchor: 'settings-units' },
  { id: 'data', route: '/settings', anchor: 'settings-data' },
  { id: 'done', route: null, anchor: null },
]

const routineOf = c => c.S?.routines?.find(r => r.id === c.made)
const inSettings = c => /^\/settings(\/|$)/.test(c.path || '')
const scheduled = c => c.has('plan-week') || c.has('plan-loop-add')

// Build your first plan: a real routine, built in a copy (sandbox 'plan') so that quitting halfway
// leaves nothing behind, and saved into the real plan only by the Save on its card.
const PLAN = [
  { id: 'p-intro', route: null, anchor: null },
  { id: 'p-go', route: null, anchor: 'tab-plan', go: '/plan' },
  // "New routine" is on the Routines side of Plan; already there, this one is passed over.
  { id: 'p-views', route: '/plan', anchor: 'plan-views', open: true, until: c => c.has('plan-new'), skip: c => c.has('plan-new') },
  { id: 'p-new', route: '/plan', anchor: 'plan-new', go: /^\/plan\/r\/[^/]+$/, sandbox: 'plan' },
  { id: 'p-name', route: c => '/plan/r/' + c.made, anchor: 'routine-name', open: true, sandbox: 'plan' },
  { id: 'p-add', route: c => '/plan/r/' + c.made, anchor: 'routine-add', open: true, sandbox: 'plan', until: c => c.sheets > 0 },
  { id: 'p-pick', route: c => '/plan/r/' + c.made, anchor: null, free: true, sheet: true, sandbox: 'plan',
    until: c => !c.sheets && (routineOf(c)?.ex.length || 0) > 0, lost: c => !c.sheets && !routineOf(c)?.ex.length, back: 'p-add' },
  { id: 'p-row', route: c => '/plan/r/' + c.made, anchor: 'routine-ex', sandbox: 'plan', optional: true },
  { id: 'p-save', route: c => '/plan/r/' + c.made, anchor: null, sandbox: 'plan', commit: true },
  { id: 'p-back', route: c => '/plan/r/' + c.made, anchor: 'routine-back', go: '/plan' },
  { id: 'p-sched', route: '/plan', anchor: 'plan-views', open: true, until: scheduled, skip: scheduled },
  // A weekday, or a place in the loop, whichever way this profile trains (the other is passed over).
  { id: 'p-day', route: '/plan', anchor: 'plan-week', free: true, sheet: true, optional: true, skip: c => c.has('plan-loop-add'),
    until: c => !c.sheets && Object.values(c.S?.week || {}).some(v => [].concat(v || []).includes(c.made)) },
  { id: 'p-loop', route: '/plan', anchor: 'plan-loop-add', free: true, sheet: true, optional: true, skip: c => c.has('plan-week'),
    until: c => !c.sheets && (c.S?.rotation?.sequence || []).includes(c.made) },
  { id: 'p-done', route: null, anchor: null },
]

// Create your own exercise: the real form. Nothing exists until its own Create button.
const madeEx = c => (c.S?.customEx?.length || 0) > (c.entry.customEx || 0)
const CUSTOM = [
  { id: 'c-intro', route: null, anchor: null },
  { id: 'c-go', route: null, anchor: 'tab-library', go: '/library' },
  { id: 'c-new', route: '/library', anchor: 'lib-new', open: true, until: c => c.sheets > 0 },
  { id: 'c-name', route: '/library', anchor: 'cx-name', open: true, sheet: true, lost: c => !c.sheets, back: 'c-new' },
  { id: 'c-bp', route: '/library', anchor: 'cx-bp', open: true, sheet: true, lost: c => !c.sheets, back: 'c-new' },
  { id: 'c-eq', route: '/library', anchor: 'cx-eq', open: true, sheet: true, lost: c => !c.sheets, back: 'c-new' },
  { id: 'c-media', route: '/library', anchor: 'cx-media', open: true, sheet: true, optional: true, lost: c => !c.sheets, back: 'c-new' },
  { id: 'c-save', route: '/library', anchor: 'cx-save', open: true, sheet: true, until: madeEx, lost: c => !c.sheets && !madeEx(c), back: 'c-new' },
  // Created: its page opens on its own. Not created (Next instead): there is no page to show.
  { id: 'c-unit', route: '/library', anchor: 'ex-unit', sheet: true, optional: true },
  { id: 'c-done', route: null, anchor: null },
]

// Edit your data: the real screens on a copy (sandbox 'edit') holding a pretend workout and
// weigh-in, so poking at them changes nothing of the user's.
const EDIT = [
  { id: 'e-intro', route: null, anchor: null, sandbox: 'edit' },
  { id: 'e-go-home', route: null, anchor: 'tab-home', go: '/home', sandbox: 'edit' },
  { id: 'e-weighins', route: '/home', anchor: 'home-weighins', open: true, sandbox: 'edit', optional: true, until: c => c.sheets > 0 },
  { id: 'e-weighin', route: '/home', anchor: 'weighin-del', sheet: true, sandbox: 'edit', optional: true },
  { id: 'e-go-stats', route: '/home', anchor: 'tab-stats', go: '/stats', sandbox: 'edit' },
  { id: 'e-history', route: '/stats', anchor: 'stats-history', go: '/history', sandbox: 'edit' },
  { id: 'e-past', route: '/history', anchor: 'history-add', sandbox: 'edit' },
  { id: 'e-row', route: '/history', anchor: 'history-row', open: true, sandbox: 'edit', until: c => c.sheets > 0 },
  { id: 'e-edit', route: '/history', anchor: 'wd-edit', sheet: true, sandbox: 'edit', lost: c => !c.sheets, back: 'e-row' },
  { id: 'e-note', route: '/history', anchor: 'wd-note', sheet: true, sandbox: 'edit', optional: true, lost: c => !c.sheets, back: 'e-row' },
  // Date & time, duration, sharing and Delete sit behind one row since v1.4.4 (was: e-date on its own button).
  { id: 'e-options', route: '/history', anchor: 'wd-options', sheet: true, sandbox: 'edit', lost: c => !c.sheets, back: 'e-row' },
  { id: 'e-back', route: '/history', anchor: 'history-back', go: '/stats', sandbox: 'edit' },
  { id: 'e-measure', route: '/stats', anchor: 'stats-measure', sandbox: 'edit' },
  { id: 'e-routines', route: '/stats', anchor: 'tab-plan', sandbox: 'edit' },
  { id: 'e-cant', route: null, anchor: null, sandbox: 'edit' },
  { id: 'e-done', route: null, anchor: null },
]

// Export & import: where the data goes in and out. Only pointing: nothing here runs an export.
const BACKUP = [
  { id: 'b-intro', route: null, anchor: null },
  { id: 'b-up', route: null, anchor: 'sp-back', go: '/settings', skip: c => !/^\/settings\/./.test(c.path || '') },
  { id: 'b-go-home', route: null, anchor: 'tab-home', go: '/home', skip: inSettings },
  { id: 'b-go-settings', route: null, anchor: 'settings-gear', go: '/settings' },
  { id: 'b-data', route: '/settings', anchor: 'settings-data', go: '/settings/data' },
  { id: 'b-export', route: '/settings/data', anchor: 'data-export' },
  { id: 'b-csv', route: '/settings/data', anchor: 'data-csv' },
  { id: 'b-auto', route: '/settings/data', anchor: 'data-auto', optional: true },
  { id: 'b-health', route: '/settings/data', anchor: 'data-health', optional: true },
  { id: 'b-import', route: '/settings/data', anchor: 'data-import' },
  { id: 'b-apps', route: '/settings/data', anchor: 'data-apps' },
  { id: 'b-up2', route: '/settings/data', anchor: 'sp-back', go: '/settings' },
  { id: 'b-sync', route: '/settings', anchor: 'settings-account' },
  { id: 'b-done', route: null, anchor: null },
]

/** Every flow by name: the tour, then the tutorials in the order Settings lists them. */
export const FLOWS = { tour: STEPS, plan: PLAN, custom: CUSTOM, edit: EDIT, backup: BACKUP }
export const TUTORIALS = ['plan', 'custom', 'edit', 'backup']
// What the closing card and Settings call each tutorial (literal t() calls for check-source-strings).
export const TUTORIAL_COPY = {
  plan: () => [t('Build your first plan'), t('Name a routine, add exercises, give it a day')],
  custom: () => [t('Create your own exercise'), t('Name, muscles, equipment and a photo')],
  edit: () => [t('Edit your data'), t('Workouts, weigh-ins and what can be fixed')],
  backup: () => [t('Export & import'), t('Backups, spreadsheets, other apps and sync')],
}


/** The stops of `flow` for this profile, in order. `ctx`: { plannedDays, rest, swipe, balance, workouts }. */
export function tourSteps(ctx = {}, flow = 'tour') {
  return (FLOWS[flow] || STEPS).filter(s => !s.when || s.when(ctx))
}

/** Where to go from `i` in direction `dir` (+1 / -1): the index, or -1 past either end. */
export function stepFrom(steps, i, dir) {
  const j = i + dir
  return j >= 0 && j < steps.length ? j : -1
}

/** The index of a step by id, or 0 when it is not (or no longer) in the list. */
export function indexOfStep(steps, id) {
  const i = steps.findIndex(s => s.id === id)
  return i < 0 ? 0 : i
}

/** A stop's screen: its own, one worked out from what the tour made (`made`), or null for "here". */
export const routeOf = (step, ctx = {}) => (typeof step.route === 'function' ? step.route(ctx) : step.route)

/** Whether `path` is the screen a `go` stop leads to. */
export function reached(step, path) {
  if (!step.go || !path) return false
  return step.go instanceof RegExp ? step.go.test(path) : path === step.go
}

/** Whether a stop is passed over on arrival: its own `skip`, or a way to a screen already on. */
export function passOver(step, ctx) {
  if (step.skip) return !!step.skip(ctx)
  return !!step.go && reached(step, ctx.path)
}

// The sample session's routine, which exists only inside the tour's sandbox.
export const SAMPLE_ROUTINE_ID = 'tour-sample'
// The pretend workout of the "Edit your data" tutorial: in its sandbox only.
export const SAMPLE_WORKOUT_ID = 'tour-sample-workout'

const GAP = 12, EDGE = 16
/**
 * Where the card goes beside a spotlight `hole` ({ top, left, width, height }, or null for the
 * middle): under it when it fits, else over it, else wherever there is more room, and never past
 * the screen's edges or the phone's own insets (`top`, `bottom`). Centred on the hole sideways.
 * `arrow`: how far in from the card's left edge it points at the hole's middle (null: the card
 * had to sit on the hole and points at nothing).
 */
export function placeCard(hole, card, { vw, vh, top = 0, bottom = 0 }) {
  const minTop = top + EDGE, maxTop = Math.max(minTop, vh - bottom - EDGE - card.h)
  const clampTop = y => Math.min(maxTop, Math.max(minTop, y))
  const left = Math.round(Math.min(Math.max(EDGE, vw - EDGE - card.w), Math.max(EDGE, hole ? hole.left + hole.width / 2 - card.w / 2 : (vw - card.w) / 2)))
  if (!hole) return { top: Math.round(clampTop((vh - card.h) / 2)), left, side: 'center', arrow: null }
  const arrow = Math.round(Math.min(card.w - 22, Math.max(22, hole.left + hole.width / 2 - left)))
  const below = vh - bottom - EDGE - (hole.top + hole.height + GAP)
  const above = hole.top - GAP - minTop
  if (below >= card.h) return { top: Math.round(hole.top + hole.height + GAP), left, side: 'below', arrow }
  if (above >= card.h) return { top: Math.round(hole.top - GAP - card.h), left, side: 'above', arrow }
  return below >= above
    ? { top: Math.round(clampTop(hole.top + hole.height + GAP)), left, side: 'below', arrow: null }
    : { top: Math.round(clampTop(hole.top - GAP - card.h)), left, side: 'above', arrow: null }
}

/**
 * The part of an element's box that is on screen (`view`: { top, bottom, vw }, the band between
 * the phone's insets and the keyboard), or null when too little of it shows to point at: a
 * spotlight on a sliver at the edge reads as pointing at nothing.
 */
export function visiblePart(r, view, min = 16) {
  if (!r || !(r.width > 0) || !(r.height > 0)) return null
  const top = Math.max(r.top, view.top), bottom = Math.min(r.top + r.height, view.bottom)
  const left = Math.max(r.left, 0), right = Math.min(r.left + r.width, view.vw)
  if (bottom - top < Math.min(min, r.height) || right - left < Math.min(min, r.width)) return null
  return { top, left, width: right - left, height: bottom - top }
}

/* ---------------- the record: { offered, done, at, resumeAsked, tutorials } ---------------- */

export function readTour() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} }
}
function writeTour(patch) {
  const next = { ...readTour(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: asked again next time, no harm */ }
  return next
}

/** A step of the tour reached: the place a closed app picks up from. */
export const noteStep = id => writeTour({ at: id, resumeAsked: false })
/** Seen to the end, skipped or closed: never offered again (Settings can still run it). */
export const markTourDone = () => writeTour({ done: Date.now(), at: null })
/** The first-run question was asked; whatever the answer, it is not asked twice. */
export const markOffered = () => writeTour({ offered: Date.now() })
/** The "pick up where you left off" question was asked: once, as promised. */
export const markResumeAsked = () => writeTour({ resumeAsked: true })
/** A tutorial seen to its end: Settings ticks it off (it can still run again). */
export const markTutorialDone = flow => writeTour({ tutorials: { ...(readTour().tutorials || {}), [flow]: Date.now() } })
export const tutorialDone = (flow, record = readTour()) => !!record.tutorials?.[flow]

/**
 * Whether to ask "Want a 1-minute tour?" now. Only on a first setup: never asked before on this
 * device, and a profile that has not logged anything yet (someone signing in with years of
 * history knows the way around). `synced`: the copy is the account's own, not one still on its
 * way down from the server.
 */
export function shouldOffer(record, S, { synced = true } = {}) {
  if (!S || record.offered || record.done || record.at) return false
  return synced && !S.active && !(S.workouts || []).length
}

/** The step a tour closed halfway can resume from, once: its id, or null. */
export function resumeAt(record) {
  return record.at && !record.done && !record.resumeAsked ? record.at : null
}

/* ---------------- open or not (the main bundle's side) ---------------- */

// null, { kind: 'offer' }, { kind: 'resume', at }, { kind: 'run', at } (the tour) or
// { kind: 'run', at, flow } (a tutorial)
let state = null
const subs = new Set()
const emit = () => { for (const f of subs) f() }
const subscribe = f => { subs.add(f); return () => subs.delete(f) }

export const tourState = () => state
export const tourRunning = () => state?.kind === 'run'
export function openTour(next) { state = next; emit() }
export function closeTour() { if (state) { state = null; emit() } }
/** From Settings: the tour from the top, whatever the record says, or one tutorial (`flow`). */
export const startTour = (at = null, flow = 'tour') => openTour(flow === 'tour' ? { kind: 'run', at } : { kind: 'run', at, flow })

export const useTour = () => useSyncExternalStore(subscribe, tourState, tourState)
/** Whether the tour is running: the seasonal decorations step aside meanwhile. */
export const useTourRunning = () => useSyncExternalStore(subscribe, tourRunning, tourRunning)

// Android back (lib/back.js) asks here first: the open tour takes the press and closes. A
// tutorial closed that way leaves the tour's own record alone.
export function tourBack() {
  if (!state) return false
  if (state.kind === 'run' && !state.flow) markTourDone()
  closeTour()
  return true
}
