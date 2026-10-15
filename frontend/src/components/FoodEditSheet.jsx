import { useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { UNITS, newUuid } from '../lib/nutrition/diary.js'
import { NUTRIENTS, categoryChoices, editorEnergyUnit, foodErrorText, foodOf, formOf, nutrientLabel } from '../lib/nutrition/foods.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { confirmSheet } from '../sheets.jsx'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, Row, Section, SelectRow, Switch, TextArea, TextField } from './ui.jsx'

const toast = m => useUI.getState().toast(m)

function problemText(error) {
  if (error === 'name') return t('Give the food a name.')
  if (error === 'portion') return t('The serving needs an amount above 0.')
  return t('{0} must be a number, 0 or more.', nutrientLabel(error.slice('nutrient:'.length)))
}

function NutrientField({ id, unit, sub, value, onChange }) {
  return <label className="measure-field">
    <span>{sub ? '· ' : ''}{nutrientLabel(id)}</span>
    <span className="measure-input">
      <input className="num" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} aria-label={nutrientLabel(id)} />
      <i>{unit}</i>
    </span>
  </label>
}

// Create (no `food`) or edit (a saved food, with an id). Nothing is sent until Save; a failed
// save keeps everything typed. A new food carries one key for as long as the sheet is open, so a
// retry after a lost answer saves it once. Energy is in the person's unit, taken when the sheet
// opens so the field does not change unit under what was typed; it is stored as kcal.
export function FoodEditSheet({ food = null, settings = null, close }) {
  const editing = typeof food?.id === 'number'
  const [energyUnit] = useState(() => editorEnergyUnit(settings))
  const [form, setForm] = useState(() => formOf(editing ? food : null, { energyUnit }))
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const key = useRef(newUuid())
  const choices = categoryChoices(settings)
  const categories = form.category && !choices.includes(form.category) ? [...choices, form.category] : choices
  const units = form.unit && !UNITS.includes(form.unit) ? [form.unit, ...UNITS] : UNITS

  const set = patch => setForm(f => ({ ...f, ...patch }))
  const setNutrient = (id, value) => setForm(f => ({ ...f, nutrients: { ...f.nutrients, [id]: value } }))

  async function save() {
    if (busy) return
    const made = foodOf(form, { food: editing ? food : null, clientKey: key.current, energyUnit })
    if (made.error) { setProblem(problemText(made.error)); return }
    setProblem('')
    setBusy(true)
    try {
      await useNutrition.getState().saveFood(made.food)
      close()
      toast(t('Food saved'))
    } catch (e) {
      setProblem(foodErrorText(e, { write: true }))
      setBusy(false)
    }
  }

  function remove() {
    confirmSheet({
      title: t('Delete this food?'),
      message: t('“{0}” is removed from your foods. Meals you already logged keep it.', food.name),
      confirmText: t('Delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await useNutrition.getState().deleteFood(food.id)
          close()
          toast(t('Food deleted'))
        } catch (e) {
          toast(foodErrorText(e, { write: true }))
        }
      },
    })
  }

  const shown = NUTRIENTS.filter(n => n.main || more)
  return <>
    <SheetHeader title={editing ? t('Edit food') : t('New food')} action={<Button size="sm" variant="ghost" onClick={close}>{t('Cancel')}</Button>} />
    <label className="measure-date">
      <span>{t('Name')}</span>
      <TextField value={form.name} maxLength={120} autoFocus={!editing} onChange={e => set({ name: e.target.value })} />
    </label>
    <label className="measure-date">
      <span>{t('Brand')}</span>
      <TextField value={form.brand} maxLength={120} onChange={e => set({ brand: e.target.value })} />
    </label>
    <label className="measure-date">
      <span>{t('Barcode')}</span>
      <TextField value={form.barcode} inputMode="numeric" maxLength={32} onChange={e => set({ barcode: e.target.value })} />
    </label>
    <label className="measure-date">
      <span>{t('Serving amount')}</span>
      <TextField value={form.portion} inputMode="decimal" onChange={e => set({ portion: e.target.value })} />
    </label>
    <Section footer={t('The values below are for one serving.')}>
      <SelectRow title={t('Serving unit')} value={form.unit} options={units.map(u => ({ value: u, label: u }))} onChange={unit => set({ unit })} />
    </Section>
    <div className="measure-form">
      {shown.map(n => <NutrientField key={n.id} id={n.id} unit={n.id === 'calories' ? energyUnit : n.unit} sub={n.sub} value={form.nutrients[n.id]} onChange={v => setNutrient(n.id, v)} />)}
    </div>
    <div className="measure-options">
      <Button size="sm" variant="ghost" onClick={() => setMore(m => !m)}>{more ? t('Fewer nutrients') : t('More nutrients')}</Button>
    </div>
    {(categories.length > 0) && <Section>
      <SelectRow title={t('Category')} value={form.category} options={[{ value: '', label: t('None') }, ...categories.map(c => ({ value: c, label: c }))]} onChange={category => set({ category })} />
    </Section>}
    {editing && <Section>
      <Row title={t('Favorite')}><Switch checked={form.favorite} onChange={favorite => set({ favorite })} aria-label={t('Favorite')} /></Row>
    </Section>}
    <label className="measure-date">
      <span>{t('Notes')}</span>
      <TextArea value={form.notes} maxLength={500} onChange={e => set({ notes: e.target.value })} />
    </label>
    {problem && <div className="small muted" role="alert">{problem}</div>}
    <SheetActions>
      <Button variant="primary" onClick={save} disabled={busy}>{t('Save')}</Button>
    </SheetActions>
    {editing && <Section>
      <Row icon="trash" title={t('Delete food')} danger onClick={remove} />
    </Section>}
  </>
}

/** Opens the editor over the page. */
export function foodEditSheet(opts = {}) {
  useUI.getState().openSheet(close => <FoodEditSheet {...opts} close={close} />)
}
