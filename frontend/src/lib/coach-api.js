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
import { t, tn, getLang } from './i18n.js'
import { useStore } from '../store/useStore.js'
import { todayForCoach } from './coach-context.js'
import { shareOf } from '../../../api/coach/core/categories.js'
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
// Each request says which language the app is in: a profile that never picked one has no stored
// `lang` worth trusting — it is worked out per device (#303, lib/default-lang.js) — and the
// Coach should answer in what the person is reading.

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
      // An automatic review speaks only when it has something to suggest, like the server's
      // (api/coach/cadence.js): a skip, a failure or "nothing to change" nobody asked for is noise.
      if (ev.scheduled) { if (ev.kind === 'ready') announceProposal(ev.pending); return }
      if (ev.kind === 'failed') toast(jobErrorText(ev.errorClass, ev.detail))
      else if (ev.kind === 'nochange') toast(t('Nothing to change right now: {0}', String(ev.reading || '').slice(0, 140)))
    })
  }
  return localMod
}

// The job this app last started and has not written a reply for yet. A run that fails before
// the first status poll — a provider refusing the connection answers in milliseconds — is never
// seen running, so "running, then gone" cannot be the only way the chat learns a run ended: it
// also compares the server's last outcome with the id the start request returned. Kept here,
// at module level, because the plan the intake asks for is started on another screen.
let awaited = null
const track = r => {
  if (r?.job?.id) awaited = r.job.id
  return r
}
export const awaitedJob = () => awaited
export const settleAwaited = id => { if (!id || awaited === id) awaited = null }

/* The one question before anything leaves for an AI provider (Apple 5.1.2(i), and plain manners).
   Asked here, at the single door every job goes through, so no screen can start one around it:
   the provider and host come from the same disclosure the intake shows, and a yes is kept per
   provider and host on this device (lib/coach-consent.js). The demo answers locally and a model
   on your own network is not a third party, so neither asks. "Not now" rejects with code
   'declined' and `quiet`, which the screens let pass without a toast: you said no, you know. */
export const coachVia = () => (DEMO ? 'demo' : LOCAL() ? 'device' : 'server')
export const isDeclined = e => e?.code === 'declined'
export async function ensureAiConsent() {
  if (DEMO) return true
  const { consentTarget, hasAiConsent, allowAi } = await import('./coach-consent.js')
  const target = consentTarget(await disclosure(), coachVia())
  if (!target || target.local || await hasAiConsent(target)) return true
  const { askAiConsent } = await import('../components/CoachConsentSheet.jsx')
  if (await askAiConsent(target)) { await allowAi(target); return true }
  throw Object.assign(new Error(t('Okay, nothing was sent.')), { code: 'declined', quiet: true, data: { code: 'declined' } })
}
const asked = fn => async (...a) => { await ensureAiConsent(); return fn(...a) }

