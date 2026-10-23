import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { parseProgramme } from '../lib/programme-share.js'
import { ProgrammeImport } from '../programme-sheets.jsx'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export default function SharedProgrammes({ onImported }) {
  const userId = useStore(s => s.user?.id)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    setRows(null); setError(false)
    if (!userId) return
    let active = true
    api('/api/shared-programmes').then(value => { if (active) setRows(value.programmes) }).catch(e => {
      // An older server has no shared library; keep its ordinary Plan unchanged.
      if (active) { if (e.status === 404) setRows([]); else setError(true) }
    })
    return () => { active = false }
  }, [userId, retry])
  const open = async id => {
    setBusy(id); setError(false)
    try {
      const { bundle } = await api('/api/shared-programmes?id=' + encodeURIComponent(id))
      const checked = parseProgramme(bundle)
      if (useStore.getState().user?.id !== userId) return
      useUI.getState().openSheet(close => <ProgrammeImport bundle={checked} userId={userId} close={close} onImported={() => {
        useStore.getState().update(s => { s.programmeMode = true })
        onImported?.()
      }} />)
    } catch { setError(true) }
    finally { setBusy(null) }
  }
  if (!userId || (rows?.length === 0 && !error)) return null
  return <section className="shared-programmes" aria-labelledby="shared-library-title">
    <h4 className="sec" id="shared-library-title">{t('Shared programmes')}</h4>
    {error ? <div role="alert"><p className="muted small">{t('Could not load shared programmes.')}</p><Button size="sm" onClick={() => setRetry(n => n + 1)}>{t('Try again')}</Button></div>
      : !rows ? <p role="status" className="muted small">{t('Loading…')}</p>
        : <ul className="shared-programme-list">{rows.map(row => <li className="row between" key={row.id}>
          <div className="shared-programme-name"><strong>{row.name}</strong><div className="muted small">{t('{0} weeks', row.weeks)}</div></div>
          <Button size="sm" disabled={busy !== null} onClick={() => open(row.id)} aria-label={t('Import “{0}”', row.name)}>{t('Import')}</Button>
        </li>)}</ul>}
  </section>
}
