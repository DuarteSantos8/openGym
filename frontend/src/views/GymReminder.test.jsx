// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// #614: Settings → Reminders → Gym reminder. The native side is mocked (lib/gym-reminder.js has
// its own tests); this checks the pages' flow: off by default, the explainer before any system
// prompt, "Always" asked only after it, the gyms as plain rows, the search first (as you type,
// after a pause, Current location first), the editor (map under a fixed pin, radius sizes, inline
// name and text) and its save and remove.
const mocks = vi.hoisted(() => ({
  config: { on: false, gyms: [], window: null },
  perm: { location: 'prompt', background: 'prompt', notifications: 'granted' },
  saved: [], asked: [], confirm: true, nav: vi.fn(), toast: vi.fn(), location: { state: null },
  here: { lat: 47.3769, lng: 8.5417, accuracy: 12 },
  finds: [], hits: [], findError: false, picks: [], resolved: undefined, reverse: [], address: 'Gym St 1, 8000 Zürich',
  source: 'osm', platform: 'android', map: null,
}))
// The places side, controlled per test (lib/gym-places.js has its own tests for the search's
// manners and the iPhone's MapKit calls).
vi.mock('../lib/gym-places.js', async () => {
  const real = await vi.importActual('../lib/gym-places.js')
  return {
    ...real,
    searchSource: async () => mocks.source,
    findPlaces: async (q, o) => { mocks.finds.push([q, o]); if (mocks.findError) throw new Error('down'); return mocks.hits },
    placeOfPick: async h => { mocks.picks.push(h); return mocks.resolved === undefined ? h : mocks.resolved },
    addressAt: async p => { mocks.reverse.push(p); return mocks.address },
  }
})
vi.mock('../lib/platform-now.js', () => ({ platformNow: () => mocks.platform }))
vi.mock('../lib/gym-reminder.js', async () => {
  const real = await vi.importActual('../lib/gym-reminder.js')
  return {
    ...real,
    loadGymConfig: async () => ({ config: real.normConfig(mocks.config), permission: mocks.perm }),
    saveGymConfig: async c => { mocks.saved.push(real.normConfig(c)); mocks.config = real.normConfig(c); return { watching: c.on ? c.gyms.length : 0, permission: mocks.perm } },
    gymPermissions: async () => mocks.perm,
    askForegroundLocation: async () => { mocks.asked.push('foreground'); mocks.perm = { ...mocks.perm, location: 'granted' }; return mocks.perm },
    askBackgroundLocation: async () => { mocks.asked.push('background'); mocks.perm = { ...mocks.perm, background: 'granted' }; return mocks.perm },
    currentPosition: async () => mocks.here,
    openAppSettings: vi.fn(),
  }
})
vi.mock('../sheets.jsx', () => ({
  confirmSheet: o => { (mocks.confirmOpts ||= []).push(o); mocks.asked.push(o.danger ? 'confirm-remove' : 'explainer'); if (mocks.confirm) o.onConfirm?.(); else o.onCancel?.() },
}))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: () => {} })
  const useUI = sel => (sel ? sel(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: { workouts: [] } })
  const useStore = sel => (sel ? sel(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav, useLocation: () => mocks.location }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }) },
}))
// The map is Leaflet in the phone app; here a stand-in that records the view and lets a test
// "drag" it (set the centre, fire moveend).
vi.mock('leaflet', () => {
  const layer = () => ({ addTo() { return this }, setLatLng() {}, setRadius(r) { mocks.map.radius = r } })
  const L = {
    map: () => {
      const m = mocks.map = { on: {}, center: { lat: 0, lng: 0 }, zoom: 2, radius: null, views: [] }
      const api = {
        setView(ll, z) { m.center = { lat: ll[0], lng: ll[1] }; m.zoom = z; m.views.push([ll, z]); m.on.moveend?.(); return api },
        attributionControl: { setPrefix() {} },
        on(ev, fn) { m.on[ev] = fn },
        invalidateSize() {}, remove() {},
        getCenter: () => m.center, getZoom: () => m.zoom,
      }
      return api
    },
    tileLayer: layer, circle: layer,
  }
  return { default: L, ...L }
})
vi.mock('leaflet/dist/leaflet.css', () => ({}))

