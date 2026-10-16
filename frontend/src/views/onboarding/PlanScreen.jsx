import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import ChoiceCards from '../../components/onboarding/ChoiceCards.jsx'
import CoachSheet from '../../components/onboarding/CoachSheet.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import PlanScene from '../../components/onboarding/scenes/PlanScene.jsx'
import { t, tn } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { pathOf } from '../../lib/onboarding/flow.js'
import { useLater } from '../../lib/onboarding/use-later.js'
import { useUI } from '../../store/useUI.js'

// 5 Plan (§3b): "Want a plan to follow?", three equal cards and nothing pre-selected. A ready-made
// plan opens its preview; the AI coach opens its sheet; no plan goes to the end. Each plan only
// where the hub says this server takes it, so nobody chooses a plan openGym would refuse. Skip in
// the nav is "no plan". Only asked for one training day or more, and not of a profile that already
// has routines (the flow skips this step then). The coach's consent is to the hub's text, by its
// id: its time is the hub's.
const SAY = () => ({
  starter: t('A ready-made plan, one row per training day'),
  coach: t('Your AI coach drafts the plan for you to review'),
  none: t('No plan for now. Add one any time'),
})

export default function PlanScreen() {
  const { state, act, saveHubStep, go, coachAvailable, starterAvailable } = useOnboarding()
  const days = state.answers.trainingDays
  const [preview, setPreview] = useState(null)
  const later = useLater()
  if (!days) return <Navigate to={pathOf('training')} replace />

  const consent = state.coachConsent
  const coach = () => useUI.getState().openSheet(close => (
    <CoachSheet consent={consent} days={days} experience={state.starter?.experience ?? null} equipment={state.starter?.equipment ?? 'gym'}
      onDismiss={() => act({ type: 'pick', pick: state.answers.plan && state.answers.plan.kind !== 'coach' ? state.answers.plan.kind : null })}
      onBuild={({ experience, equipment }) => {
        act({ type: 'plan', plan: { kind: 'coach', experience, equipment, consentVersion: consent.version } })
        saveHubStep('plan')
        close()
        go('finish')
      }}
      close={close} />
  ))
  const pick = (v, { viaKey }) => {
    act({ type: 'pick', pick: v })
    if (v === 'none') {
      act({ type: 'plan', plan: { kind: 'none' } })
      saveHubStep('plan')
    }
    if (viaKey) return
    if (v === 'starter') later(() => go('starter'), 560)
    else if (v === 'coach') later(coach, 640)
    else later(() => go('finish'), 620)
  }
  const options = [
    ...(starterAvailable ? [{ value: 'starter', icon: 'listChecks', title: t('Use a ready-made plan'),
      sub: tn('A starter plan for {0} day a week. You see it before you start.', 'A starter plan for {0} days a week. You see it before you start.', days) }] : []),
    ...(coachAvailable ? [{ value: 'coach', icon: 'messagesSquare', title: t('Have the AI coach build one'), sub: t('An AI model drafts a plan from your answers. You review it first.') }] : []),
    { value: 'none', icon: 'calendarClock', title: t('No plan for now'), sub: t('Log workouts as you go. Add a plan any time.') },
  ]
  return (
    <StepScreen titleId="ob-plan-t" title={t('Want a plan to follow?')} sub={t('Pick what suits you. Nothing is set until you choose.')}
      stage={<PlanScene state={preview ?? state.pick} days={days} />}
      caption={state.pick ? SAY()[state.pick] : ''}>
      <ChoiceCards labelledBy="ob-plan-t" options={options} value={state.pick} onPick={pick}
        onPreview={v => setPreview(v === state.pick ? null : v)} />
    </StepScreen>
  )
}
