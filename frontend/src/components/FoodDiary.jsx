// The food diary card of the Extension Lab (lib/nutrition-diary.js holds every rule). One day at a
// time: its totals, its entries by meal, and a form to log a food by hand. A barcode lookup logs
// into the same day through the parent's `onLog`.
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { MEALS, addFood, removeFood, restoreFood, foodsOn, nutrientsOf, dayTotals } from '../lib/nutrition-diary.js'

export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }

/** `d` moved by `n` days, as an ISO date. Calendar arithmetic in UTC, so no DST skips a day. */
export const shiftDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

const fmt = (v, unit) => v == null ? 'Not given' : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`
const dayLabel = (d, today) => d === today ? 'Today' : d === shiftDay(today, -1) ? 'Yesterday'
  : new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

function Totals({ totals }) {
  const gaps = Object.entries(totals.missing).filter(([, n]) => n > 0)
  return <div className="diary-totals" aria-live="polite">
    <div className="addon-metrics diary-metrics">
      <div className="addon-metric"><span className="addon-metric-label">Energy</span><strong>{totals.kcal.toLocaleString()} kcal</strong></div>
      <div className="addon-metric"><span className="addon-metric-label">Protein</span><strong>{totals.proteinG} g</strong></div>
      <div className="addon-metric"><span className="addon-metric-label">Carbs</span><strong>{totals.carbohydrateG} g</strong></div>
      <div className="addon-metric"><span className="addon-metric-label">Fat</span><strong>{totals.fatG} g</strong></div>
    </div>
    {gaps.length > 0 && <p className="addon-footnote" data-gaps>
      Totals leave out values the label did not give: {gaps.map(([k, n]) => `${{ kcal: 'energy', proteinG: 'protein', carbohydrateG: 'carbs', fatG: 'fat' }[k]} on ${n} ${n === 1 ? 'entry' : 'entries'}`).join(', ')}.
    </p>}
  </div>
}

const blank = { name: '', amount: '100', basis: 'g', meal: 'breakfast', kcal: '', proteinG: '', carbohydrateG: '', fatG: '' }

function ManualForm({ day, onDone }) {
  const update = useStore(s => s.update)
  const [f, setF] = useState(blank)
  const [error, setError] = useState('')
  const set = k => e => { setF(v => ({ ...v, [k]: e.target.value })); setError('') }
  const submit = ev => {
    ev.preventDefault()
    const input = { d: day, meal: f.meal, name: f.name, amount: f.amount === '' ? NaN : Number(f.amount), basis: f.basis,
      per100: { kcal: f.kcal, proteinG: f.proteinG, carbohydrateG: f.carbohydrateG, fatG: f.fatG } }
    try { update(s => { addFood(s, input) }); setF({ ...blank, meal: f.meal }); onDone?.() }
    catch (err) { setError(err?.message || 'Could not log this food') }
  }
  const field = (k, label) => <label className="diary-field"><span>{label}</span>
    <input name={k} type="text" inputMode="decimal" autoComplete="off" value={f[k]} onChange={set(k)} /></label>
  return <form className="diary-form" onSubmit={submit} aria-label="Log a food by hand">
    <label className="diary-field diary-wide"><span>Food</span>
      <input name="name" type="text" maxLength={80} autoComplete="off" value={f.name} onChange={set('name')} placeholder="Greek yogurt" /></label>
    <label className="diary-field"><span>Amount</span>
      <input name="amount" type="text" inputMode="decimal" autoComplete="off" value={f.amount} onChange={set('amount')} /></label>
    <label className="diary-field"><span>Unit</span>
      <select name="basis" value={f.basis} onChange={set('basis')}><option value="g">g</option><option value="ml">mL</option></select></label>
    <label className="diary-field"><span>Meal</span>
      <select name="meal" value={f.meal} onChange={set('meal')}>{MEALS.map(m => <option key={m} value={m}>{MEAL_LABEL[m]}</option>)}</select></label>
    <fieldset className="diary-per100">
      <legend>Per 100 {f.basis === 'ml' ? 'mL' : 'g'}, from the label (leave blank if not given)</legend>
      {field('kcal', 'kcal')}{field('proteinG', 'Protein g')}{field('carbohydrateG', 'Carbs g')}{field('fatG', 'Fat g')}
    </fieldset>
    {error && <p className="addon-error" role="alert">{error}</p>}
    <div className="diary-actions"><button type="submit" className="diary-primary" data-log-manual>Log food</button></div>
  </form>
}

export default function FoodDiary({ day, setDay }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [adding, setAdding] = useState(false)
  const today = todayISO()
  const entries = useMemo(() => foodsOn(S, day), [S, day])
  const totals = useMemo(() => dayTotals(entries), [entries])
  const remove = entry => {
    const stored = S.foodLog?.[entry.id]
    update(s => { removeFood(s, entry.id) })
    toast?.(`Removed ${entry.name}`, { action: 'Undo', onAction: () => update(s => { restoreFood(s, entry.id, stored) }) })
  }
  return <section className="addon-card diary" aria-labelledby="diary-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">NUTRITION / SYNCED DIARY</span><h2 id="diary-title">Food diary</h2></div>
      <div className="diary-daynav" role="group" aria-label="Day">
        <button type="button" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">‹</button>
        <span data-day={day}>{dayLabel(day, today)}</span>
        <button type="button" onClick={() => setDay(shiftDay(day, 1))} disabled={day >= today} aria-label="Next day">›</button>
      </div>
    </div>
    <Totals totals={totals} />
    {entries.length === 0
      ? <p className="addon-empty">Nothing logged for {dayLabel(day, today).toLowerCase() === 'today' ? 'today' : 'this day'}. Look up a barcode or log a food by hand.</p>
      : MEALS.filter(m => entries.some(e => e.meal === m)).map(m => <div key={m} className="diary-meal">
        <h3>{MEAL_LABEL[m]}</h3>
        <ul>{entries.filter(e => e.meal === m).map(e => {
          const n = nutrientsOf(e)
          return <li key={e.id} className="diary-entry" data-entry={e.id}>
            <div className="diary-entry-main"><strong>{e.name}</strong>
              <span>{e.amount.toLocaleString()} {e.basis === 'ml' ? 'mL' : 'g'}{e.brand ? ` · ${e.brand}` : ''}{e.src.kind === 'off' ? ' · Open Food Facts' : ''}</span></div>
            <div className="diary-entry-kcal">{fmt(n.kcal, 'kcal')}</div>
            <button type="button" className="diary-remove" onClick={() => remove(e)} aria-label={`Remove ${e.name}`}>×</button>
          </li>
        })}</ul>
      </div>)}
    {adding ? <ManualForm day={day} onDone={() => setAdding(false)} />
      : <button type="button" className="diary-secondary" onClick={() => setAdding(true)} data-open-manual>Log a food by hand</button>}
    <p className="addon-footnote">Saved in your profile and synced like your workouts. Nothing here is sent to Open Food Facts.</p>
  </section>
}
