import { useState } from 'react'
import ChoiceCards from '../../components/onboarding/ChoiceCards.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import SeesawScene from '../../components/onboarding/scenes/SeesawScene.jsx'
import { t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { useLater } from '../../lib/onboarding/use-later.js'

// 2 Goal (§3 screen 2): four cards, a tap moves on (650ms, so the seesaw is seen to tip). "Not sure
// yet" is the way out: the goal has no skip. Arrow keys choose without moving on; Enter or Space
// on a card is a tap.
const OPTIONS = () => [
  { value: 'lose', icon: 'trendingDown', title: t('Lose weight'), sub: t('Eat a little under what you burn') },
  { value: 'keep', icon: 'scaleBalance', title: t('Keep my weight'), sub: t('Hold steady and get stronger') },
  { value: 'build', icon: 'trendingUp', title: t('Build muscle'), sub: t('A small surplus to grow on') },
  { value: 'unsure', icon: 'circleHelp', title: t('Not sure yet'), sub: t('We’ll start balanced') },
]
const CAPTION = () => ({
  lose: t('Training outweighs food: about 0.5 kg a week, steady'),
  keep: t('Food and training in balance: hold steady'),
  build: t('Food outweighs training: a lean surplus, about +10%'),
  unsure: t('Starting balanced. Pick a goal any time'),
})

export default function GoalScreen() {
  const { state, act, saveHubStep, next } = useOnboarding()
  const goal = state.answers.goal
  const [preview, setPreview] = useState(null)
  const later = useLater()
  const pick = (v, { viaKey }) => {
    act({ type: 'goal', goal: v })
    saveHubStep('goal')
    if (!viaKey) later(() => next('goal'), 650)
  }
  return (
    <StepScreen fixedHeader titleId="ob-goal-t" title={t('What’s your goal?')} sub={t('Pick one. You can change it any time.')}
      stage={<SeesawScene goal={preview ?? goal} />}
      caption={goal ? CAPTION()[goal] : t('Pick a goal to balance food and training')}>
      <ChoiceCards labelledBy="ob-goal-t" options={OPTIONS()} value={goal} onPick={pick}
        onPreview={v => setPreview(v === goal ? null : v)} />
    </StepScreen>
  )
}