export const coachStatus = async () => DEMO ? (await demo()).demoStatus() : LOCAL() ? (await local()).localStatus() : api('/api/coach/status')
// The phone's vitals (sleep, heart rate, HRV, steps) go along only when the person shares health
// with the Coach (Coach menu, What the Coach sees); they never sync, so the request carries them.
async function vitalsForCoach(st) {
  if (!MOBILE || !shareOf(st).health) return null
  try {
    const [{ loadHealth }, { vitalsSummary }] = await Promise.all([import('./health-sync.js'), import('./vitals.js')])
    const h = await loadHealth()
    return h?.vitals ? vitalsSummary(h.vitals) : null
  } catch { return null }
}
const _requestReview = async note => DEMO ? (await demo()).demoReview(S()) : LOCAL() ? (await local()).localReview(S(), note, await vitalsForCoach(S())) : api('/api/coach/review', { method: 'POST', body: JSON.stringify({ note: note || '', lang: getLang(), vitals: await vitalsForCoach(S()) }) })
export const requestReview = (...a) => asked(_requestReview)(...a).then(track)
const _requestPlan = async intake => DEMO ? (await demo()).demoPlan(S(), intake) : LOCAL() ? (await local()).localPlan(S(), intake) : api('/api/coach/plan', { method: 'POST', body: JSON.stringify({ intake, lang: getLang() }) })
export const requestPlan = (...a) => asked(_requestPlan)(...a).then(track)
const _refinePlan = async text => DEMO ? (await demo()).demoRefine(S()) : LOCAL() ? (await local()).localRefine(S(), text) : api('/api/coach/plan', { method: 'POST', body: JSON.stringify({ refine: text, lang: getLang() }) })
export const refinePlan = (...a) => asked(_refinePlan)(...a).then(track)
const _requestDebrief = async workoutId => DEMO ? (await demo()).demoDebrief(S(), workoutId) : LOCAL() ? (await local()).localDebrief(S(), workoutId) : api('/api/coach/debrief', { method: 'POST', body: JSON.stringify({ workoutId: workoutId || null, lang: getLang() }) })
export const requestDebrief = (...a) => asked(_requestDebrief)(...a).then(track)
// A question in the chat, answered in words (the `ask` job). The session running here goes along
// (lib/coach-context.js): the server never holds it.
// Routines from the library that match the question (lib/routine-library.js), so the Coach can
// offer one to import. Lazy: the library carries the exercise catalogue.
async function routinesForCoach(st, text) {
  try { return await (await import('./routine-library.js')).routineHits(st, text) } catch { return [] }
}
const _askCoach = async text => {
  if (DEMO) return (await demo()).demoAsk(S(), text)
  const st = S()
  const [vitals, routines] = await Promise.all([vitalsForCoach(st), routinesForCoach(st, text)])
  return LOCAL() ? (await local()).localAsk(st, text, todayForCoach(st), vitals, routines)
    : api('/api/coach/ask', { method: 'POST', body: JSON.stringify({ text, today: todayForCoach(st), lang: getLang(), vitals, routines }) })
}
export const askCoach = (...a) => asked(_askCoach)(...a).then(track)
// "Ask the Coach" on an exercise mid-workout (the `adapt` job): `entry` is its index in the running
// session, `reason` one of pain/busy/short/great/tired/other, `text` optional. The session goes
// along (lib/coach-context.js) with its id, so the answer can be matched to this workout.
const _requestAdapt = async ({ entry, reason, text } = {}) => {
  const st = S()
  const today = todayForCoach(st)
  if (!today) throw Object.assign(new Error(t('There’s no workout running.')), { code: 'invalid' })
  const body = { today, entry, reason: reason || 'other', text: String(text || '').trim(), activeId: st.active?.id || null }
  return DEMO ? (await demo()).demoAdapt(st, body) : LOCAL() ? (await local()).localAdapt(st, body) : api('/api/coach/adapt', { method: 'POST', body: JSON.stringify({ ...body, lang: getLang() }) })
}
export const requestAdapt = (...a) => asked(_requestAdapt)(...a).then(track)
// An automatic review, if one is due (lib/coach-schedule.js asks while the app is open). Only a
// phone with its own key runs them here; a server runs its own on its tick. The data-sharing
// question was asked when they were switched on, and nobody is there to ask it now: a "yes"
// withdrawn since (Coach menu, AI data sharing) means no run, not a dialog out of nowhere.
export async function scheduledReview() {
  if (DEMO || !LOCAL()) return null
  const { consentTarget, hasAiConsent } = await import('./coach-consent.js')
  const target = consentTarget(await disclosure(), 'device')
  if (target && !target.local && !await hasAiConsent(target)) return null
  return (await local()).localScheduled(S())
}
// A phone paired with a server leaves the reviews to the server's tick, and the server tells
// people about a proposal by web push, which the phone app does not have. So the phone asks once
// when it comes to the foreground, and says it once per proposal.
const ANNOUNCED_KEY = 'gym_coach_announced'
export async function scheduledNotice() {
  if (DEMO || LOCAL() || !MOBILE) return null
  const p = (await api('/api/coach/status'))?.pending
  if (!p || p.trigger !== 'scheduled') return null
  try { if (localStorage.getItem(ANNOUNCED_KEY) === p.id) return null; localStorage.setItem(ANNOUNCED_KEY, p.id) } catch { /* said again next time, at worst */ }
  await announceProposal(p)
  return p
}
// "The Coach has something for you", for a proposal nobody is looking at yet: a toast while the
// app is on screen, a notification when it went to the background meanwhile (a review takes a
// minute or two). Never a permission prompt: notifications were allowed in Settings, or not.
// Not 3100: that is the "Still training?" notification (lib/forgotten-phone.js), which cancels its id.
const PROPOSAL_NOTIFICATION_ID = 3200
async function announceProposal(pending) {
  const n = (pending?.changes || []).length
  if (!n) return
  const body = tn('{0} suggestion', '{0} suggestions', n)
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
    useUI.getState().toast(t('Coach') + ': ' + body)
    return
  }
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return
    const { withoutAlarmPrompt } = await import('./exact-alarm.js')
    await LocalNotifications.schedule({ notifications: await withoutAlarmPrompt(LocalNotifications, [{ id: PROPOSAL_NOTIFICATION_ID, title: t('Coach'), body, schedule: { at: new Date(Date.now() + 1000) } }]) })
  } catch { /* no notification plugin: the proposal still waits in the Coach tab */ }
}

