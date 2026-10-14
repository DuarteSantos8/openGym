// The shell's side of lib/tab-history.js: mirrors every location into the per-tab stacks and
// carries out a tab switch. A switch is several router steps — walk back to the first entry,
// replace it, push the rest of the arriving tab's stack — with the screen held on the page the
// switch started from (`shown`) until the last step has landed, so neither the pages in between
// nor the one arrived at mounts before the history is right. (The page arrived at mounting early
// was how a redirect it makes — a missing routine, the Coach for a guest — got lost in the walk.)
//
// What starts a switch: a bar button (switchTab, popToRoot for the tab on screen), and any
// navigation that lands in another tab's pages, from whatever code made it (a Profile row opening
// Routines): the push is turned into a switch, so a tab's stack never holds another tab's page.
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { emptyNav, deadSteps, planSwitch, record, settle } from './tab-history.js'
import { parentOf, tabOf } from './tab-route.js'
import { onSheetEntry, sheetEntriesLive } from './nav.js'
import { useUI } from '../store/useUI.js'

const NAV_KEY = 'gym_tab_nav'   // this tab's mirror: survives a reload, as its history does
// A walk back that never lands (history.go past the start does nothing, and says nothing) must not
// hold the screen: after this long the switch carries on from wherever history is…
const UNWIND_MS = 400
// …and a pop that still arrives within this long after that is the walk landing late: the switch
// is finished again from where it landed, with the stacks it had already put aside.
const LATE_MS = 2000
// A switch knocked off course by somebody else's walk (an iOS swipe, the browser's back) is
// carried on from where it landed — this many times, then the screen is let go as it is.
const RETRIES = 2

function loadNav() {
  try {
    const v = JSON.parse(sessionStorage.getItem(NAV_KEY))
    return v && Array.isArray(v.entries) && typeof v.idx === 'number' && typeof v.top === 'number' ? v : emptyNav()
  } catch { return emptyNav() }
}

function saveNav(nav) {
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(nav)) } catch { /* private mode: in memory only */ }
}

// The router's position in the history (react-router writes it into history.state).
const historyIdx = () => globalThis.history?.state?.idx

// A navigation into another tab's pages: to be carried out as a switch. Not a replace of the very
// first entry, though: with nothing under it in the tab, that is a cold redirect (an old link, a
// page sending a guest Home) and it only changes which tab is on screen.
function crossesTab(nav, location, navType) {
  if (navType === 'POP' || nav.idx < 0) return false
  const target = tabOf(location.pathname)
  if (!target || target === nav.tab) return false
  const idx = historyIdx()
  return !(navType === 'REPLACE' && (Number.isInteger(idx) ? idx : nav.idx) === 0)
}

export const TAB_SWITCH = { tabSwitch: true }

// For code outside the shell (the bar, the + sheet, a page's back button), like lib/nav.js's nav().
let api = { switchTab: () => {}, popToRoot: () => {}, back: () => {} }
let switching = false
// While a switch rebuilds the history, nothing else may walk it: the bar, the +, Android back.
export const isSwitching = () => switching

// Called as a sheet closes, it waits for the sheet's history entry to be walked off first
// (Modals.jsx): two walks queued in the same moment are not reliably both carried out. Only then,
// though: on a sheet's entry nobody is closing (a leaked one) it goes ahead at once. One wait at
// a time — a second tap takes the first one's place — and never longer than SHEET_MS.
const SHEET_MS = 400
let waiting = null
const afterSheet = fn => {
  if (waiting) { window.removeEventListener('popstate', waiting.listener); clearTimeout(waiting.timer); waiting = null }
  const closing = onSheetEntry() && sheetEntriesLive() > useUI.getState().sheets.length
  if (!closing) { fn(); return }
  const go = () => {
    if (!waiting) return
    window.removeEventListener('popstate', waiting.listener)
    clearTimeout(waiting.timer)
    waiting = null
    fn()
  }
  waiting = { listener: onNextPop(go), timer: setTimeout(go, SHEET_MS) }
}

