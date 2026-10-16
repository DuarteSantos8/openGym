import { useState } from 'react'
import NextButton from '../../components/onboarding/NextButton.jsx'
import RulerPicker from '../../components/onboarding/RulerPicker.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import TargetRing from '../../components/onboarding/TargetRing.jsx'
import ScaleScene from '../../components/onboarding/scenes/ScaleScene.jsx'
import { t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { WEIGHT, parseWeight, weightFrom, weightTo } from '../../lib/onboarding/units.js'
import { useSettledCaption } from '../../lib/onboarding/use-settled-caption.js'
import { targetSentence, useTarget } from '../../lib/onboarding/use-target.js'
import { useUI } from '../../store/useUI.js'

// 3d You · weight (§3b): a ruler in kg or lb, the scale's tape following it. Saved in kg, and on
// completion as the first weigh-in. With all four answers in, the ring firms up to the hub's target.
export default function WeightScreen() {
  const { state, act } = useOnboarding()
  const kg = state.answers.body.weightKg
  const unit = state.answers.units.weight
  const scale = WEIGHT[unit]
  const target = useTarget(state.answers, state.uid)
  const [live, setLive] = useState(false)
  const [settled, setSettled] = useState(kg != null)
  const value = kg == null ? null : weightTo(kg, unit)
  const fromRegion = state.answers.units.source === 'locale'
  const unitName = unit === 'kg' ? t('kilograms') : t('pounds')
  const otherName = unit === 'kg' ? t('pounds') : t('kilograms')
  const shown = value ?? scale.start
  const caption = useSettledCaption(settled && !live && kg != null, `${t('Weight {0}.', scale.say(shown))} ${targetSentence(target)}`)
  return (
    <StepScreen fixedHeader titleId="ob-weight-t" title={t('What do you weigh today?')} sub={t('Saved as your first weigh-in. Only you see it.')}
      stage={<ScaleScene kg={kg} unit={unit} live={live} after={<TargetRing target={target} />} />}
      caption={caption}
      footer={<NextButton screen="weight" ready={kg != null} />}>
      <RulerPicker scale={scale} value={value} label={t('Weight')} onBad={msg => useUI.getState().toast(msg)}
        onChange={(v, final) => {
          act({ type: 'body', field: 'weightKg', value: weightFrom(v, unit) })
          setLive(!final)
          if (final) setSettled(true)
        }}
        unit={{
          text: unit === 'kg' ? t('kg') : t('lb'),
          label: fromRegion ? t('Units: {0}, from your region. Switch to {1}', unitName, otherName) : t('Units: {0}. Switch to {1}', unitName, otherName),
          onSwitch: () => act({ type: 'unit', kind: 'weight', unit: unit === 'kg' ? 'lb' : 'kg' }),
        }}
        typed={{
          label: unit === 'kg' ? t('Weight in kilograms') : t('Weight in pounds'),
          inputMode: 'decimal',
          initial: v => String(v),
          parse: parseWeight,
          bad: t('Type your weight, like {0}', scale.start),
          kept: t('Kept within {0}–{1} {2}', scale.min, scale.max, unit === 'kg' ? t('kg') : t('lb')),
        }} />
    </StepScreen>
  )
}
