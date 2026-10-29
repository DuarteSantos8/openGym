// "Ask the Coach" on an exercise in the middle of a workout (the `adapt` job): say what is going
// on (it hurts, the rack is taken, short on time, feeling great, running on empty), and the Coach
// suggests a few changes to what is left of the session, as cards you tick. Nothing changes until
// you apply them; logged sets and the routine are never touched (lib/coach-adapt.js).
//
// It goes through the same door as every Coach job (lib/coach-api.js): the data-sharing question
// first, the same polling, the same failures in the app's voice.
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtRest } from '../lib/duration.js'
import { exTitle, appendLog } from '../lib/coach.js'
import { useCoachStatus, requestAdapt, resolvePending, jobErrorText, isDeclined } from '../lib/coach-api.js'
import { adaptFor, markAdaptStale, applyAdapt, adaptLogEntry } from '../lib/coach-adapt.js'
import Icon from './Icon.jsx'
import { Button, Check, TextField } from './ui.jsx'
import '../coach.css'

export const ADAPT_REASONS = ['pain', 'busy', 'short', 'great', 'tired', 'other']
const REASON = {
  pain: () => ['warning', t('It hurts')],
  busy: () => ['clock', t('Machine’s taken')],
  short: () => ['timer', t('Short on time')],
  great: () => ['bolt', t('Feeling great')],
  tired: () => ['moon', t('Running on empty')],
  other: () => ['chat', t('Something else')],
}

/** One change as a line a tired person reads between sets. */
export function adaptTitle(c) {
  const ex = c.exId ? exTitle(c.exId) : ''
  switch (c.type) {
    case 'swap': return t('Swap {0} for {1}', ex, exTitle(c.to))
    case 'sets': return c.sets === 0 ? t('{0}: no more sets today', ex) : t('{0}: {1} sets left instead of {2}', ex, c.sets, c.before ?? '?')
    case 'reps': return t('{0}: {1} reps a set', ex, c.reps)
    case 'weight': return t('{0}: weight {1}', ex, (c.pct > 0 ? '+' : '−') + Math.abs(c.pct) + '%')
    case 'add': return t('Add {0}', exTitle(c.to)) + ' · ' + (c.sec ? t('{0} × {1} s', c.sets, c.sec) : t('{0} × {1}', c.sets, c.reps))
    case 'skip': return t('Skip the rest of {0}', ex)
    case 'move': return c.place === 'next' ? t('Do {0} next', ex) : t('Do {0} last', ex)
    case 'rest': return c.rest > 0 ? t('{0}: rest {1}', ex, fmtRest(c.rest)) : t('{0}: no rest timer', ex)
    default: return c.type
  }
}

