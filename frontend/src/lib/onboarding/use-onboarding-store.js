import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { answersFromHub, loadOnboarding, saveStep, waitSeconds } from './api.js'
import { nextAfter, pathOf, previousOf, screenOf, skipTarget } from './flow.js'
import { forget } from './session.js'
import { initialState, loadSaved, reduce, save } from './state.js'
import { nutritionAvailable } from '../nutrition/api.js'

// The only answers that say there is no onboarding to be had here: not signed in to the hub, not
// allowed, no hub at this address, gone. Anything else that fails to read says nothing about
// whether there is a hub: no answer, a server error, an answer that is not the hub's JSON, a
// rate limit (429), a refused request. The person stays in the flow with what they answered, and
// can try again.
const NOT_THEIRS = [401, 403, 404, 410]
const hubDown = e => !NOT_THEIRS.includes(e.status)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * The onboarding's state and actions, for OnboardingLayout to provide. `hub` says what the server
 * side can do: 'pre-auth' (no account yet), 'loading', 'ready', 'offline' (the hub did not answer,
 * or not as itself: answers are kept and sent again, and the layout offers to read it again),
 * 'busy' (it answered 429: the same, and nothing is sent before its Retry-After has passed),
 * 'unavailable' (no hub to save to: the flow steps aside) or 'complete'.
 *
 * The hub's answer at each load fills in what this tab does not know: its answers, what the
 * person's data answers (those steps are skipped, flow.js answeredByData), where to resume, and
 * which plans this server takes. A plan is offered only where the hub says so: never from this
 * app's own config, which cannot say whether openGym's seed takes it.
 *
 * The state is the signed-in person's (state.js `uid`): another person's is never read, and it
 * goes whenever the flow is left (`discard`) or who is signed in changes.
 */
