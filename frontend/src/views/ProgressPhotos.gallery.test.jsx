// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import ProgressPhotos from './ProgressPhotos.jsx'
import { isoOf } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The gallery (#949): a line on top about today's photo, the activity chart right under it, and one
   grid of photos, a header per month, each photo carrying its own date. */
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d) }
const hash = n => String(n).padStart(64, '0')
const ref = n => ({ kind: 'image', hash: hash(n), mime: 'image/jpeg', size: 10, width: 4, height: 3, at: 1 })
const withPhotos = (...ages) => ({
  ...structuredClone(DEF),
  workouts: ages.map((age, i) => ({ id: 'w' + i, d: daysAgo(age), start: i + 1, entries: [], media: [ref(i + 1)] })),
})

let host, root
const mount = S => {
  useStore.setState({ S, user: null, ready: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter><ProgressPhotos /></MemoryRouter>))
}
beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll?.() })
const status = () => host.querySelector('.pp-status')?.textContent

describe('the line on top', () => {
  it('says the photo of today is in', () => {
    mount(withPhotos(0, 5))
    expect(status()).toBe('Today’s photo is in. Nice work!')
    expect(host.querySelector('.pp-status').classList.contains('ok')).toBe(true)
  })
  it('says the last photo was yesterday', () => {
    mount(withPhotos(1, 5))
    expect(status()).toBe('Your last photo was yesterday. Ready for today’s?')
    expect(host.querySelector('.pp-status').classList.contains('ok')).toBe(false)
  })
  it('says how many days it has been', () => {
    mount(withPhotos(9, 20))
    expect(status()).toBe('No photo for 9 days. What are you waiting for?')
  })
  it('is not there, and neither is the chart, with no photos at all', () => {
    mount(withPhotos())
    expect(status()).toBeUndefined()
    expect(host.querySelector('.pp-activity')).toBeNull()
    expect(host.textContent).toContain('No progress photos yet.')
  })
})

describe('the activity chart under it', () => {
  it('comes right after the line, with the photos per day', () => {
    mount(withPhotos(2, 2, 6))
    const kids = [...host.children].map(el => el.className)
    expect(kids.findIndex(c => String(c).includes('pp-status'))).toBeLessThan(kids.findIndex(c => String(c).includes('pp-activity')))
    expect(host.querySelector('.pp-activity h2').textContent).toBe('Activity (last 12 months)')
    const title = iso => [...host.querySelectorAll('.pp-activity .hm-c[title]')].find(e => e.title.startsWith(iso))?.title
    expect(title(daysAgo(2))).toBe(daysAgo(2) + ' · 2 photos')
    expect(title(daysAgo(6))).toBe(daysAgo(6) + ' · 1 photo')
    expect(host.querySelector('.pp-activity').textContent).toContain('Fewer photos')
  })
  it('scrolls to the photos of a tapped day and flashes them', () => {
    mount(withPhotos(2, 2, 6))
    const cell = [...host.querySelectorAll('.pp-activity .hm-c[title]')].find(e => e.title.startsWith(daysAgo(2)))
    act(() => cell.click())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    const tiles = [...host.querySelectorAll('.pp-tile')].filter(e => e.dataset.day === daysAgo(2))
    expect(tiles).toHaveLength(2)
    expect(tiles.every(e => e.classList.contains('pp-flash'))).toBe(true)
    expect([...host.querySelectorAll('.pp-tile')].filter(e => e.dataset.day === daysAgo(6)).some(e => e.classList.contains('pp-flash'))).toBe(false)
  })
})

