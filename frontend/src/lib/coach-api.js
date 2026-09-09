// Talking to the Coach endpoints, and knowing when to stop.
//
// Jobs are minutes-scale, so the client polls. The one rule worth stating: polling only runs
// while a Coach surface is on screen or a job is known to be in flight. An app that pings the
// server every thirty seconds forever because a feature exists is an app that costs battery
// for a feature nobody is using.

import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from './api.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'
import { t } from './i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const POLL_MS = 3000        // a job is running: often enough to feel live
const IDLE_MS = 60000       // a Coach screen is open but nothing is running

// The demo build has no backend, so it answers these locally with a canned proposal built
// from its own seeded profile (lib/coach-demo.js). Everything downstream — validation,
// staleness, apply, revert, the log — runs unchanged; only the provider is faked. The module
// is imported dynamically so none of it lands in a self-hosted bundle.
let demoMod = null
const demo = async () => (demoMod = demoMod || await import('./coach-demo.js'))
const S = () => useStore.getState().S

// The mobile build's third answer: a phone that brought its own API key runs the Coach itself
// (lib/coach-local.js — the same core the server runs, imported lazily so the catalogue and the
// validator only ever load on a phone that chose this). A paired phone takes the api() branch
// like the web app does; nothing on the web or demo builds reaches this.
let localMod = null
const LOCAL = () => MOBILE && useStore.getState().coachLocal?.mode === 'byok'
const local = async () => {
  if (!localMod) {
    localMod = await import('./coach-local.js')
    // There is no admin card on a phone: the user is the operator, so failures go to them.
    localMod.setNotifier(ev => {
      const toast = useUI.getState().toast
      if (ev.kind === 'failed') toast(jobErrorText(ev.errorClass, ev.detail))
      else if (ev.kind === 'nochange') toast(t('Nothing to change right now: {0}', String(ev.reading || '').slice(0, 140)))
    })
  }
  return localMod
}

export const coachStatus = async () => DEMO ? (await demo()).demoStatus() : LOCAL() ? (await local()).localStatus() : api('/api/coach/status')
export const requestReview = async note => DEMO ? (await demo()).demoReview(S()) : LOCAL() ? (await local()).localReview(S(), note) : api('/api/coach/review', { method: 'POST', body: JSON.stringify({ note: note || '' }) })
export const requestPlan = async intake => DEMO ? (await demo()).demoPlan(S(), intake) : LOCAL() ? (await local()).localPlan(S(), intake) : api('/api/coach/plan', { method: 'POST', body: JSON.stringify({ intake }) })
export const refinePlan = async text => DEMO ? (await demo()).demoRefine(S()) : LOCAL() ? (await local()).localRefine(S(), text) : api('/api/coach/plan', { method: 'POST', body: JSON.stringify({ refine: text }) })
export const requestDebrief = async workoutId => DEMO ? (await demo()).demoDebrief(S(), workoutId) : LOCAL() ? (await local()).localDebrief(S(), workoutId) : api('/api/coach/debrief', { method: 'POST', body: JSON.stringify({ workoutId: workoutId || null }) })
// The room: anonymous medians across the profiles on this instance that opted in. Only a
// server has a room; a phone with its own key and the demo both answer locally.
export const cohortStats = async () => DEMO ? (await demo()).demoCohort(S()) : LOCAL() ? { ok: false, enabled: false } : api('/api/coach/cohort')
export const setCohortShare = async share => (DEMO || LOCAL()) ? { ok: true, sharing: !!share } : api('/api/coach/cohort/share', { method: 'POST', body: JSON.stringify({ share: !!share }) })
export const resolvePending = async body => DEMO ? (await demo()).demoResolve() : LOCAL() ? (await local()).localResolve(body) : api('/api/coach/pending/resolve', { method: 'POST', body: JSON.stringify(body) })
export const forgetCoach = async () => DEMO ? (await demo()).demoResolve() : LOCAL() ? (await local()).localForget() : api('/api/coach/forget', { method: 'POST', body: '{}' })
export const disclosure = async () => DEMO ? (await demo()).demoDisclosure() : LOCAL() ? (await local()).localDisclosure() : api('/api/coach/disclosure')

/* Whose provider account this profile is about to spend. Its own call because the constraint is
   that the Coach screen states it too, not just the admin card — and because in instance mode a
   second profile is refused outright, which is something the user has to be able to read before
   they ask for anything rather than after a job is turned down. */
