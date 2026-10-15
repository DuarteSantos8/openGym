import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { EDIT_BACKDATE_MS } from '../lib/nutrition/fasting.js'
import { useFasting } from '../lib/nutrition/use-fasting.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { SheetHeader } from './sheet-layout.jsx'
import { Button, TextField } from './ui.jsx'

const pad = n => String(n).padStart(2, '0')
// A datetime-local field's value ("2026-10-14T21:30") is the person's own clock.
const localValue = ms => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Moves the start of the running fast: the person forgot to start it on time (FastingWidget.svelte
// _saveEditStart). Not in the future, at most 7 days back.
export default function FastStartSheet({ startAt, close }) {
  const [value, setValue] = useState(() => localValue(Date.parse(startAt)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    const at = new Date(value)
    if (!value || isNaN(at.getTime())) { setError(t('Enter a date and time.')); return }
    if (at.getTime() > Date.now()) { setError(t('The start cannot be in the future.')); return }
    // A minute inside the hub's 7-day line, so the request in flight does not cross it.
    if (at.getTime() < Date.now() - EDIT_BACKDATE_MS + 60_000) { setError(t('The start can be at most 7 days back.')); return }
    setBusy(true)
    setError(null)
    try {
      await useFasting.getState().editStart(at.toISOString())
      close()
      useUI.getState().toast(t('Start time updated'))
    } catch (e) {
      setError(writeErrorText(e))
      setBusy(false)
    }
  }

  return <div className="fast-start-sheet">
    <SheetHeader title={t('When did you start?')} />
    <label className="portion-f">
      <span className="small muted">{t('Start time')}</span>
      <TextField type="datetime-local" value={value} max={localValue(Date.now())} onChange={e => setValue(e.target.value)} aria-label={t('Start time')} />
    </label>
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <Button variant="primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save')}</Button>
  </div>
}

export function fastStartSheet(props) {
  useUI.getState().openSheet(close => <FastStartSheet {...props} close={close} />)
}
