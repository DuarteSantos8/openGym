import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { settingsFor, withSettings, joinNote, noteWithoutSettings, settingLabel, knownKeys, SUGGESTED_KEYS, SETTINGS_MAX, KEY_MAX, VALUE_MAX } from '../lib/machine-settings.js'
import { NOTE_MAX } from '../lib/history.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

// An exercise's machine settings (lib/machine-settings.js): "Seat: 5", "Leg position: M", shown as
// tags next to its muscle and equipment wherever the exercise is, so the machine is set in
// seconds. A tap on one opens the sheet that edits them all.

/** The settings as tags; tappable when `onEdit` is given. Nothing at all without settings. */
export function MachineSettingTags({ pairs, onEdit }) {
  if (!pairs?.length) return null
  return pairs.map((p, i) => {
    const inner = <>{i === 0 && <Icon name="slider" />}{settingLabel(p)}</>
    return onEdit
      ? <button key={i} type="button" className="tag acc nocap mset" onClick={onEdit}
          aria-label={t('Machine settings') + ': ' + settingLabel(p)}>{inner}</button>
      : <span key={i} className="tag acc nocap mset">{inner}</span>
  })
}

/** The quiet offer under an exercise's tags when it has none yet (the detail sheet). */
export function MachineSettingsLink({ exId }) {
  return <button type="button" className="small dim exfix-link mset-link" onClick={() => machineSettingsSheet(exId)}>
    <Icon name="plus" /> {t('Add machine settings')}
  </button>
}

const blank = () => ({ k: '', v: '' })

function MachineSettingsSheet({ exId, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const ex = exOr(exId)
  const id = useId()
  const [rows, setRows] = useState(() => {
    const saved = settingsFor(S, exId)
    return saved.length ? saved : [blank()]
  })
  // Where the cursor goes after a row is added: its name, or its value when the name came from a
  // suggestion.
  const keyRefs = useRef([]), valueRefs = useRef([])
  const [focus, setFocus] = useState(null)
  useEffect(() => {
    if (!focus) return
    ;(focus.value ? valueRefs : keyRefs).current[focus.at]?.focus()
    setFocus(null)
  }, [focus])

  const used = rows.map(r => r.k.trim().toLocaleLowerCase()).filter(Boolean)
  const suggestions = [...new Set([...knownKeys(S), ...SUGGESTED_KEYS.map(k => t(k))])]
    .filter(k => !used.includes(k.toLocaleLowerCase())).slice(0, 8)
  const full = rows.filter(r => r.k.trim() || r.v.trim()).length >= SETTINGS_MAX

  const setAt = (i, field, value) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)))
  const add = (k = '') => {
    if (full) return
    const empty = rows.findIndex(r => !r.k.trim() && !r.v.trim())
    const at = empty >= 0 ? empty : rows.length
    setRows(rs => { const next = [...rs]; next[at] = { k, v: '' }; return next })
    setFocus({ at, value: !!k })
  }
  const remove = i => setRows(rs => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [blank()]))
  const [tooLong, setTooLong] = useState(false)
  const save = () => {
    // Too long together with the note under the line: keep the sheet open, change nothing, say why.
    if (joinNote(rows, noteWithoutSettings(S, exId)).length > NOTE_MAX) { setTooLong(true); return }
    update(s => { s.exNotes = withSettings(s.exNotes, exId, rows, NOTE_MAX) })
    close()
  }

  return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Seat, leg position and the like. Shown with the exercise, so the machine is set in seconds.')}
    </div>
    {rows.map((r, i) => <div key={i} className="row mset-row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
      <input ref={el => { keyRefs.current[i] = el }} className="input" style={{ flex: '1.4 1 0', minWidth: 0 }}
        id={i === 0 ? id : undefined} aria-label={t('Name')} placeholder={t('Name, e.g. {0}', t('Seat'))}
        maxLength={KEY_MAX} value={r.k} onChange={e => setAt(i, 'k', e.target.value)} />
      <input ref={el => { valueRefs.current[i] = el }} className="input" style={{ flex: '1 1 0', minWidth: 0 }}
        aria-label={r.k.trim() ? t('Value for {0}', r.k.trim()) : t('Value')} placeholder={t('Value')}
        maxLength={VALUE_MAX} value={r.v} onChange={e => setAt(i, 'v', e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save() } }} />
      <button type="button" className="iconbtn" style={{ flex: 'none' }} aria-label={t('Remove')} title={t('Remove')} onClick={() => remove(i)}>
        <Icon name="xmark" />
      </button>
    </div>)}
    {suggestions.length > 0 && !full && <div className="chips" style={{ margin: '4px 0 10px' }}>
      {suggestions.map(k => <button key={k} type="button" className="chip nocap" onClick={() => add(k)}><Icon name="plus" />{k}</button>)}
    </div>}
    <Button variant="tinted" icon="plus" disabled={full} onClick={() => add()}>{t('Add setting')}</Button>
    {tooLong && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 10 }}>{t('The note is too long for the machine settings. Shorten it and try again.')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

/** The sheet that edits an exercise's machine settings. */
export const machineSettingsSheet = exId => useUI.getState().openSheet(close => <MachineSettingsSheet exId={exId} close={close} />)
