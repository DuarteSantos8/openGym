import Icon from '../../components/Icon.jsx'
import ChoiceCards from '../../components/onboarding/ChoiceCards.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import WhySheet from '../../components/onboarding/WhySheet.jsx'
import SexScene from '../../components/onboarding/scenes/SexScene.jsx'
import { t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { useLater } from '../../lib/onboarding/use-later.js'
import { targetSentence, useTarget } from '../../lib/onboarding/use-target.js'
import { useUI } from '../../store/useUI.js'

// 3a You · sex (§3b): the formula's constant, with "Why we ask". A tap moves on (600ms); Skip in the
// nav goes to Training. The live target ring stands on the floor and takes its first quarter.
export default function SexScreen() {
  const { state, act, saveHubStep, next } = useOnboarding()
  const sex = state.answers.body.sex
  const target = useTarget(state.answers, state.uid)
  const later = useLater()
  const pick = (v, { viaKey }) => {
    act({ type: 'body', field: 'sex', value: v })
    saveHubStep('body')
    if (!viaKey) later(() => next('sex'), 600)
  }
  const why = () => useUI.getState().openSheet(close => <WhySheet close={close} />)
  return (
    <StepScreen fixedHeader titleId="ob-sex-t" title={t('What’s your sex?')} sub={t('It picks the constant in the calorie formula. Only you see it.')}
      headerExtra={<button type="button" className="ob-why" onClick={why}><Icon name="circleHelp" /><span>{t('Why we ask')}</span></button>}
      stage={<SexScene target={target} />}
      caption={sex ? targetSentence(target) : ''}>
      <ChoiceCards slim labelledBy="ob-sex-t" value={sex} onPick={pick} options={[
        { value: 'female', title: t('Female') },
        { value: 'male', title: t('Male') },
        { value: 'unspecified', title: t('Prefer not to say'), sub: t('We’ll use the average of the two') },
      ]} />
    </StepScreen>
  )
}
