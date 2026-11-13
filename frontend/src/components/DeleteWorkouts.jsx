import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { todayISO, fmtDate } from '../lib/format.js'
import { workoutsToDelete, deleteWorkoutsOnly, restoreWorkouts } from '../lib/delete-workouts.js'
import DateField from './DateField.jsx'
import Icon from './Icon.jsx'
import { Button, Row, Switch } from './ui.jsx'

// Settings → Data → Delete workouts only (gm-journal): a clean slate for the log without losing the
// plan. What goes and what stays is said in plain words, a backup is offered first (and is the
// button you meet first), and an Undo stays on screen for a while after. The deleting itself is an
// ordinary change through the store (lib/delete-workouts.js), so the sync records every removal
// and the other devices drop the same workouts.

function DeleteWorkouts({ close, onBackup, signedIn }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [onlyBefore, setOnlyBefore] = useState(false)
  const [before, setBefore] = useState(todayISO())
  const [backedUp, setBackedUp] = useState(false)
  const going = workoutsToDelete(S, onlyBefore ? { before } : {})
  const n = going.length
  const backup = async () => { try { await onBackup(); setBackedUp(true) } catch { /* share sheet dismissed */ } }
  const go = () => {
    let removed = []
    update(s => { removed = deleteWorkoutsOnly(s, onlyBefore ? { before } : {}) })
    close()
    toast(tn('{0} workout deleted. Fresh start!', '{0} workouts deleted. Fresh start!', removed.length), {
      action: t('Undo'),
      ms: 12000,
      onAction: () => { update(s => { restoreWorkouts(s, removed) }); toast(t('Workouts are back')) },
    })
  }
  return <>
    <h3>{t('Delete workouts only')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t('Clears your training log and keeps the rest: routines, plan, settings, gyms, body weight, measurements, activities like runs or rides, recovery sessions and progress photos filed under a day.')}
    </div>
    <div className="sect-b" style={{ marginBottom: 12 }}>
      <Row icon="calendar" iconTint="var(--blue)" title={t('Only workouts before a date')}>
        <Switch checked={onlyBefore} onChange={setOnlyBefore} aria-label={t('Only workouts before a date')} />
      </Row>
      {onlyBefore && <div style={{ padding: '4px 16px 12px' }}>
        <DateField value={before} max={todayISO()} onChange={setBefore} label={t('Before')} />
      </div>}
    </div>
    <div className="del-wk-count" role="status">
      <b>{tn('{0} workout goes', '{0} workouts go', n)}</b>
      <span className="muted small">{n
        ? t('With their sets, notes, photos and videos. {0} to {1}.', fmtDate(going[0].d, true), fmtDate(going[n - 1].d, true))
        : t('Nothing to delete here.')}</span>
      {signedIn && n > 0 && <span className="muted small">{t('From this server and every signed-in device too.')}</span>}
    </div>
    <div style={{ height: 14 }} />
    <Button variant={backedUp ? 'tinted' : 'primary'} icon={backedUp ? 'check' : 'download'} onClick={backup}>
      {backedUp ? t('Backup saved') : t('Back up first')}
    </Button>
    <div style={{ height: 8 }} />
    <button type="button" className="btn danger" disabled={!n} onClick={go}>
      <Icon name="trash" />{tn('Delete {0} workout', 'Delete {0} workouts', n)}
    </button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const deleteWorkoutsSheet = ({ onBackup, signedIn = false }) =>
  useUI.getState().openSheet(close => <DeleteWorkouts close={close} onBackup={onBackup} signedIn={signedIn} />)
