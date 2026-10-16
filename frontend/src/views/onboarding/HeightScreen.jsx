import { useState } from 'react'
import NextButton from '../../components/onboarding/NextButton.jsx'
import RulerPicker from '../../components/onboarding/RulerPicker.jsx'
import StepScreen from '../../components/onboarding/StepScreen.jsx'
import TargetRing from '../../components/onboarding/TargetRing.jsx'
import DoorScene from '../../components/onboarding/scenes/DoorScene.jsx'
import { t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { HEIGHT, heightFrom, heightTo, parseHeight } from '../../lib/onboarding/units.js'
import { useSettledCaption } from '../../lib/onboarding/use-settled-caption.js'
import { targetSentence, useTarget } from '../../lib/onboarding/use-target.js'
import { useUI } from '../../store/useUI.js'

// 3c You · height (§3b): a ruler in cm or feet and inches (from the locale; the chip switches), the
// door frame's mark following it. Saved in cm.
export default function HeightScreen() {
  const { state, act } = useOnboarding()
  const cm = state.answers.body.heightCm
  const unit = state.answers.units.height
  const scale = HEIGHT[unit]
  const target = useTarget(state.answers, state.uid)
  const [live, setLive] = useState(false)
  const [settled, setSettled] = useState(cm != null)
  const value = cm == null ? null : heightTo(cm, unit)
  const fromRegion = state.answers.units.source === 'locale'
  const unitName = unit === 'cm' ? t('centimetres') : t('feet and inches')
  const otherName = unit === 'cm' ? t('feet and inches') : t('centimetres')
  const shown = value ?? scale.start
  const caption = useSettledCaption(settled && !live && cm != null, `${t('Height {0}.', scale.say(shown))} ${targetSentence(target)}`)
  return (
    <StepScreen fixedHeader titleId="ob-height-t" title={t('How tall are you?')} sub={t('Drag the ruler, or tap the number to type it.')}
      stage={<DoorScene cm={cm} live={live} after={<TargetRing target={target} />} />}
      caption={caption}
      footer={<NextButton screen="height" ready={cm != null} />}>
      <RulerPicker scale={scale} value={value} label={t('Height')} onBad={msg => useUI.getState().toast(msg)}
        onChange={(v, final) => {
          act({ type: 'body', field: 'heightCm', value: heightFrom(v, unit) })
          setLive(!final)
          if (final) setSettled(true)
        }}
        unit={{
          text: unit === 'cm' ? t('cm') : t('ft, in'),
          label: fromRegion ? t('Units: {0}, from your region. Switch to {1}', unitName, otherName) : t('Units: {0}. Switch to {1}', unitName, otherName),
          onSwitch: () => act({ type: 'unit', kind: 'height', unit: unit === 'cm' ? 'ft' : 'cm' }),
        }}
        typed={{
          label: unit === 'cm' ? t('Height in centimetres') : t('Height: feet, then inches, like 5.7'),
          inputMode: unit === 'cm' ? 'numeric' : 'decimal',
          initial: v => (unit === 'cm' ? String(v) : `${Math.floor(v / 12)}.${v % 12}`),
          parse: text => parseHeight(text, unit),
          bad: unit === 'cm' ? t('Type your height in cm, like 170') : t('Type feet, then inches, like 5.7'),
          kept: t('Kept within {0} and {1}', scale.read(scale.min).join(' ').trim(), scale.read(scale.max).join(' ').trim()),
        }} />
    </StepScreen>
  )
}
