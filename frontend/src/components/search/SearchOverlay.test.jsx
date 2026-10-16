// @vitest-environment happy-dom
// The overlay as a person uses it: the pill opens it, before typing, results, the keyboard, Escape,
// the avatar's close, no results, offline, and reduced motion.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../sheets.jsx', async orig => ({ ...(await orig()), exerciseDetailSheet: vi.fn(), customExSheet: vi.fn(), weighInsSheet: vi.fn() }))

const { useStore } = await import('../../store/useStore.js')
const { setNav } = await import('../../lib/nav.js')
const { endSearch, syncSearchWithHistory, useSearch } = await import('../../lib/search/session.js')
const { addRecent, clearRecents, noteOpened, useRecents } = await import('../../lib/search/recents.js')
const { createFakeNutriTrace } = await import('../../lib/nutrition/fake-nutritrace.js')
const { useNutrition } = await import('../../lib/nutrition/store.js')
const { resetOnlineSearch } = await import('../../lib/nutrition/use-online-search.js')
const { customExSheet } = await import('../../sheets.jsx')
const RootHeader = (await import('../RootHeader.jsx')).default
const SearchOverlay = (await import('./SearchOverlay.jsx')).default

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, navigate
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  navigate = vi.fn()
  setNav(navigate)
  history.replaceState({ idx: 0, key: 'k' }, '')
  vi.spyOn(history, 'back').mockImplementation(() => {})
  useStore.setState({ user: null })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  act(() => endSearch())
  clearRecents()
  useRecents.setState({ opened: {} })
  delete document.documentElement.dataset.motion
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const wait = ms => act(() => new Promise(r => setTimeout(r, ms)))
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const pill = () => $('.spill-i')
async function mount(path = '/home') {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><RootHeader title="Home" /><SearchOverlay /></MemoryRouter>))
}
async function type(value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(pill(), value)
    pill().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(320)
}
const key = (k, opts = {}) => act(() => { pill().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts })) })

