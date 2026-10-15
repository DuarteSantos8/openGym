import { useMemo, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { amountEditable, editedItem, newUuid, nutritionOf, timeOf, unitsFor } from '../lib/nutrition/diary.js'
import { toastLogged, writeErrorText } from '../lib/nutrition/log-feedback.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import MacroLine from './MacroLine.jsx'
import { Stat } from './blocks.jsx'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, NumberField, Row, Section, SelectRow, TextField } from './ui.jsx'

// A logged item, to change or remove (NutriTrace's diary edit sheet): the amount and unit through
// the portion logic, the servings, the time and the meal. Save sends one editedItem, built once
// per set of inputs: Save again after a failure sends the same entry (same uuid, same stamp), so
// a save whose answer was lost is not applied twice. A quick-kcal row, or a recipe split into its
// ingredients, has no amount here: its time and meal only. Remove is undone from the toast, with
// the entry back under a new uuid (the removed one stays tombstoned in NutriTrace).
export function DiaryItemSheet({ date, item, close }) {
  const units = useUnits()
  const settings = useNutrition(s => s.settings.data)
  const labels = mealLabels(settings)
  const withAmount = amountEditable(item)
  const first = useRef({ portion: Number(item.portion) || 100, unit: item.unit || 'g', servings: Number(item.quantity) || 1, meal: Number(item.meal) || 0, time: timeOf(item) }).current
  const [portion, setPortion] = useState(first.portion)
  const [unit, setUnit] = useState(first.unit)
  const [servings, setServings] = useState(first.servings)
  const [meal, setMeal] = useState(first.meal)
  const [time, setTime] = useState(first.time)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const draft = useMemo(() => {
    try { return editedItem(item, { portion, unit, servings, meal, time }) } catch { return null }
  }, [item, portion, unit, servings, meal, time])
  const dirty = portion !== first.portion || unit !== first.unit || servings !== first.servings || meal !== first.meal || time !== first.time
  const shown = nutritionOf(draft || item)

  const mealOptions = labels.map((label, slot) => ({ value: slot, label }))
  if (!mealOptions.some(o => o.value === meal)) mealOptions.push({ value: meal, label: t('Meal {0}', meal + 1) })

  async function save() {
    if (!draft || busy || !dirty) return
    setBusy(true)
    setError('')
    try {
      await useNutrition.getState().updateItem(date, draft, item)
      close()
      useUI.getState().toast(t('Updated'))
    } catch (e) {
      if (e?.code === 'changed') {
        close()
        useUI.getState().toast(writeErrorText(e))
        return
      }
      setError(writeErrorText(e))
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const at = useNutrition.getState().days[date]?.entry?.items?.findIndex(i => i.uuid === item.uuid)
      await useNutrition.getState().removeItem(date, item.uuid)
      const back = { ...item, uuid: newUuid() }
      close()
      toastLogged(t('Removed {0}', item.name), () => useNutrition.getState().restoreItem(date, back, at >= 0 ? at : null))
    } catch (e) {
      setError(writeErrorText(e))
      setBusy(false)
    }
  }

  return <>
    <SheetHeader title={item.name} sub={[item.brand, fmtDate(date, true)].filter(Boolean).join(' · ')} onClose={close} />
    {withAmount && <>
      <div className="portion-grid">
        <label className="portion-f">
          <span className="small muted">{t('Serving size')}</span>
          <NumberField value={portion} onChange={setPortion} aria-label={t('Serving size')} />
        </label>
        <label className="portion-f">
          <span className="small muted">{t('Servings')}</span>
          <NumberField value={servings} onChange={setServings} aria-label={t('Servings')} />
        </label>
      </div>
    </>}
    <Section>
      {withAmount && <SelectRow title={t('Unit')} value={unit} options={unitsFor(item).map(u => ({ value: u, label: u }))} onChange={setUnit} />}
      <SelectRow title={t('Meal')} value={meal} options={mealOptions} onChange={setMeal} />
    </Section>
    <label className="measure-date">
      <span>{t('Time')}</span>
      <TextField type="time" value={time} onChange={e => setTime(e.target.value)} aria-label={t('Time')} />
    </label>
    <div className="portion-sum">
      <Stat value={units.energy(shown.calories || 0)} />
      <MacroLine p={shown.proteins} c={shown.carbohydrates} f={shown.fat} />
    </div>
    {withAmount && !draft && <div className="muted small" role="status">{t('Enter an amount above 0.')}</div>}
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <SheetActions>
      <Button variant="primary" onClick={save} disabled={!draft || busy || !dirty}>{busy ? t('Saving…') : t('Save')}</Button>
    </SheetActions>
    <Section>
      <Row icon="trash" title={t('Remove {0}', item.name)} danger onClick={remove} />
    </Section>
  </>
}

/** Opens a logged item over the page. */
export function diaryItemSheet(props) {
  useUI.getState().openSheet(close => <DiaryItemSheet {...props} close={close} />)
}
