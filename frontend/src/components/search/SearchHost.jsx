import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { nutritionAvailable } from '../../lib/nutrition/api.js'
import { startDiaryIndex } from '../../lib/nutrition/diary-index.js'
import { isSwitching, onTabSwitch, popToRoot } from '../../lib/use-tab-nav.js'
import { isTabRoot, tabOf } from '../../lib/tab-route.js'
import { holdPage } from '../../lib/search/hold-page.js'
import { closeSearch, endSearch, focusSearch, setQuery, syncSearchWithHistory, takeSuppressed, useSearch } from '../../lib/search/session.js'
import { nav } from '../../lib/nav.js'

// The overlay itself, its rows and the `motion` engine: one chunk, asked for in idle time after
// the first paint so that it is there by the first tap, and at the latest by the first focus.
const loadOverlay = () => import('./SearchOverlay.jsx')
const SearchOverlay = lazy(loadOverlay)

const typing = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

// What the search needs from the shell (fitness-eval ux-search.md §1, §4, ui-search.md §3): the
// history it lives in (back, a tab switch, a page pushed on top), the page behind it held still,
// the tab bar and the live dock out of the way, the keyboard shortcuts, and the overlay, loaded
// lazily. Mounted once, in App.jsx's shell.
export default function SearchHost() {
  const loc = useLocation()
  const live = useSearch(s => s.live)
  const open = useSearch(s => s.open)
  const user = useStore(s => s.user)
  const [loaded, setLoaded] = useState(false)

  // Load the chunk once the app has painted.
  useEffect(() => {
    const go = () => loadOverlay().then(() => setLoaded(true), () => {})
    const id = typeof requestIdleCallback === 'function' ? requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 1500)
    return () => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id))
  }, [])
  useEffect(() => { if (live) setLoaded(true) }, [live])

  // Days from the diary index: the first sync in idle time, for the signed-in web app.
  useEffect(() => { if (nutritionAvailable(user)) startDiaryIndex() }, [user])

  // Back onto the overlay's entry shows it; a pop below it ends the visit; a pop the overlay made
  // itself (closing) is its own. A tab switch rewrites the history, and ends the visit.
  useEffect(() => {
    const onPop = () => { if (!takeSuppressed() && !isSwitching()) syncSearchWithHistory() }
    window.addEventListener('popstate', onPop)
    const off = onTabSwitch(endSearch)
    return () => { window.removeEventListener('popstate', onPop); off() }
  }, [])
  // A page pushed or replaced from wherever while the overlay is up (a sheet's own link).
  useEffect(() => { if (!isSwitching()) syncSearchWithHistory() }, [loc])

  // The page behind stays where it was (bearmenu: <html> is the scroller, so both are held) and
  // out of reach: inert, the header and the overlay apart (lib/search/hold-page.js). The hold
  // watches the document for as long as the overlay is up; a navigation asks it to look again
  // too, since the router's location can land a commit after the overlay's `open`.
  const page = useRef(null)
  useLayoutEffect(() => {
    document.body.classList.toggle('search-open', open)
    if (!open) return undefined
    const html = document.documentElement
    const y = window.scrollY
    const prev = [html.style.overflow, document.body.style.overflow]
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    page.current = holdPage()
    // The keyboard's height, so the last row scrolls clear of it.
    const vv = window.visualViewport
    const inset = () => html.style.setProperty('--search-kb', Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) + 'px')
    if (vv) { inset(); vv.addEventListener('resize', inset); vv.addEventListener('scroll', inset) }
    return () => {
      page.current.release()
      page.current = null
      html.style.overflow = prev[0]
      document.body.style.overflow = prev[1]
      document.body.classList.remove('search-open')
      html.style.removeProperty('--search-kb')
      if (vv) { vv.removeEventListener('resize', inset); vv.removeEventListener('scroll', inset) }
      if (document.body.style.position !== 'fixed') window.scrollTo(0, y)
    }
  }, [open])
  useLayoutEffect(() => { page.current?.refresh() }, [open, loc.key])

  // ⌘K / Ctrl K anywhere, `/` outside a field; never on the workout screen. Escape while a row
  // (not the pill) has the focus: clear, then close. A sheet over the overlay takes its own Escape.
  useEffect(() => {
    const onKey = e => {
      const path = String(window.location.hash || '').replace(/^#/, '').split('?')[0] || '/home'
      const k = String(e.key || '').toLowerCase()
      const combo = k === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(document.activeElement)
      if ((combo || slash) && !path.startsWith('/train/workout') && !useUI.getState().sheets.length) {
        e.preventDefault()
        const tab = tabOf(path)
        focusSearch(() => (tab ? popToRoot(tab) : nav(isTabRoot(path) ? path : '/home')))
        return
      }
      if (e.key === 'Escape' && useSearch.getState().open && !useUI.getState().sheets.length && !e.defaultPrevented) {
        e.preventDefault()
        if (useSearch.getState().query) setQuery('')
        else closeSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded && !live) return null
  return <Suspense fallback={live && open ? <div className="search-ov" aria-hidden="true" /> : null}>
    <SearchOverlay />
  </Suspense>
}
