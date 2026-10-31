import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import CardHead from './CardHead.jsx'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { fatigueOf, LB_TO_KG } from '../lib/recovery.js'
import { recoveryHint, hintText } from '../lib/recovery-hint.js'
import { lastBW } from '../lib/history.js'
import { dayOverrideSheet } from '../sheets.jsx'

// The recovery hint on Home (lib/recovery-hint.js): one short, kind line about what has rested
// and what is still recovering. Put away for the day with the ×, off in Settings → Look & Home.

export default function RecoveryHint({ S }) {
  const today = todayISO()
  const hour = new Date().getHours()
  const hint = useMemo(() => {
    if (S.recoveryHint === false || S.recoveryHintDay === today) return null
    const now = Date.now()
    const bw = lastBW(S)
    const bodyweightKg = bw && bw.w > 0 ? (S.unit === 'lb' ? bw.w * LB_TO_KG : bw.w) : undefined
    return recoveryHint(S, { now, today, fatigue: fatigueOf(S.workouts, now, { bodyweightKg, unit: S.unit }) })
  }, [S.workouts, S.recoveryHint, S.recoveryHintDay, S.active, S.week, S.dayPlan, S.queue, S.routines, S.unit, today, hour]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = hintText(hint, today)
  if (!text) return null
  const dismiss = () => useStore.getState().update(s => { s.recoveryHintDay = today })
  return <div className="card recovery-hint" data-hint={hint.kind}>
    <CardHead icon="figureStrength" tint="var(--green)" eyebrow={t('Recovery')} title={text[0]} sub={text[1]}
      action={<button type="button" className="iconbtn" onClick={dismiss} aria-label={t('Hide for today')}><Icon name="xmark" /></button>} />
    {hint.kind === 'lighter' && <div className="card-head-indent">
      <Button size="sm" variant="tinted" icon="swap" onClick={() => dayOverrideSheet(today)}>{t('Swap session')}</Button>
    </div>}
  </div>
}
