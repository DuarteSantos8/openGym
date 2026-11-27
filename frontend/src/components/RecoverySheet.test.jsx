// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { recoverySessionsOf, withRecovery } from '../lib/recovery-sessions.js'

const mocks = vi.hoisted(() => ({
  MOBILE: true,
  readDayWorkouts: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('../lib/mobile.js', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    get MOBILE() { return mocks.MOBILE },
  }
})
vi.mock('../lib/health-sync.js', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    readDayWorkouts: (...args) => mocks.readDayWorkouts(...args),
  }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})

import { RecoveryLog, RecoveryRow } from './RecoverySheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const clone = v => JSON.parse(JSON.stringify(v))
const at = (iso, h, m = 0) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()

let host, root, close
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const mount = async (props = {}) => {
  await act(async () => { root.render(<RecoveryLog day="2026-11-21" close={close} {...props} />) })
  await flush()
}
const kindBtn = label => [...host.querySelectorAll('.rec-kinds button')].find(b => b.textContent.includes(label))
const saveBtn = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('2026-11-21', 20, 0))
  mocks.MOBILE = true
  mocks.readDayWorkouts.mockReset()
  mocks.toast.mockReset()
  close = vi.fn()
  const S = clone(DEF)
  S.recoverySessions = {}
  S.workouts = []
  useStore.setState({ S, user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('RecoverySheet: Health Connect / Apple Health suggestions', () => {
  it('pre-fetches on mount, shows a checking indicator while loading, displays all specs with customize toggles, and saves them', async () => {
    let resolveWorkouts
    mocks.readDayWorkouts.mockImplementation(() => new Promise(res => { resolveWorkouts = res }))

    await mount()
    // Pre-fetches on mount for a new recovery sheet, while default kind (sauna) hides the checking row.
    expect(mocks.readDayWorkouts).toHaveBeenCalledTimes(1)
    expect(mocks.readDayWorkouts).toHaveBeenCalledWith('2026-11-21', expect.any(Object))
    expect(host.querySelector('.rec-checking')).toBeNull()

    // Switching to Easy walk while fetch is still pending shows the animated checking indicator.
    await act(async () => { kindBtn('Easy walk').click() })
    expect(host.querySelector('.rec-checking')).toBeTruthy()
    expect(host.textContent).toContain('Checking…')

    // Resolve the health query with rich Garmin walk + mobility specs.
    await act(async () => {
      resolveWorkouts({
        src: 'hc',
        records: [
          {
            id: 'garmin-w1', sport: 'walk', start: at('2026-11-21', 8, 15), end: at('2026-11-21', 8, 52),
            title: 'Morning Walk', notes: 'Easy neighborhood loop', origin: 'com.garmin.android.apps.connectmobile',
            km: 3.9, kcal: 215, steps: 4820, hrAvg: 112, hrMin: 88, hrMax: 134,
            elev: 42, speedAvg: 6.3, speedMax: 7.4, cadence: 118, floors: 5,
            laps: [{ sec: 920, km: 1.61 }, { sec: 940, km: 1.61 }],
          },
          {
            id: 'garmin-s1', sport: 'stretch', start: at('2026-11-21', 18, 0), end: at('2026-11-21', 18, 18),
            title: 'Hip Mobility', origin: 'com.garmin.android.apps.connectmobile', kcal: 48, hrAvg: 94,
          },
        ],
      })
    })
    await flush()
    expect(host.querySelector('.rec-checking')).toBeNull()
    expect(host.textContent).toContain('From Health Connect')
    const walkPicks = [...host.querySelectorAll('.rec-pick')]
    expect(walkPicks).toHaveLength(1)
    expect(walkPicks[0].textContent).toContain('Morning Walk')
    expect(walkPicks[0].textContent).toContain('Garmin Connect')
    expect(walkPicks[0].textContent).toContain('37 min')
    expect(walkPicks[0].textContent).toContain('3.9 km')
    expect(walkPicks[0].textContent).toContain('112 bpm')
    expect(walkPicks[0].textContent).toContain('215 kcal')

    // Tapping the walk pre-fills duration (37), shows all specs by default, and lets the user hide any metric.
    await act(async () => { walkPicks[0].click() })
    expect(walkPicks[0].getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('input[aria-label="Minutes"]').value).toBe('37')
    expect(host.querySelector('textarea').value).toBe('Easy neighborhood loop')
    const specs = host.querySelector('.rec-specs')
    expect(specs).toBeTruthy()
    expect(specs.textContent).toContain('Garmin Connect')
    expect(specs.textContent).toContain('3.9 km')
    expect(specs.textContent).toContain('9:29 /km')
    expect(specs.textContent).toContain('6.3 km/h')
    expect(specs.textContent).toContain('4,820')
    expect(specs.textContent).toContain('118 spm')
    expect(specs.textContent).toContain('112 bpm')
    expect(specs.textContent).toContain('Min 88 · Max 134')
    expect(specs.textContent).toContain('215 kcal')
    expect(specs.textContent).toContain('42 m')
    expect(specs.textContent).toContain('5')
    expect(specs.textContent).toContain('#1 15:20')

    // Open customize toggles and hide Elevation; it disappears live and persists in S.recoveryMetrics.
    await act(async () => { host.querySelector('.rec-specs-btn').click() })
    const elevChip = [...host.querySelectorAll('.rec-metric-chips button')].find(b => b.textContent.trim() === 'Elevation')
    await act(async () => { elevChip.click() })
    expect(useStore.getState().S.recoveryMetrics).toEqual({ elev: false })
    expect(host.querySelector('.rec-specs').textContent).not.toContain('42 m')
    await act(async () => { elevChip.click() })
    expect(useStore.getState().S.recoveryMetrics).toEqual({})

    // Tapping it again deselects, clears the specs preview, and restores manual defaults.
    await act(async () => { walkPicks[0].click() })
    expect(walkPicks[0].getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('.rec-specs')).toBeNull()
    expect(host.querySelector('input[aria-label="Minutes"]').value).toBe('30')
    expect(host.querySelector('textarea').value).toBe('')

    // Tapping again, then picking a manual preset chip smoothly falls back to manual.
    await act(async () => { walkPicks[0].click() })
    const chip45 = [...host.querySelectorAll('button.chip')].find(b => b.textContent.trim() === '45 min')
    await act(async () => { chip45.click() })
    expect(walkPicks[0].getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('.rec-specs')).toBeNull()
    expect(host.querySelector('input[aria-label="Minutes"]').value).toBe('45')

    // Switching to Mobility reuses the fetched day records and shows the stretching session.
    await act(async () => { kindBtn('Mobility').click() })
    await flush()
    expect(mocks.readDayWorkouts).toHaveBeenCalledTimes(1)
    const stretchPicks = [...host.querySelectorAll('.rec-pick')]
    expect(stretchPicks).toHaveLength(1)
    expect(stretchPicks[0].textContent).toContain('Hip Mobility')
    expect(stretchPicks[0].textContent).toContain('18 min')

    // Picking and saving writes duration, title, source app, and health metrics to S.recoverySessions.
    await act(async () => { stretchPicks[0].click() })
    await act(async () => { saveBtn().click() })
    expect(close).toHaveBeenCalledTimes(1)
    const saved = recoverySessionsOf(useStore.getState().S)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      d: '2026-11-21', kind: 'stretch', min: 18, title: 'Hip Mobility', app: 'Garmin Connect',
      kcal: 48, hr: { avg: 94 }, at: at('2026-11-21', 18, 0), src: 'hc', srcId: 'garmin-s1',
    })
  })

  it('shows saved walk specs and source app when editing and in RecoveryRow', async () => {
    const S = clone(DEF)
    S.recoverySessions = withRecovery({}, 'walk-1', {
      d: '2026-11-21', kind: 'walk', min: 37, title: 'Morning Walk', app: 'Garmin Connect',
      at: at('2026-11-21', 8, 15), src: 'hc', srcId: 'garmin-w1', km: 3.9, kcal: 215, steps: 4820, hr: { avg: 112, max: 134 },
    }, 1)
    useStore.setState({ S, user: null })

    await mount({ id: 'walk-1' })
    expect(mocks.readDayWorkouts).not.toHaveBeenCalled()
    expect(host.querySelector('.rec-picks')).toBeNull()
    const specs = host.querySelector('.rec-specs')
    expect(specs).toBeTruthy()
    expect(specs.textContent).toContain('Garmin Connect')
    expect(specs.textContent).toContain('From Health Connect')
    expect(specs.textContent).toContain('3.9 km')
    expect(specs.textContent).toContain('112 bpm')
    expect(specs.textContent).toContain('215 kcal')

    const saved = recoverySessionsOf(S)[0]
    await act(async () => { root.render(<RecoveryRow r={saved} showDate={false} />) })
    expect(host.textContent).toContain('Morning Walk')
    expect(host.textContent).toContain('37 min')
    expect(host.textContent).toContain('3.9 km')
    expect(host.textContent).toContain('112 bpm')
    expect(host.textContent).toContain('215 kcal')
    expect(host.textContent).toContain('Garmin Connect')
  })

  it('shows Apple Health label on iOS and keeps manual entry working when none are found', async () => {
    mocks.readDayWorkouts.mockResolvedValue({
      src: 'ah',
      records: [{ id: 'ah-1', sport: 'walk', start: at('2026-11-21', 7, 0), end: at('2026-11-21', 7, 22), origin: 'com.apple.health' }],
    })
    await mount()
    await act(async () => { kindBtn('Easy walk').click() })
    await flush()
    expect(host.textContent).toContain('From Apple Health')
    expect(host.querySelector('.rec-pick').textContent).toContain('Easy walk')
    expect(host.querySelector('.rec-pick').textContent).toContain('22 min')

    // Manual save without tapping any detected walk works identically.
    await act(async () => { saveBtn().click() })
    const saved = recoverySessionsOf(useStore.getState().S)
    expect(saved[0]).toMatchObject({ d: '2026-11-21', kind: 'walk', min: 30 })
    expect(saved[0].srcId).toBeUndefined()
  })

  it('does not query when editing an existing recovery session', async () => {
    const S = clone(DEF)
    S.recoverySessions = withRecovery({}, 'existing-1', { d: '2026-11-21', kind: 'walk', min: 28, note: 'Park loop' }, 1)
    useStore.setState({ S, user: null })
    await mount({ id: 'existing-1' })
    expect(mocks.readDayWorkouts).not.toHaveBeenCalled()
    expect(host.querySelector('.rec-picks')).toBeNull()
  })

  it('skips inserting a duplicate if the picked session was already logged before Save', async () => {
    mocks.readDayWorkouts.mockResolvedValue({
      src: 'hc',
      records: [{ id: 'garmin-dup', sport: 'walk', start: at('2026-11-21', 9, 0), end: at('2026-11-21', 9, 30), origin: 'com.garmin.android.apps.connectmobile' }],
    })
    await mount()
    await act(async () => { kindBtn('Easy walk').click() })
    await flush()
    await act(async () => { host.querySelector('.rec-pick').click() })
    // Simulate the same workout arriving in state (for example via sync) before Save is tapped.
    await act(async () => {
      useStore.getState().update(s => {
        s.recoverySessions = withRecovery(s.recoverySessions, 'synced-1', {
          d: '2026-11-21', kind: 'walk', min: 30, at: at('2026-11-21', 9, 0), src: 'hc', srcId: 'garmin-dup',
        })
      })
    })
    await act(async () => { saveBtn().click() })
    expect(close).toHaveBeenCalledTimes(1)
    expect(recoverySessionsOf(useStore.getState().S)).toHaveLength(1)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('supports selecting 1, 2, or all detected walks and logging them in one batch', async () => {
    mocks.readDayWorkouts.mockResolvedValue({
      src: 'hc',
      records: [
        { id: 'w-a', sport: 'walk', start: at('2026-11-21', 8, 0), end: at('2026-11-21', 8, 12), title: 'Walk A to B', notes: 'Leg 1', km: 1.0, steps: 1200, origin: 'com.garmin.android.apps.connectmobile' },
        { id: 'w-b', sport: 'walk', start: at('2026-11-21', 12, 30), end: at('2026-11-21', 12, 45), title: 'Walk B to C', km: 1.3, steps: 1600, origin: 'com.garmin.android.apps.connectmobile' },
        { id: 'w-c', sport: 'walk', start: at('2026-11-21', 17, 10), end: at('2026-11-21', 17, 30), title: 'Walk C to D', notes: 'Evening', km: 1.7, steps: 2100, origin: 'com.garmin.android.apps.connectmobile' },
      ],
    })
    await mount()
    await act(async () => { kindBtn('Easy walk').click() })
    await flush()

    const picks = [...host.querySelectorAll('.rec-pick')]
    expect(picks).toHaveLength(3)
    const selectAllBtn = () => host.querySelector('.rec-select-all')
    expect(selectAllBtn().textContent.trim()).toBe('Select all')

    // Selecting 1 shows specs and keeps single-session Save.
    await act(async () => { picks[0].click() })
    expect(host.querySelector('.rec-specs')).toBeTruthy()
    expect(host.querySelector('.rec-batch-summary')).toBeNull()
    expect(saveBtn()).toBeTruthy()

    // Selecting a 2nd switches to batch mode with combined summary and "Log 2 sessions" button.
    await act(async () => { picks[1].click() })
    expect(host.querySelector('.rec-specs')).toBeNull()
    expect(host.querySelector('input[aria-label="Minutes"]')).toBeNull()
    expect(host.querySelector('.rec-batch-summary').textContent).toContain('2 selected')
    expect(host.querySelector('.rec-batch-summary').textContent).toContain('35 min total')
    expect(host.textContent).toContain('Log 2 sessions')
    expect(selectAllBtn().textContent.trim()).toBe('Select all')

    // Select all selects all 3 walks and switches the toggle to Clear.
    await act(async () => { selectAllBtn().click() })
    expect(picks.every(p => p.getAttribute('aria-pressed') === 'true')).toBe(true)
    expect(selectAllBtn().textContent.trim()).toBe('Clear')
    expect(host.querySelector('.rec-batch-summary').textContent).toContain('3 selected')
    expect(host.querySelector('.rec-batch-summary').textContent).toContain('47 min total')
    expect(host.querySelector('.rec-batch-summary').textContent).toContain('4 km')

    // Deselecting 2 brings back single-session specs; Clear returns to manual entry.
    await act(async () => { picks[0].click() })
    await act(async () => { picks[1].click() })
    expect(host.querySelector('.rec-specs')).toBeTruthy()
    expect(host.querySelector('input[aria-label="Minutes"]').value).toBe('12')

    // Select all again and log all 3 walks at once, preserving each walk's own duration, metrics, and note.
    await act(async () => { selectAllBtn().click() })
    const logAll = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Log 3 sessions')
    expect(logAll).toBeTruthy()
    await act(async () => { logAll.click() })
    expect(close).toHaveBeenCalledTimes(1)
    const saved = recoverySessionsOf(useStore.getState().S)
    expect(saved).toHaveLength(3)
    expect(saved.map(r => r.srcId).sort()).toEqual(['w-a', 'w-b', 'w-c'])
    expect(saved.find(r => r.srcId === 'w-a')).toMatchObject({ min: 12, km: 1, note: 'Leg 1', title: 'Walk A to B' })
    expect(saved.find(r => r.srcId === 'w-b')).toMatchObject({ min: 15, km: 1.3, title: 'Walk B to C' })
    expect(saved.find(r => r.srcId === 'w-b').note).toBeUndefined()
    expect(saved.find(r => r.srcId === 'w-c')).toMatchObject({ min: 20, km: 1.7, note: 'Evening', title: 'Walk C to D' })
    expect(mocks.toast).toHaveBeenCalledWith('3 sessions logged. Your muscles say thanks.')
  })

  it('skips already-logged walks during a batch save and applies a typed shared note to newly logged ones', async () => {
    mocks.readDayWorkouts.mockResolvedValue({
      src: 'hc',
      records: [
        { id: 'w-1', sport: 'walk', start: at('2026-11-21', 9, 0), end: at('2026-11-21', 9, 15), km: 1.2 },
        { id: 'w-2', sport: 'walk', start: at('2026-11-21', 14, 0), end: at('2026-11-21', 14, 25), km: 2.0 },
      ],
    })
    await mount()
    await act(async () => { kindBtn('Easy walk').click() })
    await flush()
    await act(async () => { host.querySelector('.rec-select-all').click() })
    const ta = host.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    await act(async () => {
      setter.call(ta, 'Errand walks')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Simulate w-1 arriving from another device before save.
    await act(async () => {
      useStore.getState().update(s => {
        s.recoverySessions = withRecovery(s.recoverySessions, 'synced-w1', {
          d: '2026-11-21', kind: 'walk', min: 15, at: at('2026-11-21', 9, 0), src: 'hc', srcId: 'w-1',
        })
      })
    })
    const logBtn = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Log 2 sessions')
    await act(async () => { logBtn.click() })
    const saved = recoverySessionsOf(useStore.getState().S)
    expect(saved).toHaveLength(2)
    expect(saved.map(r => r.srcId).sort()).toEqual(['w-1', 'w-2'])
    expect(saved.find(r => r.srcId === 'w-2').note).toBe('Errand walks')
    expect(mocks.toast).toHaveBeenCalledWith('Easy walk logged. Your muscles say thanks.')
  })

  it('deduplicates near-start walks within the same batch save', async () => {
    const startA = at('2026-11-21', 9, 0)
    mocks.readDayWorkouts.mockResolvedValue({
      src: 'hc',
      records: [
        { id: 'w-garmin', sport: 'walk', start: startA, end: startA + 20 * 60e3, km: 1.5 },
        { id: 'w-fit', sport: 'walk', start: startA + 30e3, end: startA + 20 * 60e3 + 30e3, km: 1.5 },
        { id: 'w-afternoon', sport: 'walk', start: at('2026-11-21', 15, 0), end: at('2026-11-21', 15, 15), km: 1.1 },
      ],
    })
    await mount()
    await act(async () => { kindBtn('Easy walk').click() })
    await flush()
    await act(async () => { host.querySelector('.rec-select-all').click() })
    const logBtn = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Log 3 sessions')
    await act(async () => { logBtn.click() })
    const saved = recoverySessionsOf(useStore.getState().S)
    expect(saved).toHaveLength(2)
    expect(saved.map(r => r.srcId).sort()).toEqual(['w-afternoon', 'w-garmin'])
    expect(mocks.toast).toHaveBeenCalledWith('2 sessions logged. Your muscles say thanks.')
  })
})
