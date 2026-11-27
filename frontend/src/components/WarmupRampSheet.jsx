// Settings → Workout → Your warm-up ramp (#1423): the rows you warm up with, set once. Saved as
// S.warmupRamp; lib/warmup-ramp.js uses it wherever Auto would build the block, and an exercise's
// "My own" starts from it. No ramp saved is the built-in one.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { rampOf, cleanOwnRow, MAX_OWN_WARMUPS } from '../lib/warmup-ramp.js'
import { isoRun } from '../lib/bidi.js'
import { OwnWarmupRows } from './WarmupConfig.jsx'
import { Button } from './ui.jsx'

// Where a first ramp starts: the built-in one for a heavy barbell lift, to edit from.
const STARTER = [{ wb: true, r: 10 }, { wp: 40, r: 5 }, { wp: 60, r: 3 }, { wp: 80, r: 1 }]

/** "Bar × 10 · 50% × 5", or "Built-in" with none saved. */
export function rampLine(S) {
  const rows = rampOf(S)
  if (!rows.length) return t('Built-in')
  return rows.map(r => isoRun((r.wb ? t('Bar') : r.wp + '%') + ' × ' + r.r)).join(' · ')
}

export default function WarmupRampSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const saved = rampOf(S)
  const [rows, setRows] = useState(() => (saved.length ? saved : STARTER))
  const save = () => {
    const clean = rows.map(cleanOwnRow).filter(Boolean).slice(0, MAX_OWN_WARMUPS)
    update(s => { if (clean.length) s.warmupRamp = clean; else delete s.warmupRamp })
    close()
  }
  const reset = () => {
    update(s => { delete s.warmupRamp })
    close()
  }
  return <>
    <h3>{t('Your warm-up ramp')}</h3>
    <p className="intg-lead">{t('Set it once and every automatic warm-up follows it, scaled to the work weight. An exercise set to My own starts from it too.')}</p>
    <OwnWarmupRows rows={rows} setRows={setRows} lowest={0} bar />
    <p className="muted small nexd-note" style={{ marginTop: 10 }}>{t('No bar on the lift? That row is skipped. Exercises with their own warm-ups keep them.')}</p>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {saved.length > 0 && <Button variant="plain" onClick={reset}>{t('Back to the built-in ramp')}</Button>}
  </>
}
