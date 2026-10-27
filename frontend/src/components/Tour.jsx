// The app tour and its tutorials: coach marks on the real screens (lib/tour.js has the steps and
// the record). Its own chunk, loaded by App only while the tour or its question is open, so a
// normal start pays nothing for it.
//
// A spotlight is cut out over one element (data-tour="..."), the rest of the screen is dimmed and
// takes no taps or scrolling, and a small card says what it is. The spotlight follows its element
// (a scroll, a keyboard, a turned phone, a card that grows) and brings it back on screen when it
// slips off; while it is off, the card speaks from the middle instead of pointing at nothing.
// A way to another screen is shown on the real control (a tab, the gear, a back button) and waits
// for the tap, with "Show me" to do it for you. The workout stops run on a sample session, the
// plan tutorial builds its routine in a copy until Save, and the data tutorial edits a copy with a
// pretend workout in it (useStore enterTourSandbox): none of those copies is saved or synced, and
// each is gone the moment the tour leaves the stops that use it, finished, skipped or closed.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { workoutControls } from '../lib/workout-controls.js'
import {
  useTour, tourSteps, stepFrom, indexOfStep, noteStep, markTourDone, markTutorialDone, markOffered, markResumeAsked,
  openTour, closeTour, placeCard, visiblePart, routeOf, reached, passOver, TUTORIALS, TUTORIAL_COPY, SAMPLE_ROUTINE_ID, SAMPLE_WORKOUT_ID,
} from '../lib/tour.js'
import { beginWorkout } from '../sheets.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import './Tour.css'

