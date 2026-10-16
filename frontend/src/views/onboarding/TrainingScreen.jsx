import StepScreen from '../../components/onboarding/StepScreen.jsx'
import WeekScene from '../../components/onboarding/scenes/WeekScene.jsx'
import { dateLocale, t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { weekdayName } from '../../lib/onboarding/labels.js'
import { WEEK, suggestedDays } from '../../lib/onboarding/plans.js'
import { useLater } from '../../lib/onboarding/use-later.js'
import { useRadioGroup } from '../../lib/onboarding/use-radio-group.js'

// 4 Training (§3b): days a week only, 0-6. 0 is "Just tracking food" and goes to the end; any other
// number to the Plan step. A tap moves on (600ms); Skip in the nav goes to the end.
const DAYS = [0, 1, 2, 3, 4, 5, 6]

export default function TrainingScreen() {
  const { state, act, saveHubStep, next } = useOnboarding()
  const days = state.answers.trainingDays ?? null
  const later = useLater()
  const { tabIndexOf, onKeyDown } = useRadioGroup(DAYS, days, (n, how) => pick(n, how))
  function pick(n, { viaKey }) {
    act({ type: 'training', days: n })
    saveHubStep('training')
    if (!viaKey) later(() => next('training'), 600)
  }
  const locale = dateLocale()
  const lit = days ? suggestedDays(days).map(d => WEEK.indexOf(d)) : []
  const caption = days === null ? ''
    : days === 0 ? t('Just tracking food. You can add training any time.')
      : t('Suggested: {0}', suggestedDays(days).map(d => weekdayName(d, locale)).join(', '))
  return (
    <StepScreen titleId="ob-days-t" title={t('How often do you train?')} sub={t('Days a week. Pick 0 if you’re only tracking food.')}
      stage={<WeekScene days={days} lit={lit} experience={state.starter?.experience}
        letters={WEEK.map(d => weekdayName(d, locale, 'narrow'))} />}
      caption={caption}>
      <div className="ob-daysel" role="radiogroup" aria-labelledby="ob-days-t" onKeyDown={onKeyDown}>
        {DAYS.map(n => (
          <button key={n} type="button" role="radio" aria-checked={days === n} tabIndex={tabIndexOf(n)}
            aria-label={n === 0 ? t('0, just tracking food') : undefined} onClick={() => pick(n, { viaKey: false })}>{n}</button>
        ))}
      </div>
      <p className="ob-dhint">{t('We’ll suggest days. You can move them on your plan.')}</p>
    </StepScreen>
  )
}
