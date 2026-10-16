import { useState } from 'react'
import { t } from '../../lib/i18n.js'
import { EQUIPMENT_OPTIONS, EXPERIENCE_OPTIONS } from '../../lib/onboarding/labels.js'
import { SheetActions, SheetHeader } from '../sheet-layout.jsx'
import { Button } from '../ui.jsx'
import ChoiceChips from './ChoiceChips.jsx'

// 5a's "Fitted to … · Change": the experience and the equipment the starter plan is cut for. Each
// pick applies at once (onChange), so the plan behind the sheet follows.
export default function FitSheet({ experience, equipment, onChange, close }) {
  const [exp, setExp] = useState(experience)
  const [eq, setEq] = useState(equipment)
  return <>
    <SheetHeader title={t('Fit the plan to you')} />
    <ChoiceChips label={t('Experience')} options={EXPERIENCE_OPTIONS()} value={exp}
      onPick={v => { setExp(v); onChange({ experience: v }) }} />
    <ChoiceChips label={t('What you can use')} options={EQUIPMENT_OPTIONS()} value={eq}
      onPick={v => { setEq(v); onChange({ equipment: v }) }} />
    <SheetActions>
      <Button variant="primary" onClick={close}>{t('Done')}</Button>
    </SheetActions>
  </>
}