// What each stop says. Literal t() calls, so check-source-strings sees every one.
const COPY = {
  today: () => [t('Today at a glance'), t('Today’s session lives here. One tap and you’re lifting. On a rest day it says so, no guilt trip.')],
  'go-plan': () => [t('Off to Plan'), t('Your routines live behind this tab. Tap Plan.')],
  'plan-mode': () => [t('Week or rotation'), t('Train on fixed weekdays, or run your routines in a loop where the next one waits for you.')],
  'plan-views': () => [t('Your routines'), t('Schedule says when, Routines says what. Build your own or grab a starter plan.')],
  'plan-body': () => [t('Muscles at a glance'), t('The little body shows what each day works, so leg day can’t hide.')],
  'plan-menu': () => [t('Programmes and sharing'), t('Programmes, starter plans and sharing a plan with a friend live behind this button.')],
  'go-library': () => [t('The exercise library'), t('Every exercise is one tap away. Tap Exercises.')],
  'lib-search': () => [t('Find any exercise'), t('Search thousands of exercises in your language. Star your favourites and they float to the top.')],
  'lib-filters': () => [t('Filter it down'), t('Narrow the list by body part, type or the equipment you have.')],
  start: () => [t('The big Start button'), t('It starts today’s plan, or lets you pick something else. Tap it for a practice run.')],
  set: () => [t('A practice workout'), t('This one is pretend, nothing gets saved. Each row is a set: weight, then reps. Tap a number to change it.')],
  tick: () => [t('Tick it off'), t('Done with a set? Tick it. Go on, try it.')],
  rest: () => [t('Catch your breath'), t('The rest timer starts by itself. Add time, or skip it if you feel heroic.')],
  swipe: () => [t('Swipe a set'), t('Swipe a set sideways to copy or remove it. Its number opens even more.')],
  more: () => [t('The ⋯ menu'), t('Workout settings, layouts, notes and extra exercises hide in here.')],
  finish: () => [t('Finish line'), t('Finish saves the session and moves your weights along. This practice one just quietly disappears.')],
  'go-stats': () => [t('Your progress'), t('Back home, practice over. Stats is where the gains pile up. Tap it.')],
  stats: () => [t('Your numbers'), t('Workouts, streaks and everything you’ve lifted. It fills up as you train.')],
  'stats-body': () => [t('Body map'), t('See which muscles got the work and which still need rest. Tap one for details.')],
  'stats-records': () => [t('Records'), t('Pick an exercise to see its best sets, estimated max and where it’s heading.')],
  'go-home': () => [t('Settings are on Home'), t('Head back to Home first. Tap it.')],
  'go-settings': () => [t('The gear'), t('Everything you can tweak hides behind this little gear. Tap it.')],
  look: () => [t('Make it yours'), t('Theme, accent colour and what Home shows.')],
  units: () => [t('Units & language'), t('Kilos or pounds, and the language you like best.')],
  data: () => [t('Your data, your backups'), t('Backups, imports and syncing with your own server.')],
  done: () => [t('You’re set'), t('Want more? Each of these is a short guided run. You’ll find them again in Settings → About & updates.')],

  'p-intro': () => [t('Build your first plan'), t('This one is for real: we build a routine together and it lands in your plan when you tap Save. Bail before that and nothing stays behind.')],
  'p-go': () => [t('Off to Plan'), t('Routines are made in Plan. Tap it.')],
  'p-views': () => [t('Routines'), t('New routines start on the Routines side. Tap Routines.')],
  'p-new': () => [t('A new routine'), t('Tap New routine. It stays a draft until you save it.')],
  'p-name': () => [t('Name it'), t('Push Day, Legs, Monday Misery. Tap the name and type your own.')],
  'p-add': () => [t('Add exercises'), t('Tap Add exercise to pick what goes in.')],
  'p-pick': () => [t('Pick your exercises'), t('Tap one to set its sets, reps and weight, or + to take the usual. Close the list when you’re done.')],
  'p-row': () => [t('Fine-tune it'), t('Tap an exercise any time to change sets, reps or weight. The arrows reorder, the link makes a superset.')],
  'p-save': () => [t('Save your plan?'), t('This is your real plan now, if you want it. Save keeps it. Skip and it was never here.')],
  'p-back': () => [t('Saved!'), t('Now give it a day. Tap back to Plan.')],
  'p-sched': () => [t('When do you train it?'), t('Tap Schedule to put it on a day.')],
  'p-day': () => [t('Pick a day'), t('Tap a weekday and choose your new routine. Two on one day works too.')],
  'p-loop': () => [t('Add it to the loop'), t('Tap Add and pick your new routine. The loop runs in that order.')],
  'p-done': () => [t('That’s a plan'), t('Home shows it on its day and Start opens it. Change it any time right here.')],

  'c-intro': () => [t('Your own exercise'), t('Missing one? Make it. It works like any other: routines, workouts, records, the body map, backups and sync. Nothing is created until you tap Create.')],
  'c-go': () => [t('The exercise library'), t('Custom exercises live with the rest. Tap Exercises.')],
  'c-new': () => [t('Create your own exercise'), t('It’s the first row of the list. Tap it.')],
  'c-name': () => [t('Name it'), t('Call it what you call it. Other names you add help the search find it.')],
  'c-bp': () => [t('Body part'), t('Pick one. Muscle groups are optional, but they feed the body map and muscle balance.')],
  'c-eq': () => [t('Equipment'), t('So the equipment filter and your gym profiles know about it.')],
  'c-media': () => [t('A photo or video'), t('Optional: your own picture or clip of the setup. Handy for that one weird machine.')],
  'c-save': () => [t('Create it'), t('Tap Create exercise when it looks right. Or Next to just look around.')],
  'c-unit': () => [t('Its own page'), t('Weight unit, plates and stack live here. Edit or delete the exercise from here too.')],
  'c-done': () => [t('That’s the lot'), t('Search finds your exercises like any other, and they go into routines and workouts the same way.')],

  'e-intro': () => [t('Edit your data'), t('We swapped in a practice copy with a pretend workout and weigh-in. Poke at anything, nothing here sticks.')],
  'e-go-home': () => [t('Weigh-ins first'), t('They’re on Home. Tap it.')],
  'e-weighins': () => [t('Every weigh-in'), t('Tap All weigh-ins.')],
  'e-weighin': () => [t('Fix a weigh-in'), t('The bin deletes one, and Undo pops up right after. Wrong number? Log that day again and the new one wins.')],
  'e-go-stats': () => [t('Now your workouts'), t('They live under Stats. Tap it.')],
  'e-history': () => [t('History'), t('Every workout you’ve logged. Tap the clock.')],
  'e-past': () => [t('Forgot one?'), t('Log a past workout with its own date and time. It counts like any other.')],
  'e-row': () => [t('Open a workout'), t('Here’s the pretend one. Tap it.')],
  'e-edit': () => [t('Edit a workout'), t('Reopens it: sets, weights, reps, exercises. Nothing changes until you tap Save.')],
  'e-note': () => [t('Notes'), t('Rewrite the session note whenever.')],
  'e-options': () => [t('Workout options'), t('Wrong day or forgot to finish on time? Fix it in here. Sharing, export and Delete live here too.')],
  'e-back': () => [t('Back to Stats'), t('Tap back.')],
  'e-measure': () => [t('Measurements and photos'), t('Open a check-in to change or delete it. Progress photos work the same way.')],
  'e-routines': () => [t('Routines'), t('Change them any time in Plan. Past workouts keep what you actually did.')],
  'e-cant': () => [t('What you can’t edit'), t('An exercise’s history, records and progress are worked out from your workouts. Fix the workout and they follow.')],
  'e-done': () => [t('Practice copy gone'), t('Your real data is exactly as you left it.')],

  'b-intro': () => [t('Export & import'), t('Where your data goes in and out. We only point, nothing runs until you tap it yourself.')],
  'b-up': () => [t('Up one level'), t('Tap back to Settings.')],
  'b-go-home': () => [t('Settings are on Home'), t('Head back to Home first. Tap it.')],
  'b-go-settings': () => [t('The gear'), t('Everything you can tweak hides behind this little gear. Tap it.')],
  'b-data': () => [t('Data & backup'), t('Tap it.')],
  'b-export': () => [t('Back it all up'), t('One file with everything. Keep it somewhere safe, Import backup brings it back.')],
  'b-csv': () => [t('Spreadsheet'), t('Your sets, weigh-ins and measurements as CSV. Our importer reads it back too.')],
  'b-auto': () => [t('Hands-free backups'), t('The phone saves a fresh backup by itself after changes.')],
  'b-health': () => [t('Health apps'), t('Share weigh-ins and workouts with the phone’s health app.')],
  'b-import': () => [t('Restore a backup'), t('Pick a backup file and it’s all back.')],
  'b-apps': () => [t('Moving in?'), t('Strong, Hevy, FitNotes, GymMane or Apple Health body weight: import their export here.')],
  'b-up2': () => [t('One more'), t('Syncing lives under your account. Tap back to Settings.')],
  'b-sync': () => [t('Your own server'), t('Syncing your devices through your own openGym server lives under your account. No server? Everything still works on this device.')],
  'b-done': () => [t('That’s the lot'), t('Your data, your call. Back it up now and then, future you will be grateful.')],
}