// The room: anonymous medians across the profiles on this instance that opted in. Only a
// server has a room; a phone with its own key and the demo both answer locally.
export const cohortStats = async () => DEMO ? (await demo()).demoCohort(S()) : LOCAL() ? { ok: false, enabled: false } : api('/api/coach/cohort')
export const setCohortShare = async share => (DEMO || LOCAL()) ? { ok: true, sharing: !!share } : api('/api/coach/cohort/share', { method: 'POST', body: JSON.stringify({ share: !!share }) })
export const resolvePending = async body => DEMO ? (await demo()).demoResolve() : LOCAL() ? (await local()).localResolve(body) : api('/api/coach/pending/resolve', { method: 'POST', body: JSON.stringify(body) })
export const forgetCoach = async () => DEMO ? (await demo()).demoResolve() : LOCAL() ? (await local()).localForget() : api('/api/coach/forget', { method: 'POST', body: '{}' })
export const disclosure = async () => DEMO ? (await demo()).demoDisclosure() : LOCAL() ? (await local()).localDisclosure() : api('/api/coach/disclosure')

/**
 * Live job/proposal state.
 *
 * `active` lets a caller (the Home card) subscribe only while it is mounted and visible;
 * everything else keeps the poll off. Errors are swallowed on purpose — a Coach status call
 * failing while you are mid-workout is not something to interrupt anyone about.
 *
 * It is also how a screen keeps from asking a server that has no Coach: the chat passes what
 * lib/use-coach-gate.js knows. Opened straight on #/coach (a reload, a bookmark) on such a
 * server, it used to ask once before it left for Home, and the browser logged the 503 (401 for a
 * guest) as an error. The server's answers are what they were; the app just knows not to ask.
 */
