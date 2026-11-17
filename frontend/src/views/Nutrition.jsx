import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { formatNutrition } from '../lib/nutrition/format.js'
import { isOn } from '../lib/modules.js'
import { MEALS, localDay, normalizeEntry } from '../lib/nutrition/entry.js'
import { diaryDays, deleteEntry, undoEntry, foodSuggestions } from '../lib/nutrition/diary.js'
import DateField from '../components/DateField.jsx'
import Skeleton from '../components/Skeleton.jsx'
import DiarySummary from '../components/nutrition/DiarySummary.jsx'
import EntrySheet, { mealLabels } from '../components/nutrition/EntrySheet.jsx'
import FoodLookup from '../components/nutrition/FoodLookup.jsx'
import '../components/nutrition/nutrition.css'

export default function Nutrition() {
  const S = useStore(s => s.S), ready = useStore(s => s.ready)
  const nav = useNavigate()
  const [day, setDay] = useState(localDay)
  const [query, setQuery] = useState(''), [order, setOrder] = useState('recent')
  const [removed, setRemoved] = useState(null)
  if (!isOn(S, 'nutrition')) return null
  if (!ready) return <Skeleton label={t('Loading…')} />
  const days = diaryDays(S), rows = days[day] || [], meals = mealLabels()
  const open = (entry, prefill) => {
    const owner = useStore.getState().user?.id || null
    useUI.getState().openSheet(close => <EntrySheet entry={entry} prefill={prefill} day={day} owner={owner} close={close} />)
  }
  const remove = id => { useStore.getState().update(s => deleteEntry(s, id)); setRemoved(id) }
  return <div className="narrow nutrition">
    <header className="nutrition-header"><button className="btn" onClick={() => nav('/home')}>{t('Back')}</button><h1>{t('Nutrition diary')}</h1></header>
    <div className="nutrition-header"><DateField label={t('Date')} value={day} onChange={setDay} /><button className="btn primary" onClick={() => open()}>{t('Add food')}</button></div>
    <DiarySummary S={S} day={day} />
    <FoodLookup key={day} day={day} />
    {removed && <div role="status" className="nutrition-header card"><span>{t('Food deleted')}</span><button className="btn" onClick={() => { useStore.getState().update(s => undoEntry(s, removed)); setRemoved(null) }}>{t('Undo')}</button></div>}
    {!rows.length && <p className="card muted">{t('No food logged for this day.')}</p>}
    {[...MEALS, 'undated'].map(meal => {
      const entries = meal === 'undated' ? days[''] || [] : rows.filter(e => (MEALS.includes(e.meal) ? e.meal : 'snack') === meal)
      if (!entries.length) return null
      return <section className="card" key={meal}><h2>{meal === 'undated' ? t('Undated entries') : meals[meal]}</h2><ul className="nutrition-list">
        {entries.map(e => {
          const { supported } = normalizeEntry(e)
          return <li key={e.id}>
            <div className="nutrition-entry"><strong>{supported ? e.label : t('Unsupported entry')}</strong>
              {supported && <span className="ss">{e.amountG != null ? formatNutrition(e.amountG) + ' g' : e.amountMl != null ? formatNutrition(e.amountMl) + ' mL' : t('Amount unknown')}
                {e.serving && ` · ${formatNutrition(e.serving.count)} × ${e.serving.label} (${formatNutrition(e.serving.size)} ${e.serving.unit})`}</span>}
              {!supported && <span className="ss">{t('Kept unchanged. Use a compatible app to edit this entry.')}</span>}
            </div>
            <div className="nutrition-actions">{supported && <button className="btn" onClick={() => open(e)}>{t('Edit')}</button>}<button className="btn" onClick={() => remove(e.id)}>{t('Delete')}</button></div>
          </li>
        })}
      </ul></section>
    })}
    <section className="card"><h2>{t('Your foods')}</h2><p className="ss">{t('Choose an earlier entry to prefill a new one.')}</p>
      <label className="nutrition-field"><span>{t('Search your foods')}</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="nutrition-field"><span>{t('Order')}</span><select value={order} onChange={e => setOrder(e.target.value)}><option value="recent">{t('Recent')}</option><option value="frequent">{t('Frequent')}</option></select></label>
      <div className="nutrition-suggestions">{foodSuggestions(S, { query, order }).map(e => <button className="btn" key={e.id} onClick={() => open(null, e)}>{e.label}</button>)}</div>
    </section>
  </div>
}
