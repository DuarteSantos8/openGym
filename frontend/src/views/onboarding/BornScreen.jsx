import { useState } from 'react'
import NextButton from '../../components/onboarding/NextButton.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import TargetRing from '../../components/onboarding/TargetRing.jsx'
import YearWheel from '../../components/onboarding/YearWheel.jsx'
import CalendarScene from '../../components/onboarding/scenes/CalendarScene.jsx'
import { t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { yearRange } from '../../lib/onboarding/units.js'
import { useSettledCaption } from '../../lib/onboarding/use-settled-caption.js'
import { targetSentence, useTarget } from '../../lib/onboarding/use-target.js'
import { useUI } from '../../store/useUI.js'

// 3b You · born (§3b): just the year, on a wheel greyed until touched, or typed.
export default function BornScreen() {
  const { state, act } = useOnboarding()
  const year = state.answers.body.birthYear
  const target = useTarget(state.answers, state.uid)
  const [settled, setSettled] = useState(year != null)
  const [moving, setMoving] = useState(false)
  const range = yearRange()
  const caption = useSettledCaption(settled && !moving && year != null, `${t('Born {0}.', year)} ${targetSentence(target)}`)
  return (
    <StepScreen fixedHeader titleId="ob-born-t" title={t('When were you born?')} sub={t('Just the year. Spin the wheel, or tap the year to type it.')}
      stage={<CalendarScene year={year} after={<TargetRing target={target} />} />}
      caption={caption}
      footer={<NextButton screen="born" ready={year != null} />}>
      <YearWheel range={range} value={year} onBad={msg => useUI.getState().toast(msg)}
        onChange={(v, final) => {
          act({ type: 'body', field: 'birthYear', value: v })
          setMoving(!final)
          if (final) setSettled(true)
        }} />
    </StepScreen>
  )
}
