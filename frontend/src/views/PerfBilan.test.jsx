// @vitest-environment happy-dom
// Plan → Analyze my latest performance (views/PerfBilan.jsx): the local analysis shown at once, the
// Gemini review on a tap with each way it can fail said plainly, the last review kept and re-read,
// and the copy button. Gemini itself is faked: no network, no key.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { isoOf } from '../lib/format.js'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
const mocks = vi.hoisted(() => ({ key: null, ask: vi.fn(), copy: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../lib/clipboard.js', () => ({ copyText: mocks.copy }))
vi.mock('../lib/perf-report.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, getGeminiKey: () => Promise.resolve(mocks.key), askGemini: (...a) => mocks.ask(...a) }
})
const { default: PerfBilan } = await import('./PerfBilan.jsx')
const { GeminiError, loadReport } = await import('../lib/perf-report.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const set = (w, r) => ({ w, r, done: true })
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const day = (n, entries) => ({ id: 'w' + n, d: isoOf(ago(n)), start: ago(n).getTime(), entries })
let host, root

function mount(extra = {}) {
  const S = clone(DEF)
  Object.assign(S, {
    unit: 'kg', routines: [{ id: 'push', name: 'Push', ex: [] }], week: { 1: ['push'] }, gyms: [{ id: 'bf', name: 'Basic-Fit' }],
    workouts: [28, 21, 14, 7].map((n, i) => day(n, [{ id: '0025', gym: 'bf', sets: [set(60 + i * 2.5, 8)] }])),
  }, extra)
  useStore.setState({ S, user: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<PerfBilan />))
}
const text = () => host.textContent
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
const click = el => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => { localStorage.clear(); mocks.key = null; mocks.ask.mockReset(); mocks.copy.mockClear(); nav.mockClear() })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the analysis', () => {
  it('shows each exercise with its machine and its estimated 1RM, offline and at once', () => {
    mount()
    expect(text()).toContain('Basic-Fit')
    expect(text()).toContain('Est. 1RM 76 → 85.5 kg')
    expect(text()).toContain('Going well')
    expect(mocks.ask).not.toHaveBeenCalled()
  })

  it('has an empty state with nothing logged', () => {
    mount({ workouts: [] })
    expect(text()).toContain('Nothing to analyze yet')
    expect(button('Ask Gemini')).toBeUndefined()
  })

  it('goes back to Plan', async () => {
    mount()
    await click(host.querySelector('.iconbtn'))
    expect(nav).toHaveBeenCalledWith('/plan')
  })
})

describe('the AI review', () => {
  it('without a key says where to get one and offers the way to Settings', async () => {
    mocks.ask.mockRejectedValue(new GeminiError('nokey'))
    mount()
    await click(button('Ask Gemini'))
    expect(host.querySelector('.bilan-err').textContent).toContain('Google AI Studio')
    await click(button('Open Settings'))
    expect(nav).toHaveBeenCalledWith('/settings/plan')
    expect(loadReport()).toBeNull()
  })

  it.each([
    ['offline', 'No connection'], ['rate', 'free limit is reached'], ['badkey', 'refused this key'],
    ['busy', 'Gemini is busy'], ['timeout', 'too long'], ['empty', 'no text'], ['weird', 'Something went wrong'],
  ])('says what happened on %s', async (kind, words) => {
    mocks.ask.mockRejectedValue(new GeminiError(kind))
    mount()
    await click(button('Ask Gemini'))
    expect(host.querySelector('.bilan-err').textContent).toContain(words)
  })

  it('sends only the summary, shows the answer and keeps it for the next visit', async () => {
    mocks.key = 'AIza-test'
    mocks.ask.mockResolvedValue({ text: '## Ce qui marche bien\n- **Développé** en hausse', model: 'm' })
    mount()
    await click(button('Ask Gemini'))
    await settle()
    const [key, summary] = mocks.ask.mock.calls[0]
    expect(key).toBe('AIza-test')
    expect(summary).toContain('RÉGULARITÉ')
    expect(summary).not.toMatch(/"entries"|"sets"/)   // the log itself never leaves
    expect(host.querySelector('.bilan-h').textContent).toBe('Ce qui marche bien')
    expect(host.querySelector('.bilan-ul strong').textContent).toBe('Développé')
    expect(button('Redo the review')).toBeTruthy()
    expect(loadReport().text).toContain('Développé')

    // a later visit shows it without asking again
    act(() => root.unmount()); host.remove()
    mocks.ask.mockClear()
    mount()
    expect(host.querySelector('.bilan-h').textContent).toBe('Ce qui marche bien')
    expect(mocks.ask).not.toHaveBeenCalled()
  })

  it('forgets the kept review on request', async () => {
    mocks.ask.mockResolvedValue({ text: 'bilan', model: 'm' })
    mount()
    await click(button('Ask Gemini'))
    await click(button('Forget this review'))
    expect(loadReport()).toBeNull()
    expect(button('Ask Gemini')).toBeTruthy()
  })

  it('never renders the answer as HTML', async () => {
    mocks.ask.mockResolvedValue({ text: '<img src=x onerror=alert(1)> **ok**', model: 'm' })
    mount()
    await click(button('Ask Gemini'))
    expect(host.querySelector('.bilan-text img')).toBeNull()
    expect(host.querySelector('.bilan-text').textContent).toContain('<img src=x')
  })
})

describe('copy my review', () => {
  it('puts the summary, with the ask for four sections, on the clipboard', async () => {
    mount()
    await click(button('Copy my review'))
    expect(mocks.copy).toHaveBeenCalledTimes(1)
    const copied = mocks.copy.mock.calls[0][0]
    expect(copied).toContain('Stagnations et problèmes')
    expect(copied).toContain('RÉGULARITÉ')
    expect(useUI.getState().toastMsg ?? '').not.toBe('Could not copy')
  })
})
