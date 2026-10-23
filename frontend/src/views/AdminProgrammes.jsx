import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { api } from '../lib/api.js'
import { buildProgrammeBundle, parseProgramme } from '../lib/programme-share.js'
import { Button } from '../components/ui.jsx'

// Like the rest of the operator dashboard, these controls are English-only.
export default function AdminProgrammes() {
  const programmes = useStore(s => s.S.programmes)
  const definitions = programmes?.definitions || []
  const [catalogue, setCatalogue] = useState(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = () => api('/api/admin/shared-programmes').then(setCatalogue)
  useEffect(() => { let active = true; api('/api/admin/shared-programmes').then(value => { if (active) setCatalogue(value) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [])
  const change = async (method, payload) => {
    setBusy(true); setError('')
    try {
      await api('/api/admin/shared-programmes', { method, body: JSON.stringify({ revision: catalogue.revision, ...payload }) })
      await reload()
    } catch (e) { setError(e.message); try { await reload() } catch { /* Keep the last readable list and the error. */ } }
    finally { setBusy(false) }
  }
  const publish = () => {
    try {
      const state = useStore.getState().S
      const definition = state.programmes?.definitions?.find(d => d.id === selected)
      const bundle = parseProgramme(buildProgrammeBundle(definition, { customEx: state.customEx, unit: state.unit }))
      void change('POST', { sourceId: selected, bundle })
    } catch (e) { setError(e.message) }
  }
  const alreadyShared = catalogue?.programmes.some(p => p.sourceId === selected)
  return <section className="card" aria-labelledby="shared-programmes-heading">
    <h2 id="shared-programmes-heading">Shared programmes</h2>
    <p className="adm-lead">Available to every signed-in user, including future accounts. Each person adds a copy and chooses when to start.</p>
    <p className="adm-hint">Shares programme and exercise notes, never history or private media. Review notes first. Updates and unsharing leave existing copies alone.</p>
    {error && <div role="alert" className="adm-lead">{error} <Button size="sm" disabled={busy} onClick={() => { setError(''); reload().catch(e => setError(e.message)) }}>Reload</Button></div>}
    {!catalogue && !error && <div role="status" className="adm-empty">Loading…</div>}
    <label className="label" htmlFor="shared-programme-source">Your saved programme</label>
    <select className="adm-select" id="shared-programme-source" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy || !catalogue}>
      <option value="">Select a programme</option>
      {definitions.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}
    </select>
    <Button variant="primary" disabled={busy || !catalogue || !selected} onClick={publish}>{busy ? 'Saving…' : alreadyShared ? 'Update shared copy' : 'Share with everyone'}</Button>
    {!definitions.length && <p className="adm-hint">Create or import a programme in Plan first.</p>}
    {catalogue && (catalogue.programmes.length ? <ul className="adm-shared-list">
      {catalogue.programmes.map(p => <li key={p.id} className="row between">
        <div className="adm-shared-name"><strong>{p.name}</strong><div className="adm-hint">{p.weeks} weeks</div></div>
        <Button size="sm" disabled={busy} onClick={() => change('DELETE', { id: p.id })}>Unshare</Button>
      </li>)}
    </ul> : <p className="adm-empty">No programmes shared yet.</p>)}
  </section>
}