// One popstate, then the listener is gone. By hand rather than `{ once: true }`, which not every
// engine honours (happy-dom does not), and a listener that stays walks back on every later pop.
function onNextPop(fn) {
  const once = () => { window.removeEventListener('popstate', once); fn() }
  window.addEventListener('popstate', once)
  return once
}
export const switchTab = (tab, path) => afterSheet(() => api.switchTab(tab, path))
export const popToRoot = tab => afterSheet(() => api.popToRoot(tab))
// A sub-page's back: one step down this tab's stack, or with nothing under it in the tab (a deep
// link, a reload) to the page's parent in its place — `parent` when the page knows better than
// lib/tab-route.js (a settings sub-page's own parent page). Also how a finished workout leaves.
export const back = parent => {
  if (switching) return
  const up = typeof parent === 'string' ? parent : undefined
  afterSheet(() => api.back(up))
}

export function useTabNav({ navigate, location, navType }) {
  const navRef = useRef(null)
  if (!navRef.current) navRef.current = loadNav()
  const pending = useRef(null)
  const lastShown = useRef(null)   // the last location on screen outside a switch
  const late = useRef(null)        // a switch whose walk the watchdog gave up on, for LATE_MS
  const [frozen, setFrozen] = useState(null)

  const finish = useCallback(p => {
    clearTimeout(p?.timer)
    late.current = p?.timedOut ? { target: p.target, stack: p.stack, until: Date.now() + LATE_MS } : null
    pending.current = null
    switching = false
    setFrozen(null)
  }, [])

  // One build step: what it expects to see land, and how many of the stack's pages are in.
  const step = useCallback((p, path, opts) => {
    p.expect = path
    p.built = (p.built || 0) + 1
    navigate(path, opts)
  }, [navigate])

  const build = useCallback(p => {
    clearTimeout(p.timer)
    p.phase = 'build'
    p.queue = p.stack.slice(1)
    step(p, p.stack[0], { replace: true, state: TAB_SWITCH })
  }, [step])

  // Walk back to the first entry one popstate at a time: the position the router reports where it
  // lands says how far is left. Stepping from a sheet's entry onto its page is not a location
  // change at all, so the walk listens to popstate itself rather than to locations.
  const unwind = useCallback(p => {
    let listener = null
    const next = () => {
      if (pending.current !== p) return
      const idx = historyIdx()
      if (!(idx > 0)) { build(p); return }
      listener = onNextPop(next)
      navigate(-idx)
    }
    p.timer = setTimeout(() => {
      if (pending.current !== p || p.phase !== 'unwind') return
      window.removeEventListener('popstate', listener)
      p.timedOut = true
      build(p)
    }, UNWIND_MS)
    next()
  }, [navigate, build])

  const run = useCallback((plan, { shownLocation, shownTab, target, retries = 0, intent = null }) => {
    if (!plan) { finish(pending.current); return }
    if (!switching) setFrozen({ location: shownLocation, tab: shownTab })
    switching = true
    navRef.current = plan.nav
    saveNav(plan.nav)
    const p = { phase: 'unwind', stack: plan.stack, target, retries, intent }
    pending.current = p
    if (plan.back > 0) unwind(p)
    else build(p)
  }, [build, unwind, finish])

  // The same switch carried on from wherever the history now is: back to the first entry and the
  // same stack built there. What the first plan put aside stays put aside — planning afresh from
  // the mirror would put aside a half-built history as the tab that was left.
  const resume = (target, stack, retries, intent) => {
    const idx = historyIdx()
    run({ back: Number.isInteger(idx) ? idx : navRef.current.idx, stack, nav: { ...navRef.current, tab: target } },
      { target, retries, intent })
  }

  useLayoutEffect(() => {
    const p = pending.current
    const path = location.pathname + location.search
    const idx = historyIdx()

    // A location outside a switch: mirrored, or — when it is another tab's page, pushed or
    // replaced in from wherever — turned into a switch to that tab with the page on top, the entry
    // it landed on handed back to the tab it came from. The screen stays on the page it came from
    // (see the render below) until the switch is done.
    const live = () => {
      const nav = navRef.current
      if (crossesTab(nav, location, navType)) {
        const target = tabOf(location.pathname)
        const here = Number.isInteger(idx) ? idx : nav.idx + 1
        const plan = planSwitch({ ...nav, idx: here }, target, { path, leaving: nav.entries.slice(0, here) })
        run(plan, { shownLocation: lastShown.current || location, shownTab: nav.tab, target })
        return
      }
      const next = record(nav, { idx, path, navType })
      navRef.current = next
      saveNav(next)
      lastShown.current = location
      // Forward onto a page of a tab that was left: step straight back off it.
      const dead = deadSteps(next)
      if (dead) navigate(-dead)
    }

    if (p?.phase === 'unwind') {
      if (navType === 'POP') navRef.current = record(navRef.current, { idx, path, navType })
      // A push or replace while walking back (a page acting on its own): not lost — carried out
      // again once the switch is done, as new intent (through a switch, if another tab's).
      else p.intent = { path, replace: navType === 'REPLACE', state: location.state }
      return
    }
    if (p?.phase === 'build') {
      if (navType === 'POP') {
        navRef.current = record(navRef.current, { idx, path, navType })
        // Somebody walked the history mid-build, or the walk landed late: carry on from there.
        if (p.retries < RETRIES) { resume(p.target, p.stack, p.retries + 1, p.intent); return }
      } else if (path === p.expect) {
        navRef.current = record(navRef.current, { idx, path, navType })
        if (p.queue.length) { step(p, p.queue.shift(), { state: TAB_SWITCH }); return }
      } else {
        // Not the switch's own step: the switch ends where it got to (the mirror is what it had
        // built), and this navigation is new intent, taken as if it came after it — on top of the
        // arriving tab, or, for a third tab's page, a switch there that puts the arriving tab's
        // whole stack aside, not the half of it built so far.
        const built = p.stack.slice(0, p.built)
        navRef.current = { ...navRef.current, tab: p.target, entries: built, idx: built.length - 1, top: built.length - 1 }
        saveNav(navRef.current)
        finish(p)
        const target = tabOf(location.pathname)
        if (target && target !== p.target) {
          const here = Number.isInteger(idx) ? idx : built.length
          const plan = planSwitch({ ...navRef.current, idx: here }, target, { path, leaving: p.stack })
          run(plan, { shownLocation: lastShown.current || location, shownTab: p.target, target })
          return
        }
        live()
        return
      }
      navRef.current = settle(navRef.current)
      saveNav(navRef.current)
      lastShown.current = location
      finish(p)
      if (p.intent) navigate(p.intent.path, { replace: p.intent.replace, state: p.intent.state })
      return
    }
    // The walk the watchdog gave up on, landing late: put the arriving tab back on top of it.
    const stray = late.current
    late.current = null
    if (stray && navType === 'POP' && Date.now() < stray.until) {
      navRef.current = record(navRef.current, { idx, path, navType })
      resume(stray.target, stray.stack, 0)
      return
    }
    live()
    // The location object, not its key: a sheet's entry carries the key of the page under it.
  }, [location])

  const doSwitch = useCallback((target, path) => {
    if (pending.current) return
    const nav = navRef.current
    if (target === nav.tab) { if (path) navigate(path); return }
    run(planSwitch(nav, target, { path }), { shownLocation: location, shownTab: nav.tab, target })
  }, [navigate, location, run])

  const doPopToRoot = useCallback(target => {
    if (pending.current) return
    const plan = planSwitch(navRef.current, target, { toRoot: true })
    if (!plan) { window.scrollTo(0, 0); return }
    run(plan, { shownLocation: location, shownTab: target, target })
  }, [location, run])

  const doBack = useCallback(parent => {
    if (pending.current) return
    if (navRef.current.idx > 0) navigate(-1)
    else navigate(parent || parentOf(location.pathname), { replace: true })
  }, [navigate, location])

  useLayoutEffect(() => {
    api = { switchTab: doSwitch, popToRoot: doPopToRoot, back: doBack }
  }, [doSwitch, doPopToRoot, doBack])
  useLayoutEffect(() => () => { switching = false; clearTimeout(pending.current?.timer) }, [])

  if (frozen) return { tab: frozen.tab, shown: frozen.location, switching: true }
  // A cross-tab navigation the effect is about to turn into a switch: already this render shows
  // the page it came from, so the page arrived at does not mount (and redirect) mid-switch.
  if (!pending.current && lastShown.current && crossesTab(navRef.current, location, navType)) {
    return { tab: navRef.current.tab, shown: lastShown.current, switching: true }
  }
  return { tab: tabOf(location.pathname) || navRef.current.tab, shown: location, switching: false }
}