// How long a stop waits for its element to appear (a screen still loading its chunk). Tests shorten it.
let anchorWait = 2000
export const _setAnchorWait = ms => { anchorWait = ms }

const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The element a stop points at: the first one on screen, not one in the page an edge swipe back
    shows underneath or a card preview (both inert). */
export function findAnchor(name) {
  if (!name) return null
  for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) {
    if (el.closest('[inert]') || el.closest('.page.under') || el.closest('[hidden]')) continue
    return el
  }
  return null
}

// What a screen reader hears the spotlight is on: the element's own name, kept short.
const nameOf = el => {
  if (!el) return ''
  const own = el.getAttribute('aria-label') || el.querySelector?.('[aria-label]')?.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || ''
  const s = own.replace(/\s+/g, ' ').trim()
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

// Which optional stops this profile gets (lib/tour.js tourSteps).
const profileOf = S => ({
  plannedDays: scheduleModeOf(S) !== 'rotation' && Object.values(S.week || {}).some(v => [].concat(v || []).some(id => S.routines.some(r => r.id === id))),
  rest: (S.restSec ?? 90) > 0,
  swipe: !!workoutControls(S).swipeSets && (S.workoutView || 'cards') !== 'focus',
  balance: S.workouts.length > 0 || S.routines.some(r => r.ex?.length),
  workouts: S.workouts.length > 0,
})

/* ---------------- the sandboxes ---------------- */

// The sample session: a routine of two classics, only ever inside the sandbox.
const sampleRoutine = S => ({
  id: SAMPLE_ROUTINE_ID, name: t('Practice run'), emoji: 'barbell',
  ex: [
    { id: '0025', sets: 3, reps: 8, weight: S.unit === 'lb' ? 45 : 20 },
    { id: '0043', sets: 3, reps: 8, weight: S.unit === 'lb' ? 95 : 40 },
  ],
})
// The data tutorial's pretend workout (today, so it heads History) and a weigh-in to go with it.
function addSamples(s) {
  const lb = s.unit === 'lb', now = Date.now(), d = todayISO()
  const w = (kg, l) => (lb ? l : kg)
  s.workouts = [...(s.workouts || []), {
    id: SAMPLE_WORKOUT_ID, name: t('Practice session'), d, start: now - 70 * 60000, end: now - 15 * 60000,
    note: t('Felt strong. Probably the coffee.'),
    entries: [
      { id: '0025', sets: [{ w: w(20, 45), r: 8, done: true }, { w: w(22.5, 50), r: 8, done: true }, { w: w(25, 55), r: 6, done: true }] },
      { id: '0043', sets: [{ w: w(40, 95), r: 8, done: true }, { w: w(40, 95), r: 8, done: true }] },
    ],
  }]
  if (!(s.bodyweight || []).some(b => b.d === d)) {
    const last = (s.bodyweight || []).at(-1)
    s.bodyweight = [...(s.bodyweight || []), { d, w: last?.w || w(75, 165), t: now }]
  }
}

export function startPractice() {
  const st = useStore.getState()
  if (st.tourSandbox) return
  st.enterTourSandbox(s => {
    s.routines = [...s.routines, sampleRoutine(s)]
    s.active = null
  })
  beginWorkout([SAMPLE_ROUTINE_ID], null)
  const S = useStore.getState().S
  if (S.active) useStore.getState().update(s => { if (s.active) s.active.tour = true })
}
export function endPractice() {
  if (!useStore.getState().tourSandbox) return
  const ui = useUI.getState()
  ui.stopRest()
  ui.stopWork?.()
  useStore.getState().leaveTourSandbox()
}

// Which sandbox is up: one at a time, the one the stop asks for.
let sandboxKind = null
function sandboxFor(kind) {
  if (kind && sandboxKind === kind && useStore.getState().tourSandbox) return
  leaveSandbox()
  if (!kind) return
  if (kind === 'practice') startPractice()
  else useStore.getState().enterTourSandbox(s => { s.active = null; if (kind === 'edit') addSamples(s) })
  sandboxKind = kind
}
export function leaveSandbox() {
  endPractice()
  sandboxKind = null
}

/** The plan tutorial's Save: the routine built in the copy goes into the real plan, with any
    exercise made for it on the way. True when there was one to save. */
export function commitPlan(id) {
  const st = useStore.getState()
  const r = st.tourSandbox && st.S.routines.find(x => x.id === id)
  if (!r) return false
  const routine = JSON.parse(JSON.stringify(r))
  const custom = (st.S.customEx || []).filter(c => routine.ex.some(e => e.id === c.id))
  leaveSandbox()
  useStore.getState().update(s => {
    const at = s.routines.findIndex(x => x.id === routine.id)
    if (at >= 0) s.routines[at] = routine
    else s.routines.push(routine)
    s.customEx = s.customEx || []
    for (const c of custom) if (!s.customEx.some(x => x.id === c.id)) s.customEx.push(JSON.parse(JSON.stringify(c)))
  })
  return true
}

/* ---------------- the frame ---------------- */

// The insets the phone keeps for itself (index.css --sat/--sab), read once through a probe.
function safeInsets() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:var(--sat,0px);padding-bottom:var(--sab,0px)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 }
  probe.remove()
  return out
}