describe('the grid', () => {
  it('is one grid, not a row per day, newest first, with the date on every photo', () => {
    mount(withPhotos(2, 2, 40, 400))
    expect(host.querySelectorAll('.pp-gallery')).toHaveLength(1)
    const tiles = [...host.querySelectorAll('.pp-gallery .pp-tile')]
    expect(tiles).toHaveLength(4)
    expect(tiles.map(e => e.dataset.day)).toEqual([daysAgo(2), daysAgo(2), daysAgo(40), daysAgo(400)])
    tiles.forEach(e => expect(e.querySelector('.pp-chip').textContent.length).toBeGreaterThan(3))
    // the two photos of one day sit side by side in the same grid, each with that day on it
    expect(tiles[0].querySelector('.pp-chip').textContent).toBe(tiles[1].querySelector('.pp-chip').textContent)
  })
  it('has a header for each month, with the year', () => {
    mount(withPhotos(2, 40, 400))
    const heads = [...host.querySelectorAll('.pp-gallery .pp-month')].map(e => e.textContent)
    expect(heads).toHaveLength(3)
    heads.forEach(h => expect(h).toMatch(/ \d{4}$/))
    expect(new Set(heads).size).toBe(3)
  })
  it('picks two photos to compare with a tap each', () => {
    mount(withPhotos(2, 5, 9))
    const tile = i => host.querySelectorAll('.pp-tile')[i]
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Compare').click())
    act(() => tile(0).click()); act(() => tile(1).click())
    expect(tile(0).classList.contains('pp-selected')).toBe(true)
    expect(tile(1).classList.contains('pp-selected')).toBe(true)
    expect(tile(2).classList.contains('pp-selected')).toBe(false)
    expect(host.querySelectorAll('.pp-check')).toHaveLength(2)
  })
})

describe('the buttons', () => {
  const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
  it('keeps the header to the title, and puts Add photos (the main one) over Compare, under the chart', () => {
    mount(withPhotos(2, 5))
    expect(host.querySelector('.hdr').querySelectorAll('button')).toHaveLength(1)   // just the back arrow
    const actions = host.querySelector('.pp-actions')
    expect([...actions.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Add photos', 'Compare'])
    expect(btn('Add photos').classList.contains('primary')).toBe(true)
    expect(btn('Compare').classList.contains('tinted')).toBe(true)
    const kids = [...host.children].map(el => String(el.className))
    expect(kids.findIndex(c => c.includes('pp-activity'))).toBeLessThan(kids.findIndex(c => c.includes('pp-actions')))
    expect(kids.findIndex(c => c.includes('pp-actions'))).toBeLessThan(kids.findIndex(c => c.includes('pp-gallery')))
  })
  it('has no Compare with fewer than two photos', () => {
    mount(withPhotos(2))
    expect([...host.querySelectorAll('.pp-actions button')].map(b => b.textContent)).toEqual(['Add photos'])
  })
  it('swaps to Confirm over Cancel while comparing, Confirm waiting for two photos, and back', () => {
    mount(withPhotos(2, 5, 9))
    const labels = () => [...host.querySelectorAll('.pp-actions button')].map(b => b.textContent)
    act(() => btn('Compare').click())
    expect(labels()).toEqual(['Confirm', 'Cancel'])
    expect(btn('Confirm').classList.contains('primary')).toBe(true)
    expect(host.querySelector('.pp-actions').classList.contains('stick')).toBe(true)      // pinned while comparing
    expect(btn('Confirm').disabled).toBe(true)
    expect(host.querySelector('.pp-cta')).toBeNull()                 // nothing sticks to the bottom any more
    act(() => host.querySelectorAll('.pp-tile')[0].click())
    expect(btn('Confirm').disabled).toBe(true)
    act(() => host.querySelectorAll('.pp-tile')[2].click())
    expect(btn('Confirm').disabled).toBe(false)
    act(() => btn('Cancel').click())
    expect(labels()).toEqual(['Add photos', 'Compare'])
    expect(host.querySelector('.pp-actions').classList.contains('stick')).toBe(false)
    expect(host.querySelectorAll('.pp-selected')).toHaveLength(0)
  })
  it('opens the comparison of the two picked photos with Confirm', () => {
    mount(withPhotos(2, 5, 9))
    act(() => btn('Compare').click())
    act(() => host.querySelectorAll('.pp-tile')[0].click())
    act(() => host.querySelectorAll('.pp-tile')[1].click())
    act(() => btn('Confirm').click())
    expect(useUI.getState().sheets.at(-1)?.kind).toBe('viewer')
    expect([...host.querySelectorAll('.pp-actions button')].map(b => b.textContent)).toEqual(['Add photos', 'Compare'])
  })
})
