import { useEffect, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { createEntry, MEALS, NUTRIENTS } from '../../lib/nutrition/entry.js'
import { addEntry, changeEntry } from '../../lib/nutrition/diary.js'
import { visibleOptionalEntries } from '../../lib/sync-merge.js'
import { isOn } from '../../lib/modules.js'
import ErrorState from '../ErrorState.jsx'
import { nutrientLabels } from './DiarySummary.jsx'
export const mealLabels = () => ({ breakfast: t('Breakfast'), lunch: t('Lunch'), dinner: t('Dinner'), snack: t('Snack') })
export default function EntrySheet({ entry, prefill, day, owner, close }) {
  const currentOwner = useStore(s => s.user?.id || null)
  const enabled = useStore(s => isOn(s.S, 'nutrition'))
  const allowed = enabled && currentOwner === owner
  useEffect(() => { if (!allowed) close() }, [allowed, close])
  const source = entry || prefill
  const [values, setValues] = useState(() => ({
    label: source?.label || '', meal: source?.meal || 'snack',
    amount: source?.serving?.count ?? source?.amountG ?? source?.amountMl ?? '',
    unit: source?.serving ? 'serving' : source?.amountMl != null ? 'mL' : 'g',
    servingLabel: source?.serving?.label || '', servingSize: source?.serving?.size ?? '', servingUnit: source?.serving?.unit || 'g',
    ...Object.fromEntries(NUTRIENTS.map(k => [k, source?.[k] ?? ''])),
  }))
  const [dirty, setDirty] = useState(new Set())
  const [error, setError] = useState(false)
  const set = (key, value) => { setValues(v => ({ ...v, [key]: value })); setDirty(d => new Set([...d, key])); setError(false) }
  const labels = nutrientLabels(), meals = mealLabels()
  const save = event => {
    event.preventDefault()
    const current = useStore.getState()
    if (!isOn(current.S, 'nutrition') || (current.user?.id || null) !== owner) { close(); return }
    try {
      if (entry) {
        const patch = Object.fromEntries([...dirty].map(k => [k, values[k]]))
        const amountKeys = ['amount', 'unit', 'servingLabel', 'servingSize', 'servingUnit']
        if (amountKeys.some(k => dirty.has(k))) for (const k of amountKeys) patch[k] = values[k]
        useStore.getState().update(s => {
          if (!visibleOptionalEntries(s, 'nutritionEntries').some(e => e.id === entry.id)) throw new Error('deleted')
          changeEntry(s, entry.id, patch)
        })
      } else {
        // EP-05b seam: pass a confirmed snapshot and creation-only provenance here.
        const record = createEntry({ ...values, day }, prefill ? { source: prefill.source, externalId: prefill.externalId, contentFingerprint: prefill.contentFingerprint } : undefined)
        useStore.getState().update(s => addEntry(s, record))
      }
      close()
    } catch { setError(true) }
  }
  const field = (key, title, numeric = false) => <label className="nutrition-field" key={key}>
    <span>{title}</span><input name={key} value={values[key]} onChange={e => set(key, e.target.value)}
      type={numeric ? 'number' : 'text'} inputMode={numeric ? 'decimal' : undefined} min={numeric ? 0 : undefined}
      max={numeric ? 1000000 : undefined} step={numeric ? 'any' : undefined} maxLength={numeric ? undefined : 200}
      required={key === 'label'} autoFocus={key === 'label'} />
  </label>
  if (!allowed) return null
  return <form className="nutrition-form" onSubmit={save}>
    <h2>{entry ? t('Edit food') : t('Add food')}</h2>
    {field('label', t('Food name'))}
    <label className="nutrition-field"><span>{t('Meal')}</span><select name="meal" value={values.meal} onChange={e => set('meal', e.target.value)}>
      {MEALS.map(m => <option key={m} value={m}>{meals[m]}</option>)}
    </select></label>
    <div className="nutrition-pair">{field('amount', t('Amount'), true)}
      <label className="nutrition-field"><span>{t('Unit')}</span><select name="unit" value={values.unit} onChange={e => set('unit', e.target.value)}>
        <option value="g">g</option><option value="mL">mL</option><option value="serving">{t('Serving')}</option>
      </select></label>
    </div>
    {values.unit === 'serving' && <>
      {field('servingLabel', t('Serving name'))}
      <div className="nutrition-pair">{field('servingSize', t('Amount per serving'), true)}
        <label className="nutrition-field"><span>{t('Serving unit')}</span><select name="servingUnit" value={values.servingUnit} onChange={e => set('servingUnit', e.target.value)}><option value="g">g</option><option value="mL">mL</option></select></label>
      </div>
    </>}
    <fieldset><legend>{t('Totals for this entry')}</legend>
      <p className="ss">{t('Leave unknown values blank. Changing the amount does not change these totals.')}</p>
      <div className="nutrition-pair">{NUTRIENTS.map(k => field(k, labels[k], true))}</div>
    </fieldset>
    {error && <ErrorState title={t('Could not save food')} text={t('Check the name, units and numbers. The entry may have changed on another device.')} />}
    <div className="nutrition-pair"><button className="btn" type="button" onClick={close}>{t('Cancel')}</button><button className="btn primary" type="submit">{t('Save')}</button></div>
  </form>
}