// The band of the screen a spotlight can be in: between the phone's insets, above the keyboard
// (the visual viewport shrinks for it), in the layout viewport's coordinates.
function viewBand(insets) {
  const vw = window.innerWidth, ih = window.innerHeight
  const vv = window.visualViewport?.height > 0 ? window.visualViewport : null
  const vTop = vv ? vv.offsetTop || 0 : 0
  const vH = vv ? vv.height : ih
  const keyboard = vv && ih - vH > 120
  return { vw, vh: Math.min(ih, vTop + vH), top: Math.max(insets.top, vTop), bottom: keyboard ? 0 : insets.bottom }
}

// The band as visiblePart reads it: its top and bottom edges.
const bandBox = b => ({ top: b.top, bottom: b.vh - b.bottom, vw: b.vw })

// Tab stays inside the card unless the stop hands the screen over; Escape closes.
function useCardKeys(cardRef, onEscape, trap = true) {
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); onEscape(); return }
      if (e.key !== 'Tab' || !cardRef.current || !trap) return
      const f = [...cardRef.current.querySelectorAll('button:not([disabled])')]
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      const inside = cardRef.current.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onEscape, trap])
}

/* "Want a 1-minute tour?" after the first setup, or "Finish the tour?" once after it was closed
   halfway. A small card in the middle; either answer is remembered. */
