// @vitest-environment happy-dom
// The sheet itself: it names the provider, says what goes there and which way, and every way of
// leaving it settles the question. A sheet swiped away must count as "not now"; a promise that
// never settles is a Coach button that spins forever.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ toast: vi.fn(), S: null, update: null }))
vi.mock('../store/useUI.js', async () => {
  const { create } = await import('zustand')
  let n = 0
  const useUI = create((set, get) => ({
    sheets: [],
    toast: (...a) => mocks.toast(...a),
    openSheet(render) {
      const id = 's' + (++n)
      set(s => ({ sheets: [...s.sheets, { id, render }] }))
      return { id, close: () => get().closeSheet(id) }
    },
    closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  }))
  return { useUI }
})
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S, update: mocks.update })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, readJsonFile: async () => null, writeJsonFile: async () => {} }))
vi.mock('../coach.css', () => ({}))

const { useUI } = await import('../store/useUI.js')
const { askAiConsent, AiConsentSection } = await import('./CoachConsentSheet.jsx')
const { consentTarget, allowAi, hasAiConsent, _resetAiConsent } = await import('../lib/coach-consent.js')

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return <>{sheets.map(s => <div key={s.id} className="sheet">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)}</>
}

let host, root
beforeEach(() => {
  localStorage.clear(); _resetAiConsent(); mocks.toast.mockReset()
  mocks.S = { coach: { cadence: { everyWorkouts: 4 } } }
  mocks.update = vi.fn(fn => fn(mocks.S))
  useUI.setState({ sheets: [] })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Sheets />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const click = async el => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const server = consentTarget({ provider: 'gemini', host: 'generativelanguage.googleapis.com' }, 'server')
const device = consentTarget({ provider: 'compatible', host: 'openrouter.ai' }, 'device')

describe('asking', () => {
  it('names the provider, the data and the route through the user\'s server', async () => {
    let p
    await act(async () => { p = askAiConsent(server) })
    const text = host.textContent
    expect(text).toContain('Send your training to Google Gemini?')
    expect(text).toContain('through your openGym server to Google Gemini')
    expect(text).toContain('your server’s admin picked')
    for (const line of ['Your plan', 'Your workouts', 'Your body weight', 'Your answers to the Coach', 'Your unit and language', 'Anything you type to the Coach']) expect(text).toContain(line)
    expect(text).not.toMatch(/—/)
    await click(button('Allow'))
    await expect(p).resolves.toBe(true)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('says it goes straight from this device for the phone\'s own key, and "Not now" answers false', async () => {
    let p
    await act(async () => { p = askAiConsent(device) })
    expect(host.textContent).toContain('this device sends this straight to openrouter.ai')
    await click(button('Not now'))
    await expect(p).resolves.toBe(false)
  })

  it('a sheet closed any other way (swiped down, the backdrop) is a "not now", not a hang', async () => {
    let p
    await act(async () => { p = askAiConsent(server) })
    await act(async () => { useUI.getState().closeSheet(useUI.getState().sheets[0].id) })
    await expect(p).resolves.toBe(false)
  })
})

describe('the AI data sharing list', () => {
  const mountList = async () => { await act(async () => { root.render(<><Sheets /><AiConsentSection /></>) }) }

  it('says nothing is allowed yet, then shows what was', async () => {
    await mountList()
    expect(host.textContent).toContain('Nothing allowed yet')
    await act(async () => { await allowAi(device) })
    expect(host.textContent).toContain('openrouter.ai')
    expect(host.textContent).toContain('With your API key')
  })

  it('withdrawing forgets the answer; for the server it also stops the automatic reviews', async () => {
    await allowAi(server)
    await mountList()
    expect(host.textContent).toContain('Through your server')
    await click(button('Withdraw'))
    expect(await hasAiConsent(server)).toBe(false)
    expect(mocks.S.coach.cadence).toBe('off')
    expect(mocks.toast).toHaveBeenCalledWith('Withdrawn. The Coach will ask before it sends anything again.')
    expect(host.textContent).toContain('Nothing allowed yet')
  })
})
