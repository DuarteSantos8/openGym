// @vitest-environment happy-dom
// Settings → Apple Watch → Gestures: one screen, two tabs; a choice saves when it is made (a list
// row, here; the carousel saves when it settles) with an Undo, never from a button to forget.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))
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
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: {} }) } }))

import WatchGesturesPage from './WatchGestures.jsx'
import { useUI } from '../store/useUI.js'
import { readWatchPrefs, readGestureState, noteGestureEvent } from '../lib/watch-settings.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return <>{sheets.map(s => <div key={s.id} className="sheet">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)}</>
}
let host, root
async function mount(input) {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[{ pathname: '/settings/watch-gestures', state: input ? { input } : undefined }]}><WatchGesturesPage /><Sheets /></MemoryRouter>)
  })
}
const byText = (sel, text) => [...host.querySelectorAll(sel)].find(b => b.textContent.trim().startsWith(text))
const click = async el => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

beforeEach(() => {
  localStorage.clear(); mocks.toast.mockReset(); useUI.setState({ sheets: [] })
  host = document.createElement('div'); document.body.replaceChildren(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()) })

describe('the Gestures screen', () => {
  it('opens on the tab the Settings row asked for, and the carousel is one adjustable item', async () => {
    await mount('actionButton')
    expect(byText('.seg button', 'Action Button').getAttribute('aria-pressed')).toBe('true')
    const car = host.querySelector('[role="slider"]')
    expect(car.getAttribute('aria-valuetext')).toMatch(/^Smart, 1 of 8, selected\. \S/)   // the effect is spoken too
    expect(car.getAttribute('aria-valuemax')).toBe('8')
    expect(host.querySelector('.gw-pg').getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('[aria-label="Next action"]')).toBeTruthy()
    // Double Tap has six: Show metrics and Next exercise are the Action Button's alone.
    await click(byText('.seg button', 'Double Tap'))
    expect(host.querySelector('[role="slider"]').getAttribute('aria-valuemax')).toBe('6')
  })

  it('recommends Skip rest for Double Tap and Smart for the Action Button, and lists what Smart does, never Finish', async () => {
    await mount()
    expect(host.querySelector('.gw-pg .gw-rec').closest('.gw-pg').querySelector('h2').textContent).toContain('Skip rest')
    await click(byText('.seg button', 'Action Button'))
    expect(host.querySelector('.gw-pg .gw-rec').closest('.gw-pg').querySelector('h2').textContent).toContain('Smart')
    const smart = host.querySelector('details.gw-smart')
    expect(smart.querySelector('summary').textContent).toBe('What Smart does')
    expect(smart.textContent).toContain('Skip rest')
    expect(smart.textContent).toContain('Never Finish or Discard.')
  })

  it('shows the same choices as a list; a tap saves at once, with an Undo that puts it back', async () => {
    await mount()
    await click(host.querySelector('.gw-mode'))
    const radios = [...host.querySelectorAll('[role="radio"]')]
    expect(radios).toHaveLength(6)
    expect(radios[2].getAttribute('aria-checked')).toBe('true')
    expect(radios[2].textContent).toContain('Recommended')
    await click(radios[0])
    expect(readWatchPrefs().doubleTap).toBe('smart')
    expect(host.querySelector('[aria-checked="true"]').textContent).toContain('Smart')
    const [msg, opts] = mocks.toast.mock.calls.at(-1)
    expect(msg).toBe('Double Tap set to Smart')
    await act(async () => { opts.onAction() })
    expect(readWatchPrefs().doubleTap).toBe('skipRest')
    expect(host.querySelector('[aria-checked="true"]').textContent).toContain('Skip rest')
  })

  it('keeps each input’s own choice, and Show metrics only on the Action Button', async () => {
    await mount('actionButton')
    await click(host.querySelector('.gw-mode'))
    await click(byText('[role="radio"]', 'Show metrics'))
    expect(readWatchPrefs()).toMatchObject({ actionButton: 'showMetrics', doubleTap: 'skipRest' })
  })

  it('a carousel that has not settled yet still saves its page when the screen is left', async () => {
    await mount()
    expect(readWatchPrefs().doubleTap).toBe('skipRest')
    // happy-dom has no layout: the carousel rests on page 0 (Smart)
    await act(async () => { host.querySelector('[role="slider"]').dispatchEvent(new Event('scroll')) })
    await act(async () => { root.unmount() })
    expect(readWatchPrefs().doubleTap).toBe('smart')
    root = createRoot(host)
  })

  it('tests Double Tap on the watch: waiting, then Worked when the watch answers', async () => {
    await mount()
    expect(byText('.gw-link', 'Try it on my watch')).toBeTruthy()
    await click(byText('.gw-link', 'Try it on my watch'))
    const stamp = readWatchPrefs().gestureTest
    expect(stamp).toBeGreaterThan(0)
    expect(host.querySelector('.gw-testmsg').textContent).toContain('Waiting for your watch')
    await act(async () => { noteGestureEvent({ type: 'gestureTestOk', stamp }) })
    expect(host.querySelector('.gw-testmsg').textContent).toContain('Worked')
  })

  it('says calmly when the watch does not answer in time', async () => {
    vi.useFakeTimers()
    try {
      await mount()
      await act(async () => { byText('.gw-link', 'Try it on my watch').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      await act(async () => { vi.advanceTimersByTime(31000) })
      expect(host.querySelector('.gw-testmsg').textContent).toContain('No answer yet')
      expect(byText('.gw-link', 'Try it on my watch').disabled).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('the Action Button asks for one step on the watch first, and keeps the lifter’s word until a press is heard', async () => {
    await mount('actionButton')
    expect(byText('.gw-link', 'Try it')).toBeUndefined()
    const row = byText('.lrow', 'One step on your watch first')
    await click(row)
    expect(host.querySelector('.gw-sheet').textContent).toContain('Under First Press, pick a workout type')
    await click(byText('.gw-sheet button', 'I’ve done this'))
    expect(readGestureState().setup).toBe(true)
    expect(host.querySelector('.gw-sheet')).toBeNull()
    expect(host.textContent).toContain('Action Button is set up')
    await act(async () => { noteGestureEvent({ type: 'actionButtonSeen', at: 5 }) })
    expect(host.textContent).toContain('Action Button is working')
  })
})
