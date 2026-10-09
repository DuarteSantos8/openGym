import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import { exLine, modeOf } from '../lib/history.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { fmtRest } from '../lib/duration.js'
import { buildSessionEntry, builtOutOfProgression } from '../lib/session-start.js'
import { joinSessionNoProg } from '../lib/session-noprog.js'
import { appendLog } from '../lib/coach.js'
import { applyWorkoutActions, coachExerciseConfig, ensureWorkoutEntryKeys, markWorkoutActions, needsGroupChoice, workoutCoachSession } from '../lib/workout-coach.js'
import { awaitedJob, JOB_ERRORS, isDeclined, jobErrorText, requestWorkout, resolvePending, settleAwaited, useCoachStatus } from '../lib/coach-api.js'
import { swapGroupSheet } from '../sheets.jsx'
import { discardedFor } from '../lib/watch-sync.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { Button, Check } from './ui.jsx'
import { ChangeRow } from './ChangeRow.jsx'
import '../coach.css'

const QUICK = [
  'This hurts or doesn’t feel right',
  'This equipment is busy',
  'I need to finish sooner',
  'I feel great—add a little more'
]

const nameOf = id => exerciseNameText(exOr(id))

// Builds an exercise the Coach adds or swaps in the way the manual add does: the slot's routine
// and progression rules, today's history (buildSessionEntry, joinSessionNoProg).
const entryMaker = s => (id, after, slot) => {
  const routine = slot?.rid ? (s.routines || []).find(r => r.id === slot.rid) : null
  const built = buildSessionEntry(s, id, coachExerciseConfig(id, after), routine, slot)
  return joinSessionNoProg(s.active, {
    id, ...built, ...(slot?.rid ? { rid: slot.rid } : {}), ...(builtOutOfProgression(slot, routine) ? { noProg: true } : {})
  })
}

// The unfinished work of an entry as one line ("2 × 10 · 40 kg"), read from its rows.
function remainingLine(entry, unit) {
  const left = (entry?.sets || []).filter(set => !set.done && !isWarmupRow(set))
  if (!left.length) return '–'
  const top = key => Math.max(0, ...left.map(set => Number(set[key]) || 0))
  const cfg = { id: entry.id, mode: modeOf({ id: entry.id, ...entry.target }), sets: left.length, reps: top('r'), weight: top('w'), sec: top('sec'), min: top('min'), speed: left[0].speed }
  return exLine(cfg, unit)
}

function actionTitle(action, entries) {
  const name = nameOf(action.target?.exerciseId || action.after?.id)
  if (action.type === 'swap-exercise') return t('Swap {0} for {1}', name, nameOf(action.after.id))
  if (action.type === 'move-exercise') {
    const ref = entries.find(e => e.key === action.after.afterEntryKey)
    if (ref) return t('Move {0} after {1}', name, nameOf(ref.id))
    return action.after.afterEntryKey == null ? t('Move {0} first', name) : t('Move {0} later', name)
  }
  if (action.type === 'adjust-exercise') return t('Adjust {0}', name)
  if (action.type === 'skip-exercise') return t('Skip {0}', name)
  if (action.type === 'note') return t('Add to session note')
  return t('Add {0}', name)
}

// Exact before and after, worked out from the live workout rather than taken from the model.
function actionValues(action, S, make) {
  const entries = S.active.entries
  const entry = action.target && entries.find(e => e.key === action.target.entryKey)
  if (action.type === 'swap-exercise' || action.type === 'add-exercise') {
    const slot = entry || entries.find(e => e.key === action.after.afterEntryKey) || entries.at(-1)
    return { before: entry ? remainingLine(entry, S.unit) : '–', after: remainingLine(make(action.after.id, action.after, slot), S.unit) }
  }
  if (action.type === 'adjust-exercise') {
    const draft = structuredClone({ entries: [entry], cur: 0 })
    applyWorkoutActions(draft, [action], make)
    const line = e => remainingLine(e, S.unit) + (action.after.restSec != null ? ' · ' + t('{0} rest', fmtRest(e.target?.restSec > 0 ? e.target.restSec : S.restSec)) : '')
    return { before: line(entry), after: line(draft.entries[0]) }
  }
  if (action.type === 'skip-exercise') return { before: remainingLine(entry, S.unit), after: '–' }
  return null
}

const toggled = (current, id, on) => {
  const next = new Set(current)
  if (on) next.add(id); else next.delete(id)
  return next
}

const workoutLog = (pending, decisions) => ({ kind: 'workout', at: Date.now(), proposalId: pending.id, summary: pending.reply, decisions })
const decisions = (marked, accepted) => marked.map(({ values, stale, ...action }) => ({ ...action, status: accepted.has(action.id) ? 'accepted' : stale ? 'stale' : 'rejected' }))