import GymReminderPage, { GymEditPage, GymFindPage, TYPE_PAUSE_MS } from './GymReminder.jsx'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const wait = async ms => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }); await flush() }
const render = async el => { await act(async () => { root.render(el) }); await flush() }
const rowByText = text => [...host.querySelectorAll('.lrow')].find(e => e.textContent.includes(text))
const switchIn = text => rowByText(text)?.querySelector('[role="switch"]')
const click = async el => { await act(async () => { el.click() }); await flush() }
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const byLabel = label => host.querySelector(`[aria-label="${label}"]`)
const type = async (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const gymsConfig = () => ({ on: true, gyms: [
  { id: 'a', name: 'Downtown', address: 'Main St 1, 8000 Zürich', lat: 47.37, lng: 8.54, radius: 150, text: '' },
  { id: 'b', name: 'Uptown', lat: 47.4, lng: 8.5, radius: 120, text: 'Legs today', off: true },
], window: null })

beforeEach(() => {
  mocks.config = { on: false, gyms: [], window: null }
  mocks.perm = { location: 'prompt', background: 'prompt', notifications: 'granted' }
  mocks.saved = []; mocks.asked = []; mocks.confirmOpts = []; mocks.confirm = true; mocks.location = { state: null }
  mocks.finds = []; mocks.hits = []; mocks.findError = false; mocks.picks = []; mocks.resolved = undefined; mocks.reverse = []
  mocks.address = 'Gym St 1, 8000 Zürich'; mocks.source = 'osm'; mocks.platform = 'android'; mocks.map = null
  mocks.here = { lat: 47.3769, lng: 8.5417, accuracy: 12 }
  mocks.nav.mockClear(); mocks.toast.mockClear()
  window.history.replaceState({ idx: 0 }, '')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Gym reminder page', () => {
  it('off by default, with a friendly empty list and an Add button', async () => {
    await render(<GymReminderPage />)
    expect(host.textContent).toContain('Gym reminder')
    expect(host.textContent).toContain('Your gyms')
    expect(host.textContent).toContain('No gyms yet.')
    expect(rowByText('Add a gym')).toBeTruthy()
    const sw = switchIn('Gym reminder')
    expect(sw.getAttribute('aria-checked') ?? String(sw.checked)).toMatch(/false/)
    // the places never leave the phone, and it says so
    expect(host.textContent).toContain('Your gyms stay on this phone')
  })

  it('turning it on explains first, then asks while-in-use, then Always, then saves', async () => {
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    expect(mocks.asked).toEqual(['explainer', 'foreground', 'background'])
    expect(mocks.saved.at(-1).on).toBe(true)
  })

  // App Review 5.1.1(iv): the explainer has one button, Continue, and it always leads to the
  // phone's own dialog; saying no is the phone dialog's job.
  it('the explainer has one button and can\'t be swiped away', async () => {
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    const opts = mocks.confirmOpts.at(-1)
    expect(opts.noCancel).toBe(true)
    expect(opts.locked).toBe(true)
    expect(opts.cancelText).toBeUndefined()
    expect(opts.onCancel).toBeUndefined()
  })

  it('Always already given: no explainer, straight on', async () => {
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted' }
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    expect(mocks.asked).toEqual([])
    expect(mocks.saved.at(-1).on).toBe(true)
  })

  it('lists the gyms as plain rows with address and radius; a tap opens the editor', async () => {
    mocks.config = gymsConfig()
    await render(<GymReminderPage />)
    const rows = host.querySelectorAll('.gym-list .gym-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].tagName).toBe('BUTTON')
    expect(rows[0].textContent).toContain('Downtown')
    expect(rows[0].textContent).toContain('Main St 1, 8000 Zürich · 150 m')
    // a switched-off gym says so and fades
    expect(rows[1].classList.contains('off')).toBe(true)
    expect(rows[1].querySelector('.lrow-v').textContent).toBe('Off')
    await click(rows[0])
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { id: 'a' } })
  })

  it('Add a gym is the list\'s last row and opens the search', async () => {
    mocks.config = gymsConfig()
    await render(<GymReminderPage />)
    const rows = [...host.querySelectorAll('.gym-list .lrow')]
    expect(rows.at(-1).textContent).toBe('Add a gym')
    await click(rows.at(-1))
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-find')
  })

  it('20 gyms: no Add row, the reason instead', async () => {
    mocks.config = { on: true, gyms: Array.from({ length: 20 }, (_, i) => ({ id: 'g' + i, name: 'G' + i, lat: 47 + i / 100, lng: 8, radius: 120 })), window: null }
    await render(<GymReminderPage />)
    expect(rowByText('Add a gym')).toBeFalsy()
    expect(host.textContent).toContain('That’s 20 gyms')
  })

  it('the optional time window: 06:00 to 22:00 when switched on', async () => {
    await render(<GymReminderPage />)
    await click(switchIn('Only between certain hours'))
    expect(mocks.saved.at(-1).window).toEqual({ from: '06:00', to: '22:00' })
    expect(host.querySelectorAll('input[type="time"]')).toHaveLength(2)
  })

  it('background location refused: the row says so and leads to the settings', async () => {
    mocks.perm = { location: 'granted', background: 'denied', notifications: 'granted' }
    await render(<GymReminderPage />)
    expect(host.textContent).toContain('Only while using the app')
    expect(host.textContent).toContain('needs location access in the background')
  })
  it('Android, quick arrival check not allowed: says why and leads to the settings; allowed: just On', async () => {
    const { openAppSettings } = await import('../lib/gym-reminder.js')
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted', quick: 'off' }
    await render(<GymReminderPage />)
    expect(rowByText('Quick arrival check').textContent).toContain('Off')
    expect(host.textContent).toContain('up to half an hour')
    await click(rowByText('Quick arrival check'))
    expect(openAppSettings).toHaveBeenCalled()
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    mocks.perm = { ...mocks.perm, quick: 'granted' }
    await render(<GymReminderPage />)
    expect(rowByText('Quick arrival check').textContent).toContain('On')
    expect(host.textContent).toContain('a few minutes at most')
  })
  it('iOS (no quick flag): no such row', async () => {
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted' }
    await render(<GymReminderPage />)
    expect(host.textContent).not.toContain('Quick arrival check')
  })
})

