import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
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
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <span className="lrow-i" style={{ background: 'var(--green)' }}><Icon name="figureStrength" /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="lbl2">{t('Recovery')}</div>
        <div className="small" style={{ fontWeight: 500 }}>{text[0]}</div>
        <div className="small muted">{text[1]}</div>
        {hint.kind === 'lighter' && <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="tinted" icon="swap" onClick={() => dayOverrideSheet(today)}>{t('Swap session')}</Button>
        </div>}
      </div>
      <button type="button" className="iconbtn" style={{ width: 30, height: 30, fontSize: 14 }} onClick={dismiss} aria-label={t('Hide for today')}><Icon name="xmark" /></button>
    </div>
  </div>
}
