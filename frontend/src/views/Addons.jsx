import { Suspense, lazy, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { APP_NAME } from '../lib/brand.js'
import { workoutDay, sessionVolume } from '../lib/history.js'
import { trainingVolumeSeries } from '../lib/addon-trends.js'
import { previewActivityFile } from '../lib/addon-activity.js'
import { MEALS, addFood, fromLookup } from '../lib/nutrition-diary.js'
import FoodDiary, { MEAL_LABEL } from '../components/FoodDiary.jsx'
import NutriTraceCard from '../components/NutriTraceCard.jsx'
import ProgressionLab from '../components/ProgressionLab.jsx'
import MovementLab from '../components/MovementLab.jsx'
import AnatomyViewer from '../components/AnatomyViewer.jsx'
import './addons.css'
import { t } from '../lib/i18n.js'

const TrendChart = lazy(() => import('../components/AddonTrendChart.jsx'))

const formatMetric = (value, unit) => value == null ? t('Not reported') : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`

function Metric({ label, value, unit }) {
  return <div className="addon-metric">
    <span className="addon-metric-label">{label}</span>
    <strong>{formatMetric(value, unit)}</strong>
  </div>
}

const BASIS = { '100g': 'Values per 100 g, as the label states.', '100ml': 'Values per 100 mL, as the label states.' }

// After a lookup: how much of it, at which meal, into the diary's day.
function LogFromLookup({ food, day }) {
  const update = useStore(s => s.update)
  const [amount, setAmount] = useState('100')
  const [meal, setMeal] = useState('snack')
  const [state, setState] = useState({ done: false, error: '' })
  const unit = food.basis === '100ml' ? 'mL' : 'g'
  const log = ev => {
    ev.preventDefault()
    try {
      update(s => { addFood(s, fromLookup(food, { d: day, meal, amount: amount === '' ? NaN : Number(amount) })) })
      setState({ done: true, error: '' })
    } catch (err) { setState({ done: false, error: t(err?.message || 'Could not log this food') }) }
  }
  if (state.done) return <p className="diary-logged" role="status">{t('Logged {0} {1} of {2} to {3}.', amount, unit, food.name, t(MEAL_LABEL[meal]).toLocaleLowerCase())}</p>
  return <form className="diary-quick" onSubmit={log} aria-label={t('Add to food diary')}>
    <label className="diary-field"><span>{t('Amount ({0})', unit)}</span>
      <input name="log-amount" type="text" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setState({ done: false, error: '' }) }} /></label>
    <label className="diary-field"><span>{t('Meal')}</span>
      <select name="log-meal" value={meal} onChange={e => setMeal(e.target.value)}>{MEALS.map(m => <option key={m} value={m}>{t(MEAL_LABEL[m])}</option>)}</select></label>
    <button type="submit" className="diary-primary" data-log-lookup>{t('Add to diary')}</button>
    {state.error && <p className="addon-error" role="alert">{state.error}</p>}
  </form>
}

function FoodLookup({ enabled, day }) {
  const [barcode, setBarcode] = useState('')
  const [food, setFood] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const lookup = async ev => {
    ev.preventDefault()
    if (!enabled || loading) return
    const code = barcode.trim()
    if (!/^\d{8,14}$/.test(code)) { setFood(null); setError(t('Enter a barcode of 8 to 14 digits.')); return }
    setLoading(true); setFood(null); setError('')
    try {
      const response = await api('/api/addons/food?barcode=' + encodeURIComponent(code))
      if (!response?.food) throw new Error('Product not found')
      setFood(response.food)
    } catch (err) {
      setError(t(err?.message || 'Food lookup unavailable'))
    } finally { setLoading(false) }
  }
  return <section className="addon-card" aria-labelledby="addon-food-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">{t('Nutrition · read only')}</span><h2 id="addon-food-title">{t('Nutrition lookup')}</h2></div>
      <span className="addon-state">{enabled ? t('Available') : t('Off by default')}</span>
    </div>
    <p>{t('Look up a product’s published nutrition per 100 g or mL using its barcode.')}</p>
    {!enabled && <p className="addon-note">{t('Needs a signed-in profile on a server with the nutrition lookup turned on (ADDON_NUTRITION=1).')}</p>}
    <form onSubmit={lookup} className="addon-form">
      <label htmlFor="addon-barcode">{t('Product barcode')}</label>
      <div className="addon-input-row">
        <input id="addon-barcode" name="barcode" type="text" inputMode="numeric" autoComplete="off"
          placeholder="3017620422003" maxLength={14} value={barcode} disabled={!enabled || loading}
          onChange={e => { setBarcode(e.target.value); setFood(null); setError('') }} />
        <button type="submit" data-lookup disabled={!enabled || loading}>{loading ? t('Looking up…') : t('Look up')}</button>
      </div>
    </form>
    {error && <p className="addon-error" role="alert">{error}</p>}
    {food && <div className="addon-food" aria-live="polite">
      <div className="addon-food-name"><strong>{food.name}</strong><span>{[food.brand, food.quantity].filter(Boolean).join(' · ')}</span></div>
      <div className="addon-metrics">
        <Metric label={t('Energy')} value={food.per100?.kcal} unit="kcal" />
        <Metric label={t('Protein')} value={food.per100?.proteinG} unit="g" />
        <Metric label={t('Carbs')} value={food.per100?.carbohydrateG} unit="g" />
        <Metric label={t('Fat')} value={food.per100?.fatG} unit="g" />
      </div>
      <p className="addon-footnote" data-basis>{t(BASIS[food.basis] || 'Per 100 g or mL, as the label states.')}</p>
      {food.allergens?.length > 0 && <p>{t('Reported allergens: {0}', food.allergens.join(', '))}</p>}
      <LogFromLookup key={food.barcode} food={food} day={day} />
      <p className="addon-footnote">{t('Source: Open Food Facts (ODbL database). Product data may be incomplete; check the label.')}</p>
    </div>}
    <p className="addon-footnote">{t('Nothing is sent on page load. Only the barcode you submit is looked up; no workout history is shared.')}</p>
  </section>
}

function ActivityPreview() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = async ev => {
    const file = ev.target.files?.[0]
    if (!file) return
    setBusy(true); setResult(null); setError('')
    try { setResult(await previewActivityFile(file)) }
    catch (err) { setError(t(err?.message || 'Could not read this activity')) }
    finally { setBusy(false); ev.target.value = '' }
  }
  return <section className="addon-card" aria-labelledby="addon-activity-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">{t('Training · on this device')}</span><h2 id="addon-activity-title">{t('Activity file preview')}</h2></div>
      <span className="addon-state">{t('No upload')}</span>
    </div>
    <p>{t('Inspect a FIT, TCX, or GPX activity file on this device before deciding what to do with it.')}</p>
    <label className="addon-picker">
      {busy ? t('Reading…') : t('Choose a GPX, TCX or FIT file')}
      <input type="file" accept=".gpx,.tcx,.fit" disabled={busy} onChange={pick} aria-label={t('Choose an activity file')} />
    </label>
    {error && <p role="alert" className="addon-error">{error}</p>}
    {result && <div className="addon-file-summary" aria-live="polite">
      <strong>{result.filename}</strong><span>{result.kind}</span>
      <div className="addon-metrics">
        <Metric label={t('Distance')} value={result.distanceKm} unit="km" />
        <Metric label={t('Duration')} value={result.durationMinutes} unit="min" />
      </div>
    </div>}
    <p className="addon-footnote">{t('Activity preview only: the file stays on your device. This does not import into workout history.')}</p>
  </section>
}

function TrainingInsights({ S, workouts, unit }) {
  // The same volume as Stats and the heatmap: from the logged sets, with the profile's warm-up and
  // bodyweight settings (sessionVolume), not a cached total that may predate an edit.
  const rows = useMemo(() => trainingVolumeSeries(workouts, {
    end: todayISO(), days: 14, dayOf: workoutDay, volumeOf: w => sessionVolume(w, S)
  }), [workouts, S])
  const total = rows.reduce((sum, row) => sum + row.volume, 0)
  return <section className="addon-card addon-trends" aria-labelledby="addon-trends-title">
    <div className="addon-headline"><div>
      <span className="addon-kicker">{t('Insights · your data')}</span>
      <h2 id="addon-trends-title">{t('Training volume')}</h2>
    </div><span className="addon-state">{t('Last 14 days')}</span></div>
    {workouts.length ? <>
      <p>{t('{0} of recorded training volume across this window.', `${Math.round(total).toLocaleString()} ${unit}`)}</p>
      <Suspense fallback={<p>{t('Preparing chart…')}</p>}><TrendChart rows={rows} unit={unit} /></Suspense>
    </> : <p className="addon-empty">{t('Complete a workout to see a real training-volume chart. No sample data is shown.')}</p>}
  </section>
}

const ROADS = [
  { name: 'NutriTrace food library', status: 'Server opt-in', detail: 'Log from your own NutriTrace foods once the server admin adds nutritrace to INTEGRATIONS. Sending workouts to NutriTrace waits on measured calories.' },
  { name: 'Recipes and meal plans', status: 'Not connected', detail: 'Mealie can be connected as a separate recipe service.' },
  { name: 'Advanced progression', status: 'Simulation', detail: 'Liftosaur-style rules run in an isolated evaluator and are compared with the built-in progression above; applying one to a routine comes later.' },
  { name: 'Endurance activities', status: 'Not connected', detail: 'FitTrackee is optional once activity previews prove useful.' },
  { name: 'Camera coaching', status: 'Lab preview', detail: 'The Movement lab above counts squats on this device; other movements and real-device testing come next. Bluetooth sensors come later.' },
  { name: '3D anatomy explorer', status: 'Lab preview', detail: 'The 3D muscle map above uses a simplified Z-Anatomy model (CC BY-SA 4.0) and the same levels as the 2D map.' },
  { name: 'Automations and AI', status: 'Existing integrations first', detail: 'Use the built-in webhooks and coach before adding Node-RED or LangGraph.' },
]

function Roadmap() {
  return <section className="addon-card" aria-labelledby="addon-roadmap-title">
    <div className="addon-headline"><div>
      <span className="addon-kicker">{t('Integrations · transparency')}</span><h2 id="addon-roadmap-title">{t('Extension roadmap')}</h2>
    </div></div>
    <p>{t('These systems are not connected by this prototype. Adding a name here does not grant access to external services.')}</p>
    <div className="addon-roadmap">
      {ROADS.map(item => <div key={item.name} className="addon-roadmap-row"><div>
        <strong>{t(item.name)}</strong><p>{t(item.detail)}</p>
      </div><small>{t(item.status)}</small></div>)}
    </div>
  </section>
}

export default function Addons() {
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  // Signing out keeps the config the session fetched; these two need a signed-in profile (the api
  // answers 401 otherwise), so they follow the user, not the config alone.
  const signedIn = !!useStore(s => s.user)
  const reduceMotion = useReducedMotion()
  const nav = useNavigate()
  // Back the way you came when there is a way, else up to where the Lab is listed (Settings).
  const back = () => ((window.history.state?.idx || 0) > 0 ? nav(-1) : nav('/settings/integrations', { replace: true }))
  const workouts = Array.isArray(S?.workouts) ? S.workouts : []
  const [day, setDay] = useState(todayISO)
  return <main className="addons-page">
    <button type="button" className="sp-back addons-back" data-back="/settings/integrations" onClick={back}><Icon name="chevronLeft" /><span>{t('Integrations')}</span></button>
    <motion.header className="addons-hero" initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26 }}>
      <span className="addon-kicker">{t('{0} Lab', APP_NAME)}</span>
      <h1>{t('More ways to train.')} <span>{t('Under your control.')}</span></h1>
      <p>{t('Optional, isolated additions to the tracker. Existing workout records are not changed here.')}</p>
    </motion.header>
    <div className="addons-layout">
      <FoodDiary day={day} setDay={setDay} />
      <TrainingInsights S={S} workouts={workouts} unit={S?.unit || 'kg'} />
      <AnatomyViewer />
      <FoodLookup enabled={signedIn && config?.addons?.nutrition === true} day={day} />
      {signedIn && config?.integrations?.providers?.includes('nutritrace') && <NutriTraceCard day={day} />}
      <ActivityPreview />
      <MovementLab />
      {/* The rule editor and the roadmap are for tinkerers: folded away so the page reads as a few
          clear tools first (release pass). */}
      <details className="addon-card addon-advanced">
        <summary>{t('Advanced: progression rules and roadmap')}</summary>
        <ProgressionLab unit={S?.unit || 'kg'} />
        <Roadmap />
      </details>
    </div>
  </main>
}
