// Per-tab back stacks on top of the one linear history a browser (and the Android WebView) has.
//
// The browser only ever holds the stack of the tab on screen. This module mirrors that stack — one
// path per history position, the position being the router's own `idx` (react-router keeps it in
// history.state; Modals.jsx gives a sheet's entry the next one) — and keeps the other tabs' stacks
// aside. Switching tabs then means: put the leaving tab's entries aside, walk the browser back to
// the first entry, replace it with the bottom of the arriving tab's stack and push the rest. Back
// presses walk down one tab and then leave the app: they never reach another tab's pages.
//
// A replace cannot drop the entries ahead of it, so after a switch the leaving tab's pages can
// still sit in the browser's forward history. `top` is the last live position: a forward step
// past it lands on a dead entry, which the shell steps straight back off (`deadSteps`).
// Pure: the shell feeds it locations and carries out the plans it returns.
import { TABS, TAB_ROOT, isWorkoutPath, tabOf } from './tab-route.js'

export const emptyNav = () => ({ entries: [], idx: -1, top: -1, tab: 'home', stacks: {} })

// The tab on screen: the route's own, or for a shared page (Profile, the workout) the one under it.
const tabFor = (nav, path) => tabOf(path.split('?')[0]) || nav.tab

export function record(nav, { idx, path, navType }) {
  // No position (an entry nothing wrote one into): count it as the start of a history.
  const at = Number.isInteger(idx) && idx >= 0 ? idx : 0
  // Forward onto a page of a tab that was left: not this tab's page, nothing to mirror.
  if (navType === 'POP' && nav.idx >= 0 && at > nav.top) return { ...nav, idx: at }
  const entries = navType === 'PUSH' ? nav.entries.slice(0, at) : nav.entries.slice()
  entries[at] = path
  // A push ends the history here; a pop or a replace leaves what is ahead (forward) as it was.
  // The first location of a document starts the live history wherever it is. A replace past the
  // top is the router taking over a sheet's entry (closeThenNav): live, as the page it became.
  const top = navType === 'PUSH' || nav.idx < 0 ? at : navType === 'REPLACE' ? Math.max(nav.top, at) : nav.top
  return { ...nav, tab: tabFor(nav, path), entries, idx: at, top }
}

// A finished switch: what is ahead of here belongs to the tab that was left.
export const settle = nav => ({ ...nav, top: nav.idx, entries: nav.entries.slice(0, nav.idx + 1) })

// How far to step back off a dead forward entry (0 when the position is live).
export const deadSteps = nav => (nav.idx > nav.top ? nav.idx - nav.top : 0)

// A stack as it is put aside: no gaps, never the workout (a session that has ended there would
// come back as the Start screen; the dock reopens one that runs), and one entry for a page that
// sat on two positions (a sheet's entry the router then replaced with the same page).
const compact = paths => paths.filter(p => p && !isWorkoutPath(p)).filter((p, i, all) => i === 0 || p !== all[i - 1])

const pathOnly = p => p.split(/[?#]/)[0]

// The arriving tab's stack: what it held when it was left, else its root, with `path` on top (a
// page opened in it from elsewhere). A page the stack already holds is not stacked again: the
// stack goes back to it, with the new address (its query may differ: /progress?range=90).
export function stackFor(nav, target, path) {
  // Compacted again: a stack saved by an older build (sessionStorage) may still hold the workout.
  const saved = compact(nav.stacks[target] || [])
  const kept = saved.length ? saved : [TAB_ROOT[target]]
  if (!path) return kept
  const at = kept.findIndex(p => pathOnly(p) === pathOnly(path))
  return at >= 0 ? [...kept.slice(0, at), path] : [...kept, path]
}

// What showing `target` takes: how far back to walk (to the first entry), then the paths to put
// there, the first one replacing that entry and the rest pushed. `nav` is what to keep.
// - another tab: its own stack comes back (plus `path`), this one is put aside;
// - the tab on screen with `toRoot` (its bar button tapped again): back down to its root.
// Null when there is nothing to do.
export function planSwitch(nav, target, { path, toRoot = false, leaving } = {}) {
  if (!TABS.includes(target)) return null
  const here = compact(leaving || nav.entries.slice(0, nav.idx + 1))
  if (target === nav.tab) {
    if (!toRoot) return null
    if (here.length <= 1 && here[0] === TAB_ROOT[target]) return null
    return { back: Math.max(0, nav.idx), stack: [TAB_ROOT[target]], nav }
  }
  return {
    back: Math.max(0, nav.idx),
    stack: stackFor(nav, target, path),
    nav: { ...nav, tab: target, stacks: { ...nav.stacks, [nav.tab]: here } },
  }
}