export const coachAccount = async () =>
  DEMO ? { mode: 'instance', provider: 'demo', providerLabel: 'Demo', account: null, connected: true, reason: null, message: null }
    : LOCAL() ? { mode: 'device', provider: useStore.getState().coachLocal.provider, providerLabel: null, account: null, connected: true, reason: null, message: null }
      : api('/api/coach/account')

/* Admin-only. The token is write-only from the client's side: it goes up once and is never
   read back, so there is deliberately no "show me the current credential" call to pair with it. */
export const connectCredential = body => api('/api/admin/coach/connect', { method: 'POST', body: JSON.stringify(body) })
export const disconnectCredential = () => api('/api/admin/coach/disconnect', { method: 'POST', body: '{}' })

/**
 * Live job/proposal state.
 *
 * `active` lets a caller (the Home card) subscribe only while it is mounted and visible;
 * everything else keeps the poll off. Errors are swallowed on purpose — a Coach status call
 * failing while you are mid-workout is not something to interrupt anyone about.
 */
export function useCoachStatus(active = true) {
  const [state, setState] = useState({ job: null, pending: null, cap: null, loading: true })
  const timer = useRef(null)
  const loop = useRef(null)   // the running poll loop's `tick`, so a manual refresh can re-pace it

  const refresh = useCallback(async () => {
    try {
      const s = await coachStatus()
      setState({ ...s, loading: false })
      // A refresh that finds a job in flight — the one the caller just started — must not leave
      // the loop asleep on its idle cadence: without this the card shows up to a minute after
      // the job ended, sitting on "thinking…" the whole time.
      if (s?.job && loop.current) { clearTimeout(timer.current); timer.current = setTimeout(loop.current, POLL_MS) }
      return s
    } catch {
      setState(s => ({ ...s, loading: false }))
      return null
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let stopped = false
    const tick = async () => {
      const s = await refresh()
      if (stopped) return
      clearTimeout(timer.current)
      timer.current = setTimeout(tick, s?.job ? POLL_MS : IDLE_MS)
    }
    loop.current = tick
    tick()
    return () => { stopped = true; loop.current = null; clearTimeout(timer.current) }
  }, [active, refresh])

  return { ...state, refresh }
}

// Server failure classes, in the app's voice. The provider's own words go to the admin card;
// what a lifter needs is what it means for them and whether trying again will help.
export const JOB_ERRORS = {
  off: 'The Coach isn’t set up on this instance.',
  busy: 'The Coach is already thinking about your training.',
  cap: 'The Coach is resting — try again tomorrow.',
  consent: 'The Coach needs your go-ahead first.',
  timeout: 'The Coach took too long and gave up.',
  auth: 'The Coach couldn’t sign in to its provider — the instance owner needs to check its setup.',
  missing: 'The Coach isn’t installed properly on this instance.',
  provider: 'The Coach couldn’t run — the instance owner needs to check its setup.',
  unusable: 'The Coach answered with something the app couldn’t use.',
  restart: 'The server restarted while the Coach was thinking.',
  nostate: 'The Coach couldn’t read your training data.',
  noworkout: 'There is no workout to look at yet — log one first.',
  internal: 'Something went wrong on the server.'
}

// The same failures on a phone that brought its own key: there is no instance owner to
// check anything, the person reading this is the operator, and the provider's own words
// are the only thing that lets them fix it (a spent quota, a wrong model, a rejected key).
export const BYOK_ERRORS = {
  auth: 'Your AI provider rejected the key on this phone — check it under Settings → AI Coach.',
  missing: 'The Coach isn’t set up on this phone — check Settings → AI Coach.',
  provider: 'Your AI provider couldn’t answer.',
  unusable: 'The Coach answered with something the app couldn’t use.',
  internal: 'Something went wrong on this phone.'
}

/** The line the person sees for a failed job — with the reason attached where they can act on it. */
export function jobErrorText(cls, detail) {
  const own = LOCAL()
  const base = (own && BYOK_ERRORS[cls]) || JOB_ERRORS[cls] || (own ? BYOK_ERRORS.internal : JOB_ERRORS.internal)
  const why = own && detail ? String(detail).trim().slice(0, 300) : ''
  return why ? `${base}\n${why}` : base
}
