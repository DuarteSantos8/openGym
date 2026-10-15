// @vitest-environment happy-dom
// /me/<old page>: a bookmark, a home-screen shortcut or a link from before the §5 merge lands on the
// renamed page (lib/tab-route.js PROFILE_RENAMED), not on Profile's root.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsRoute } from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.__APP_VERSION__ ??= 'test'

let host, root, seen
function Where() { seen = useLocation().pathname; return null }

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const open = path => act(() => root.render(
  <MemoryRouter initialEntries={[path]}>
    <Where />
    <Routes>
      <Route path="/me" element={<SettingsRoute />} />
      <Route path="/me/:page" element={<SettingsRoute />} />
    </Routes>
  </MemoryRouter>,
))

describe('renamed Profile pages', () => {
  it.each([['look', 'appearance'], ['plan', 'schedule'], ['data', 'backup']])('/me/%s opens /me/%s', (from, to) => {
    open('/me/' + from)
    expect(seen).toBe('/me/' + to)
  })

  // Notifications needs a push server: a guest in a browser has none, so the page itself sends it on.
  it('/me/reminders opens /me/notifications, which a guest in a browser does not have', () => {
    open('/me/reminders')
    expect(seen).toBe('/me')
  })

  it('an unknown page still goes to Profile', () => {
    open('/me/nope')
    expect(seen).toBe('/me')
  })
})