export function useCoachStatus(active = true) {
  const [state, setState] = useState({ job: null, pending: null, cap: null, loading: true })
  const timer = useRef(null)
  const loop = useRef(null)   // the running poll loop's `tick`, so a manual refresh can re-pace it
  const seq = useRef(0)       // which status request is the newest one

  const refresh = useCallback(async () => {
    const mine = ++seq.current
    try {
      const s = await coachStatus()
      // An answer that arrives after a newer request was sent is older than what that request
      // will bring: the idle poll in flight when a run is started must not land after the
      // refresh that follows the start, putting back the run count and last outcome from before.
      if (mine !== seq.current) return s
      setState({ ...s, loading: false })
      // A refresh that finds a job in flight — the one the caller just started — must not leave
      // the loop asleep on its idle cadence: without this the card shows up to a minute after
      // the job ended, sitting on "thinking…" the whole time.
      if (s?.job && loop.current) { clearTimeout(timer.current); timer.current = setTimeout(loop.current, POLL_MS) }
      return s
    } catch (e) {
      if (mine === seq.current) setState(s => ({ ...s, loading: false }))
      // The server says its Coach is off (503, code off) while this app still holds a config
      // that says it is on: an admin switched it off since. Asking the config again turns the
      // Coach screens off (lib/use-coach-gate.js) and with them this poll, which would otherwise
      // collect the same refusal once a minute.
      if (e?.status === 503 && e?.data?.code === 'off' && useStore.getState().config?.coach?.enabled) {
        Promise.resolve(useStore.getState().refreshConfig?.()).catch(() => {})
      }
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
//
// Each line is a getter, so it is translated when it is read, not when this module loads: the
// module loads once, in English, before any locale pack has arrived, and a language picked later
// would otherwise never reach these lines. The lookup is still JOB_ERRORS[cls].
export const JOB_ERRORS = {
  get off() { return t('The Coach isn’t set up on this instance.') },
  get busy() { return t('The Coach is already thinking about your training.') },
  get cap() { return t('The Coach is taking a rest day. Try again tomorrow.') },
  get consent() { return t('The Coach needs your go-ahead first.') },
  get timeout() { return t('The Coach took too long and gave up.') },
  get auth() { return t('The Coach couldn’t sign in to its provider. The instance owner needs to check its setup.') },
  get missing() { return t('The Coach isn’t installed properly on this instance.') },
  get provider() { return t('The Coach couldn’t run. The instance owner needs to check its setup.') },
  // The causes api/coach/core/failure.js sorts a provider failure into, each with its own fix.
  get quota() { return t('The Coach hit its AI provider’s limit. Try again later, or the instance owner needs to check the plan or key.') },
  get schema() { return t('The Coach’s AI provider rejected the request format. The instance owner needs to try another model.') },
  get outage() { return t('The Coach’s AI provider is having an outage. Try again in a little while.') },
  get unreachable() { return t('The Coach couldn’t reach its AI provider. The instance owner needs to check the endpoint and the network.') },
  get cutoff() { return t('The connection to the AI provider dropped while the Coach was thinking. Try again, ideally on Wi-Fi.') },
  get unusable() { return t('The Coach answered with something the app couldn’t use.') },
  get restart() { return t('The server restarted while the Coach was thinking.') },
  get nostate() { return t('The Coach couldn’t read your training data.') },
  get noworkout() { return t('There’s no workout to look at yet. Log one first.') },
  // The refusal at enqueue when the process cannot drop privileges (api/coach/jobs.js). The same
  // words as api/coach/routes.js USER_ERROR.unprivileged; what to fix goes to the admin card.
  get unprivileged() { return t('The Coach is switched off on this instance for safety reasons.') },
  get internal() { return t('Something went wrong on the server.') }
}

// The same failures on a phone that brought its own key: there is no instance owner to
// check anything, the person reading this is the operator, and the provider's own words
// are the only thing that lets them fix it (a spent quota, a wrong model, a rejected key).
export const BYOK_ERRORS = {
  get auth() { return t('Your AI provider rejected the key on this phone. Check it under Settings → AI Coach.') },
  get missing() { return t('The Coach isn’t set up on this phone. Check Settings → AI Coach.') },
  get provider() { return t('Your AI provider couldn’t answer.') },
  get cutoff() { return t('The connection to your AI provider dropped while the Coach was thinking. Try again, ideally on Wi-Fi.') },
  get unusable() { return t('The Coach answered with something the app couldn’t use.') },
  get internal() { return t('Something went wrong on this phone.') }
}

// The classes that mean the provider call itself failed, as opposed to the app or the server.
// A phone with its own key has one line for all of them ("Your AI provider couldn't answer.")
// and the provider's own words attached under it, which is the part its operator can act on.
const PROVIDER_CLASSES = new Set(['auth', 'quota', 'schema', 'outage', 'cutoff', 'unreachable', 'timeout', 'missing', 'provider'])

/** The line the person sees for a failed job — with the reason attached where they can act on it.
 *
 *  `serverText` is the API's own short line for a failure class this build has no translated line
 *  for. The server sorts a provider failure by cause now (quota, schema, outage, unreachable), and
 *  a class the app has never heard of used to fall back on "Something went wrong on the server.",
 *  which is both untrue and useless. The app's own line still wins wherever there is one, so a
 *  translated build keeps translating; the server's English is only the last resort.
 */
export function jobErrorText(cls, detail, serverText) {
  const own = LOCAL()
  // On a phone with its own key the instance-owner lines for the provider causes would point at
  // somebody who isn't there: the provider line plus the provider's own words says it better.
  const base = own
    ? (BYOK_ERRORS[cls] || (PROVIDER_CLASSES.has(cls) && !['timeout', 'missing'].includes(cls) ? BYOK_ERRORS.provider : JOB_ERRORS[cls]) || BYOK_ERRORS.internal)
    : (JOB_ERRORS[cls] || serverText || JOB_ERRORS.internal)
  const why = own && detail ? String(detail).trim().slice(0, 300) : ''
  return why ? `${base}\n${why}` : base
}
