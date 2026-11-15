import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO, uid } from '../lib/format.js'
import { NOTE_MAX } from '../lib/history.js'
import { tappable, useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import {
  RECOVERY_KINDS, RECOVERY_LABEL, RECOVERY_ICON, RECOVERY_PRESETS, RECOVERY_MIN_MAX,
  recoverySessionsOf, withRecovery, recoveryLine,
} from '../lib/recovery-sessions.js'
import DateField from './DateField.jsx'
import Icon from './Icon.jsx'
import { Button, Stepper } from './ui.jsx'

// Recovery sessions (lib/recovery-sessions.js): the sauna, the ice bath, the massage. Two taps:
// what it was and how long, the day and a note if you like. Opened from History, a day in the
// calendar and the journal; an existing one opens here to edit or remove.

function RecoveryLog({ id = null, day = null, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const had = id ? recoverySessionsOf(S).find(r => r.id === id) : null
  const [kind, setKind] = useState(had?.kind || 'sauna')
  const [min, setMin] = useState(had?.min || RECOVERY_PRESETS[had?.kind || 'sauna'][1])
  const [d, setD] = useState(had?.d || day || todayISO())
  const [note, setNote] = useState(had?.note || '')
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const pickKind = k => {
    setKind(k)
    // A preset of the old kind becomes the middle one of the new; a typed duration stays.
    if (RECOVERY_PRESETS[kind].includes(min)) setMin(RECOVERY_PRESETS[k][1])
  }
  const save = () => {
    if (!(min >= 1) || d > todayISO()) return
    update(s => { s.recoverySessions = withRecovery(s.recoverySessions, id || uid(), { d, kind, min, note: note.trim().slice(0, NOTE_MAX) }) })
    close()
    toast(had ? t('Saved') : t('{0} logged. Your muscles say thanks.', t(RECOVERY_LABEL[kind])))
  }
  const remove = () => {
    update(s => { s.recoverySessions = withRecovery(s.recoverySessions, id, null) })
    close()
    toast(t('Recovery session removed'))
  }
  return <>
    <h3>{had ? t('Edit recovery') : t('Log recovery')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Sauna, ice bath, massage: the work between the workouts. It shows in your history, not in your sets.')}</div>
    <div className="chips rec-kinds" role="radiogroup" aria-label={t('Kind')} style={{ margin: '0 0 12px', flexWrap: 'wrap' }}>
      {RECOVERY_KINDS.map(k => <button key={k} type="button" role="radio" aria-checked={kind === k}
        className={'chip nocap ichip' + (kind === k ? ' on' : '')} onClick={() => pickKind(k)}>
        <Icon name={RECOVERY_ICON[k]} />{t(RECOVERY_LABEL[k])}</button>)}
    </div>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('How long')}</div>
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      {RECOVERY_PRESETS[kind].map(m => <button key={m} type="button" className={'chip nocap' + (min === m ? ' on' : '')}
        aria-pressed={min === m} onClick={() => setMin(m)}>{t('{0} min', m)}</button>)}
      <Stepper value={min} min={1} max={RECOVERY_MIN_MAX} step={1} decimal={false} onChange={setMin} unit={t('min')} ariaLabel={t('Minutes')} />
    </div>
    <label className="measure-date">
      <span>{t('Date')}</span>
      <DateField value={d} max={todayISO()} onChange={setD} label={t('Date')} />
    </label>
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How was it? (optional)')} onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 16 }} />
    <Button variant="primary" icon="check" onClick={save} disabled={!(min >= 1)}>{t('Save')}</Button>
    {had && <><div style={{ height: 8 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Remove')}</Button></>}
  </>
}

/** Log a new recovery session (on `day`, else today), or edit the one with `id`. */
export const recoverySheet = ({ id = null, day = null } = {}) =>
  useUI.getState().openSheet(close => <RecoveryLog id={id} day={day} close={close} />)

/** One session as a list row, the way History lists a workout. */
export function RecoveryRow({ r, showDate = true }) {
  return <div className="item rec-row" {...tappable(() => recoverySheet({ id: r.id }))}>
    <span className="lrow-i rec-i" aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={RECOVERY_ICON[r.kind]} /></span>
    <div className="grow"><div className="tt">{t(RECOVERY_LABEL[r.kind])}</div>
      <div className="ss">{[showDate ? fmtDate(r.d, true) : null, t('{0} min', r.min), r.note].filter(Boolean).join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}

export { recoveryLine }