export function useOnboardingStore({ user, navigate, location, navType }) {
  const uid = user?.id ?? null
  const [state, dispatch] = useReducer(reduce, undefined, () => loadSaved(uid) || { ...initialState(), uid })
  // The state as of the last action, for an action that saves right after it changes something.
  const now = useRef(state)
  const act = useCallback(action => {
    now.current = reduce(now.current, action)
    dispatch(action)
  }, [])
  // Kept only while it is the signed-in person's: for the render between a sign-out and the state
  // starting over, the old person's is not written down again.
  useEffect(() => { if (state.uid === uid) save(state) }, [state, uid])

  // A save still waiting its turn when the person changes belongs to the one before.
  const people = useRef(0)
  const signedInAs = useRef(uid)
  useEffect(() => {
    if (signedInAs.current !== uid) { signedInAs.current = uid; people.current++ }
    act({ type: 'user', uid })
  }, [uid, act])

  /** Leaves the flow: nothing of it stays, in this tab's storage or on screen. */
  const discard = useCallback(() => {
    forget()
    act({ type: 'reset' })
  }, [act])

  const [hub, setHub] = useState(user ? 'loading' : 'pre-auth')
  // The latest read: an answer to an earlier one (another person's, or the layout gone) is dropped.
  const reads = useRef(0)

  // When the hub said it is busy, the time before which nothing more is sent to it.
  const busyUntil = useRef(0)
  /** Whether the hub's last answer was "busy" and its Retry-After has not passed. */
  const busy = useCallback(() => Date.now() < busyUntil.current, [])
  /** Runs one hub request, after any Retry-After the hub has asked for; a 429 starts the next wait. */
  const hubCall = useCallback(async request => {
    const wait = busyUntil.current - Date.now()
    if (wait > 0) await sleep(wait)
    try {
      return await request()
    } catch (e) {
      if (e.status === 429) busyUntil.current = Date.now() + waitSeconds(e) * 1000
      throw e
    }
  }, [])

  /** Reads the hub's state again into this tab's. Resolves true once it is in, false if the read failed. */
  const refresh = useCallback(async () => {
    const read = ++reads.current
    try {
      const res = await hubCall(loadOnboarding)
      if (read !== reads.current) return false
      if (res.completedAt != null) { discard(); setHub('complete'); return true }
      act({
        type: 'hub', answers: answersFromHub(res.answers), prefill: res.prefill, next: res.next, remaining: res.remaining,
        coachAvailable: res.coachAvailable, starterAvailable: res.starterAvailable, coachConsent: res.coachConsent,
      })
      setHub('ready')
      return true
    } catch (e) {
      if (read === reads.current) {
        if (e.status === 429) setHub('busy')
        else if (hubDown(e)) setHub('offline')
        else { discard(); setHub('unavailable') }
      }
      return false
    }
  }, [act, discard, hubCall])

  useEffect(() => {
    if (!uid) { setHub('pre-auth'); return undefined }
    if (!nutritionAvailable(user)) { discard(); setHub('unavailable'); return undefined }
    setHub('loading')
    refresh()
    return () => { reads.current++ }
    // Keyed on the person, not the object: a refreshed user is the same onboarding.
  }, [uid])

  // The hub's saves go one at a time, in the order asked, so an older answer can never land after
  // a newer one (a plan before the training it fits, or arrow keys run through the cards). A step
  // asked again while its save is still waiting to go is not sent twice: that save reads the
  // answers when it goes, so it carries the latest and the last answer wins. With nothing on its
  // way, a save goes at once.
  const tail = useRef(null)
  const waiting = useRef(new Map())

  /**
   * Saves one hub step from the latest answers; a failure marks it to be sent again. The request
   * names the person its answers belong to, read together with them: when someone else has signed
   * in by the time it arrives the hub refuses it (`wrong-user`) and it is dropped, for it is not
   * this person's to send again or to mark unsaved.
   */
  const saveHubStep = useCallback(step => {
    const queued = waiting.current.get(step)
    if (queued) return queued
    const person = people.current
    const send = async () => {
      waiting.current.delete(step)
      // Asked for one person, due after another signed in: the answers now are not the ones it was for.
      if (person !== people.current) return false
      try {
        await hubCall(() => saveStep(step, now.current.answers, now.current.uid))
        act({ type: 'saved', step, ok: true })
        return true
      } catch (e) {
        if (e.code !== 'wrong-user') act({ type: 'saved', step, ok: false })
        return false
      }
    }
    const before = tail.current
    const run = before ? before.then(send) : send()
    if (before) waiting.current.set(step, run)
    tail.current = run
    run.then(() => { if (tail.current === run) tail.current = null })
    return run
  }, [act, hubCall])

  /** Resolves once every save asked for so far has had its answer. */
  const savesSettled = useCallback(() => tail.current ?? Promise.resolve(true), [])

  // The flow's own history, mirrored from the router's, so Back walks it where it can and a cold
  // entry (a reload, a link) goes to the step before instead of out of the app.
  const stack = useRef([])
  const screen = screenOf(location.pathname)
  // Once per history entry (location.key), whatever the screen.
  useEffect(() => {
    if (!screen) return
    const s = stack.current
    if (navType === 'POP') {
      const at = s.lastIndexOf(screen)
      stack.current = at >= 0 ? s.slice(0, at + 1) : [screen]
    } else if (navType === 'REPLACE' && s.length) {
      stack.current = [...s.slice(0, -1), screen]
    } else if (s[s.length - 1] !== screen) {
      stack.current = [...s, screen]
    }
  }, [location.key])

  const go = useCallback((to, { replace = false } = {}) => {
    navigate(pathOf(to, now.current.code), { replace })
  }, [navigate])

  const back = useCallback(() => {
    if (stack.current.length > 1) { navigate(-1); return }
    const prev = previousOf(screen, now.current)
    if (prev) navigate(pathOf(prev, now.current.code), { replace: true, state: { back: true } })
  }, [navigate, screen])

  /** On to the screen after `from`, by the skip map. */
  const next = useCallback(from => go(nextAfter(from, now.current)), [go])

  const skip = useCallback(from => {
    const to = skipTarget(from, now.current)
    if (from === 'training') {
      act({ type: 'skipTraining' })
      saveHubStep('training')
    } else if (from === 'plan') {
      act({ type: 'plan', plan: { kind: 'none' } })
      saveHubStep('plan')
    } else {
      // About you: what was answered stays, and is saved; with nothing answered the hub takes the
      // step as skipped (api.js stepAnswers), so it does not ask it again either.
      saveHubStep('body')
      act({ type: 'skipYou' })
    }
    if (to) go(to)
  }, [act, go, saveHubStep])

  // The AI coach only with the consent text the hub sent: nobody agrees to a text not shown.
  const coachAvailable = state.coachAvailable === true && state.coachConsent != null
  const starterAvailable = state.starterAvailable === true

  return useMemo(() => ({
    state, hub, screen, coachAvailable, starterAvailable,
    act, saveHubStep, savesSettled, go, back, next, skip, refresh, discard, hubCall, busy,
    current: () => now.current,
  }), [state, hub, screen, coachAvailable, starterAvailable, act, saveHubStep, savesSettled, go, back, next, skip, refresh, discard, hubCall, busy])
}
