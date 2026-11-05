// @vitest-environment happy-dom
// The Gemini key sheet (Settings → Plan): the key is saved to the secure store and nowhere else.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { getGeminiKey, clearGeminiKey } from '../lib/perf-report.js'
import { GeminiKeySheet, useHasGeminiKey } from './GeminiKeySheet.jsx'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const type = (el, value) => act(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }))
})
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))

function Probe() { const has = useHasGeminiKey(); return <i id="has">{String(has)}</i> }

beforeEach(async () => { await clearGeminiKey(); useStore.setState({ S: structuredClone(DEF) }) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('GeminiKeySheet', () => {
  it('saves the pasted key to the secure store, never to the app state, and closes', async () => {
    const close = vi.fn()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<><GeminiKeySheet close={close} /><Probe /></>))
    await settle()
    expect(host.querySelector('#has').textContent).toBe('false')
    expect(button('Save').disabled).toBe(true)
    await type(host.querySelector('input'), '  AIza-secret-123  ')
    expect(host.querySelector('input').type).toBe('password')
    await act(async () => { button('Save').click() })
    await settle()
    expect(await getGeminiKey()).toBe('AIza-secret-123')
    expect(close).toHaveBeenCalled()
    expect(host.querySelector('#has').textContent).toBe('true')
    expect(JSON.stringify(useStore.getState().S)).not.toContain('AIza-secret-123')
    // (on the phone the plugin is the Keystore; in a browser it falls back to its own localStorage entry,
    // which is still never the app's saved state, so it never syncs or lands in a backup)
    expect(localStorage.getItem('gym_state_v1') || '').not.toContain('AIza-secret-123')
  })

  it('removes a saved key', async () => {
    const { setGeminiKey } = await import('../lib/perf-report.js')
    await setGeminiKey('AIza-old')
    const close = vi.fn()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    act(() => root.render(<><GeminiKeySheet close={close} /><Probe /></>))
    await settle()
    expect(host.querySelector('#has').textContent).toBe('true')
    await act(async () => { button('Remove key').click() })
    await settle()
    expect(await getGeminiKey()).toBeNull()
    expect(close).toHaveBeenCalled()
  })
})
