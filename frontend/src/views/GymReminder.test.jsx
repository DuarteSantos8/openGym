// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// #614: Settings → Reminders → Gym reminder. The native side is mocked (lib/gym-reminder.js has
// its own tests); this checks the page's flow: off by default, the explainer before any system
// prompt, "Always" asked only after it, the gyms list, the time window and the editor's save.
const mocks = vi.hoisted(() => ({
  config: { on: false, gyms: [], window: null },
  perm: { location: 'prompt', background: 'prompt', notifications: 'granted' },
  saved: [], asked: [], confirm: true, nav: vi.fn(), toast: vi.fn(), menu: null, location: { state: null },
  here: { lat: 47.3769, lng: 8.5417, accuracy: 12 },
}))
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
  confirmSheet: o => { mocks.asked.push('explainer'); if (mocks.confirm) o.onConfirm?.(); else o.onCancel?.() },
  menuSheet: o => { mocks.menu = o },
}))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast })
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
// The map is Leaflet in the phone app; here a stand-in that records what the page asks of it.
vi.mock('leaflet', () => {
  const layer = () => ({ addTo() { return this }, on() { return this }, setLatLng() {}, setOpacity() {}, setStyle() {}, setRadius() {}, getLatLng: () => ({ lat: 0, lng: 0 }), options: { opacity: 0 } })
  const L = {
    map: () => ({ setView() { return this }, attributionControl: { setPrefix() {} }, on() {}, invalidateSize() {}, remove() {}, getZoom: () => 2 }),
    tileLayer: layer, marker: layer, circle: layer, divIcon: () => ({}),
  }
  return { default: L, ...L }
})
vi.mock('leaflet/dist/leaflet.css', () => ({}))

import GymReminderPage, { GymEditPage, searchAddress } from './GymReminder.jsx'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const render = async el => { await act(async () => { root.render(el) }); await flush() }
const rowByText = text => [...host.querySelectorAll('.lrow, .row, [class*="row"]')].find(e => e.textContent.includes(text))
const switchIn = text => rowByText(text)?.querySelector('[role="switch"], input[type="checkbox"], button')
const click = async el => { await act(async () => { el.click() }); await flush() }

beforeEach(() => {
  mocks.config = { on: false, gyms: [], window: null }
  mocks.perm = { location: 'prompt', background: 'prompt', notifications: 'granted' }
  mocks.saved = []; mocks.asked = []; mocks.confirm = true; mocks.menu = null; mocks.location = { state: null }
  mocks.nav.mockClear(); mocks.toast.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Gym reminder page', () => {
  it('off by default, with an empty list and an Add row', async () => {
    await render(<GymReminderPage />)
    expect(host.textContent).toContain('Gym reminder')
    expect(host.textContent).toContain('Your gyms')
    expect(host.textContent).toContain('Add a gym')
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

  it('"Not now" on the explainer: no system prompt, stays off', async () => {
    mocks.confirm = false
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    expect(mocks.asked).toEqual(['explainer'])
    expect(mocks.saved).toEqual([])
  })

  it('Always already given: no explainer, straight on', async () => {
    mocks.perm = { location: 'granted', background: 'granted', notifications: 'granted' }
    await render(<GymReminderPage />)
    await click(switchIn('Gym reminder'))
    expect(mocks.asked).toEqual([])
    expect(mocks.saved.at(-1).on).toBe(true)
  })

  it('lists the gyms with their radius; a tap opens the editor', async () => {
    mocks.config = { on: true, gyms: [{ id: 'a', name: 'Downtown', lat: 47.37, lng: 8.54, radius: 150, text: '' }], window: null }
    await render(<GymReminderPage />)
    expect(host.textContent).toContain('Downtown')
    expect(host.textContent).toContain('150 m around the pin')
    await click(rowByText('Downtown'))
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { id: 'a' } })
  })

  it('"I\'m at the gym right now" takes the phone\'s position into the editor', async () => {
    await render(<GymReminderPage />)
    await click(rowByText('Add a gym'))
    expect(mocks.menu.items.map(i => i.label)).toEqual(['I’m at the gym right now', 'Pick it on the map'])
    await act(async () => { await mocks.menu.items[0].onClick() })
    expect(mocks.asked).toEqual(['foreground'])
    expect(mocks.nav).toHaveBeenCalledWith('/settings/gym-edit', { state: { draft: { lat: 47.3769, lng: 8.5417 } } })
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

describe('one gym', () => {
  it('a new gym from a draft: default radius, saved with the place', async () => {
    mocks.location = { state: { draft: { lat: 47.3769, lng: 8.5417 } } }
    await render(<GymEditPage />)
    expect(host.textContent).toContain('100 m')
    expect(host.querySelector('.gym-map')).toBeTruthy()
    // OpenStreetMap is asked only on an explicit Search
    expect(host.textContent).toContain('only when you tap Search')
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')
    await click(save)
    expect(mocks.saved.at(-1).gyms).toHaveLength(1)
    expect(mocks.saved.at(-1).gyms[0]).toMatchObject({ lat: 47.3769, lng: 8.5417, radius: 100 })
  })

  it('without a place, Save waits for the pin', async () => {
    mocks.location = { state: { draft: {} } }
    await render(<GymEditPage />)
    const save = [...host.querySelectorAll('button')].find(b => b.textContent === 'Save')
    expect(save.disabled).toBe(true)
  })
})

describe('address search (Nominatim)', () => {
  it('sends a User-Agent that names the app, and reads the answer', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => [{ lat: '47.1', lon: '8.2', display_name: 'Gym Street 1, Town' }, { lat: 'x', lon: '1' }] }))
    const r = await searchAddress('Gym Street 1', fetcher)
    expect(r).toEqual([{ lat: 47.1, lng: 8.2, label: 'Gym Street 1, Town' }])
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/search\?format=jsonv2&limit=5&q=Gym%20Street%201/)
    expect(init.headers['User-Agent']).toMatch(/^openGym\/.+opengym\.ch/)
  })
  it('an empty query asks nobody', async () => {
    const fetcher = vi.fn()
    expect(await searchAddress('   ', fetcher)).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
})