/** The proposal as tickable cards: in the sheet during the workout, and in the Coach's chat. */
export function AdaptProposal({ p, onDone }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const live = adaptFor(S, p)
  const marked = useMemo(() => markAdaptStale(S, p), [S, p])
  const [accepted, setAccepted] = useState(() => new Set(marked.filter(c => !c.stale).map(c => c.id)))
  const toggle = id => setAccepted(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const ids = [...accepted].filter(id => marked.some(c => c.id === id && !c.stale))

  const finish = () => { try { onDone?.() } catch { /* the sheet may be gone */ } }
  const apply = () => {
    if (!ids.length) { dismiss(); return }
    const ui = useUI.getState()
    ui.stopWork?.()
    // A running rest belongs to an exercise (timer.forIdx); a skip or a move shifts the indexes.
    const rest = ui.timer
    const owner = rest?.forIdx != null ? S.active?.entries?.[rest.forIdx]?.id : null
    let applied = []
    update(s => {
      applied = applyAdapt(s, p, ids).applied
      if (applied.length) appendLog(s, adaptLogEntry(p, applied))
    })
    if (owner) {
      const at = (useStore.getState().S.active?.entries || []).findIndex(e => e.id === owner)
      if (at >= 0 && useUI.getState().timer) useUI.setState({ timer: { ...useUI.getState().timer, forIdx: at } })
    }
    resolvePending({ accepted: applied, rejected: marked.filter(c => !applied.includes(c.id)).map(c => c.id) }).catch(() => {})
    toast(applied.length ? tn('{0} change made to this workout', '{0} changes made to this workout', applied.length) : t('Nothing could be applied any more.'))
    finish()
  }
  const dismiss = () => {
    update(s => { appendLog(s, adaptLogEntry(p, [], { dismissed: true })) })
    resolvePending({ dismissed: true }).catch(() => {})
    finish()
  }

  return <div className="pcard adapt-card">
    <div className="pcard-hd">
      <div className="pcard-eyebrow">{t('For this workout')}</div>
      <h2 className="pcard-h">{tn('{0} suggestion', '{0} suggestions', marked.length)}</h2>
      {!!p.summary && <p className="pcard-sum">{p.summary}</p>}
      {!live && <p className="pcard-sum" style={{ fontSize: 13, color: 'var(--yellow)' }}>{t('That workout is over, so these can’t be applied any more.')}</p>}
    </div>
    {marked.map(c => <div key={c.id} className={'pcard-chg' + (c.stale ? ' stale' : '')}>
      <div className="grow">
        <div className="pcard-chg-t">{adaptTitle(c)}</div>
        <div className="pcard-chg-w">{c.why}</div>
        {c.stale && live && <div className="pcard-chg-stale">{t('Your workout moved on, so this one no longer fits.')}</div>}
      </div>
      {!c.stale && <Check checked={accepted.has(c.id)} onChange={() => toggle(c.id)} label={adaptTitle(c)} />}
    </div>)}
    <div className="pcard-note">{t('Logged sets and your routine stay as they are. The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
    <div className="pcard-ft">
      {live && <Button variant="primary" icon="check" onClick={apply} disabled={!ids.length}>
        {ids.length ? tn('Apply {0} change', 'Apply {0} changes', ids.length) : t('Apply nothing')}
      </Button>}
      <Button onClick={dismiss}>{live ? t('Not now') : t('Dismiss')}</Button>
    </div>
  </div>
}

/** The sheet: the question, the wait, the answer. */
export default function WorkoutCoachSheet({ entryIdx, close }) {
  const S = useStore(s => s.S)
  const entry = S.active?.entries?.[entryIdx]
  const { job, pending, last, lastError, refresh } = useCoachStatus(true)
  const [reason, setReason] = useState(null)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(null)        // the job this sheet started
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const mine = pending?.kind === 'adapt' && adaptFor(S, pending) ? pending : null

  // The sheet started a job and it ended without a proposal: say what came back.
  const ended = sent && !job && !mine && last?.id && last.id === sent
  useEffect(() => { if (sent && !job) refresh() }, [sent, !!job])

  const send = async () => {
    if (!reason || busy) return
    setBusy(true); setError(null)
    try {
      const r = await requestAdapt({ entry: entryIdx, reason, text })
      setSent(r?.job?.id || 'started')
      refresh()
    } catch (e) {
      if (!isDeclined(e)) setError(e?.data?.code ? jobErrorText(e.data.code) : (e?.message || t('Something went wrong on the server.')))
    } finally { setBusy(false) }
  }

  if (mine) return <div className="workout-coach"><AdaptProposal p={mine} onDone={close} /></div>
  const name = entry ? exTitle(entry.id) : ''
  return <div className="workout-coach">
    <div className="pcard-eyebrow"><Icon name="sparkles" /> {t('Ask the Coach')}</div>
    <h2 className="pcard-h" style={{ margin: '4px 0 12px' }}>{name}</h2>
    {job || (sent && !ended)
      ? <div className="adapt-wait" role="status">
        <div className="bub typing"><i /><i /><i /></div>
        <p className="small dim">{t('Looking at your workout…')} {t('You can keep training, the answer waits here and in the Coach.')}</p>
      </div>
      : ended
        ? <div className="adapt-ended">
          <p className="pcard-sum">{last.outcome === 'nochange'
            ? (last.reading || t('Nothing to change. Carry on as planned.'))
            : jobErrorText(last.errorClass, lastError?.detail)}</p>
          <Button onClick={close}>{t('Done')}</Button>
        </div>
        : <>
          <p className="small dim" style={{ marginBottom: 10 }}>{t('What’s up? The Coach suggests a few changes to what is left of this workout. Logged sets stay as they are.')}</p>
          <div className="adapt-reasons">
            {ADAPT_REASONS.map(k => {
              const [icon, label] = REASON[k]()
              return <button key={k} type="button" className={'chip' + (reason === k ? ' on' : '')} aria-pressed={reason === k} onClick={() => setReason(k)}>
                <Icon name={icon} /> {label}
              </button>
            })}
          </div>
          <TextField className="adapt-text" value={text} maxLength={400} placeholder={reason === 'pain' ? t('Where, and what movement hurts? (optional)') : t('Anything else? (optional)')}
            onChange={e => setText(e.target.value)} />
          {error && <p className="small" style={{ color: 'var(--red)' }}>{error}</p>}
          <div className="pcard-ft" style={{ paddingInline: 0 }}>
            <Button variant="primary" icon="sparkles" onClick={send} disabled={!reason || busy}>{t('Ask the Coach')}</Button>
            <Button onClick={close}>{t('Cancel')}</Button>
          </div>
        </>}
  </div>
}

/** Opens the sheet for the exercise at `entryIdx` of the running session. */
export function workoutCoachSheet(entryIdx) {
  useUI.getState().openSheet(close => <WorkoutCoachSheet entryIdx={entryIdx} close={close} />)
}
