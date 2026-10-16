// One search visit (fitness-eval ux-search.md §1, §4): the overlay is one history entry of its own,
// pushed on top of the tab root it was opened on, like a sheet's (components/Modals.jsx). A result
// opens over it (a sheet) or on top of it (a route, `visit`), and back returns to the overlay with
// the query, the scope and the scroll as they were, the keyboard down; back again returns to the
// page it was opened on. Tapping a tab ends the visit, and a reload never brings the overlay back.
//
// The session is `live` from the moment the overlay opens until the visit ends; `open` is whether
// the overlay is on screen (not while a result's route is on top of it). The history entry carries
// `gainsSearch` (the session's id); the routes a result opens carry `searchVisit` in their router
// state, which lib/use-tab-nav.js reads to keep another tab's page on top of this tab's stack.
//
// A Day result moves the date every tab shares (lib/nutrition/selection.js) to that day: the
// date it had is kept here and put back when the visit ends or comes back to the overlay.
import { create } from 'zustand'
import { uid } from '../format.js'
import { useDiarySelection } from '../nutrition/selection.js'
import { nav } from '../nav.js'

/** The overlay's element id. */
export const SEARCH_OVERLAY_ID = 'gains-search'
/** The results listbox inside it, which the pill (the combobox) controls. */
export const SEARCH_LIST_ID = 'gains-search-list'

const idxOf = state => (Number.isInteger(state?.idx) ? state.idx : 0)
const historyState = () => { try { return globalThis.history?.state ?? null } catch { return null } }

// `active`: the id of the option the arrow keys are on (the pill's aria-activedescendant).
const closed = () => ({ open: false, live: false, id: null, base: -1, query: '', group: null, scrollTop: 0, origin: null, date: undefined, active: null })

export const useSearch = create(() => ({ ...closed(), tab: 'home' }))

// The history entry the overlay sits on is ours to walk off when the overlay closes itself; that
// popstate is not a back press.
let suppress = 0

const restoreDate = () => {
  const { date } = useSearch.getState()
  if (date === undefined) return
  useDiarySelection.getState().setDate(date)
  useSearch.setState({ date: undefined })
}

/** Opens the overlay over the tab root on screen (`tab` the tab whose header holds the pill),
 *  synchronously: it is called from the pill's focus, inside the tap, which is what lets iOS raise
 *  the keyboard. Coming back to a live visit's overlay entry just shows it again. */
export function openSearch(tab) {
  const s = useSearch.getState()
  const here = historyState()
  if (s.live && here?.gainsSearch === s.id) {
    if (!s.open) useSearch.setState({ open: true })
    return
  }
  // The pill this focus came from keeps it: the visit before ends without the blur.
  if (s.live) finish()
  const id = uid()
  const base = idxOf(here) + 1
  try { history.pushState({ ...(here || {}), idx: base, gainsSearch: id }, '') } catch { /* no history: the overlay still opens */ }
  useSearch.setState({ ...closed(), open: true, live: true, id, base, tab, origin: { tab, path: currentPath() } })
}

const currentPath = () => String(globalThis.location?.hash || '').replace(/^#/, '') || '/home'

/** The avatar's ×, Escape on an empty field: the overlay goes and its history entry with it. */
export function closeSearch() {
  const s = useSearch.getState()
  if (!s.live) return
  const onEntry = historyState()?.gainsSearch === s.id
  endSearch()
  if (onEntry) { suppress++; try { history.back() } catch { suppress-- } }
}

const finish = () => {
  restoreDate()
  useSearch.setState({ ...closed() })
}

/** The visit is over (closed, a tab tapped, walked back past it, the scrim): forget it, the date
 *  back, and the pill let go. A pill that kept the focus would keep the keyboard up over a page
 *  with no overlay, and a tap on it would open nothing, being focused already. */
export function endSearch() {
  if (!useSearch.getState().live) return
  finish()
  if (pill && pill.isConnected && pill === globalThis.document?.activeElement) pill.blur()
}

export const setQuery = query => useSearch.setState(s => (s.query === query ? s : { query, active: null }))
export const setGroup = group => useSearch.setState({ group, scrollTop: 0, active: null })
export const setActive = active => useSearch.setState(s => (s.active === active ? s : { active }))
export const rememberScroll = scrollTop => { useSearch.setState({ scrollTop }) }

/**
 * Opens a route on top of the overlay. The overlay steps aside (the session stays live), and the
 * page arrives with `searchVisit` so that another tab's page is pushed here rather than switched to.
 * `date` (a Day result) is the shared date the page should show: the current one is kept and put
 * back afterwards. `state` is the router state the page reads (`find`, `via`).
 */
export function visit(path, { date, state } = {}) {
  const s = useSearch.getState()
  if (!s.live) { nav(path, state ? { state } : undefined); return }
  if (date !== undefined) {
    const sel = useDiarySelection.getState()
    if (s.date === undefined) useSearch.setState({ date: sel.date })
    sel.setDate(date)
  }
  useSearch.setState({ open: false })
  nav(path, { state: { ...(state || {}), searchVisit: s.id } })
}

/**
 * Where history is now, after a popstate or a navigation: back on the overlay's entry shows it
 * (the date it moved put back); an entry above it is a result on top (hidden, still live); one
 * below it ends the visit. An overlay entry of no live session (a reload, a restored tab) is
 * stepped off: a cold start never brings the overlay back.
 */
export function syncSearchWithHistory(state = historyState()) {
  const s = useSearch.getState()
  const mine = state?.gainsSearch
  if (mine && mine !== s.id) {
    try { history.back() } catch { /* nothing to step off */ }
    return
  }
  if (!s.live) return
  if (mine === s.id) {
    restoreDate()
    if (!s.open) useSearch.setState({ open: true })
    return
  }
  if (idxOf(state) > s.base) { if (s.open) useSearch.setState({ open: false }); return }
  endSearch()
}

/** For the popstate listener: whether this pop is the overlay's own close walking its entry off. */
export function takeSuppressed() {
  if (suppress <= 0) return false
  suppress--
  return true
}

/** Whether a router location belongs to the live visit (a result's page opened on top of it). */
export const isSearchVisit = state => !!state?.searchVisit

// The pill's input (the header registers it) and the overlay's key handler (the overlay registers
// it): the keys typed into the one field drive the rows of the other.
let pill = null
let keys = null
let focusOnMount = false
export const registerPill = el => { pill = el }
export const setOverlayKeys = fn => { keys = fn }
export const overlayKey = e => keys?.(e)
/** Back to the pill, for a control of the overlay that leaves the page. */
export const focusPill = () => { if (pill?.isConnected) pill.focus({ preventScroll: true }) }

/** ⌘K, Ctrl K and `/`: the pill on screen gets the focus (which opens the overlay); with none on
 *  screen (a sub-page, Profile) the tab's root is opened and its pill focused once it is there. */
export function focusSearch(goToRoot) {
  if (pill && pill.isConnected) { pill.focus(); pill.select?.(); return }
  focusOnMount = true
  goToRoot()
}
/** The header asks once, as it mounts, whether ⌘K brought it. */
export function takeFocusOnMount() {
  const v = focusOnMount
  focusOnMount = false
  return v
}
