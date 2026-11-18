// The Extension Lab's NutriTrace card: connect the profile's own NutriTrace (an address and an API
// token with read:foods, sealed on the server), then search its food library and log a food into
// the diary's day. Talks only to openGym's /api/integrations routes; the server calls NutriTrace.
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { MEALS, addFood, fromNutriTrace, nutriTraceProblem } from '../lib/nutrition-diary.js'
import { MEAL_LABEL } from './FoodDiary.jsx'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const unitLabel = basis => (basis === '100ml' ? 'mL' : 'g')

function ConnectForm({ onConnected }) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const out = await post('/api/integrations/connect', { provider: 'nutritrace', url: url.trim(), token: token.trim() })
      setToken('')
      onConnected(out?.connection || null)
    } catch (err) { setError(err?.message || 'Could not connect') }
    finally { setBusy(false) }
  }
  return <form className="diary-form nt-connect" onSubmit={submit} aria-label="Connect NutriTrace">
    <label className="diary-field diary-wide"><span>NutriTrace address</span>
      <input name="nt-url" type="url" inputMode="url" autoComplete="off" placeholder="https://nutritrace.example.com" value={url} onChange={e => { setUrl(e.target.value); setError('') }} /></label>
    <label className="diary-field diary-wide"><span>API token</span>
      <input name="nt-token" type="password" autoComplete="off" spellCheck={false} placeholder="nt_pat_..." value={token} onChange={e => { setToken(e.target.value); setError('') }} /></label>
    <p className="addon-footnote diary-wide">Make one in NutriTrace under Settings, API Tokens, with the read:foods scope. openGym keeps it sealed on its server and never shows it again.</p>
    {error && <p className="addon-error" role="alert">{error}</p>}
    <div className="diary-actions"><button type="submit" className="diary-primary" disabled={busy} data-nt-connect>{busy ? 'Connecting…' : 'Connect'}</button></div>
  </form>
}

function Result({ food, day, meal }) {
  const update = useStore(s => s.update)
  const [amount, setAmount] = useState(food.portion > 0 ? String(food.portion) : '100')
  const [state, setState] = useState({ done: false, error: '' })
  const problem = nutriTraceProblem(food)
  const add = () => {
    try {
      update(s => { addFood(s, fromNutriTrace(food, { d: day, meal, amount: amount === '' ? NaN : Number(amount) })) })
      setState({ done: true, error: '' })
    } catch (err) { setState({ done: false, error: err?.message || 'Could not log this food' }) }
  }
  const kcal = food.perPortion?.kcal
  return <li className="nt-result" data-nt-food={food.id}>
    <div className="diary-entry-main"><strong>{food.name}</strong>
      <span>{[food.brand, food.portion != null && food.unit ? `${food.portion} ${food.unit}` : '', kcal != null ? `${kcal} kcal` : ''].filter(Boolean).join(' · ')}</span></div>
    {state.done ? <span className="nt-added" role="status">Added</span>
      : !problem ? <div className="nt-add">
        <input className="nt-amount" type="text" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setState({ done: false, error: '' }) }} aria-label={`Amount of ${food.name} in ${unitLabel(food.basis)}`} />
        <span className="nt-unit">{unitLabel(food.basis)}</span>
        <button type="button" className="diary-primary" onClick={add} data-nt-add>Add</button>
      </div>
      : problem === 'implausible'
        ? <span className="addon-footnote nt-cannot">Its values per 100 are ones no food can have. Check this food in NutriTrace.</span>
        : <span className="addon-footnote nt-cannot">Measured in {food.unit || 'servings'}: only g or mL can go into the diary.</span>}
    {state.error && <p className="addon-error" role="alert">{state.error}</p>}
  </li>
}

export default function NutriTraceCard({ day }) {
  const [conn, setConn] = useState(undefined)   // undefined: loading, null: none
  const [loadError, setLoadError] = useState('')
  const [q, setQ] = useState('')
  const [meal, setMeal] = useState('snack')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState({ text: '', error: false })

  const load = useCallback(() => api('/api/integrations').then(d => {
    setConn((d?.connections || []).find(c => c.provider === 'nutritrace') || null); setLoadError('')
  }).catch(err => { setConn(null); setLoadError(err?.message || 'Could not load your connections') }), [])
  useEffect(() => { load() }, [load])

  const search = async ev => {
    ev.preventDefault()
    if (busy) return
    setBusy(true); setNote({ text: '', error: false })
    try { const out = await api('/api/integrations/nutritrace/foods?q=' + encodeURIComponent(q.trim())); setResults(out?.foods || []) }
    catch (err) { setResults(null); setNote({ text: err?.message || 'Search failed', error: true }); load() }
    finally { setBusy(false) }
  }
  const check = async () => {
    setNote({ text: 'Checking…', error: false })
    try {
      const out = await post('/api/integrations/test', { id: conn.id })
      setNote(out?.ok ? { text: 'Connected, and the token can read your foods.', error: false } : { text: out?.msg || 'The check failed.', error: true })
      if (out?.connection) setConn(out.connection)
    } catch (err) { setNote({ text: err?.message || 'The check failed.', error: true }) }
  }
  const disconnect = async () => {
    try { await post('/api/integrations/disconnect', { id: conn.id }); setConn(null); setResults(null); setNote({ text: '', error: false }) }
    catch (err) { setNote({ text: err?.message || 'Could not disconnect', error: true }) }
  }

  return <section className="addon-card" aria-labelledby="nt-title">
    <div className="addon-headline">
      <div><span className="addon-kicker">NUTRITION / YOUR NUTRITRACE</span><h2 id="nt-title">NutriTrace foods</h2></div>
      <span className="addon-state" data-nt-state>{conn === undefined ? 'Loading' : !conn ? 'Not connected' : conn.status === 'attention' ? 'Needs attention' : conn.status === 'paused' ? 'Paused' : 'Connected'}</span>
    </div>
    <p>Log foods from your own NutriTrace library. Only your search text goes to NutriTrace; nothing is written there.</p>
    {loadError && <p className="addon-error" role="alert">{loadError}</p>}
    {conn === null && <ConnectForm onConnected={c => { setConn(c); setNote({ text: '', error: false }) }} />}
    {conn && <>
      <p className="addon-note">{conn.info?.host || conn.label}{conn.lastError?.msg ? `: ${conn.lastError.msg}` : ''}</p>
      <form className="diary-quick nt-search" onSubmit={search} aria-label="Search your NutriTrace foods">
        <label className="diary-field"><span>Search</span>
          <input name="nt-q" type="search" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} placeholder="skyr" maxLength={80} /></label>
        <label className="diary-field"><span>Add to</span>
          <select name="nt-meal" value={meal} onChange={e => setMeal(e.target.value)}>{MEALS.map(m => <option key={m} value={m}>{MEAL_LABEL[m]}</option>)}</select></label>
        <button type="submit" className="diary-primary" disabled={busy} data-nt-search>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {results && (results.length
        ? <ul className="nt-results" aria-live="polite">{results.map(f => <Result key={`${f.id}|${day}|${meal}`} food={f} day={day} meal={meal} />)}</ul>
        : <p className="addon-empty">No foods in your NutriTrace match that.</p>)}
      <div className="nt-tools">
        <button type="button" className="diary-secondary" onClick={check} data-nt-check>Check connection</button>
        <button type="button" className="diary-secondary" onClick={disconnect} data-nt-disconnect>Disconnect</button>
      </div>
    </>}
    {note.text && <p className={note.error ? 'addon-error' : 'addon-footnote'} role={note.error ? 'alert' : 'status'}>{note.text}</p>}
  </section>
}
