import { useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO, fmtDate, weekKey, weekStartOf } from '../lib/format.js'
import { programmeStatus } from '../lib/programmes.js'
import {
  deloadCycleOf, deloadWhy, nextDeloadWeek, deloadSuggestion, plusWeeks, pushBack, skipDeload, addDeload,
  dismissSuggestion, setDeloadEvery, setDeloadAuto, EVERY_CHOICES, DELOAD_SET_SHARE,
} from '../lib/deload-cycle.js'
import CardHead from './CardHead.jsx'
import { Button, Row, Segmented, Switch } from './ui.jsx'

/* Deload weeks without a programme (lib/deload-cycle.js). Home says it when this week or next
   week is one, with a one-tap way to move it, and asks when the numbers (and the daily form,
   when it is logged) say a lighter week would help. Settings → Advanced → Deload weeks sets the
   rhythm. No card at all with a programme running: its own weeks decide. */

const pct = Math.round((1 - DELOAD_SET_SHARE) * 100)

export function DeloadCard ({ S }) {
  const today = todayISO()
  const update = useStore(s => s.update)
  const view = useMemo(() => {
    if (programmeStatus(S, today)?.current) return null
    const cur = weekKey(today, weekStartOf(S))
    if (deloadWhy(S, cur)) return { kind: 'now', wk: cur }
    const next = plusWeeks(cur, 1)
    if (deloadWhy(S, next)) return { kind: 'next', wk: next }
    const sug = deloadSuggestion(S, today)
    return sug ? { kind: 'ask', wk: sug.week, reason: sug.reason } : null
  }, [S.deloadCycle, S.workouts, S.weekStart, S.programme, S.programmes, today]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return null
  const toast = (msg, undo) => useUI.getState().toast(msg, undo ? { action: t('Undo'), onAction: () => update(s => { s.deloadCycle = undo }) } : undefined)
  const before = S.deloadCycle ? JSON.parse(JSON.stringify(S.deloadCycle)) : undefined
  const act = (fn, msg) => { update(s => { fn(s) }); toast(msg, before) }
  if (view.kind === 'ask') {
    const why = view.reason === 'both' ? t('Your numbers dipped for two weeks and your check-ins say tired.')
      : view.reason === 'form' ? t('Your check-ins say tired, and the numbers are not climbing.')
        : t('Your numbers dipped for two weeks running.')
    return <div className="card deload-card" data-deload="ask">
      <CardHead icon="battery" tint="var(--indigo)" eyebrow={t('Deload week?')} title={t('A lighter week might do more than a harder one.')} sub={why} />
      <div className="card-head-indent row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" variant="tinted" onClick={() => act(s => addDeload(s, view.wk), t('Next week is a deload. Enjoy it.'))}>{t('Make next week one')}</Button>
        <Button size="sm" variant="ghost" onClick={() => act(s => dismissSuggestion(s, today), t('Fair enough. Asking again next week.'))}>{t('Not now')}</Button>
      </div>
    </div>
  }
  const now = view.kind === 'now'
  return <div className="card deload-card" data-deload={view.kind}>
    <CardHead icon="battery" tint="var(--indigo)" eyebrow={now ? t('Deload week') : t('Next week: deload')}
      title={now ? t('{0}% fewer sets, same weights. Recharge.', pct) : t('Next week runs {0}% fewer sets. Same weights.', pct)}
      sub={now ? t('It stays out of your progression, so nothing goes up or down.') : t('Starts {0}.', fmtDate(view.wk))} />
    <div className="card-head-indent row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Button size="sm" variant="tinted" icon="calendar" onClick={() => act(s => pushBack(s, view.wk), t('Moved to the week of {0}.', fmtDate(plusWeeks(view.wk, 1))))}>{t('Push it back a week')}</Button>
      <Button size="sm" variant="ghost" onClick={() => act(s => skipDeload(s, view.wk), now ? t('Full week it is.') : t('Skipped. Next week trains as usual.'))}>{now ? t('Not this week') : t('Skip this one')}</Button>
    </div>
  </div>
}

/** Settings → Advanced: the rhythm and the automatic suggestion. */
export function DeloadRows () {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const c = deloadCycleOf(S)
  const next = c.every ? nextDeloadWeek(S) : null
  return <>
    <Row icon="battery" iconTint="var(--indigo)" title={t('Deload weeks')}
      subtitle={c.every ? (next ? t('Every {0} weeks. Next one: week of {1}.', c.every, fmtDate(next)) : t('Every {0} weeks.', c.every)) : t('A lighter week on a rhythm, no programme needed.')}>
      <Segmented className="seg-inline" value={String(c.every)}
        options={EVERY_CHOICES.map(n => ({ value: String(n), label: n ? String(n) : t('Off') }))}
        onChange={v => update(s => { setDeloadEvery(s, Number(v)) })} />
    </Row>
    <Row icon="sparkles" iconTint="var(--indigo)" title={t('Suggest a deload when I need one')}
      subtitle={t('When your numbers dip two weeks running (and your check-ins say tired, if you log them), Home asks.')}>
      <Switch aria-label={t('Suggest a deload when I need one')} checked={c.auto} onChange={v => update(s => { setDeloadAuto(s, v) })} />
    </Row>
  </>
}
