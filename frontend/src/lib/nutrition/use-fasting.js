import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { NtApi, nutritionAvailable } from './api.js'
import { useNutrition } from './store.js'
import { useStore } from '../../store/useStore.js'

// The person's fasts as the app shows them: the running one and the finished ones, read through
// the hub (api.js). NutriTrace is the source of truth; this holds what it last said, so Home's
// card, the + sheet and the Fasting page agree.
//
// A write that is retried after its answer was lost lands on the server's own guards (a second
// start is a 409, a second end a 400): both are read as "it already happened", the state is
// reloaded, and only a real failure reaches the caller as an NtError (api.js).
//
// `status` is 'idle' | 'loading' | 'ready' | 'error'.

const HISTORY_LIMIT = 60

const initial = () => ({ status: 'idle', active: null, history: [], error: null })

// Bumped when the account changes, so an answer for the account before never lands in the next.
let gen = 0

export const useFasting = create((set, get) => ({
  ...initial(),

  reset() {
    gen += 1
    set(initial())
  },

  async load({ force = false } = {}) {
    const cur = get()
    if (!force && (cur.status === 'ready' || cur.status === 'loading')) return
    const g = gen
    if (cur.status !== 'ready') set({ status: 'loading' })
    try {
      const [active, all] = await Promise.all([NtApi.getActiveFast(), NtApi.getFasts(HISTORY_LIMIT)])
      if (g !== gen) return
      set({ status: 'ready', error: null, active: active?.id ? active : null, history: (Array.isArray(all) ? all : []).filter(f => f.end_at) })
    } catch (e) {
      if (g === gen) set({ status: cur.status === 'ready' ? 'ready' : 'error', error: e })
    }
  },

  /** Starts a fast of `goalHours`, optionally back-dated to `startAt` (an ISO instant). Resolves to
   *  `{ fast, started }`: `started` is false when a fast was already running elsewhere (a 409); that
   *  fast is loaded and is the one returned, and it is not this call's to announce as started. */
  async start(goalHours, startAt) {
    const g = gen
    let fast
    try {
      fast = await NtApi.startFast(goalHours, startAt)
    } catch (e) {
      if (e?.status === 409) {
        await get().load({ force: true })
        if (get().active) return { fast: get().active, started: false }
      }
      throw e
    }
    if (g === gen) set({ status: 'ready', active: fast })
    // NutriTrace's widget remembers the last plan as the next one's default. Not worth failing for.
    useNutrition.getState().saveSetting('fastingDefaultHours', goalHours).catch(() => {})
    return { fast, started: true }
  },

  /** Ends the running fast. Resolves to the finished fast, or null when there was none (it was
   *  already ended elsewhere). */
  async end() {
    const g = gen
    const running = get().active
    if (!running) return null
    let fast
    try {
      fast = await NtApi.endFast(running.id)
    } catch (e) {
      if (e?.status === 400 || e?.status === 404) {
        await get().load({ force: true })
        if (!get().active) return null
      }
      throw e
    }
    if (g === gen) set(s => ({ active: null, history: [fast, ...s.history.filter(f => f.id !== fast.id)] }))
    return fast
  },

  /** Moves the running fast's start (the person forgot to start it on time). */
  async editStart(startAt) {
    const g = gen
    const running = get().active
    if (!running) return null
    const fast = await NtApi.editFastStart(running.id, startAt)
    // A fast ended elsewhere answers with its end: it is no longer the running one.
    if (g === gen) set(s => ({ active: fast.end_at ? null : fast, history: fast.end_at ? [fast, ...s.history.filter(f => f.id !== fast.id)] : s.history }))
    return fast
  },

  /** Takes a finished fast out of the history. */
  async remove(id) {
    const g = gen
    await NtApi.deleteFast(id)
    if (g === gen) set(s => ({ history: s.history.filter(f => f.id !== id) }))
  },
}))

/** Turns the fasting tracker on or off for the person (NutriTrace's `fastingEnabled` setting, so
 *  its own diary follows). Throws an NtError; the settings are re-read on success. */
export async function setFastingEnabled(on) {
  await NtApi.putSetting('fastingEnabled', on)
  await useNutrition.getState().loadSettings({ force: true })
}

/** Whether the fasting tracker is on: nutrition reachable and the setting on. False until the
 *  settings are read; Home's diary and the + sheet, which use this, load them already. */
export function useFastingOn() {
  const user = useStore(s => s.user)
  const on = useNutrition(s => s.settings.data?.fastingEnabled === true)
  return nutritionAvailable(user) && on
}

/** The clock, re-read every `ms` while `running`, for a fast's elapsed time. */
export function useNow(running = true, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [running, ms])
  return now
}

// Another account signing in on this device never sees the last one's fasts.
const who = s => (s.user ? String(s.user.id ?? s.user.name ?? '') : '')
if (typeof useStore.subscribe === 'function') {
  useStore.subscribe((s, prev) => {
    if (who(s) !== who(prev)) useFasting.getState().reset()
  })
}
