// The safety copies the browser keeps (lib/safety-copies.js): a list with what each holds, and a
// restore. Restoring goes through importBackup, the same deliberate add-back as importing a file.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { deleteCopy, listCopies } from '../lib/safety-store.js'
import { Button } from './ui.jsx'

const reasonLabel = reason => (reason === 'reset' ? t('Before a reset') : reason === 'import' ? t('Before an import') : t('Automatic copy'))

export const summaryLine = s => [
  s.workouts ? t('{0} workouts', s.workouts) : '',
  s.routines ? t('{0} routines', s.routines) : '',
  s.plans ? t('{0} cardio plans', s.plans) : '',
].filter(Boolean).join(' · ') || t('Settings only')

// importBackup keeps a copy of what is here first (store/useStore.js), so a restore can be undone
// from this same list.
export function restoreCopy(copy) {
  useStore.getState().importBackup(copy.state)
  useUI.getState().toast(t('Copy restored'))
}

export default function SafetyCopiesSheet({ close, offered }) {
  const [copies, setCopies] = useState(null)
  useEffect(() => { listCopies().then(setCopies) }, [])

  const askRestore = copy => useUI.getState().openSheet(c => (
    <div>
      <h3>{t('Restore this copy?')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('Your current data is replaced by the copy from {0}. What is here now is kept as a copy first.', fmtDate(isoOf(new Date(copy.at)), false, true))}
      </div>
      <Button variant="primary" onClick={() => { c(); close(); restoreCopy(copy) }}>{t('Restore')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={c}>{t('Cancel')}</Button>
    </div>
  ), { kind: 'center' })

  return <>
    <h3>{offered ? t('Your data looks empty') : t('Safety copies')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('This browser keeps copies of your data, and one before every reset or import. They stay on this device.')}
    </div>
    {copies === null ? null : copies.length === 0
      ? <div className="muted small" style={{ margin: '4px 0 12px' }}>{t('No copies yet')}</div>
      : <div className="list" style={{ marginBottom: 12 }}>
        {copies.map(c => (
          <div key={c.id} className="item">
            <button type="button" className="grow cardio-plan-pick" onClick={() => askRestore(c)}>
              <div className="tt">{fmtDate(isoOf(new Date(c.at)), false, true)} · {reasonLabel(c.reason)}</div>
              <div className="small dim">{summaryLine(c.summary || {})}</div>
            </button>
            <Button size="sm" icon="trash" aria-label={t('Delete copy')}
              onClick={() => { deleteCopy(c.id).then(() => listCopies().then(setCopies)) }} />
          </div>
        ))}
      </div>}
    <Button onClick={close}>{offered ? t('Not now') : t('Close')}</Button>
  </>
}

export const safetyCopiesSheet = props => useUI.getState().openSheet(close => <SafetyCopiesSheet {...props} close={close} />)
