import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import { useThreadAnchor } from '../../lib/onboarding/use-thread-anchor.js'
import { todayISO } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import { completeOnboarding } from '../../lib/onboarding/api.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { detourOf, planOwed } from '../../lib/onboarding/flow.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'

// PLACEHOLDER for the Summary (ux-onboarding §3b screen 6, motion-onboarding-summary-v2.md). The
// Summary and its hand-over to Home are built later, on top of the redesigned Home; until then
// this step only finishes: every answer saved, the onboarding completed on the hub (both apps
// written through its outbox), then Home. Missing body answers can still be added first, by the
// skip map's detour ("Add my details" → only the missing steps → back here). It keeps a plain
// floor so the thread has a line to land on, as every onboarding screen does.
//
// What the hub says each app did with its write is said as it is: still on its way only where it
// is being tried again (openGym down or busy), and a write refused for good, or a plan openGym
// could not set up, stays on screen with where to put it right.
//
// Nothing completes without the plan the days call for: an AI coach plan (and the consent in it)
// does not survive a reload, so with training days and no plan chosen here or stored on the hub,
// the Plan step is asked again rather than finishing without it.

// The hub's steps in their order: a step's answer can depend on the one before (a plan on the
// training days), so failed saves go again one at a time, in this order.
const HUB_STEPS = ['goal', 'body', 'training', 'plan']
// openGym's write is still queued and tried again: it lands without anything more from the person.
const ON_ITS_WAY = ['pending', 'retrying']

/** What did not go in and needs the person, from the hub's answer to completing; null: nothing. */
function setbacksOf(done) {
  const setbacks = {
    plan: done?.plan?.status === 'refused',
    training: done?.delivery?.opengym === 'failed',
    food: done?.delivery?.nutritrace === 'failed',
  }
  return setbacks.plan || setbacks.training || setbacks.food ? setbacks : null
}

export default function FinishScreen() {
  const navigate = useNavigate()
  const { state, hub, act, saveHubStep, savesSettled, go, refresh, discard, current, hubCall, busy } = useOnboarding()
  const [status, setStatus] = useState('idle') // idle | saving | error | busy (the hub asked to wait)
  const [setbacks, setSetbacks] = useState(null)
  const floor = useRef(null)
  useThreadAnchor(floor, 'line')
  const missing = detourOf(state.answers)

  const leave = to => {
    discard()
    navigate(to, { replace: true })
  }

  // `again`: the second go, after the hub refused a plan and nothing was left to pick instead.
  const finish = async (again = false) => {
    setStatus('saving')
    const owner = current().uid
    // The person who tapped is no longer the one signed in: what follows is not theirs to finish.
    const someoneElse = () => current().uid !== owner
    const fail = () => setStatus(busy() ? 'busy' : 'error')
    // A save still on its way (a tap just before this one) lands first.
    await savesSettled()
    // No plan chosen for the days given, here or on the hub: asked again, never dropped.
    if (planOwed(current().answers, current().server)) {
      setStatus('idle')
      go('plan')
      return
    }
    // Nothing completes with an answer the hub has not taken: those are sent again first.
    for (const step of HUB_STEPS.filter(s => current().unsaved.includes(s))) {
      if (!(await saveHubStep(step))) {
        if (someoneElse()) setStatus('idle')
        else fail()
        return
      }
    }
    let done = null
    try {
      done = await hubCall(() => completeOnboarding(todayISO(), owner))
    } catch (e) {
      if (e.code === 'wrong-user') { setStatus('idle'); return }
      if (e.code === 'plan-unavailable') {
        // The plan chosen is one this server cannot take (any more), or no longer fits the days:
        // the hub cleared it. With another plan to offer, the Plan step is asked again; with none,
        // it would be a screen of one card, so "no plan" is the answer and this finishes.
        act({ type: 'plan', plan: null })
        // Without the hub's answer there is no knowing what it offers now: try again, from here.
        if (!(await refresh())) { fail(); return }
        const now = current()
        const offered = !!now.answers.trainingDays && (now.starterAvailable === true || (now.coachAvailable === true && !!now.coachConsent))
        if (!offered && !again) {
          act({ type: 'plan', plan: { kind: 'none' } })
          saveHubStep('plan')
          return finish(true)
        }
        useUI.getState().toast(t('That plan can’t be set up on this server right now. Pick another.'))
        setStatus('idle')
        go('plan')
        return
      }
      if (e.code !== 'complete') { fail(); return }
    }
    // openGym took its write: what it now holds (the plan, the weigh-in, the settings) is read
    // into the app now, so Home shows it. One still on its way comes with the app's next check.
    if (done?.delivery?.opengym === 'done') useStore.getState().pullState()
    const found = setbacksOf(done)
    if (found) {
      setSetbacks(found)
      setStatus('idle')
      return
    }
    if (ON_ITS_WAY.includes(done?.delivery?.opengym)) useUI.getState().toast(t('Saved. Some of it is still on its way to Training and will show up there soon.'))
    leave('/home')
  }
  const details = () => {
    act({ type: 'detour', steps: missing })
    go(missing[0])
  }
  const art = <svg className="ob-fin-art" viewBox="0 0 320 16" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path ref={floor} d="M16 8 H304" />
  </svg>

  if (setbacks) {
    const lines = [
      setbacks.plan && t('Your plan couldn’t be set up. Pick one in Training.'),
      setbacks.training && t('Training didn’t take your answers. Add your weight and a plan there.'),
      setbacks.food && t('Food didn’t take your targets. Set them in Food goals.'),
    ].filter(Boolean)
    const toTraining = setbacks.plan || setbacks.training
    return (
      <StepScreen key="setbacks" titleId="ob-finish-t" title={t('Not everything could be set up')} sub={lines.join(' ')} stage={art}
        footer={<>
          {toTraining && <Button variant="primary" onClick={() => leave('/train')}>{t('Open Training')}</Button>}
          {setbacks.food && <Button variant={toTraining ? 'tinted' : 'primary'} onClick={() => leave('/food/goals')}>{t('Open Food goals')}</Button>}
          <Button variant="plain" onClick={() => leave('/home')}>{t('Go to Home')}</Button>
        </>} />
    )
  }
  const failed = status === 'error' || status === 'busy'
  // The hub's answer on this tab is still on its way (a reload): whether a plan is stored there
  // is not known yet, so nothing is finished before it is.
  const reading = hub === 'loading'
  return (
    <StepScreen titleId="ob-finish-t"
      title={failed ? t('Your answers could not be saved yet') : t('That’s everything for now')}
      sub={status === 'busy' ? t('Gains is busy right now. Try again in a moment. Nothing you answered is lost.')
        : failed ? t('Check your connection and try again. Nothing you answered is lost.') : t('Your answers set up your Home.')}
      stage={art}
      footer={<>
        <Button variant="primary" disabled={status === 'saving' || reading} aria-busy={status === 'saving' || undefined} onClick={() => finish()}>
          {failed ? t('Try again') : t('Go to Home')}
        </Button>
        {failed && <Button variant="plain" onClick={() => navigate('/home', { replace: true })}>{t('Finish later')}</Button>}
        {!failed && missing.length > 0 && <Button variant="tinted" onClick={details}>{t('Add my details')}</Button>}
      </>} />
  )
}
