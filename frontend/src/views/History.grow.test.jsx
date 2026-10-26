// @vitest-environment happy-dom
// History renders its rows a page at a time as the list is scrolled (performance round 2): a
// 400-workout history used to render every row on each open. Coming back renders as many rows as
// before, so the page can land where it was scrolled to.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
let DEF, useStore

const clone = v => JSON.parse(JSON.stringify(v))
let observers = []
class FakeIO {
  constructor(cb) { this.cb = cb; this.els = []; observers.push(this) }
  observe(el) { this.els.push(el) }
  disconnect() { this.els = []; observers = observers.filter(o => o !== this) }
}
// The end of the list comes into reach: every live observer is told.
const reachEnd = () => act(() => { for (const o of [...observers]) o.cb(o.els.map(target => ({ target, isIntersecting: true }))) })

const day = i => new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10)
function install(n) {
  const st = clone(DEF)
  const workouts = Array.from({ length: n }, (_, i) => ({ id: 'w' + i, d: day(i), start: Date.parse(day(i) + 'T10:00:00Z'), end: Date.parse(day(i) + 'T11:00:00Z'), name: 'Push ' + i, entries: [], prs: [] }))
  Object.assign(st, { routines: [], week: {}, dayPlan: {}, active: null, workouts, weighIn: false })
  useStore.setState({ S: st, user: null })
}

const roots = []
function mount(History) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(<MemoryRouter><History /></MemoryRouter>))
  return host
}
const rows = host => host.querySelectorAll('.list .item').length

describe('History grows as it is scrolled', () => {
  let History, PAGE
  beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.resetModules()
    observers = []
    window.IntersectionObserver = FakeIO
    ;({ DEF, useStore } = await import('../store/useStore.js'))
    ;({ default: History, HISTORY_PAGE: PAGE } = await import('./History.jsx'))
  })
  afterEach(() => {
    for (const r of roots.splice(0)) act(() => r.unmount())
    document.body.innerHTML = ''
    delete window.IntersectionObserver
  })

  it('renders the first page, then a page more each time its end comes into reach, newest first', async () => {
    install(150)
    const host = mount(History)
    expect(rows(host)).toBe(PAGE)
    expect(host.querySelector('.list .item .tt').textContent).toBe('Push 149')
    reachEnd()
    expect(rows(host)).toBe(2 * PAGE)
    reachEnd()
    expect(rows(host)).toBe(150)
    // all there: nothing left to observe
    expect(observers).toHaveLength(0)
    expect(host.querySelector('.list .item:last-child .tt').textContent).toBe('Push 0')
  })

  it('coming back renders as many rows as before (so the scroll position can be restored)', async () => {
    install(300)
    let host = mount(History)
    reachEnd(); reachEnd()
    expect(rows(host)).toBe(3 * PAGE)
    act(() => roots.pop().unmount())
    host = mount(History)
    expect(rows(host)).toBe(3 * PAGE)
  })

  it('a short history is whole, with nothing observed', async () => {
    install(12)
    const host = mount(History)
    expect(rows(host)).toBe(12)
    expect(observers).toHaveLength(0)
  })

  it('without IntersectionObserver the whole list renders, as before', async () => {
    delete window.IntersectionObserver
    install(150)
    const host = mount(History)
    expect(rows(host)).toBe(150)
  })
})