// A suggestion whose workout is over can no longer apply: kept in the history as expired, then cleared.
function expire(pending, refresh) {
  if (pending.actions?.length) useStore.getState().update(s => appendLog(s, workoutLog(pending, pending.actions.map(a => ({ ...a, title: actionTitle(a, []), status: 'stale' })))))
  return resolvePending({ dismissed: true }).catch(() => {}).finally(refresh)
}

/** A workout's suggestion is over once that workout is finished (synced everywhere) or was discarded here.
    The discard never leaves this device; lib/watch-sync.js remembers it for the watch, and the Coach reads the
    same list, so a suggestion that lands after the discard is known to be over. Another device, which never saw
    that workout, leaves it alone. */
export function useExpireWorkoutProposal(pending, refresh) {
  const ready = useStore(s => s.ready)
  const finished = useStore(s => pending?.kind === 'workout' && (s.S.workouts || []).some(w => w?.id === pending.activeId))
  useEffect(() => {
    if (ready && pending?.kind === 'workout' && (finished || discardedFor().includes(pending.activeId))) expire(pending, refresh)
  }, [ready, finished, pending?.id])
}

export default function WorkoutCoachSheet({ close, anchorKey }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const { job, pending: anyPending, loading, lastError, last, refresh, maxMessageLen } = useCoachStatus(true)
  const pending = anyPending?.kind === 'workout' && anyPending.activeId === S.active?.id ? anyPending : null
  const [text, setText] = useState('')
  const textRef = useRef(null)
  const onTextFocus = useSheetKeyboard(textRef)
  const [selected, setSelected] = useState(new Set())
  const [applied, setApplied] = useState(null)
  const [limitation, setLimitation] = useState(null)
  const [busy, setBusy] = useState(false)
  useExpireWorkoutProposal(anyPending, refresh)

  const make = useMemo(() => entryMaker(S), [S])
  const marked = useMemo(() => markWorkoutActions(pending, S.active).map(action => ({
    ...action,
    title: actionTitle(action, S.active.entries),
    values: action.stale ? null : actionValues(action, S, make)
  })), [pending, S, make])
  const anchor = S.active?.entries?.find(entry => entry.key === anchorKey)

  // The reply joins the workout's conversation once, however often the sheet is reopened. Advice
  // with nothing to apply is settled at once, so the next question can follow.
  useEffect(() => {
    if (!pending) return
    setSelected(new Set())
    if (!(S.active?.coachChat || []).some(m => m.ref === pending.id)) update(s => {
      if (!s.active || (s.active.coachChat || []).some(m => m.ref === pending.id)) return
      s.active.coachChat = [...(s.active.coachChat || []), { role: 'coach', text: pending.reply, ref: pending.id }].slice(-8)
    })
    if (!pending.actions?.length) {
      settleAwaited(pending.id)
      resolvePending({ accepted: [] }).catch(() => {}).finally(refresh)
    }
  }, [pending?.id])

  useEffect(() => {
    if (loading || job || pending) return
    const mine = awaitedJob()
    if (!mine || last?.id !== mine) return
    settleAwaited(mine)
    if (last?.outcome === 'failed') toast(jobErrorText(lastError?.errorClass || last.errorClass, lastError?.detail))
  }, [loading, job, pending, last?.id])

  const send = async message => {
    const value = String(message ?? text).trim()
    if (!value || busy || job || anyPending) return
    setBusy(true)
    try {
      let session
      update(s => { session = workoutCoachSession(s.active, anchorKey) })
      await requestWorkout(value, session)
      // Stamped with the exercise it was asked from, for the thread and for the model.
      update(s => { if (s.active) s.active.coachChat = [...(s.active.coachChat || []), { role: 'user', text: value, ...(anchor ? { about: anchor.id } : {}) }].slice(-8) })
      setText('')
      refresh()
    } catch (e) { if (!isDeclined(e)) toast(JOB_ERRORS[e.data?.code] || e.message || t('Could not ask the Coach')) }
    setBusy(false)
  }

  const commit = (chosen, groupDisposition) => {
    const ui = useUI.getState()
    const restIdx = ui.timer?.forIdx
    let restAt = null
    // A timed hold closes over indexes that are about to move.
    ui.stopWork()
    try {
      update(s => {
        ensureWorkoutEntryKeys(s.active)
        const restKey = s.active.entries[restIdx]?.key
        applyWorkoutActions(s.active, chosen, entryMaker(s), { groupDisposition })
        restAt = restKey ? s.active.entries.findIndex(entry => entry.key === restKey) : null
        appendLog(s, workoutLog(pending, decisions(marked, new Set(chosen.map(a => a.id)))))
      })
    } catch {
      toast(t('This part of the workout has changed.'))
      return
    }
    // A rest follows its exercise, or ends with it.
    if (restAt != null) restAt < 0 ? ui.stopRest() : useUI.setState({ timer: { ...useUI.getState().timer, forIdx: restAt } })
    settleAwaited(pending.id)
    resolvePending({ accepted: chosen.map(a => a.id), rejected: marked.filter(a => !chosen.includes(a)).map(a => a.id) }).catch(() => {}).finally(refresh)
    const now = useStore.getState().S
    setApplied({ reason: pending.reason })
    // What hurt, and on which exercise: the line a future plan has to read on its own.
    const said = (now.active?.coachChat || []).filter(m => m.role === 'user').at(-1)?.text || ''
    setLimitation(anchor ? `${nameOf(anchor.id)}: ${said}` : said)
  }

  const apply = () => {
    const chosen = marked.filter(action => selected.has(action.id))
    // Something picked has changed under it: nothing applies, and the rest waits for another look.
    if (chosen.some(action => action.stale)) {
      setSelected(new Set(chosen.filter(action => !action.stale).map(action => action.id)))
      toast(t('This part of the workout has changed.'))
      return
    }
    if (!chosen.length) return
    if (needsGroupChoice(chosen, S.active)) swapGroupSheet(disposition => commit(chosen, disposition))
    else commit(chosen)
  }

  const dismiss = () => {
    update(s => appendLog(s, workoutLog(pending, decisions(marked, new Set()))))
    settleAwaited(pending.id)
    resolvePending({ dismissed: true }).catch(() => {}).finally(refresh)
    close()
  }

  const remember = () => {
    const note = limitation.trim()
    update(s => {
      const old = (s.coach.profile.limitations || '').trim()
      // The newest note is the one kept whole when the field is full.
      s.coach.profile.limitations = [old, note].filter(Boolean).join('\n').slice(-600)
    })
    toast(t('Saved for future plans'))
    setLimitation(null)
  }

  if (applied) return <div className="workout-coach">
    <h3>{t('Workout updated')}</h3>
    <p className="muted small">{t('Only unfinished work changed. Logged sets stay as they happened.')}</p>
    {applied.reason === 'discomfort' && limitation !== null && <>
      <h4 className="sec">{t('Remember this for future plans?')}</h4>
      <textarea className="input" rows={3} maxLength={600} value={limitation} onChange={e => setLimitation(e.target.value)} />
      <div style={{ height: 8 }} />
      <Button disabled={!limitation.trim()} onClick={remember}>{t('Save to my Coach profile')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Done')}</Button>
  </div>

  return <div className="workout-coach">
    <h3>{t('Coach')}</h3>
    <div className="muted small">{job ? t('Thinking about this workout…') : anchor ? nameOf(anchor.id) : t('Adapt the workout you’re doing now')}</div>
    <div className="msgs" style={{ margin: '14px 0' }}>
      {(S.active?.coachChat || []).map((message, i) => <div key={i} className={'msg ' + message.role}>
        <div className="bub">{message.text}</div>
        {message.about && <div className="msg-t">{nameOf(message.about)}</div>}
      </div>)}
      {job && <div className="msg coach"><div className="bub typing"><i /><i /><i /></div></div>}
    </div>
    {!job && !anyPending && <div className="chips-row">{QUICK.map(label => <button key={label} className="qchip" onClick={() => send(t(label))}>{t(label)}</button>)}</div>}
    {anyPending && !pending && (anyPending.kind === 'workout'
      // Another workout's suggestion, perhaps one discarded on a device that never says so.
      ? <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <p className="muted small grow">{t('A Coach suggestion for another workout is still waiting. Finish or discard that workout, or clear it here.')}</p>
        <Button size="sm" style={{ flex: 'none', width: 'auto', whiteSpace: 'nowrap' }} onClick={() => expire(anyPending, refresh)}>{t('Clear it')}</Button>
      </div>
      : <p className="muted small">{t('Finish the Coach suggestion already waiting for you before asking about this workout.')}</p>)}
    {pending && !!marked.length && <>
      {/* A note's line is the note itself, read as written; the Coach's reason for it stays in the log. */}
      {marked.map(action => <ChangeRow key={action.id} c={action.type === 'note' ? { ...action, why: action.after.text } : action} S={S} title={action.title} vals={action.values} stale={action.stale} staleNote={t('This part of the workout has changed.')}>
        {!action.stale && <Check checked={selected.has(action.id)} label={action.title} onChange={on => setSelected(toggled(selected, action.id, on))} />}
      </ChangeRow>)}
      <div className="pcard-note">{t('The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <Button variant="primary" disabled={!selected.size} onClick={apply}>{t('Apply selected changes')}</Button>
        <Button onClick={dismiss}>{t('Not today')}</Button>
      </div>
    </>}
    {/* The Session note's text box and button, so a sheet over the workout reads like the others. */}
    {!pending && <>
      <div style={{ height: 12 }} />
      <textarea ref={textRef} className="input" rows={4} maxLength={maxMessageLen || 1000} value={text}
        placeholder={t('What’s happening?')} disabled={!!job || !!anyPending}
        onFocus={onTextFocus} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
      <div style={{ height: 18 }} />
      <Button variant="primary" disabled={!text.trim() || busy || !!job || !!anyPending} onClick={() => send()}>{t('Send')}</Button>
    </>}
  </div>
}