describe('adding a gym: search first', () => {
  const field = () => host.querySelector('.gym-find-bar input')
  const hits = () => [...host.querySelectorAll('.gym-hit')]
  const two = () => [
    { id: '1', name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.38, lng: 8.54, fitness: true, kind: 'gym', distance: 340 },
    { id: '2', name: 'Gym Street', address: 'Zürich', lat: 47.2, lng: 8.3, fitness: false, kind: 'address', distance: 21400 },
  ]

  it('the app\'s own search field on top, the privacy line, Current location as the first row', async () => {
    await render(<GymFindPage />)
    expect(field().closest('.searchf')).toBeTruthy()
    expect(field().getAttribute('aria-label')).toBe('Find your gym…')
    expect(host.textContent).toContain('Searches go to OpenStreetMap. Your gyms stay on this phone.')
    const first = host.querySelector('.lrow')
    expect(first.textContent).toBe('Current location')
    expect(hits()).toHaveLength(0)
  })

  it('on the iPhone the line names Apple Maps', async () => {
    mocks.source = 'apple'
    await render(<GymFindPage />)
    expect(host.textContent).toContain('Searches go to Apple Maps. Your gyms stay on this phone.')
  })

  it('asks once you pause typing, with the newest text only; one letter asks nobody', async () => {
    mocks.hits = two()
    await render(<GymFindPage />)
    await type(field(), 'I')
    await wait(TYPE_PAUSE_MS + 50)
    expect(mocks.finds).toEqual([])
    await type(field(), 'Ir')
    await type(field(), 'Iro')
    await type(field(), 'Iron')
    await wait(TYPE_PAUSE_MS / 2)
    expect(mocks.finds).toEqual([])
    await wait(TYPE_PAUSE_MS)
    expect(mocks.finds.map(f => f[0])).toEqual(['Iron'])
  })

  it('results: name, then distance, kind and address on the grey line', async () => {
    mocks.hits = two()
    await render(<GymFindPage />)
    await type(field(), 'iron')
    await wait(TYPE_PAUSE_MS + 50)
    const rows = hits()
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.lrow-t').textContent).toBe('Iron Temple')
    expect(rows[0].querySelector('.lrow-s').textContent).toBe('340 m · Gym · Gym St 1, 8000 Zürich')
    expect(rows[1].querySelector('.lrow-s').textContent).toMatch(/^21 km · Address · Zürich$/)
    // OpenStreetMap data, credited
    expect(host.textContent).toContain('© OpenStreetMap')
    // Current location stays first
    expect(host.querySelector('.lrow').textContent).toBe('Current location')
  })

  it('is biased to where you are when location is already allowed, without asking', async () => {
    mocks.perm = { location: 'granted', background: 'prompt', notifications: 'granted' }
    await render(<GymFindPage />)
    await type(field(), 'iron')
    await wait(TYPE_PAUSE_MS + 50)
    expect(mocks.finds.at(-1)[1]).toEqual({ near: { lat: 47.3769, lng: 8.5417 } })
    expect(mocks.asked).toEqual([])
  })

  it('nothing found, and a search that did not answer, say so', async () => {
    await render(<GymFindPage />)
    await type(field(), 'zzzz')
    await wait(TYPE_PAUSE_MS + 50)
    expect(host.textContent).toContain('Nothing found. Try a street and a town.')
    mocks.findError = true
    await type(field(), 'zzzzz')
    await wait(TYPE_PAUSE_MS + 50)
    expect(host.textContent).toContain('The search didn’t answer. Try again in a moment.')
  })

  it('picking a result opens the editor with its name, address and place', async () => {
    mocks.hits = two()
    await render(<GymFindPage />)
    await type(field(), 'iron')
    await wait(TYPE_PAUSE_MS + 50)
    await click(hits()[0])
    expect(mocks.picks[0].id).toBe('1')
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { from: 'find', draft: { name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.38, lng: 8.54 } } })
  })

  it('an Apple row gets its place when picked; none: a toast, no editor', async () => {
    mocks.hits = [{ id: 'a:0', ref: '0', name: 'Iron Temple', address: 'Zürich', lat: null, lng: null, fitness: true, kind: 'gym', apple: true, distance: null }]
    mocks.resolved = { ...mocks.hits[0], address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2 }
    await render(<GymFindPage />)
    await type(field(), 'iron')
    await wait(TYPE_PAUSE_MS + 50)
    expect(hits()[0].querySelector('.lrow-s').textContent).toBe('Gym · Zürich')
    await click(hits()[0])
    expect(mocks.nav.mock.calls.at(-1)[1].state.draft).toEqual({ name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.1, lng: 8.2 })
    mocks.nav.mockClear(); mocks.resolved = null
    await click(hits()[0])
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalled()
  })

  it('Current location asks for while-using location, then opens the editor at the phone', async () => {
    await render(<GymFindPage />)
    await click(rowByText('Current location'))
    expect(mocks.asked).toEqual(['foreground'])
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { from: 'find', draft: { name: '', address: '', lat: 47.3769, lng: 8.5417 } } })
  })

  it('Current location with no fix: says so, no editor', async () => {
    mocks.here = null
    await render(<GymFindPage />)
    await click(rowByText('Current location'))
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Couldn’t find where you are. Try the search instead.')
  })
})

