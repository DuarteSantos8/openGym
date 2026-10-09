// @vitest-environment happy-dom
// The long exercise lists — the Library, the add-exercise picker and the muscle explorer — load
// their next page by themselves once the "Show more" button at their foot comes near the screen
// (lib/use-auto-more.js). The button stays, and without IntersectionObserver it is the way on.
// happy-dom has no IntersectionObserver, so a fake one stands in and is fired by hand.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker } from './sheets.jsx'
import Library from './views/Library.jsx'
import MuscleExplorer from './components/MuscleExplorer.jsx'
import { BODYPARTS, EXDB } from './lib/exercises.js'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

const observers = []
class FakeIntersectionObserver {
  constructor(cb) { this.cb = cb; this.els = new Set(); observers.push(this) }
  observe(el) { this.els.add(el) }
  unobserve(el) { this.els.delete(el) }
  disconnect() { this.els.clear() }
}
// The button scrolls into the observed band: every live observer reports what it watches.
const comeIntoView = () => act(() => observers.forEach(o => o.els.size && o.cb([...o.els].map(target => ({ target, isIntersecting: true })))))

const mounted = []
function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const rows = host => host.querySelectorAll('.list > .item').length - 1   // drop "Create your own"
const showMore = host => [...host.querySelectorAll('button')].find(b => b.textContent === 'Show more')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  observers.length = 0
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  vi.unstubAllGlobals()
})

describe('lists load their next page as you scroll', () => {
  it('Library: the button coming into view loads the next 40', () => {
    const host = render(<Library />)
    expect(rows(host)).toBe(40)
    comeIntoView()
    expect(rows(host)).toBe(80)
    comeIntoView()
    expect(rows(host)).toBe(120)
  })

  it('picker: the next 50, the same way', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    expect(rows(host)).toBe(50)
    comeIntoView()
    expect(rows(host)).toBe(100)
  })

  it('muscle explorer: the results of a muscle load on too', () => {
    const host = render(<MuscleExplorer onDetail={vi.fn()} onPlan={vi.fn()} />)
    // the muscle with the most exercises, so there is a second page to load
    const chips = [...host.querySelectorAll('.chip[aria-pressed]')]
    const biggest = chips.reduce((a, b) => (+b.querySelector('.dim').textContent > +a.querySelector('.dim').textContent ? b : a))
    act(() => biggest.click())
    const before = host.querySelectorAll('.list > .item').length
    expect(before).toBe(40)
    comeIntoView()
    expect(host.querySelectorAll('.list > .item').length).toBeGreaterThan(before)
  })

  it('stops watching once everything is shown', () => {
    // a body part with a few pages, not the whole catalogue
    const count = bp => EXDB.filter(e => e.bp === bp).length
    const bp = BODYPARTS.filter(b => count(b) > 40).sort((a, b) => count(a) - count(b))[0]
    const host = render(<Library />)
    act(() => [...host.querySelectorAll('.chips .chip')].find(c => c.textContent === bp).click())
    for (let i = 0; i < 10 && showMore(host); i++) comeIntoView()
    expect(rows(host)).toBe(count(bp))
    expect(showMore(host)).toBeUndefined()
    expect(observers.every(o => o.els.size === 0)).toBe(true)
  })

  it('without IntersectionObserver the button still loads more, and nothing breaks', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const host = render(<Library />)
    expect(rows(host)).toBe(40)
    act(() => showMore(host).click())
    expect(rows(host)).toBe(80)
  })
})