describe('the search overlay', () => {
  it('opens on the pill\'s focus: the pill a combobox controlling the results listbox, with the tab\'s shortcuts', async () => {
    await mount()
    expect(pill().getAttribute('aria-haspopup')).toBe('listbox')
    expect(pill().getAttribute('aria-expanded')).toBe('false')
    await act(async () => pill().focus())
    await wait(50)
    expect(pill().getAttribute('role')).toBe('combobox')
    expect(pill().getAttribute('aria-expanded')).toBe('true')
    expect(pill().getAttribute('aria-controls')).toBe('gains-search-list')
    const list = $('#gains-search-list')
    expect(list.getAttribute('role')).toBe('listbox')
    expect(list.closest('#gains-search')).not.toBeNull()
    // The shortcuts are actions, not choices: plain buttons in the tab order, outside the listbox.
    const chips = $$('.chip-lg')
    expect(chips.map(c => c.textContent)).toEqual(['History', 'Exercises', 'Routines', 'Body'])
    for (const c of chips) {
      expect(c.hasAttribute('role')).toBe(false)
      expect(c.tabIndex).toBe(0)
      expect(list.contains(c)).toBe(false)
    }
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect($('.avatar-btn').getAttribute('aria-label')).toBe('Close search')
  })

  it('the keyboard order is the pill, then the shortcuts and Clear, then the listbox the arrows walk', async () => {
    addRecent({ kind: 'query', query: 'squat' })
    await mount()
    await act(async () => pill().focus())
    await wait(50)
    const tabbable = [...document.querySelectorAll('button, input, [tabindex]')].filter(el => el.tabIndex >= 0 && !el.closest('[inert]'))
    const order = tabbable.map(el => el.matches('.spill-i') ? 'pill' : el.classList.contains('avatar-btn') ? 'avatar'
      : el.classList.contains('chip-lg') ? 'chip' : el.classList.contains('sr-clear') ? 'clear' : el.closest('#gains-search-list') ? 'listbox' : 'other:' + el.className)
    expect(order).toEqual(['pill', 'avatar', 'chip', 'chip', 'chip', 'chip', 'clear'])
    const list = $('#gains-search-list')
    expect(list.contains($('.sr-clear'))).toBe(false)
    expect(list.compareDocumentPosition($('.sr-clear')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    // Clear does what it says, and the focus goes back to the pill instead of leaving with it.
    await act(async () => $('.sr-clear').click())
    expect(useRecents.getState().list).toEqual([])
    expect(document.activeElement).toBe(pill())
  })

  it('shows the best match and the groups, walks them with the arrows and opens one with Enter', async () => {
    await mount()
    await act(async () => pill().focus())
    await type('history')
    expect($('.sr-best').textContent).toContain('History')
    expect($('.sr-summary')).not.toBeNull()
    await key('ArrowDown')
    const first = $$('[data-search-row]')[0]
    expect(pill().getAttribute('aria-activedescendant')).toBe(first.id)
    expect(first.classList.contains('on')).toBe(true)
    await key('Enter')
    expect(navigate).toHaveBeenCalledWith('/train/history', { state: { searchVisit: useSearch.getState().id } })
    expect(useSearch.getState()).toMatchObject({ open: false, live: true })
  })

  it('Escape clears first, then closes; the avatar closes too', async () => {
    await mount()
    await act(async () => pill().focus())
    await type('squat')
    await key('Escape')
    expect(pill().value).toBe('')
    expect(useSearch.getState().open).toBe(true)
    await key('Escape')
    expect(useSearch.getState().live).toBe(false)
    await act(async () => pill().focus())
    expect(useSearch.getState().open).toBe(true)
    await act(async () => $('.avatar-btn').click())
    expect(useSearch.getState().live).toBe(false)
  })

  it('says when nothing matches, and offers to make it', async () => {
    await mount()
    await act(async () => pill().focus())
    await type('qqzzxxv')
    expect(document.body.textContent).toContain('Nothing matches “qqzzxxv”')
    const make = $$('[data-search-row]').find(r => r.textContent.includes('Create exercise'))
    await act(async () => make.click())
    expect(customExSheet).toHaveBeenCalledWith(null, null, 'qqzzxxv')
  })

  it('scopes to a group from the summary line, and Backspace in the empty pill drops the scope', async () => {
    await mount()
    await act(async () => pill().focus())
    await type('press')
    const exercises = $$('.sr-sum').find(b => b.textContent.includes('exercises'))
    await act(async () => exercises.click())
    expect(useSearch.getState().group).toBe('exercises')
    expect($('.sr-token')).not.toBeNull()
    expect(pill().placeholder).toBe('Search exercises')
    await type('')
    await key('Backspace')
    expect(useSearch.getState().group).toBe(null)
  })

  it('offline: your own results work, and Online says it comes back with the connection', async () => {
    const nt = createFakeNutriTrace()
    vi.stubGlobal('fetch', nt.fetch)
    resetOnlineSearch()
    useNutrition.getState().reset()
    useStore.setState({ user: { id: 7, name: 'A' } })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mount()
    await act(async () => pill().focus())
    await type('nutella')
    await wait(50)
    expect(document.body.textContent).toContain('Online results come back when you reconnect')
  })

  it('with reduced motion still opens, scrolls and answers the keys', async () => {
    document.documentElement.dataset.motion = 'reduce'
    await mount()
    await act(async () => pill().focus())
    await type('history')
    expect($('.sr-best')).not.toBeNull()
    await key('ArrowDown')
    expect(pill().getAttribute('aria-activedescendant')).toBeTruthy()
  })

  it('the results are a listbox of groups named by their headings, every row an option with a unique id', async () => {
    await mount()
    await act(async () => pill().focus())
    // A page, settings and exercises: three groups.
    await type('rest')
    const list = $('#gains-search-list')
    const options = [...list.querySelectorAll('[role="option"]')]
    expect(options.length).toBeGreaterThan(3)
    expect(options.map(o => o.id)).toEqual([...new Set(options.map(o => o.id))])
    for (const o of options) {
      expect(o.getAttribute('aria-selected')).toBe('false')
      // No control inside an option.
      expect(o.querySelector('button, a, input')).toBeNull()
    }
    const groups = [...list.querySelectorAll('[role="group"]')]
    expect(groups.length).toBeGreaterThan(1)
    for (const g of groups) {
      const heading = document.getElementById(g.getAttribute('aria-labelledby'))
      expect(heading.tagName).toBe('H2')
      expect(g.contains(heading)).toBe(true)
    }
    // The summary line is not an option, and sits outside the listbox.
    expect(list.querySelector('.sr-summary')).toBeNull()
  })

  it('walks the options with the arrows from group to group, Home and End, and Enter activates the active one', async () => {
    await mount()
    await act(async () => pill().focus())
    await type('rest')
    const options = () => [...$('#gains-search-list').querySelectorAll('[role="option"]')]
    const groupOf = el => el.closest('[role="group"]')?.getAttribute('aria-labelledby') || null
    const seen = []
    for (let i = 0; i < options().length; i++) {
      await key('ArrowDown')
      const id = pill().getAttribute('aria-activedescendant')
      const el = document.getElementById(id)
      expect(el).toBe(options()[i])
      expect(options().filter(o => o.getAttribute('aria-selected') === 'true')).toEqual([el])
      seen.push(groupOf(el))
    }
    // It crossed from one group into the next without stopping.
    expect(new Set(seen.filter(Boolean)).size).toBeGreaterThan(1)
    await key('Home')
    expect(pill().getAttribute('aria-activedescendant')).toBe(options()[0].id)
    await key('End')
    const last = options().at(-1)
    expect(pill().getAttribute('aria-activedescendant')).toBe(last.id)
    // Up from the first option leaves the list.
    await key('Home')
    await key('ArrowUp')
    expect(pill().hasAttribute('aria-activedescendant')).toBe(false)
    // Enter on an option in the second group opens it.
    const target = options().find(o => groupOf(o) && groupOf(o) !== groupOf(options().find(x => groupOf(x))))
    while (pill().getAttribute('aria-activedescendant') !== target.id) await key('ArrowDown')
    const open = vi.spyOn(target, 'click')
    await key('Enter')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('before typing: Recent is a group of the listbox, and the arrows walk its entries and their ×, but not the shortcuts or Clear', async () => {
    addRecent({ kind: 'query', query: 'squat' })
    addRecent({ kind: 'result', type: 'page', id: '/train/history', label: 'History', query: 'hist' })
    await mount()
    await act(async () => pill().focus())
    await wait(50)
    const options = () => [...$('#gains-search-list').querySelectorAll('[role="option"]')]
    const names = options().map(o => o.getAttribute('aria-label') || o.textContent.trim())
    expect(names).toEqual([expect.stringContaining('History'), 'Remove History from recent', 'squat', 'Remove squat from recent'])
    const labels = new Set(options().map(o => o.closest('[role="group"]').getAttribute('aria-labelledby')))
    expect([...labels]).toEqual(['sr-recent'])
    // Down to the second ×, Enter: "squat" goes, and the arrows are handed to the entry before it.
    for (let i = 0; i < 4; i++) await key('ArrowDown')
    expect(pill().getAttribute('aria-activedescendant')).toBe('sr-x_q_squat')
    await key('Enter')
    expect(useRecents.getState().list.map(r => r.query)).toEqual(['hist'])
    expect(document.getElementById(pill().getAttribute('aria-activedescendant'))?.getAttribute('aria-label')).toContain('History')
  })

  it('a result in both Recent and Suggested shows once, in Recent', async () => {
    addRecent({ kind: 'result', type: 'page', id: '/train/history', label: 'History', query: '' })
    noteOpened('page:/train/history')
    noteOpened('page:/train/history')
    await mount()
    await act(async () => pill().focus())
    await wait(50)
    const ids = $$('#gains-search-list [role="option"]').map(o => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter(id => id === 'sr-page__train_history')).toHaveLength(1)
    expect($('#sr-sugg')).toBeNull()
  })

  it('a slow source\'s note is a disabled option the arrows still reach; its error is one option that retries', async () => {
    const nt = createFakeNutriTrace()
    vi.stubGlobal('fetch', nt.fetch)
    resetOnlineSearch()
    useNutrition.getState().reset()
    useStore.setState({ user: { id: 7, name: 'A' } })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await mount()
    await act(async () => pill().focus())
    await type('nutella')
    await wait(50)
    const note = $('#sr-note_online')
    expect(note.getAttribute('role')).toBe('option')
    expect(note.getAttribute('aria-disabled')).toBe('true')
    while (pill().getAttribute('aria-activedescendant') !== 'sr-note_online') await key('ArrowDown')
    await key('Enter')
    expect(useSearch.getState()).toMatchObject({ open: true, live: true })
  })

  it('the pill shows the query only while the overlay does', async () => {
    await mount()
    await act(async () => pill().focus())
    await type('history')
    await key('ArrowDown')
    await key('Enter')
    expect(useSearch.getState()).toMatchObject({ open: false, live: true, query: 'history' })
    expect(pill().value).toBe('')
    expect(pill().getAttribute('aria-expanded')).toBe('false')
  })

  it('a back press or the scrim that ends the visit lets go of the pill', async () => {
    await mount()
    await act(async () => pill().focus())
    expect(document.activeElement).toBe(pill())
    // Android back: the pop lands under the overlay's entry.
    await act(async () => syncSearchWithHistory({ idx: 0 }))
    expect(useSearch.getState().live).toBe(false)
    expect(document.activeElement).not.toBe(pill())
    await act(async () => pill().focus())
    expect(useSearch.getState().open).toBe(true)
    await wait(50)
    await act(async () => $('.search-scrim').click())
    expect(useSearch.getState().live).toBe(false)
    expect(document.activeElement).not.toBe(pill())
    // Focused again, it opens again.
    await act(async () => pill().focus())
    expect(useSearch.getState().open).toBe(true)
  })

  it('the tab\'s context button steps aside while search is open and comes back on close; under reduced motion at once', async () => {
    document.documentElement.dataset.motion = 'reduce'
    const ctx = () => $$('button').find(b => b.getAttribute('aria-label') === 'Context')
    await act(async () => root.render(<MemoryRouter initialEntries={['/home']}>
      <RootHeader title="Home" action={<button type="button" className="iconbtn" aria-label="Context">c</button>} /><SearchOverlay />
    </MemoryRouter>))
    await wait(50)
    expect(ctx().closest('.hdr-slot')).not.toBeNull()
    await act(async () => pill().focus())
    await wait(50)
    expect(ctx()).toBeUndefined()
    await act(async () => $('.avatar-btn').click())
    await wait(50)
    expect(ctx()).toBeDefined()
  })

  it('speaks the results once typing has stopped, in one polite region', async () => {
    await mount()
    await act(async () => pill().focus())
    await type('history')
    await wait(700)
    const live = $$('[role="status"]').find(el => el.getAttribute('aria-live') === 'polite' && el.closest('#gains-search'))
    expect(live.textContent).toMatch(/results?:/)
  })
})
