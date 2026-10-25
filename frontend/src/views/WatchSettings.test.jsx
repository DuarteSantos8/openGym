// @vitest-environment happy-dom
// Settings → Apple Watch: one Apple Health story. The phone's Apple Health switch (Settings → Data)
// is the one switch; this page says what the watch makes of it and leads there.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ health: { on: false }, link: { paired: true, installed: true } }))
vi.mock('../lib/health-sync.js', () => ({ loadHealth: async () => mocks.health, onHealthChange: () => () => {} }))
vi.mock('../lib/watch-sync.js', () => ({ watchStatus: async () => mocks.link }))

import WatchSettingsPage from './WatchSettings.jsx'
import { readWatchPrefs, writeWatchStatus } from '../lib/watch-settings.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let where = null
function Where() { where = useLocation(); return null }

async function mount() {
  const el = document.createElement('div')
  document.body.replaceChildren(el)
  await act(async () => {
    createRoot(el).render(<MemoryRouter initialEntries={['/settings/watch']}><Routes>
      <Route path="/settings/watch" element={<WatchSettingsPage />} />
      <Route path="*" element={<Where />} />
    </Routes></MemoryRouter>)
  })
  return el
}
const row = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

beforeEach(() => { localStorage.clear(); mocks.health = { on: false }; where = null })

describe('Settings → Apple Watch', () => {
  it('shows Apple Health as the phone has it, and leads to its switch', async () => {
    const el = await mount()
    expect(row(el, 'Apple Health').querySelector('.lrow-v').textContent).toBe('Off')
    expect(el.textContent).toContain('Turn on Apple Health and the watch measures your heart rate for every set.')
    expect(row(el, 'Apple Health').querySelector('[role="switch"]')).toBeNull()
    await act(async () => { row(el, 'Apple Health').click() })
    expect(where.pathname).toBe('/settings/data')
    expect(where.state).toEqual({ find: 'Write to Apple Health' })
  })

  it('says when the watch was not allowed to', async () => {
    mocks.health = { on: true }
    writeWatchStatus({ health: 'denied' })
    const el = await mount()
    expect(row(el, 'Apple Health').querySelector('.lrow-v').textContent).toBe('Not allowed')
    expect(el.textContent).toContain('Allow it in the Health app on your iPhone.')
  })

  it('has the switch for opening on the watch, on to begin with', async () => {
    const el = await mount()
    const sw = row(el, 'Open on the watch').querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await act(async () => { sw.click() })
    expect(readWatchPrefs().autoShow).toBe(false)
  })

  it('lets you pick what the watch shows, one switch at a time, clean to begin with', async () => {
    const el = await mount()
    const sw = title => row(el, title).querySelector('[role="switch"]')
    expect(sw('Exercise animation').getAttribute('aria-checked')).toBe('true')
    expect(sw('Calories').getAttribute('aria-checked')).toBe('false')
    expect(sw('Time so far').getAttribute('aria-checked')).toBe('false')
    await act(async () => { sw('Calories').click() })
    await act(async () => { sw('Exercise animation').click() })
    expect(readWatchPrefs().show).toMatchObject({ kcal: true, clip: false, hr: true, rest: 'ring' })
    expect(row(el, 'Rest timer')).toBeTruthy()
    expect(row(el, 'The Digital Crown turns first')).toBeUndefined()
  })
})

