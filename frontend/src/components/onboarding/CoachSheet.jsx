import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { coachConsentCopy } from '../../lib/onboarding/consent.js'
import { EQUIPMENT_OPTIONS, EXPERIENCE_OPTIONS } from '../../lib/onboarding/labels.js'
import { SheetActions, SheetHeader } from '../sheet-layout.jsx'
import { Button } from '../ui.jsx'
import ChoiceChips from './ChoiceChips.jsx'

// 5b: the AI coach (§3b; never "Coach" without "AI" and a description). What it reads, where the
// answers go, and the one tap that sends them: the consent, the hub's text (`consent`, see
// lib/onboarding/consent.js), whose id goes with the choice. Experience is optional, equipment
// defaults to a full gym. Build → onBuild({ experience, equipment }); Not now (or closing) → back
// on the Plan choice with nothing picked.
export default function CoachSheet({ consent: text, days, experience, equipment, onBuild, onDismiss, close }) {
  const [exp, setExp] = useState(experience)
  const [eq, setEq] = useState(equipment || 'gym')
  // However it closes without building (Not now, the scrim, Escape, a swipe), the choice is undone.
  const built = useRef(false)
  const dismiss = useRef(onDismiss)
  useEffect(() => () => { if (!built.current) dismiss.current?.() }, [])
  const build = () => { built.current = true; onBuild({ experience: exp ?? null, equipment: eq }) }
  const consent = coachConsentCopy(text, days)
  return <>
    <SheetHeader title={t('Have the AI coach build your plan')} />
    <p className="ob-sheet-p">{consent.reads}</p>
    <p className="ob-fine">{consent.where}</p>
    <ChoiceChips label={t('Your experience (optional)')} options={EXPERIENCE_OPTIONS()} value={exp} onPick={setExp} />
    <ChoiceChips label={t('What you can use')} options={EQUIPMENT_OPTIONS()} value={eq} onPick={setEq} />
    <SheetActions>
      <Button variant="primary" onClick={build}>{t('Build my plan')}</Button>
      <Button onClick={close}>{t('Not now')}</Button>
    </SheetActions>
  </>
}
