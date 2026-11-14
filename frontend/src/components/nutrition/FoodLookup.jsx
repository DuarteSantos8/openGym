import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { api, remoteAuth } from '../../lib/api.js'
import { MOBILE } from '../../lib/mobile.js'
import { isOn } from '../../lib/modules.js'
import { t } from '../../lib/i18n.js'
import { sourceSnapshot, sourceFingerprint, validateBarcode, lookupInput } from '../../lib/nutrition/food-source.js'
import { createEntry, MEALS, NUTRIENTS } from '../../lib/nutrition/entry.js'
import { addEntry } from '../../lib/nutrition/diary.js'
import { formatNutrition } from '../../lib/nutrition/format.js'
import { mealLabels } from './EntrySheet.jsx'
import { nutrientLabels } from './DiarySummary.jsx'
import ErrorState from '../ErrorState.jsx'
import SourceSnapshot from './SourceSnapshot.jsx'

function unavailable(state) {
  if (MOBILE && !remoteAuth()) return t('Connect this phone to a server to look up food.')
  if (!state.user?.id) return t('Sign in to look up food.')
  if (state.config?.foodLookup?.status === 'disabled') return t('Food lookup is disabled on this server.')
  if (state.config?.foodLookup?.status !== 'configured-unverified') return t('Food lookup is not supported by this server.')
  return ''
}
function failure(error) {
  switch (error?.data?.code || error?.code) {
    case 'food-lookup-invalid-barcode': return t('Enter a valid barcode.')
    case 'food-lookup-not-found': return t('Product not found.')
    case 'food-lookup-auth-required': return t('Sign in to look up food.')
    case 'food-lookup-disabled': return t('Food lookup is disabled on this server.')
    case 'nutrition-disabled': return t('Nutrition is not enabled on the server yet. Wait for sync, then try again.')
    case 'food-lookup-rate-limited': return t('Too many lookups. Try again later.')
    case 'food-lookup-timeout': case 'timeout': return t('Food lookup timed out. Try again.')
    case 'not-paired': return t('Connect this phone to a server to look up food.')
    case 'food-lookup-upstream': case 'bad-response': return t('The food provider could not answer. Try again.')
    default: return error?.status ? t('The food provider could not answer. Try again.') : t('Could not reach the server. Manual logging still works.')
  }
}
export default function FoodLookup({ day }) {
  const user = useStore(s => s.user), config = useStore(s => s.config)
  const enabled = useStore(s => isOn(s.S, 'nutrition'))
  const [barcode, setBarcode] = useState(''), [preview, setPreview] = useState(null)
  const [amount, setAmount] = useState('100'), [unit, setUnit] = useState('g'), [meal, setMeal] = useState('snack')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false)
  const generation = useRef(0), submitting = useRef(false)
  const owner = user?.id || null, status = unavailable({ user, config })
  const clear = () => { generation.current++; setPreview(null); setBusy(false); setError(''); setSaved(false) }
  useEffect(() => {
    clear()
    // Subscribe synchronously too: even an off/on or account-away/back transition invalidates.
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.user?.id !== previous.user?.id || isOn(state.S, 'nutrition') !== isOn(previous.S, 'nutrition') || state.config?.foodLookup?.status !== previous.config?.foodLookup?.status) clear()
    })
    return () => { generation.current++; unsubscribe() }
  }, [day])
  const allowed = () => {
    const current = useStore.getState()
    return isOn(current.S, 'nutrition') && current.user?.id === owner && !unavailable(current)
  }
  const lookup = async event => {
    event.preventDefault()
    if (!allowed() || busy) return
    clear()
    if (!validateBarcode(barcode)) { setError(t('Enter a valid barcode.')); return }
    const request = ++generation.current
    setBusy(true)
    try {
      const value = await api('/api/food-lookup?barcode=' + encodeURIComponent(barcode))
      if (request !== generation.current || !allowed()) return
      let snapshot
      try {
        snapshot = sourceSnapshot(value)
        if (snapshot.externalId !== barcode) throw new Error('source-identity')
      } catch { throw { code: 'bad-response' } }
      const fingerprint = sourceFingerprint(snapshot)
      setPreview({ snapshot, fingerprint, generation: request }); setUnit(snapshot.per100.basis === 'g' ? 'g' : 'mL'); setAmount('100'); submitting.current = false
    } catch (err) {
      if (request === generation.current && allowed()) setError(failure(err))
    } finally { if (request === generation.current) setBusy(false) }
  }
  let input
  if (preview) try { input = lookupInput(preview.snapshot, amount, unit) } catch { /* invalid amounts cannot be saved */ }
  const save = () => {
    if (submitting.current || !preview || preview.generation !== generation.current || !input || !allowed()) return
    submitting.current = true
    try {
      const p = preview.snapshot
      const record = createEntry({ ...input, day, meal }, { source: p.source, externalId: p.externalId, contentFingerprint: preview.fingerprint, sourceSnapshot: p })
      useStore.getState().update(s => addEntry(s, record))
      clear(); setSaved(true)
    } catch { submitting.current = false; setError(t('Could not save food')) }
  }
  if (!enabled) return null
  const labels = nutrientLabels(), meals = mealLabels()
  const p = preview?.snapshot, basisUnit = p?.per100.basis === 'g' ? 'g' : 'mL'
  const serving = p?.serving?.[basisUnit === 'g' ? 'grams' : 'millilitres']
  return <section className="card nutrition-lookup">
    <h2>{t('Food lookup')}</h2>
    {status ? <p className="ss">{status}</p> : <>
      <p className="ss">{t('Lookup sends only this barcode through your server to Open Food Facts. It does not save a meal.')}</p>
      <p className="ss">{t('Configured on this server. Connection is checked only when you choose Lookup.')}</p>
      <form onSubmit={lookup} className="nutrition-lookup-form">
        <label className="nutrition-field"><span>{t('Barcode')}</span><input name="barcode" inputMode="numeric" autoComplete="off" maxLength={14} value={barcode} onChange={e => { clear(); setBarcode(e.target.value) }} /></label>
        <button className="btn" type="submit" disabled={busy}>{busy ? t('Looking up…') : t('Lookup')}</button>
      </form>
    </>}
    {error && <ErrorState title={t('Food lookup')} text={error} />}
    {saved && <p role="status">{t('Food saved')}</p>}
    {preview && !status && <div aria-live="polite">
      <SourceSnapshot value={p} />
      <div className="nutrition-pair">
        <label className="nutrition-field"><span>{t('Amount')}</span><input name="lookupAmount" type="number" min="0" max="1000000" step="any" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className="nutrition-field"><span>{t('Unit')}</span><select value={unit} onChange={e => setUnit(e.target.value)}><option value={basisUnit}>{basisUnit}</option>{serving && <option value="serving">{t('Serving')} ({p.serving.label})</option>}</select></label>
      </div>
      <label className="nutrition-field"><span>{t('Meal')}</span><select value={meal} onChange={e => setMeal(e.target.value)}>{MEALS.map(m => <option key={m} value={m}>{meals[m]}</option>)}</select></label>
      <h3>{t('Totals for this entry')}</h3>
      {input ? <dl className="nutrition-source-values">{NUTRIENTS.map(k => <div key={k}><dt>{labels[k]}</dt><dd>{input[k] === undefined ? t('Unknown') : formatNutrition(input[k])}</dd></div>)}</dl> : <p role="status">{t('Check the amount and calculated totals.')}</p>}
      <p className="ss">{t('Save keeps this source snapshot. You can edit the entry later without refreshing it.')}</p>
      <button className="btn primary" type="button" disabled={!input} onClick={save}>{t('Save')}</button>
    </div>}
  </section>
}
