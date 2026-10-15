import { useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { energyOf, unitsFor } from '../lib/nutrition/diary.js'
import { NUTRIENTS, fmtAmount, foodErrorText, nutrientLabel, per100Of, per100Unit } from '../lib/nutrition/foods.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, Row, Section, Segmented, SelectRow, TextField } from './ui.jsx'

const toast = (m, opts) => useUI.getState().toast(m, opts)

function Facts({ food, settings }) {
  const rows = NUTRIENTS.filter(n => n.id === 'calories' || Number(food.nutrition?.[n.id]) > 0)
  return <Section>
    {rows.map(n => {
      const v = food.nutrition?.[n.id] || 0
      const e = n.id === 'calories' ? energyOf(v, settings) : null
      return <Row key={n.id} title={nutrientLabel(n.id)} value={e ? `${e.value} ${e.unit}` : `${fmtAmount(v)} ${n.unit}`} />
    })}
  </Section>
}

// A food in full: its nutrition per 100 g and per serving, and logging it to a meal. A food of
// yours (it has an id) adds Edit; an online result adds Save as food. Logging a result saves it
// to your foods first (store.logFood), so the diary row points at a food you can find again.
// The date and meal are taken once, when the sheet opens, and kept.
export function FoodDetailSheet({ food, settings, close, onEdit, onSave }) {
  const own = typeof food.id === 'number'
  const base = useRef(null)
  if (!base.current) base.current = useDiarySelection.getState().target(settings)
  const { date } = base.current
  const names = mealLabels(settings)
  const [meal, setMeal] = useState(base.current.meal)
  const per100 = per100Of(food)
  const both = !!per100 && !(Number(food.portion) === 100 && food.unit === per100Unit(food))
  const [basis, setBasis] = useState(both ? 'per100' : 'serving')
  const [amount, setAmount] = useState(String(food.portion ?? 100))
  const [unit, setUnit] = useState(food.unit || 'g')
  const [busy, setBusy] = useState(false)
  const draft = useRef({ sig: '', value: null })
  const serving = `${fmtAmount(food.portion ?? 100)} ${food.unit || 'g'}`
  const mealName = names[meal] ?? names[0]

  async function log() {
    if (busy) return
    // atPortion reads a 0 as "the food's own serving", so a zero is refused here, not logged as 100.
    const portion = Number(String(amount).replace(',', '.'))
    if (!(portion > 0)) { toast(t('Enter an amount above 0.')); return }
    setBusy(true)
    try {
      // The same draft goes again on a retry, so a write whose answer was lost does not log twice.
      const sig = [food.id ?? food.client_key, meal, portion, unit].join('|')
      const n = useNutrition.getState()
      if (draft.current.sig !== sig) draft.current = { sig, value: n.draftFood({ food, meal, portion, unit, servings: 1 }) }
      const item = await n.logFood(date, draft.current.value)
      close()
      toast(t('Logged to {0}', mealName), {
        action: t('Undo'),
        onAction: () => { useNutrition.getState().removeItem(date, item.uuid).catch(e => toast(foodErrorText(e, { write: true }))) },
      })
    } catch (e) {
      toast(e?.code === 'invalid' ? t('Enter an amount above 0.') : foodErrorText(e, { write: true }))
      setBusy(false)
    }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      await onSave(food)
      close()
    } catch (e) {
      toast(foodErrorText(e, { write: true }))
      setBusy(false)
    }
  }

  return <>
    <SheetHeader title={food.name} sub={food.brand || undefined} action={<Button size="sm" variant="ghost" onClick={close}>{t('Done')}</Button>} />
    {both && <Segmented value={basis} onChange={setBasis}
      options={[{ value: 'per100', label: t('Per 100 {0}', per100Unit(food)) }, { value: 'serving', label: t('Per serving') }]} />}
    {!both && <div className="muted small">{t('Per serving ({0})', serving)}</div>}
    <Facts food={basis === 'per100' ? per100 : food} settings={settings} />
    {food.notes && <Section title={t('Notes')}><Row title={food.notes} /></Section>}
    <Section title={t('Log')} footer={date === todayISO() ? undefined : t('Logging to {0}', fmtDate(date, true))}>
      <label className="measure-date">
        <span>{t('Amount')}</span>
        <TextField value={amount} inputMode="decimal" onChange={e => setAmount(e.target.value)} />
      </label>
      <SelectRow title={t('Unit')} value={unit} options={unitsFor(food).map(u => ({ value: u, label: u }))} onChange={setUnit} />
      <SelectRow title={t('Meal')} value={meal} options={names.map((label, slot) => ({ value: slot, label }))} onChange={setMeal} />
    </Section>
    <SheetActions>
      <Button variant="primary" onClick={log} disabled={busy}>{t('Log to {0}', mealName)}</Button>
      {!own && onSave && <Button variant="tinted" onClick={save} disabled={busy}>{t('Save as food')}</Button>}
    </SheetActions>
    {own && onEdit && <Section>
      <Row icon="pencil" title={t('Edit food')} accessory="chevron" onClick={() => { close(); onEdit(food) }} />
    </Section>}
  </>
}

/** Opens a food's detail over the page. `onEdit` for a food of yours, `onSave` for a result. */
export function foodDetailSheet(opts) {
  useUI.getState().openSheet(close => <FoodDetailSheet {...opts} close={close} />)
}
