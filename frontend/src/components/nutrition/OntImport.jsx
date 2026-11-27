import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { isOn } from '../../lib/modules.js'

// A different tab can change the persisted owner before this tab observes the handover.
function sameDiary(owner) {
  try {
    const state = useStore.getState()
    if (!state.ready || !isOn(state.S, 'nutrition') || (state.user?.id ?? null) !== owner) return false
    const saved = JSON.parse(localStorage.getItem('gym_user'))?.id ?? null
    return saved === owner && (owner ? localStorage.getItem('gym_owner') === owner
      : !localStorage.getItem('gym_owner') || !!localStorage.getItem('gym_guest'))
  } catch { return false }
}

export default function OntImport({ owner }) {
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState('')
  const version = useRef(0)
  useEffect(() => () => { version.current++ }, [])

  async function choose(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const request = ++version.current
    setPreview(null)
    setStatus('')
    if (!file || !sameDiary(owner)) return
    try {
      const { readOntArchive, mergeOntRows } = await import('../../lib/nutrition/ont-import.js')
      const { rows, skipped } = await readOntArchive(file)
      if (version.current !== request || !sameDiary(owner)) return
      setStatus(t('{0} entries ready. {1} skipped.', rows.length, skipped))
      if (rows.length) setPreview({ rows, mergeOntRows })
    } catch {
      if (version.current === request && sameDiary(owner)) setStatus(t('Could not read this OpenNutriTracker export.'))
    }
  }

  function confirm() {
    if (!preview || !sameDiary(owner)) return
    let counts
    try {
      useStore.getState().update(state => { counts = preview.mergeOntRows(state, preview.rows) }, true, { checkSyncLimit: true })
      setStatus('')
      useUI.getState().toast(t('Added: {0}. Updated: {1}. Unchanged: {2}.', counts.added, counts.updated, counts.unchanged))
    } catch (err) {
      setStatus(err?.message === 'sync-too-large'
        ? t('This import would exceed the account sync limit. Try a smaller export.')
        : t('Could not read this OpenNutriTracker export.'))
    }
    setPreview(null)
  }

  return <section className="card">
    <label className="nutrition-field"><span>{t('Import OpenNutriTracker export')}</span>
      <input type="file" accept=".zip,application/zip" onChange={choose} />
    </label>
    <p role="status">{status}</p>
    {preview && <div>
      <p>{owner ? t('Import into your synced account diary?') : t('Import into the diary on this device?')}</p>
      <button className="btn primary" onClick={confirm}>{t('Import')}</button>
      <button className="btn" onClick={() => { setPreview(null); setStatus('') }}>{t('Cancel')}</button>
    </div>}
  </section>
}
