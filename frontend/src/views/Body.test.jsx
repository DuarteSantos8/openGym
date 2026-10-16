// @vitest-environment happy-dom
// Progress › Body: one page, three segments, switched in place.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Body from './Body.jsx'

const navigate = vi.fn()
let search = ''
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate, useLocation: () => ({ search }) }))
vi.mock('../components/BodyWeight.jsx', () => ({ default: () => <div data-testid="weight" /> }))
vi.mock('./Measurements.jsx', () => ({ default: () => <div data-testid="measurements" /> }))
vi.mock('./ProgressPhotos.jsx', () => ({ default: () => <div data-testid="photos" /> }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const mount = props => act(() => root.render(<Body {...props} />))
const tabs = () => [...host.querySelectorAll('.seg button')]
const on = () => tabs().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
const shown = () => [...host.querySelectorAll('[data-testid]')].map(e => e.dataset.testid)
const press = label => act(() => tabs().find(b => b.textContent === label).click())

beforeEach(() => {
  navigate.mockClear()
  search = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Progress › Body', () => {
  it('is titled Body with Weight, Measurements and Photos', () => {
    mount()
    expect(host.querySelector('h1')?.textContent ?? host.textContent).toContain('Body')
    expect(tabs().map(b => b.textContent)).toEqual(['Weight', 'Measurements', 'Photos'])
    expect(host.querySelector('.seg[aria-label="Body"]')).not.toBeNull()
  })

  it('opens on Weight by default', () => {
    mount()
    expect(on()).toEqual(['Weight'])
    expect(shown()).toEqual(['weight'])
  })

  it.each([
    ['measurements', 'Measurements', 'measurements'],
    ['photos', 'Photos', 'photos'],
    ['weight', 'Weight', 'weight'],
  ])('shows the %s segment for its route', (segment, label, id) => {
    mount({ segment })
    expect(on()).toEqual([label])
    expect(shown()).toEqual([id])
  })

  it.each([
    ['Measurements', '/progress/body/measurements'],
    ['Photos', '/progress/body/photos'],
    ['Weight', '/progress/body'],
  ])('switches to %s in place (replace), at its own path', (label, path) => {
    mount({ segment: label === 'Weight' ? 'photos' : 'weight' })
    press(label)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(path, { replace: true })
  })

  it('keeps the query (the range) when it switches', () => {
    search = '?range=365'
    mount()
    press('Photos')
    expect(navigate).toHaveBeenLastCalledWith('/progress/body/photos?range=365', { replace: true })
    press('Measurements')
    expect(navigate).toHaveBeenLastCalledWith('/progress/body/measurements?range=365', { replace: true })
  })
})
