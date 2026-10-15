// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '../components/Toast.jsx'
import { useUI } from '../store/useUI.js'
import { NAVIGATE_MSG, pageBuild, startSwMessages, UPDATED_MSG } from './sw-update.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* A deploy reaching an open app. The worker (public/sw.js) posts UPDATED_MSG with the build that
   is now active; the page, which keeps the JavaScript it loaded, offers a Reload in the app's own
   toast. The toast and the store are the real ones; the service worker container is an
   EventTarget the test posts to. */
const OLD = 'aaaaaaaaaa'
const NEW = 'bbbbbbbbbb'
const NEWER = 'cccccccccc'

let host, root, container, reload, stop
const post = data => act(async () => { container.dispatchEvent(new MessageEvent('message', { data })) })
const toastText = () => host.querySelector('#toast')?.textContent || ''
const reloadButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Reload')
const start = (over = {}) => { stop = startSwMessages({ container, build: OLD, reload, loc: window.location, ...over }) }

beforeEach(async () => {
  container = new EventTarget()
  reload = vi.fn()
  useUI.setState({ toastMsg: '', toastAction: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Toast />) })
})
afterEach(async () => {
  stop?.()
  stop = undefined
  await act(async () => { root.unmount() })
  host.remove()
  window.location.hash = ''
})

describe('the update prompt', () => {
  it('offers a Reload when a build other than the page’s own took over, and reloads on tap', async () => {
    start()
    await post({ type: UPDATED_MSG, build: NEW })
    expect(toastText()).toContain('A new version is ready')
    expect(reloadButton()).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()   // asked, never forced: a set may be half typed

    await act(async () => { reloadButton().click() })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(toastText()).toBe('')
  })

  it('stays up long enough to be read', async () => {
    vi.useFakeTimers()
    try {
      start()
      await post({ type: UPDATED_MSG, build: NEW })
      await act(async () => { vi.advanceTimersByTime(20_000) })
      expect(toastText()).toContain('A new version is ready')
    } finally { vi.useRealTimers() }
  })

  it('does not prompt the page that already runs the build the message names', async () => {
    // The page whose fresh index.html started the install: the worker activating under it changes
    // nothing it is running.
    start()
    await post({ type: UPDATED_MSG, build: OLD })
    expect(toastText()).toBe('')
    expect(reloadButton()).toBeUndefined()
  })

  it('does not prompt again on a second activation', async () => {
    start()
    await post({ type: UPDATED_MSG, build: NEW })
    await act(async () => { useUI.setState({ toastMsg: '', toastAction: null }) })   // dismissed, or timed out
    await post({ type: UPDATED_MSG, build: NEW })
    await post({ type: UPDATED_MSG, build: NEWER })
    expect(toastText()).toBe('')
  })

  it('does not prompt a page that does not know its build, or for a message that is not an update', async () => {
    start({ build: '' })
    await post({ type: UPDATED_MSG, build: NEW })
    stop()
    start()
    await post({ type: UPDATED_MSG })
    await post({ type: UPDATED_MSG, build: '' })
    await post({ type: 'something-else', build: NEW })
    await post(null)
    await post('gains-sw-updated')
    expect(toastText()).toBe('')
  })

  it('stops listening when told to', async () => {
    start()
    stop()
    await post({ type: UPDATED_MSG, build: NEW })
    expect(toastText()).toBe('')
  })
})

describe('the build the page runs', () => {
  it('is the stamp the build wrote into index.html', () => {
    expect(pageBuild()).toBe('')
    const meta = document.createElement('meta')
    meta.name = 'gains-build'
    meta.content = OLD
    document.head.appendChild(meta)
    try { expect(pageBuild()).toBe(OLD) } finally { meta.remove() }
  })
})

describe('a notification tap reaching the page', () => {
  const origin = () => window.location.origin

  it('takes the page to the route by setting its hash, without a reload', async () => {
    start()
    await post({ type: NAVIGATE_MSG, url: origin() + '/#/train/workout' })
    expect(window.location.hash).toBe('#/train/workout')
    await post({ type: NAVIGATE_MSG, url: origin() + '/#/home?x=1' })
    expect(window.location.hash).toBe('#/home?x=1')
    expect(reload).not.toHaveBeenCalled()
  })

  it('refuses another site and anything that is not a hash route', async () => {
    start()
    for (const url of ['https://evil.example/#/home', 'javascript:alert(1)', origin() + '/#home', origin() + '/', '', 42, null, undefined]) {
      await post({ type: NAVIGATE_MSG, url })
      expect(window.location.hash, String(url)).toBe('')
    }
  })
})
