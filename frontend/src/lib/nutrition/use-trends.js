import { create } from 'zustand'
import { NtApi } from './api.js'
import { useNutrition } from './store.js'
import { FETCH_DAYS, mergeSources } from './wellness.js'
import { useStore } from '../../store/useStore.js'
import { isoOf } from '../format.js'

// What Progress › Trends and Recovery read, through the hub (api.js): every diary day NutriTrace
// has (GET /api/diary, as its Statistics page reads it) and the wearable's days. Server state kept
// so the hub's cards and the pages agree and a range change never asks again.
//
// Fresh, not just cached: a page asks again whenever it opens, comes back to the front or the day
// changes (use-freshness.js), with `load({ force: true })`, which leaves what is held on screen until
// the new answer lands. A diary write marks the days `stale`, so the next look asks again. A failed
// read leaves what was there and reports the error.
//
// `status` is 'idle' | 'loading' | 'ready' | 'error'.

const idle = () => ({ status: 'idle', days: [], error: null, stale: false })

// Bumped when the account changes, so an answer for the account before never lands in the next.
let gen = 0
// Numbers the requests: of two in flight (a refresh on top of a refresh) only the last one lands.
let seq = 0

export const useTrends = create((set, get) => ({
  ...idle(),

  reset() {
    gen += 1
    set(idle())
  },

  async load({ force = false } = {}) {
    const cur = get()
    if (!force && !cur.stale && (cur.status === 'ready' || cur.status === 'loading')) return
    const g = gen
    const n = ++seq
    set(cur.status === 'ready' ? { stale: false } : { status: 'loading', stale: false })
    try {
      const days = await NtApi.getAllDiary()
      if (g === gen && n === seq) set({ status: 'ready', error: null, days: Array.isArray(days) ? days : [] })
    } catch (e) {
      if (g === gen && n === seq) set(s => ({ status: s.days.length || s.status === 'ready' ? 'ready' : 'error', error: e }))
    }
  },
}))

const wellnessIdle = () => ({ status: 'idle', byDate: {}, error: null, unavailable: false, stale: false })
let wellnessGen = 0
let wellnessSeq = 0

// The settings say which wearables are connected (booleans, never credentials: the hub passes
// these four keys). A person with none costs no request.
const connected = settings => ({
  fitbit: !!(settings?.fitbitEnabled || settings?.googleHealthEnabled || settings?.healthConnectEnabled),
  garmin: !!settings?.garminEnabled,
})

// The hub answers a route it does not forward with 404 and a query it refuses with 403: the
// wearable routes are not open on this server yet, which is not a failure to report.
const notOpen = reason => reason?.status === 403 || reason?.status === 404

export const useWellness = create((set, get) => ({
  ...wellnessIdle(),

  reset() {
    wellnessGen += 1
    set(wellnessIdle())
  },

  /** Reads the last year of both sources (one that fails does not hide the other) once the
   *  settings are known; a forced read asks for the settings again too, so a wearable connected
   *  since shows up. Nothing is asked for without a connected wearable. */
  async load({ force = false } = {}) {
    const cur = get()
    if (!force && !cur.stale && (cur.status === 'ready' || cur.status === 'loading')) return
    const g = wellnessGen
    const n = ++wellnessSeq
    if (cur.status !== 'ready') set({ status: 'loading' })
    const settings = await useNutrition.getState().loadSettings({ force })
    if (g !== wellnessGen || n !== wellnessSeq) return
    if (!settings) {
      set(s => ({ status: s.status === 'ready' ? 'ready' : 'error', error: useNutrition.getState().settings.error }))
      return
    }
    const on = connected(settings)
    if (!on.fitbit && !on.garmin) {
      set({ status: 'ready', error: null, byDate: {}, unavailable: false, stale: false })
      return
    }
    const to = isoOf(new Date())
    const from = isoOf(new Date(Date.now() - (FETCH_DAYS - 1) * 86400000))
    const asked = [
      on.fitbit ? NtApi.getWellness('fitbit', from, to) : Promise.resolve(null),
      on.garmin ? NtApi.getWellness('garmin', from, to) : Promise.resolve(null),
    ]
    const [fitbit, garmin] = await Promise.allSettled(asked)
    if (g !== wellnessGen || n !== wellnessSeq) return
    const failed = [fitbit, garmin].filter(r => r.status === 'rejected')
    if (failed.length === 2 || (failed.length === 1 && !(on.fitbit && on.garmin))) {
      if (failed.every(r => notOpen(r.reason))) {
        set({ status: 'ready', error: null, byDate: {}, unavailable: true, stale: false })
      } else {
        set(s => ({ status: s.status === 'ready' ? 'ready' : 'error', error: failed[0].reason }))
      }
      return
    }
    set({
      status: 'ready',
      error: null,
      unavailable: false,
      stale: false,
      byDate: mergeSources(fitbit.status === 'fulfilled' ? fitbit.value : null, garmin.status === 'fulfilled' ? garmin.value : null),
    })
  },
}))

// A diary write (a day logged on Home, a food removed) changes what Trends adds up: the days are
// marked stale, and the next look asks again.
useNutrition.subscribe((s, prev) => {
  if (s.days !== prev.days) useTrends.setState({ stale: true })
})

// Another account signing in on this device never sees the last one's diary or wearable.
const who = s => (s.user ? String(s.user.id ?? s.user.name ?? '') : '')
if (typeof useStore.subscribe === 'function') {
  useStore.subscribe((s, prev) => {
    if (who(s) !== who(prev)) {
      useTrends.getState().reset()
      useWellness.getState().reset()
    }
  })
}
