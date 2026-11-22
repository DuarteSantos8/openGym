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
})
