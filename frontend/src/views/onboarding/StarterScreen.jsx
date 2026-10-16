import { useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import FitSheet from '../../components/onboarding/FitSheet.jsx'
import StarterBaseline from '../../components/onboarding/StarterBaseline.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import { exerciseNameText } from '../../lib/format.js'
import { dateLocale, t, tn } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { pathOf } from '../../lib/onboarding/flow.js'
import { equipmentLabel, experienceLabel, weekdayName } from '../../lib/onboarding/labels.js'
import { WEEK, moveSession, starterSessions, templateFor } from '../../lib/onboarding/plans.js'
import { starterFor } from '../../lib/onboarding/state.js'
import { useUI } from '../../store/useUI.js'

// 5a Starter preview (§3b): the plan card, its sessions on movable weekdays (tap a session, then a
// free day), and "Fitted to: New to lifting · Full gym · Change". Use this plan → the end.
const LETTERS = 'ABCDEF'
const NAME = () => ({
  'full-body-2': t('Two-day full body'), 'full-body': t('Full body starter'), 'upper-lower': t('Upper / lower'),
  'upper-lower-ppl': t('Upper / lower, then push / pull / legs'), 'ppl-6': t('Push / pull / legs, twice'),
})

export default function StarterScreen() {
  const { state, act, saveHubStep, go } = useOnboarding()
  const days = state.answers.trainingDays
  const fresh = !state.starter || state.starter.templateId !== templateFor(days) || state.starter.weekdays.length !== days
  const plan = fresh ? starterFor(days, state.starter) : state.starter
  useEffect(() => { if (days && fresh) act({ type: 'starter', patch: starterFor(days, state.starter) }) }, [days, fresh, act, state.starter])
  const sessions = useMemo(() => starterSessions(days, plan.equipment), [days, plan.equipment])
  if (!days) return <Navigate to={pathOf('training')} replace />

  const locale = dateLocale()
  const sel = Math.min(plan.sel, sessions.length - 1)
  const tap = day => act({ type: 'starter', patch: moveSession(plan.weekdays, sel, day) })
  const fit = () => useUI.getState().openSheet(close => (
    <FitSheet experience={plan.experience} equipment={plan.equipment} close={close}
      onChange={patch => act({ type: 'starter', patch })} />
  ))
  const use = () => {
    act({ type: 'plan', plan: { kind: 'starter', templateId: plan.templateId, weekdays: plan.weekdays, equipment: plan.equipment, experience: plan.experience } })
    saveHubStep('plan')
    go('finish')
  }
  const name = days === 1 ? t('One-day full body') : NAME()[plan.templateId]
  const session = sessions[sel]
  return (
    <StepScreen titleId="ob-starter-t" title={t('Your starter plan')}
      sub={tn('Picked for {0} day a week. Move a session to another day if you like.', 'Picked for {0} days a week. Move a session to another day if you like.', days)}
      footer={<Button variant="primary" onClick={use}>{t('Use this plan')}</Button>}>
      <div className="ob-plan">
        <div className="ob-pl-name">{name}</div>
        <div className="ob-pl-meta">{tn('{0} day a week', '{0} days a week', days)}</div>
        <div className="ob-pl-days" role="group" aria-label={t('Training days')}>
          {WEEK.map(d => {
            const i = plan.weekdays.indexOf(d)
            const label = i >= 0
              ? t('{0}, session {1}, {2}', weekdayName(d, locale), LETTERS[i], sessions[i]?.name) + (i === sel ? ', ' + t('selected') : '')
              : t('{0}, rest day. Move {1} here', weekdayName(d, locale), session?.name)
            return <button key={d} type="button" className="ob-pday" aria-pressed={i === sel} aria-label={label} onClick={() => tap(d)}>
              {weekdayName(d, locale, 'short')}
            </button>
          })}
          {plan.weekdays.map((d, i) => (
            <span key={i} className={i === sel ? 'ob-pill sel' : 'ob-pill'} style={{ '--d': WEEK.indexOf(d) }} aria-hidden="true"><b>{LETTERS[i]}</b></span>
          ))}
          <StarterBaseline />
        </div>
        <p className="ob-pl-hint">{t('Tap a session, then a free day to move it there.')}</p>
        {session && <div className="ob-pl-sess" aria-live="polite">
          <div className="ob-pl-st">{weekdayName(plan.weekdays[sel], locale)} · {session.name}</div>
          {session.exercises.map((e, k) => (
            <div key={k} className="ob-exr">
              <span className="ob-exth" aria-hidden="true"><Icon name="dumbbell" /></span>
              <div>
                <div className="ob-exn">{e.ex ? exerciseNameText(e.ex) : e.id}</div>
                <div className="ob-exs">{t('{0} × {1}', e.sets, e.reps)}</div>
              </div>
            </div>
          ))}
        </div>}
        <div className="ob-pl-fit">
          <span>{t('Fitted to: {0} · {1}', experienceLabel(plan.experience), equipmentLabel(plan.equipment))}</span>
          <Button variant="plain" size="sm" onClick={fit}>{t('Change')}</Button>
        </div>
      </div>
    </StepScreen>
  )
}
