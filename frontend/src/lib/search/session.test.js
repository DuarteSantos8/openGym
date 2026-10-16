// @vitest-environment happy-dom
// The back model (ux-search.md §4): one history entry for the overlay; a result's route on top of
// it; back to the overlay with the query, scope and scroll kept; back again to where it started;
// the shared date scoped to the visit; a cold start never brings the overlay back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setNav } from '../nav.js'
import { useDiarySelection } from '../nutrition/selection.js'
import { closeSearch, endSearch, openSearch, rememberScroll, setGroup, setQuery, syncSearchWithHistory, takeSuppressed, useSearch, visit } from './session.js'

let navigate, push, back
beforeEach(() => {
  navigate = vi.fn()
  setNav(navigate)
  history.replaceState({ idx: 3, key: 'home' }, '')
  push = vi.spyOn(history, 'pushState')
  back = vi.spyOn(history, 'back').mockImplementation(() => {})
  useDiarySelection.getState().reset()
})
afterEach(() => {
  endSearch()
  while (takeSuppressed()) { /* drain */ }
  vi.restoreAllMocks()
})

const onEntry = () => ({ ...history.state })

describe('the search visit', () => {
  it('opens on one history entry of its own, synchronously, one past the page', () => {
    openSearch('home')
    expect(useSearch.getState()).toMatchObject({ open: true, live: true, base: 4, tab: 'home' })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toMatchObject({ idx: 4, key: 'home', gainsSearch: useSearch.getState().id })
  })

  it('a route opens on top as a search visit; back returns to the overlay as it was; back again ends it', () => {
    openSearch('home')
    const entry = onEntry()
    setQuery('chicken')
    setGroup('days')
    rememberScroll(120)
    visit('/train/routines/r1')
    expect(navigate).toHaveBeenCalledWith('/train/routines/r1', { state: { searchVisit: entry.gainsSearch } })
    expect(useSearch.getState()).toMatchObject({ open: false, live: true })
    // on top of it
    syncSearchWithHistory({ idx: 5, key: 'r1', usr: { searchVisit: entry.gainsSearch } })
    expect(useSearch.getState().open).toBe(false)
    // back: the overlay, as it was left
    syncSearchWithHistory(entry)
    expect(useSearch.getState()).toMatchObject({ open: true, query: 'chicken', group: 'days', scrollTop: 120 })
    // back again: where it was opened
    syncSearchWithHistory({ idx: 3, key: 'home' })
    expect(useSearch.getState()).toMatchObject({ open: false, live: false, query: '' })
  })

  it('a Day result moves the shared date for the visit and puts it back on the way back', () => {
    useDiarySelection.getState().setDate('2026-10-01')
    openSearch('food')
    const entry = onEntry()
    visit('/food?date=2026-09-20&find=u1', { date: '2026-09-20' })
    expect(useDiarySelection.getState().date).toBe('2026-09-20')
    syncSearchWithHistory(entry)
    expect(useDiarySelection.getState().date).toBe('2026-10-01')
    visit('/food?date=2026-09-21', { date: '2026-09-21' })
    endSearch()   // a tab tapped
    expect(useDiarySelection.getState().date).toBe('2026-10-01')
  })

  it('closing walks its own entry off, and that pop is not a back press', () => {
    openSearch('train')
    history.replaceState(push.mock.calls[0][0], '')
    closeSearch()
    expect(back).toHaveBeenCalledTimes(1)
    expect(takeSuppressed()).toBe(true)
    expect(useSearch.getState().live).toBe(false)
  })

  it('a cold start on an overlay entry steps off it', () => {
    syncSearchWithHistory({ idx: 4, gainsSearch: 'from-before-the-reload' })
    expect(back).toHaveBeenCalledTimes(1)
    expect(useSearch.getState().open).toBe(false)
  })

  it('opening again on its own entry just shows it', () => {
    openSearch('home')
    history.replaceState(push.mock.calls[0][0], '')
    useSearch.setState({ open: false })
    openSearch('home')
    expect(push).toHaveBeenCalledTimes(1)
    expect(useSearch.getState().open).toBe(true)
  })
})