function Question({ kind, at }) {
  const cardRef = useRef(null)
  const resume = kind === 'resume'
  useEffect(() => { if (resume) markResumeAsked(); else markOffered() }, [resume])
  useEffect(() => { cardRef.current?.focus() }, [])
  const no = () => { if (resume) markTourDone(); closeTour() }
  const yes = () => openTour({ kind: 'run', at: resume ? at : null })
  useCardKeys(cardRef, no)
  return <div className="tour tour-ask">
    <div className="tour-block tour-dim" />
    <div className="tour-card tour-center" ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b">
      <h2 id="tour-t">{resume ? t('Finish the tour?') : t('Want a 1-minute tour?')}</h2>
      <p id="tour-b">{resume ? t('You stopped halfway. Want to see the rest?') : t('We’ll point at the good bits on the real screens. Bail out anytime.')}</p>
      <div className="tour-acts">
        <Button onClick={no}>{resume ? t('No thanks') : t('Skip')}</Button>
        <Button variant="primary" onClick={yes}>{resume ? t('Continue') : t('Show me')}</Button>
      </div>
    </div>
  </div>
}

// A tutorial from the closing card: the tour counts as seen, the tutorial runs from its start.
const runTutorial = flow => { markTourDone(); leaveSandbox(); openTour({ kind: 'run', at: null, flow }) }

