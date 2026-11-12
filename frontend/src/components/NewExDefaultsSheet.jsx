// Settings → Workout → New exercises start with (QOL Q10): the sets and reps (and the hold's
// seconds) an exercise gets when you add it to a routine or a workout. Saved as S.newExDefaults;
// lib/history.js pickedExerciseConfig reads it. Cardio keeps its one block of time.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { NEW_EX_DEFAULTS, newExDefaultsOf, fmtSec } from '../lib/history.js'
import { Stepper, Button } from './ui.jsx'
import { isoRun } from '../lib/bidi.js'

/** "3 × 10 · 3 × 0:45", as the settings row shows it. */
export const newExLine = S => { const d = newExDefaultsOf(S); return `${isoRun(`${d.sets} × ${d.reps}`)} · ${isoRun(`${d.sets} × ${fmtSec(d.sec)}`)}` }

export default function NewExDefaultsSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [d, setD] = useState(() => newExDefaultsOf(S))
  const plain = d.sets === NEW_EX_DEFAULTS.sets && d.reps === NEW_EX_DEFAULTS.reps && d.sec === NEW_EX_DEFAULTS.sec
  const save = () => {
    update(s => { if (plain) delete s.newExDefaults; else s.newExDefaults = { ...d } })
    close()
  }
  return <>
    <h3>{t('New exercises start with')}</h3>
    <p className="intg-lead">{t('What an exercise gets when you add it to a routine or a workout. You can still change each one after.')}</p>
    <div className="nexd">
      <Stepper label={t('Sets')} ariaLabel={t('Sets')} value={d.sets} min={1} max={10} decimal={false} onChange={v => setD(x => ({ ...x, sets: v }))} />
      <Stepper label={t('Reps')} ariaLabel={t('Reps')} value={d.reps} min={1} max={50} decimal={false} onChange={v => setD(x => ({ ...x, reps: v }))} />
      <Stepper label={t('Seconds for a hold')} ariaLabel={t('Seconds for a hold')} value={d.sec} step={5} min={5} max={600} decimal={false} onChange={v => setD(x => ({ ...x, sec: v }))} />
    </div>
    <p className="muted small nexd-note">{t('Cardio keeps starting as one block of time.')}</p>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {!plain && <Button variant="plain" onClick={() => setD({ ...NEW_EX_DEFAULTS })}>{t('Back to 3 × 10')}</Button>}
  </>
}
