// @vitest-environment happy-dom
// Progress › Body › Photos segment: the action row, the Compare mode and the lines around them.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { syncMedia } from '../lib/media-sync.js'
import ProgressPhotos from './ProgressPhotos.jsx'

const mocks = vi.hoisted(() => ({ picker: null, pick: null }))
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../components/CustomMediaField.jsx', () => ({ useMediaPicker: () => mocks.picker }))
vi.mock('../components/CustomMedia.jsx', () => ({
  CustomThumb: () => <span className="thumb" />,
  MediaView: () => <span className="media-view" />,
  useMediaUrl: () => ({ url: null }),
}))
vi.mock('../lib/media-sync.js', () => ({ syncMedia: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const hashOf = n => n.toString(16).padStart(64, '0')
const img = n => ({ kind: 'image', hash: hashOf(n), mime: 'image/jpeg', size: 1000, width: 10, height: 10 })
const workout = (d, media = [], id = 'w' + d) => ({ id, d, start: new Date(d + 'T10:00:00').getTime(), entries: [], media })

let host, root
const setWorkouts = workouts => useStore.setState(s => ({ S: { ...s.S, workouts } }))
const picker = (patch = {}) => { mocks.picker = { pick: mocks.pick, busy: false, canAdd: true, showAdd: true, ...patch } }
const mount = () => act(() => root.render(<ProgressPhotos />))
const text = () => host.textContent
const action = label => [...host.querySelectorAll('.act-b')].find(b => b.textContent === label)
const thumbs = () => [...host.querySelectorAll('.wmedia-item')]

beforeEach(() => {
  navigate.mockClear()
  vi.mocked(syncMedia).mockClear()
  mocks.pick = vi.fn(async () => img(99))
  picker()
  useUI.getState().closeAll()
  useStore.setState({ pushState: vi.fn(async () => {}) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll() })

describe('Photos segment: Add photo', () => {
  it('offers Add photo and Compare when today has a workout, with no explanation line', () => {
    setWorkouts([workout(todayISO())])
    mount()
    expect(action('Add photo')).toBeDefined()
    expect(action('Workout')).toBeUndefined()
    expect(action('Compare')).toBeDefined()
    expect(text()).not.toContain('A photo goes on a workout')
  })

  it('swaps Add photo for Workout when today has none, and says why', () => {
    setWorkouts([workout('2020-01-01')])
    mount()
    expect(action('Add photo')).toBeUndefined()
    expect(text()).toContain('A photo goes on a workout: log today’s to add one.')
    act(() => action('Workout').click())
    expect(navigate).toHaveBeenCalledWith('/train/workout')
  })

  it('disables Add photo while busy or when files cannot be stored', () => {
    setWorkouts([workout(todayISO())])
    picker({ busy: true, canAdd: false })
    mount()
    expect(action('Add photo').disabled).toBe(true)
    expect(action('Add photo').getAttribute('aria-busy')).toBe('true')
    act(() => root.render(<div />))
    picker({ canAdd: false })
    mount()
    expect(action('Add photo').disabled).toBe(true)
  })

  it('puts the picked file on today\'s workout, toasts, and syncs the media', async () => {
    setWorkouts([workout(todayISO())])
    mount()
    const input = host.querySelector('input[type="file"]')
    expect(input.accept).toBe('image/*')
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(mocks.pick).toHaveBeenCalledWith(file)
    expect(useStore.getState().S.workouts[0].media.map(m => m.hash)).toEqual([hashOf(99)])
    expect(syncMedia).toHaveBeenCalledWith({ force: true })
    expect(useUI.getState().toastMsg).toBe('Photo added')
  })
})

describe('Photos segment: Compare', () => {
  it('is disabled with fewer than two photos', () => {
    setWorkouts([workout(todayISO(), [img(1)])])
    mount()
    expect(action('Compare').disabled).toBe(true)
  })

  it('becomes Cancel while comparing, asks for two photos, then offers the comparison', () => {
    setWorkouts([workout('2026-01-01', [img(1)]), workout('2026-02-01', [img(2)]), workout('2026-03-01', [img(3)])])
    mount()
    act(() => action('Compare').click())
    expect(action('Compare')).toBeUndefined()
    expect(action('Cancel')).toBeDefined()
    expect(text()).toContain('Pick two photos to compare.')
    expect(host.querySelector('.pp-cta')).toBeNull()
    act(() => thumbs()[0].click())
    act(() => thumbs()[1].click())
    expect(thumbs().filter(t => t.classList.contains('pp-selected'))).toHaveLength(2)
    expect(text()).toContain('Ready! Open the comparison.')
    const go = host.querySelector('.pp-cta button')
    expect(go.textContent).toBe('Compare')
    act(() => go.click())
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(action('Cancel')).toBeUndefined()
    expect(action('Compare')).toBeDefined()
  })

  it('Cancel leaves compare mode and clears the picks', () => {
    setWorkouts([workout('2026-01-01', [img(1)]), workout('2026-02-01', [img(2)])])
    mount()
    act(() => action('Compare').click())
    act(() => thumbs()[0].click())
    act(() => action('Cancel').click())
    expect(thumbs().some(t => t.classList.contains('pp-selected'))).toBe(false)
    expect(action('Compare')).toBeDefined()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('disables Add photo and Workout while comparing, and hides the explanation line', () => {
    setWorkouts([workout(todayISO(), [img(1)]), workout('2020-01-01', [img(2)])])
    mount()
    act(() => action('Compare').click())
    expect(action('Add photo').disabled).toBe(true)
    act(() => action('Cancel').click())
    act(() => root.render(<div />))
    setWorkouts([workout('2020-01-01', [img(1)]), workout('2020-02-01', [img(2)])])
    mount()
    expect(text()).toContain('A photo goes on a workout')
    act(() => action('Compare').click())
    expect(action('Workout').disabled).toBe(true)
    expect(text()).not.toContain('A photo goes on a workout')
  })

  it('opens a photo in the viewer outside compare mode', () => {
    setWorkouts([workout('2026-01-01', [img(1)])])
    mount()
    act(() => thumbs()[0].click())
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})

describe('Photos segment: the list', () => {
  it('shows the empty state with no photos', () => {
    setWorkouts([workout('2026-01-01')])
    mount()
    expect(text()).toContain('No progress photos yet')
    expect(thumbs()).toHaveLength(0)
  })

  it('counts the photos and groups them by date, newest first', () => {
    setWorkouts([workout('2026-01-01', [img(1)]), workout('2026-02-01', [img(2), img(3)])])
    mount()
    expect(text()).toContain('3 photos')
    expect(text()).not.toContain('No progress photos yet')
    expect([...host.querySelectorAll('.wmedia-grid')].map(g => g.children.length)).toEqual([2, 1])
    act(() => root.render(<div />))
    setWorkouts([workout('2026-01-01', [img(1)])])
    mount()
    expect(text()).toContain('1 photo')
  })
})

describe('Photos segment: without the media feature', () => {
  beforeEach(() => picker({ showAdd: false, canAdd: false }))

  it('has no action row and no Add photo', () => {
    setWorkouts([workout(todayISO(), [img(1)])])
    mount()
    expect(host.querySelector('.act-row')).toBeNull()
    expect(text()).not.toContain('Add photo')
    expect(text()).not.toContain('A photo goes on a workout')
  })

  it('shows a small Compare button only from two photos, and it turns into Cancel', () => {
    setWorkouts([workout('2026-01-01', [img(1)])])
    mount()
    expect(host.querySelector('.btn')).toBeNull()
    act(() => root.render(<div />))
    setWorkouts([workout('2026-01-01', [img(1)]), workout('2026-02-01', [img(2)])])
    mount()
    const btn = () => host.querySelector('.btn')
    expect(btn().textContent).toBe('Compare')
    act(() => btn().click())
    expect(btn().textContent).toBe('Cancel')
    expect(text()).toContain('Pick two photos to compare.')
    act(() => btn().click())
    expect(btn().textContent).toBe('Compare')
  })
})