function Run({ at, flow = 'tour' }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S0 = useRef(useStore.getState().S).current
  const steps = useMemo(() => tourSteps(profileOf(S0), flow), [S0, flow])
  const [i, setI] = useState(() => indexOfStep(steps, at))
  const [rect, setRect] = useState(null)
  // The stop the spotlight is ready for: a stale true from the stop before never counts.
  const [readyAt, setReadyAt] = useState(-1)
  const ready = readyAt === i
  const [card, setCard] = useState({ w: 320, h: 180 })
  const [band, setBand] = useState(null)
  const [sheetTop, setSheetTop] = useState(null)
  const [, setTick] = useState(0)
  const cardRef = useRef(null)
  const anchorRef = useRef(null)
  const dirRef = useRef(1)
  const madeRef = useRef(null)
  const entryRef = useRef({})
  const shownAt = useRef(0)
  const pathRef = useRef(loc.pathname)
  pathRef.current = loc.pathname
  const insets = useMemo(() => safeInsets(), [])
  const reduced = useMemo(reducedMotion, [])
  const step = steps[i]
  const [title, body] = (COPY[step.id] || (() => [step.id, '']))()
  const tutorial = flow !== 'tour'

  // What the stops' rules read (lib/tour.js until / lost / skip).
  const ctxNow = () => ({
    S: useStore.getState().S, path: pathRef.current, sheets: useUI.getState().sheets.length,
    made: madeRef.current, entry: entryRef.current, has: name => !!findAnchor(name),
  })

  const finish = (completed = false) => {
    if (!tutorial) markTourDone()
    else if (completed) markTutorialDone(flow)
    leaveSandbox()
    if (useUI.getState().sheets.length) useUI.getState().closeAll()
    closeTour()
    const path = pathRef.current
    // A screen that was only there in a copy (the practice workout, the routine not saved) is not
    // left on screen without its data.
    const gone = /^\/plan\/r\//.test(path) && !useStore.getState().S.routines.some(r => '/plan/r/' + r.id === path)
    if (path === '/workout' || (!tutorial && completed)) nav('/home', { replace: true })
    else if (gone) nav('/plan', { replace: true })
  }
  const go = dir => {
    dirRef.current = dir
    const j = stepFrom(steps, i, dir)
    if (j < 0) { if (dir > 0) finish(true); return }
    setI(j)
  }
  const jump = id => {
    const j = steps.findIndex(s => s.id === id)
    if (j >= 0) { dirRef.current = -1; setI(j) }
  }

  // Each stop: the right copy of the data, the right screen, then the element.
  useEffect(() => {
    let gone = false, tm = null
    setReadyAt(-1)
    setRect(null)
    anchorRef.current = null
    if (!tutorial) noteStep(step.id)
    sandboxFor(step.sandbox)
    if (!step.sheet && useUI.getState().sheets.length) useUI.getState().closeAll()
    entryRef.current = { customEx: (useStore.getState().S.customEx || []).length }
    const route = routeOf(step, { made: madeRef.current })
    if (route && pathRef.current !== route) nav(route, { replace: true })
    // A way to a screen that is already on has nothing to show, nor a stop whose own rule says so.
    if (!step.skip && step.go && reached(step, route || pathRef.current)) { go(dirRef.current); return }
    if (step.skip && (!route || route === pathRef.current) && passOver(step, ctxNow())) { go(dirRef.current); return }
    const started = Date.now()
    const look = () => {
      if (gone) return
      // The screen first (a navigation can land a frame or two later): an element of the same
      // name on the screen being left is not the one this stop means.
      if (route && pathRef.current !== route && Date.now() - started < anchorWait) { tm = setTimeout(look, 30); return }
      const el = findAnchor(step.anchor)
      if (!el && step.anchor && Date.now() - started < anchorWait) { tm = setTimeout(look, 60); return }
      if (step.skip && passOver(step, ctxNow())) { go(dirRef.current); return }
      // Not there after all: an optional stop is passed over, any other one speaks from the middle.
      if (!el && step.anchor && step.optional) { go(dirRef.current); return }
      anchorRef.current = el
      if (el && !visiblePart(el.getBoundingClientRect(), bandBox(viewBand(insets)), 40)) el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      shownAt.current = Date.now()
      setReadyAt(i)
    }
    look()
    return () => { gone = true; clearTimeout(tm) }
  }, [i])

  // The spotlight follows its element: a scroll (the page's or a sheet's), a keyboard, a turned
  // phone, a card that grows. Off screen, it is brought back once the scrolling stops.
  useEffect(() => {
    if (!ready) return
    let raf = 0, last = '', lastFix = 0, lastScroll = 0
    const onScroll = () => { lastScroll = Date.now() }
    document.addEventListener('scroll', onScroll, true)
    const tick = () => {
      let el = anchorRef.current
      if (el && !el.isConnected) el = anchorRef.current = findAnchor(step.anchor)   // re-rendered under us
      else if (!el && step.anchor) el = anchorRef.current = findAnchor(step.anchor)
      const view = viewBand(insets)
      const r = el ? el.getBoundingClientRect() : null
      const vis = r ? visiblePart(r, bandBox(view)) : null
      const now = Date.now()
      if (el && !vis && now - lastScroll > 350 && now - lastFix > 700) {
        lastFix = now
        el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      }
      const sh = step.free ? document.querySelector('.sheet')?.getBoundingClientRect().top ?? null : null
      const key = [vis?.top, vis?.left, vis?.width, vis?.height, view.vw, view.vh, view.top, view.bottom, sh].map(v => (v == null ? '-' : Math.round(v))).join(',')
      if (key !== last) {
        last = key
        setRect(vis ? { ...vis } : null)
        setBand(view)
        setSheetTop(sh)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    // The card waits unseen while its element scrolls in (settling below); then it shows anyway.
    const late = setTimeout(() => setTick(n => n + 1), 750)
    return () => { cancelAnimationFrame(raf); clearTimeout(late); document.removeEventListener('scroll', onScroll, true) }
  }, [ready, i])

  // The dimmed screen does not scroll: a drag or a wheel on it would carry the element away.
  useEffect(() => {
    if (!ready || step.free) return
    const stop = e => {
      const tgt = e.target
      if (!tgt?.closest) return
      const inCard = tgt.closest('.tour-card')
      if (inCard && inCard.scrollHeight > inCard.clientHeight + 1) return
      if (tgt.closest('.tour-block') || inCard) e.preventDefault()
    }
    document.addEventListener('touchmove', stop, { passive: false, capture: true })
    document.addEventListener('wheel', stop, { passive: false, capture: true })
    return () => {
      document.removeEventListener('touchmove', stop, { capture: true })
      document.removeEventListener('wheel', stop, { capture: true })
    }
  }, [ready, i])

  // The card reads first: focus goes to it at every stop.
  useEffect(() => { if (ready) cardRef.current?.focus({ preventScroll: true }) }, [ready, i])
  useLayoutEffect(() => {
    const el = cardRef.current
    if (el && (el.offsetWidth !== card.w || el.offsetHeight !== card.h) && el.offsetWidth) setCard({ w: el.offsetWidth, h: el.offsetHeight })
  })

  // Tapping the highlighted element is a way on where the stop says so (the set's tick): the
  // app does what the tap does first, and the tour follows. An intercepted one (Start) is the
  // tour's alone: the practice workout opens instead of a real one.
  useEffect(() => {
    if (!ready || !(step.tap || step.intercept)) return
    let tm = null
    const onClick = e => {
      if (!anchorRef.current?.contains(e.target)) return
      if (step.intercept) { e.preventDefault(); e.stopPropagation(); go(1); return }
      tm = setTimeout(() => go(1), 350)
    }
    document.addEventListener('click', onClick, true)
    return () => { document.removeEventListener('click', onClick, true); clearTimeout(tm) }
  }, [ready, i])

  // A way to another screen: on once the user got there (the tab, the gear, the back button).
  useEffect(() => {
    if (!ready || !step.go || !reached(step, loc.pathname)) return
    if (step.id === 'p-new') madeRef.current = loc.pathname.split('/').pop()
    go(1)
  }, [ready, i, loc.pathname])

  // Stops that wait for something (a sheet opened, an exercise added, a day picked) look now and
  // then; one that no longer makes sense (its sheet was closed) goes back to where it does.
  useEffect(() => {
    if (!ready || !(step.until || step.lost)) return
    let lostFor = 0
    const iv = setInterval(() => {
      const c = ctxNow()
      if (step.until?.(c)) { clearInterval(iv); go(1); return }
      if (step.lost?.(c)) { if (++lostFor >= 2) { clearInterval(iv); jump(step.back) } }
      else lostFor = 0
      setTick(n => n + 1)
    }, 120)
    return () => clearInterval(iv)
  }, [ready, i])

  // The browser's back to another screen closes the tour; so does leaving it mounted (an error, a
  // sign-out). A back that only spent a sheet's history entry (components/Modals.jsx: every sheet
  // pushes one, and closing it goes back over it) leaves the address as it was and the tour open.
  const hereRef = useRef('')
  useEffect(() => { hereRef.current = window.location.pathname + window.location.hash }, [loc.pathname])
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname + window.location.hash === hereRef.current) return
      if (!tutorial) markTourDone()
      leaveSandbox()
      closeTour()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => () => leaveSandbox(), [])
  useCardKeys(cardRef, () => finish(false), !(step.open || step.free || step.go))

  // "Show me": the tap a way-to-a-screen stop waits for, done for the user.
  const showMe = () => {
    if (step.intercept) { go(1); return }
    const el = anchorRef.current || findAnchor(step.anchor)
    if (el) el.click()
    else if (typeof step.go === 'string') nav(step.go, { replace: true })
  }
  const save = () => { if (commitPlan(madeRef.current)) go(1) }

  const view = band || viewBand(insets)
  const pad = 6
  const hole = rect && (() => {
    const top = Math.max(view.top - 2, rect.top - pad), left = Math.max(0, rect.left - pad)
    const bottom = Math.min(view.vh - view.bottom + 2, rect.top + rect.height + pad), right = Math.min(view.vw, rect.left + rect.width + pad)
    return { top, left, width: right - left, height: bottom - top }
  })()
  const pos = placeCard(hole, card, { vw: view.vw, vh: view.vh, top: view.top, bottom: view.bottom })
  const motion = reduced ? 'none' : undefined
  const open = step.tap || step.open || step.go || step.intercept
  const last = i === steps.length - 1
  const what = nameOf(anchorRef.current)
  // Between stops, and for a moment while the element scrolls into view, the card waits unseen
  // rather than flashing up in the middle.
  const settling = !ready || (step.anchor && !rect && Date.now() - shownAt.current < 700)
  const counter = <span className="tour-count">{t('Step {0} of {1}', i + 1, steps.length)}</span>
  const skip = !last && <button type="button" className="tour-skip" onClick={() => finish(false)}>{tutorial ? t('Skip') : t('Skip tour')}</button>
  const routine = step.commit ? useStore.getState().S.routines.find(r => r.id === madeRef.current) : null

  // The screen is the user's: a bar out of the way of the open sheet, and a ring, not a dimmer.
  if (step.free) {
    const atBottom = sheetTop != null && sheetTop < view.top + 140
    return <div className="tour tour-free" data-step={step.id} data-flow={flow}>
      {rect && sheetTop == null && <div className="tour-ring" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, transition: motion }} />}
      <div className={'tour-card tour-bar' + (atBottom ? ' at-bottom' : '')} ref={cardRef} tabIndex={-1} role="dialog" aria-modal="false"
        aria-labelledby="tour-t" aria-describedby="tour-b" style={{ visibility: ready ? undefined : 'hidden' }}>
        <div className="tour-top">{counter}{skip}</div>
        <h2 id="tour-t">{title}</h2>
        <p id="tour-b">{body}</p>
        <div className="tour-acts">
          {i > 0 && <Button size="sm" onClick={() => go(-1)}>{t('Back')}</Button>}
          <Button size="sm" variant="primary" onClick={() => go(1)}>{t('Next')}</Button>
        </div>
      </div>
    </div>
  }

  return <div className="tour" data-step={step.id} data-flow={flow}>
    {hole ? <>
      <div className="tour-hole" data-testid="tour-hole" style={{ ...hole, transition: motion }} />
      {/* Four panes around the hole take the taps the dimmed screen should not get. */}
      <div className="tour-block" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
      <div className="tour-block" style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-block" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
      <div className="tour-block" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
      {!open && <div className="tour-block" style={hole} />}
    </> : <div className="tour-block tour-dim" />}
    <div className={'tour-card' + (hole ? '' : ' tour-center') + (step.id === 'done' ? ' tour-wide' : '')} ref={cardRef} tabIndex={-1}
      role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b" data-side={hole ? pos.side : 'center'}
      style={{ ...(hole ? { top: pos.top, left: pos.left, transition: motion } : null), visibility: settling ? 'hidden' : undefined }}>
      {hole && pos.arrow != null && <span className={'tour-arrow ' + pos.side} aria-hidden="true" style={{ left: pos.arrow }} />}
      <div className="tour-top">{counter}{skip}</div>
      <h2 id="tour-t">{title}</h2>
      <p id="tour-b">{body}{step.commit && !routine?.ex.length ? ' ' + t('Add an exercise first, then it’s worth saving.') : ''}{what && <span className="tour-sr"> {t('Pointing at: {0}', what)}</span>}</p>
      {step.id === 'done' && <div className="tour-list" role="group" aria-label={t('Tutorials')}>
        {TUTORIALS.map(f => {
          const [tt, ss] = TUTORIAL_COPY[f]()
          return <button key={f} type="button" className="tour-tut" onClick={() => runTutorial(f)}>
            <span className="tour-tut-m"><span className="tour-tut-t">{tt}</span><span className="tour-tut-s">{ss}</span></span>
            <Icon name="chevronRight" />
          </button>
        })}
      </div>}
      <div className="tour-acts">
        {i > 0 && <Button onClick={() => go(-1)}>{t('Back')}</Button>}
        {step.commit
          ? <Button variant="primary" disabled={!routine?.ex.length} onClick={save}>{t('Save plan')}</Button>
          : step.go || step.intercept
            ? <Button variant="primary" onClick={showMe}>{t('Show me')}</Button>
            : <Button variant="primary" onClick={() => go(1)}>{last ? (tutorial ? t('Done') : t('Let’s go')) : t('Next')}</Button>}
      </div>
    </div>
  </div>
}

export default function Tour() {
  const st = useTour()
  if (!st) return null
  if (st.kind === 'run') return <Run key={'run-' + (st.flow || 'tour')} at={st.at} flow={st.flow || 'tour'} />
  return <Question kind={st.kind} at={st.at} />
}