describe('one gym: confirm or change it', () => {
  const nameField = () => byLabel('Name')
  const segs = () => [...host.querySelectorAll('.gym-radius .seg button')]
  const fromSearch = draft => { mocks.location = { state: { from: 'find', draft } } }

  it('a new gym from the search: the name filled in, Medium, the map at the place', async () => {
    fromSearch({ name: 'Iron Temple', address: 'Gym St 1, 8000 Zürich', lat: 47.38, lng: 8.54 })
    await render(<GymEditPage />)
    expect(nameField().value).toBe('Iron Temple')
    expect(nameField().closest('.lrow')).toBeTruthy()
    expect(host.querySelector('.gym-map')).toBeTruthy()
    expect(host.querySelector('.gmap-pin')).toBeTruthy()
    expect(mocks.map.center).toEqual({ lat: 47.38, lng: 8.54 })
    expect(host.textContent).toContain('Gym St 1, 8000 Zürich')
    expect(segs().map(b => b.textContent)).toEqual(['Small75 m', 'Medium120 m', 'Large200 m'])
    expect(segs()[1].getAttribute('aria-pressed')).toBe('true')
    // no Remove for a gym that is not saved yet
    expect(rowByText('Remove')).toBeFalsy()
  })

  it('save: the place, the name you typed, the size and the text; back past the search to the list', async () => {
    fromSearch({ name: 'Iron Temple', address: 'Gym St 1', lat: 47.38, lng: 8.54 })
    window.history.replaceState({ idx: 3 }, '')
    await render(<GymEditPage />)
    await type(nameField(), 'Basement')
    await click(segs()[2])
    await type(byLabel('Notification text'), 'Legs!')
    await click(btn('Save'))
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ name: 'Basement', address: 'Gym St 1', lat: 47.38, lng: 8.54, radius: 200, text: 'Legs!' })
    expect(mocks.nav).toHaveBeenCalledWith(-2)
  })

  it('dragging the map moves the gym (the pin stays put) and looks up the new address', async () => {
    fromSearch({ name: 'Iron Temple', address: 'Gym St 1', lat: 47.38, lng: 8.54 })
    mocks.address = 'Side St 9, 8000 Zürich'
    await render(<GymEditPage />)
    await act(async () => { mocks.map.center = { lat: 47.381, lng: 8.541 }; mocks.map.on.moveend() })
    await flush()
    await wait(950)
    expect(mocks.reverse.at(-1)).toEqual({ lat: 47.381, lng: 8.541 })
    expect(host.textContent).toContain('Side St 9, 8000 Zürich')
    await click(btn('Save'))
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ lat: 47.381, lng: 8.541, address: 'Side St 9, 8000 Zürich', name: 'Iron Temple' })
  })

  it('a new radius zooms the map to fit its circle', async () => {
    fromSearch({ name: 'X', lat: 47.38, lng: 8.54 })
    await render(<GymEditPage />)
    const z = mocks.map.zoom
    await click(segs()[2])
    expect(mocks.map.radius).toBe(200)
    expect(mocks.map.zoom).toBeLessThan(z)
  })

  it('"Show where I am" moves the map to the phone', async () => {
    fromSearch({ name: 'X', lat: 47.1, lng: 8.1 })
    await render(<GymEditPage />)
    await click(byLabel('Show where I am'))
    expect(mocks.asked).toEqual(['foreground'])
    expect(mocks.map.center).toEqual({ lat: 47.3769, lng: 8.5417 })
    await click(btn('Save'))
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ lat: 47.3769, lng: 8.5417 })
  })

  it('a saved gym with its own radius keeps it as a fourth size; switched off stays off', async () => {
    mocks.config = gymsConfig()
    mocks.location = { state: { id: 'a' } }
    await render(<GymEditPage />)
    expect(segs().map(b => b.textContent)).toEqual(['Small75 m', 'Medium120 m', 'Custom150 m', 'Large200 m'])
    expect(segs()[2].getAttribute('aria-pressed')).toBe('true')
    await click(switchIn('Remind me here'))
    await click(btn('Save'))
    expect(mocks.saved.at(-1).gyms.find(g => g.id === 'a')).toMatchObject({ radius: 150, off: true })
  })

  it('Remove is the last row, asks first, and takes the gym off the list', async () => {
    mocks.config = gymsConfig()
    mocks.location = { state: { id: 'a' } }
    await render(<GymEditPage />)
    const rows = [...host.querySelectorAll('.lrow')]
    expect(rows.at(-1).textContent).toBe('Remove')
    expect(rows.at(-1).classList.contains('danger')).toBe(true)
    await click(rows.at(-1))
    expect(mocks.asked).toContain('confirm-remove')
    expect(mocks.saved.at(-1).gyms.map(g => g.id)).toEqual(['b'])
  })

  it('Open in Google Maps on Android, Apple Maps on the iPhone', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    fromSearch({ name: 'Iron Temple', lat: 47.3769, lng: 8.5417 })
    await render(<GymEditPage />)
    await click(rowByText('Open in Google Maps'))
    expect(open).toHaveBeenLastCalledWith('https://www.google.com/maps/search/?api=1&query=47.376900%2C8.541700', '_blank', 'noopener')
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    mocks.platform = 'ios'
    await render(<GymEditPage />)
    await click(rowByText('Open in Apple Maps'))
    expect(open).toHaveBeenLastCalledWith('https://maps.apple.com/?ll=47.376900%2C8.541700&q=Iron%20Temple', '_blank', 'noopener')
    open.mockRestore()
  })

  it('opened without a place: back to the search', async () => {
    mocks.location = { state: { draft: {} } }
    await render(<GymEditPage />)
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-find', { replace: true })
  })
})
