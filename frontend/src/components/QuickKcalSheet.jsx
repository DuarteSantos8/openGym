import { useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { writeErrorText, toastLogged } from '../lib/nutrition/log-feedback.js'
import { Button, NumberField, TextField } from './ui.jsx'
import { SheetHeader } from './sheet-layout.jsx'

const KJ_PER_KCAL = 4.184

// NutriTrace's Quick Calories (QuickCaloriesSheet.svelte): energy with no food behind it, in the
// person's unit (kJ is stored as kcal), an optional name and the macros you know. A failed write
// keeps the sheet and its numbers.
// `pending` ({ uuid }): the entry a failed write may still have saved, shared by the sheets of one
// picker. While it is set, the next log reuses that uuid, so an edit after a lost answer updates
// the entry instead of adding a second one.
export default function QuickKcalSheet({ date, meal, mealName, onLogged, pending: shared, close }) {
  const units = useUnits()
  const own = useRef({ uuid: null })
  const pending = shared || own.current
  const [energy, setEnergy] = useState(null)
  const [name, setName] = useState('')
  const [p, setP] = useState(null)
  const [c, setC] = useState(null)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const kcal = energy == null ? null : units.energyUnit === 'kJ' ? energy / KJ_PER_KCAL : energy
  // One draft per set of numbers: Log again after a failure sends the same entry.
  const draft = useMemo(() => {
    try {
      const d = useNutrition.getState().draftQuick({ kcal, name, proteins: p, carbohydrates: c, fat: f, meal })
      return pending.uuid ? { ...d, uuid: pending.uuid } : d
    } catch { return null }
  }, [kcal, name, p, c, f, meal, pending])

  const log = async () => {
    if (!draft || busy) return
    setBusy(true)
    setError(null)
    try {
      const item = await useNutrition.getState().logQuick(date, draft)
      pending.uuid = null
      close()
      if (onLogged) onLogged()
      toastLogged(t('Logged to {0}', mealName), () => useNutrition.getState().removeItem(date, item.uuid))
    } catch (e) {
      pending.uuid = draft.uuid
      setError(writeErrorText(e))
      setBusy(false)
    }
  }

  return <div className="quick-sheet">
    <SheetHeader title={t('Quick kcal')} sub={mealName + ' · ' + fmtDate(date, true)} />
    <label className="portion-f">
      <span className="small muted">{units.energyUnit}</span>
      <NumberField value={energy} onChange={setEnergy} nullable decimal={false} aria-label={units.energyUnit} autoFocus />
    </label>
    <label className="portion-f">
      <span className="small muted">{t('Name (optional)')}</span>
      <TextField value={name} maxLength={60} onChange={e => setName(e.target.value)} aria-label={t('Name (optional)')} />
    </label>
    <div className="portion-grid">
      <label className="portion-f"><span className="small muted">{t('Protein')} (g)</span>
        <NumberField value={p} onChange={setP} nullable aria-label={t('Protein')} /></label>
      <label className="portion-f"><span className="small muted">{t('Carbs')} (g)</span>
        <NumberField value={c} onChange={setC} nullable aria-label={t('Carbs')} /></label>
      <label className="portion-f"><span className="small muted">{t('Fat')} (g)</span>
        <NumberField value={f} onChange={setF} nullable aria-label={t('Fat')} /></label>
    </div>
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <Button variant="primary" onClick={log} disabled={!draft || busy}>{busy ? t('Saving…') : t('Log')}</Button>
  </div>
}

export function quickKcalSheet(props) {
  useUI.getState().openSheet(close => <QuickKcalSheet {...props} close={close} />)
}
