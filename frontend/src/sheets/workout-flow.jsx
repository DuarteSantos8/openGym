import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX, exOr, betterWeight, beatsWeight, isCustomEx } from '../lib/exercises.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, todayISO, isoOf, uid, exCount, setsWorkCount } from '../lib/format.js'
import { effectiveRoutineIds, bestWeightFor, bestWeightForEntry, workoutVolume, setsDone, setsDoneActive, setUnitsTotal, setLabel, workSetsDone, NOTE_MAX } from '../lib/history.js'
import { beep } from '../lib/sound.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { nav, closeThenNav, navToWorkout } from '../lib/nav.js'
import { back } from '../lib/use-tab-nav.js'
import WorkoutMediaSection from '../components/WorkoutMedia.jsx'
import { workoutMediaOf } from '../lib/media-refs.js'
import Stepper from '../components/Stepper.jsx'
import { durationSheet } from '../components/DurationWheel.jsx'
import { SG_NAME_MAX } from '../lib/superset-meta.js'
import { REST_MAX, fmtRest } from '../lib/duration.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch, SelectRow, Row } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import BodyMap from '../components/BodyMap.jsx'
import { exerciseMuscleSnapshot, loadOfWorkouts } from '../lib/muscles.js'
import { is1RMRecord } from '../lib/onerm.js'
import { entryDbLoad } from '../lib/dumbbells.js'
import { speedUnitOf } from '../lib/speed.js'
import { buildCompletedWorkout, sessionEnd } from '../lib/finish-workout.js'
import { refillAfter } from '../lib/rotation.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { repeatSessionEntries } from '../lib/session-repeat.js'
import { useSheetKeyboard, tappable }from '../lib/use-sheet-keyboard.js'
import { buildSessionEntries } from '../lib/session-start.js'
import { finishCompare, finishCardio } from '../lib/finish-compare.js'
import { joinSessionNoProg } from '../lib/session-noprog.js'
import { buildCombinedEntries, deriveSessionName } from '../lib/session-merge.js'
import { syncNow } from '../lib/nutrition/sync.js'
import { reportWorkoutKcal } from '../lib/nutrition/workout-kcal.js'
import { workoutsOn, backfillStart, backfillEnd, completeBackfill, historyAsOf, sessionHistory } from '../lib/backfill.js'
import { rebuildPrHistory, MAX_DURATION_MIN, endsInFuture } from '../lib/workout-date.js'
import { editLeftEmpty, editedRecord, editChangesNothing } from '../lib/session-edit.js'
import { stampWorkout } from '../lib/sync-merge.js'
import { S, update, ui, toast, snd } from './shared.js'
import { confirmSheet, menuSheet } from './confirm-menu.jsx'
import { bwSheet } from './body-weight.jsx'
import { mediaGoesToo } from './workout-detail.jsx'

/* ============================ workout lifecycle ============================ */
// Start / Resume from anywhere (the + sheet, the Training hub): back to the session that is on,
// else today's planned routines when any of them has exercises, else the Start screen to pick one.
export function startOrResume() {
  const st = S()
  if (st.active) { navToWorkout(); return }
  const ids = effectiveRoutineIds(st, todayISO())
  if (ids.some(id => st.routines.find(r => r.id === id)?.ex.length)) { startFlow(ids); return }
  navToWorkout()
}

// `routineIds` accepts `string | string[] | null` — `[r.id]` for one routine,
// `effectiveRoutineIds(...)` for today's planned session, `[]` / null for explicit freestyle.
export function startFlow(routineIds) {
  // The weigh-in is a setting (Settings → During a workout, issue #137): off goes straight
  // into the session with no body weight on it, same as "Start without weighing in".
  if (S().weighIn === false) { beginWorkout(routineIds, null); return }
  bwSheet({ required: true, onDone: bw => beginWorkout(routineIds, bw) })
}
export function beginWorkout(routineIds, bw) {
  const st = S()
  const { entries, routineIds: rids, routines } = buildCombinedEntries(st, routineIds)
  update(s => {
    s.active = {
      id: uid(), d: todayISO(), start: Date.now(),
      // A session tracks its routines as a list; per-entry `rid` carries which one each
      // exercise came from. No top-level `excludeFromProgression` — per-entry `noProg` does it.
      routineIds: rids,
      name: routines.length ? deriveSessionName(routines.map(r => r.name)) : t('Freestyle'),
      bw: bw || null, cur: 0, entries,
      // Snapshot the layout at start so the header ⋮ can change it for this session only —
      // changing the saved default (Settings → Workout view) mid-session leaves it alone.
      workoutView: st.workoutView || 'cards',
    }
  })
  useUI.getState().stopRest()
  navToWorkout()
}

// "Repeat today" (#58): a saved workout's exercises as a new freestyle session dated today, each
// seeded from what that workout logged (lib/session-repeat.js). The weigh-in asks first, the
// way starting any workout does.
export function repeatWorkout(w, close) {
  const st = S()
  if (st.active) { toast(t('Finish the current workout first.')); return }
  const { entries, skipped } = repeatSessionEntries(st, w)
  if (!entries.length) { toast(t('Nothing to repeat. Its exercises no longer exist.')); return }
  const go = bw => {
    if (S().active) { toast(t('Finish the current workout first.')); return }
    update(s => {
      s.active = {
        id: uid(), d: todayISO(), start: Date.now(), routineIds: [],
        name: w.name || t('Freestyle'), bw: bw || null, cur: 0, entries,
        workoutView: s.workoutView || 'cards',
      }
    })
    useUI.getState().stopRest()
    if (close) closeThenNav(close, '/train/workout'); else navToWorkout()
    if (skipped) toast(tn('{0} exercise no longer exists and was left out.', '{0} exercises no longer exist and were left out.', skipped))
  }
  if (st.weighIn === false) { go(null); return }
  if (close) close()
  bwSheet({ required: true, onDone: go })
}

/* ============================ log a past workout ============================ */
// The same screen as a live session, pointed at another day. `backfill` on the active
// session is what tells the workout screen to drop the clock and the rest timers, and tells
// the finish path to file the workout where its date belongs instead of at the end.
// `initial` is a missed day of the plan (#284): its date, and the routines planned for it. A
// combined day is offered as the one session it plans, next to each routine on its own.
const PLANNED_DAY = '__planned-day'
function LogPastWorkout({ initial, close }) {
  const st = useStore(s => s.S)
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const planned = [].concat(initial?.routineIds || []).map(id => st.routines.find(r => r.id === id)).filter(Boolean)
  const [date, setDate] = useState(initial?.iso || isoOf(yesterday))
  const [time, setTime] = useState('18:00')
  const [dur, setDur] = useState(60)
  const [routineId, setRoutineId] = useState(planned.length > 1 ? PLANNED_DAY : planned[0]?.id || '')
  const today = todayISO()
  const options = [
    { value: '', label: t('Freestyle') },
    ...(planned.length > 1 ? [{ value: PLANNED_DAY, label: deriveSessionName(planned.map(r => r.name)) }] : []),
    ...st.routines.map(r => ({ value: r.id, label: r.name })),
  ]

  const go = replaceId => {
    close()
    const routineIds = routineId === PLANNED_DAY ? planned.map(r => r.id) : routineId ? [routineId] : []
    beginBackfill({ iso: date, time, durationMin: Math.max(1, dur), routineIds, replaceId })
  }
  const submit = () => {
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    if (!(dur >= 1)) { toast(t('Enter how long it took (at least 1 minute).')); return }
    if (dur > MAX_DURATION_MIN) { toast(t('That’s more than a day. Keep it to 24 hours or less.')); return }
    if (endsInFuture(date, time, dur)) { toast(t('That’s still in the future. Try an earlier start.')); return }
    const existing = workoutsOn(st, date)
    if (!existing.length) { go(null); return }
    ui().openSheet(c => <SameDayChoice iso={date} existing={existing} close={c}
      onReplace={id => { c(); go(id) }} onAdd={() => { c(); go(null) }} />, { kind: 'center' })
  }

  return <>
    <h3>{t('Log a past workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Logged on the usual workout screen, without timers.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={e => setDate(e.target.value)} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={e => setTime(e.target.value)} /></Row>
    <Stepper label={t('Duration')} unit={t('min')} value={dur} step={5} min={0} decimal={false} invalid={!(dur >= 1) || dur > MAX_DURATION_MIN} onChange={v => setDur(Math.round(v))} />
    {!(dur >= 1) && <div className="small" style={{ color: 'var(--red-ink)', marginTop: 6 }}>{t('Enter how long it took (at least 1 minute).')}</div>}
    {dur > MAX_DURATION_MIN && <div className="small" style={{ color: 'var(--red-ink)', marginTop: 6 }}>{t('That’s more than a day. Keep it to 24 hours or less.')}</div>}
    <div style={{ height: 8 }} />
    <SelectRow icon="dumbbell" title={t('Routine')} value={routineId} options={options} onChange={setRoutineId} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={submit}>{t('Continue')}</Button>
  </>
}
// Three ways out when the day already has a workout. Replacing with several on that day means
// picking which one; the rest of the day is left alone. A workout with photos or videos says
// they come along.
function SameDayChoice({ iso, existing, onReplace, onAdd, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{fmtDate(iso, true)}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{t('There is already a workout on that day.')}</div>
    {existing.map(w => {
      // Replacing re-logs the sets; the photos and videos move to the new record (completeBackfill).
      const n = workoutMediaOf(w, Infinity).length
      return <div key={w.id} style={{ marginBottom: 8 }}>
        <button className="btn danger" onClick={() => onReplace(w.id)}>{existing.length > 1 ? t('Replace') + ' · ' + w.name : t('Replace')}</button>
        {n > 0 && <div className="small dim samed-media" style={{ marginTop: 4 }}>{tn('Its photo or video moves to the new workout.', 'Its {0} photos or videos move to the new workout.', n)}</div>}
      </div>
    })}
    <button className="btn primary" onClick={onAdd}>{t('Add as second workout')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}
// History's button hands this its click event; only a day from the plan counts as `initial`.
export function logPastWorkoutSheet(initial) {
  if (S().active) { toast(t('Finish the current workout first.')); return }
  const from = typeof initial?.iso === 'string' ? initial : null
  ui().openSheet(close => <LogPastWorkout initial={from} close={close} />)
}
// A backfilled session is built the way a live one is (buildCombinedEntries → buildPlannedEntry),
// so its entries carry the same stamps: the routine list, per-entry rid and the plan, no
// top-level routineId. One routine from the picker, or every routine of a missed combined day.
// Only from the history before that day (historyAsOf): a session logged later must not hand its
// progression back to the day it skipped.
function beginBackfill({ iso, time, durationMin, routineIds, replaceId }) {
  const st = S()
  const start = backfillStart(iso, time)
  const past = historyAsOf(st, { d: iso, start, replaceId })
  const { entries, routineIds: rids, routines } = buildCombinedEntries(past, routineIds || [])
  update(s => {
    s.active = {
      id: uid(), d: iso, start,
      routineIds: rids,
      name: routines.length ? deriveSessionName(routines.map(r => r.name)) : t('Freestyle'),
      bw: null, cur: 0, entries,
      backfill: { durationMin, replaceId: replaceId || null },
      // Same layout snapshot as a live session (see beginWorkout).
      workoutView: st.workoutView || 'cards',
    }
  })
  useUI.getState().stopRest()
  navToWorkout()
}

/* ============================ add a routine mid-session ============================ */
// The workout header ⋮ → Add routine. Single-pick: a routine already in the session, or one
// with no exercises, is shown disabled and tagged. Picking one appends its entries (each
// stamped with its `rid`), extends `s.active.routineIds`, and re-derives the session name.
// `s.active.cur` is left where it is — the appended block is reached by scrolling / Next.
function AddRoutineToSession({ close }) {
  const st = useStore(s => s.S)
  const active = st.active
  if (!active) return null
  const inSession = new Set([].concat(active.routineIds || []))
  const add = r => {
    const entries = buildSessionEntries(sessionHistory(st), r).map(e => ({ ...e, rid: r.id }))
    update(s => {
      if (!s.active) return
      // A session kept out of progression as a whole (the header ⋮) keeps the routine's
      // exercises out too, the same as an exercise added on its own.
      s.active.entries.push(...entries.map(e => joinSessionNoProg(s.active, e)))
      s.active.routineIds = [...[].concat(s.active.routineIds || []), r.id]
      if (!s.active.customName) {
        s.active.name = deriveSessionName(s.active.routineIds.map(id => s.routines.find(x => x.id === id)?.name).filter(Boolean))
      }
    })
    close()
    toast(t('{0} added ({1})', r.name, exCount(r.ex.length)))
  }
  return <>
    <h3>{t('Add routine')}</h3>
    <div className="list">
      {st.routines.map(r => {
        const already = inSession.has(r.id)
        const empty = !(r.ex || []).length
        const disabled = already || empty
        return <div key={r.id} className={'item' + (disabled ? ' disabled' : '')} aria-disabled={disabled || undefined}
          {...tappable(disabled ? null : () => add(r))}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
          {already ? <span className="tag">{t('already added')}</span> : empty ? <span className="tag">{t('no exercises')}</span> : <Icon name="chevronRight" className="chev" />}
        </div>
      })}
    </div>
  </>
}
export function addRoutineToSessionSheet() {
  if (!S().active) return
  ui().openSheet(close => <AddRoutineToSession close={close} />)
}

/* ============================ exercise notes ============================
   Two notes, one sheet, because from the user's side it is one question — "what do I want to
   remember about this exercise?" — with two different lifetimes:

     · today's note belongs to this session and is stored on the workout entry. It is history:
       what happened, how it felt. The PIN is the user saying "this one is for next time", which
       only they can know at the moment of writing — see pinnedNoteFor.
     · the standing note belongs to the exercise itself and lives in S.exNotes. Seat height, pin
       position, a form cue. True every session, so it is shown every session and never expires.

   A routine's own `note` (a plan's instruction for this exercise) is edited in the config sheet
   and is deliberately not here: it belongs to the plan, not to the day or to the movement. */
function ExerciseNote({ entryIdx, close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const A = st.active
  const editing = !!A?.editingWorkoutId
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry ? exOr(entry.id) : null
  const [note, setNote] = useState(entry?.note || '')
  const [pin, setPin] = useState(!!entry?.notePin)
  const [standing, setStanding] = useState(entry ? (st.exNotes?.[entry.id] || '') : '')
  useEffect(() => { if (!entry) close() }, [!entry])
  if (!entry) return null

  const save = () => {
    const today = note.trim().slice(0, NOTE_MAX)
    const always = standing.trim().slice(0, NOTE_MAX)
    update(s => {
      const e = s.active?.entries?.[entryIdx]
      if (e) {
        if (today) { e.note = today; if (pin) e.notePin = true; else delete e.notePin }
        else { delete e.note; delete e.notePin }
      }
      if (!editing) {
        s.exNotes = s.exNotes || {}
        if (always) s.exNotes[entry.id] = always
        else delete s.exNotes[entry.id]
      }
    })
    close()
  }

  return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('This session')}</div>
    <textarea ref={noteRef} className="input" rows={3} maxLength={NOTE_MAX} value={note}
      placeholder={t('How it went, what to change. Saved with today’s workout.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="sect-b">
      <Row icon="pin" iconTint="var(--yellow)" title={t('Show this next time')}
        subtitle={t('Brings it up again the next time you train this exercise.')}>
        <Switch checked={pin} onChange={setPin} disabled={!note.trim()} />
      </Row>
    </div>
    {!editing && <>
      <div style={{ height: 18 }} />
      <div className="small muted" style={{ marginBottom: 6 }}>{t('Always for this exercise')}</div>
      <textarea className="input" rows={2} maxLength={NOTE_MAX} value={standing}
        placeholder={t('Seat height, pin position, a form cue. Shown every session.')}
        onChange={e => setStanding(e.target.value)} />
    </>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const exerciseNoteSheet = entryIdx => ui().openSheet(close => <ExerciseNote entryIdx={entryIdx} close={close} />)

function SetNote({ entryIdx, setIdx, close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const row = useStore(s => s.S.active?.entries?.[entryIdx]?.sets?.[setIdx])
  const update = useStore(s => s.update)
  const [note, setNote] = useState(row?.note || '')

  useEffect(() => { if (!row) close() }, [!row])
  if (!row) return null

  const save = () => {
    const text = note.trim().slice(0, NOTE_MAX)
    update(s => {
      const set = s.active?.entries?.[entryIdx]?.sets?.[setIdx]
      if (!set) return
      if (text) set.note = text
      else delete set.note
    }, true)
    close()
  }

  return <>
    <h3>{t('Set note')}</h3>
    <textarea ref={noteRef} className="input" rows={4} maxLength={NOTE_MAX} value={note}
      placeholder={t('Anything specific to remember about this set.')}
      onFocus={onNoteFocus} onChange={event => setNote(event.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

export const setNoteSheet = (entryIdx, setIdx) =>
  ui().openSheet(close => <SetNote entryIdx={entryIdx} setIdx={setIdx} close={close} />)

/* The session note: how the whole workout went, as opposed to how one exercise went. It lives
   on the active session, so buildCompletedWorkout carries it onto the finished workout and it
   shows up again in history — where it stays editable. Written here rather than only after the
   fact because "notes you can write during a workout" is the point; a note you can only add
   once the session is filed is a different, smaller feature. */
function SessionNote({ close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const A = st.active
  const [note, setNote] = useState(A?.note || '')
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null

  const save = () => {
    const text = note.trim().slice(0, NOTE_MAX)
    update(s => { if (!s.active) return; if (text) s.active.note = text; else delete s.active.note })
    close()
  }

  return <>
    <h3>{t('Session note')}</h3>
    <textarea ref={noteRef} className="input" rows={4} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const sessionNoteSheet = () => ui().openSheet(close => <SessionNote close={close} />)

function RenameWorkout({ close }) {
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef)
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const A = st.active
  const [name, setName] = useState(A?.name || '')
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null

  const trimmed = name.trim().slice(0, 60)
  const canSave = trimmed.length > 0

  const save = () => {
    if (!canSave) return
    update(s => {
      if (!s.active) return
      s.active.name = trimmed
      s.active.customName = true
    })
    close()
  }

  return <>
    <h3>{t('Rename workout')}</h3>
    <input ref={inputRef} className="input" type="text" autoFocus maxLength={60} value={name}
      placeholder={t('Workout title')}
      onFocus={onFocus} onChange={e => setName(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && canSave) save() }} />
    <div style={{ height: 18 }} />
    <Button variant="primary" disabled={!canSave} onClick={save}>{t('Save')}</Button>
  </>
}
export const renameWorkoutSheet = () => ui().openSheet(close => <RenameWorkout close={close} />)

// A superset's own name and rest between rounds (#292), from the routine editor.
function SupersetSettings({ meta, onSave, close }) {
  const inputRef = useRef(null)
  const onFocus = useSheetKeyboard(inputRef)
  const [name, setName] = useState(meta.name || '')
  const [rest, setRest] = useState(meta.rest || 0)
  const save = () => { onSave({ name: name.trim().slice(0, SG_NAME_MAX), rest }); close() }
  return <>
    <h3>{t('Superset')}</h3>
    <input ref={inputRef} className="input" type="text" maxLength={SG_NAME_MAX} value={name}
      placeholder={t('Name, e.g. Arm finisher')} onFocus={onFocus} onChange={e => setName(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 12 }} />
    <div className="list">
      <Row icon="timer" iconTint="var(--orange)" title={t('Rest after each round')}
        value={rest > 0 ? fmtRest(rest) : t('Longest exercise rest')} accessory="chevron"
        onClick={() => durationSheet({ title: t('Rest after each round'), value: rest, max: REST_MAX, off: t('Longest exercise rest'),
          footer: t('Without one, the superset rests as long as its longest exercise rest.'), onDone: setRest })} />
    </div>
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const supersetSheet = (meta, onSave) => ui().openSheet(close => <SupersetSettings meta={meta} onSave={onSave} close={close} />)

/* Drop-set drops and rest-pause bursts are edited inline on the set row itself (Workout.jsx) —
   no sheet, no timer. A planned exercise (see the "Intensifier" config below) arrives with them
   already computed via applyIntensifierPlan; an unplanned straight set can still grow one live
   by tapping "+ Drop"/"+ Burst", which appends with the same suggested-next-value math. */

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc-ink)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('All exercises done. Nice work! Finish up, or add another one if you’ve got more in you.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going: tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

export function saveWorkoutEdits(onExit = () => nav('/train/history')) {
  // A save decision left open after the editor already closed (a second prompt from a route
  // exit that raced the first save) has nothing to save or delete: it only finishes leaving.
  if (!S().active?.editingWorkoutId) { onExit(); return }
  // An edit that unticked or removed every set would save a workout with nothing in it, which
  // the history would still list and count as a training day. Deleting it is what that edit
  // means; Keep editing goes back to the sets.
  if (editLeftEmpty(S().active)) {
    confirmSheet({
      title: t('Delete workout?'),
      message: t('No sets are left in this workout, so there is nothing to save. Delete it from your history?') + mediaGoesToo(editedRecord(S())),
      confirmText: t('Delete workout'), cancelText: t('Keep editing'), danger: true,
      onConfirm: () => {
        useStore.getState().deleteHistoryEdit()
        useUI.getState().stopRest()
        useUI.getState().stopWork()
        useStore.getState().autoBackupNow()
        toast(t('Workout deleted'))
        onExit()
      },
    })
    return
  }
  try {
    useStore.getState().saveHistoryEdit()
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    useStore.getState().autoBackupNow()
    toast(t('Workout updated'))
    onExit()
  } catch (error) { toast(t(error.message)) }
}

// The one save prompt that may be open: { id, onExit }. Closing the editor and a route exit
// can both ask in the same moment (the X, then the route change its tap set off); a second
// prompt stacked under the first came back after Save changes and asked all over again
// (QA 10-06). The second ask now joins the open prompt and only says where to go after it.
let savePrompt = null
const promptOpen = () => !!savePrompt && useUI.getState().sheets.some(x => x.id === savePrompt.id)

export function exitWorkoutEdit(onExit = () => nav('/train/history')) {
  if (!S().active?.editingWorkoutId) { onExit(); return }
  if (promptOpen()) { savePrompt.onExit = onExit; return }
  const prompt = { id: null, onExit }
  const done = () => prompt.onExit()
  const leave = () => {
    // A stale prompt's Don't save must not throw away whatever is in S.active by now.
    if (!S().active?.editingWorkoutId) { done(); return }
    useStore.getState().discardHistoryEdit()
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    done()
  }
  // Nothing to save: closing just closes, as it does for a workout only looked at.
  if (editChangesNothing(S())) { leave(); return }
  prompt.id = ui().openSheet(close => <>
    <h3>{t('Save workout changes?')}</h3>
    <p className="muted">{t('Save your edits to this workout, or keep the original record.')}</p>
    <Button variant="primary" onClick={() => { close(); saveWorkoutEdits(done) }}>{t('Save changes')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); leave() }}>{t("Don't save")}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Keep editing')}</Button>
  </>, { kind: 'center' })?.id
  savePrompt = prompt
}

// "60 kg × 5, 5, 4", or "60×5 · 62.5×5" when the weight changed between sets; a bodyweight lift
// without load is just its reps. A set taken to failure keeps its "F", as it does in the history.
export function setsLine(sets, unit) {
  const ws = new Set(sets.map(s => s.w))
  const reps = s => s.r + (s.f ? ' ' + t('F') : '')
  if (ws.size === 1) {
    const w0 = sets[0].w
    return (w0 > 0 ? fmtNum(w0) + ' ' + unit + ' × ' : '') + sets.map(reps).join(', ')
  }
  return sets.map(s => (s.w > 0 ? fmtNum(s.w) + '×' : '') + reps(s)).join(' · ')
}
const TREND = { 1: ['arrowUp', 'var(--green-ink)'], 0: ['minus', 'var(--text-2)'], [-1]: ['arrowDown', 'var(--orange-ink)'] }
function LastAndNext({ st, w }) {
  const rows = finishCompare(st, w)
  if (!rows.length) return null
  const nextWord = { up: t('step up'), hold: t('same again'), down: t('lighter'), deload: t('deload') }
  return <div style={{ textAlign: 'start', marginBottom: 14 }}>
    <h4 className="sec">{t('Last time and next time')}</h4>
    <div className="list">{rows.map(row => {
      const ex = EXIDX[row.id]
      const tr = row.trend == null ? null : TREND[row.trend]
      return <div key={row.id} className="item" style={{ display: 'block' }}>
        <div className="row between" style={{ gap: 8 }}>
          <span className={'tt ' + exerciseNameClass(ex)} style={{ fontWeight: 600 }}>{ex ? exerciseNameFor(ex) : row.id}</span>
          {tr ? <span style={{ color: tr[1], display: 'inline-flex' }} aria-label={row.trend > 0 ? t('Up on last time') : row.trend < 0 ? t('Down on last time') : t('Same as last time')}><Icon name={tr[0]} /></span>
            : <span className="tag nocap">{t('First time')}</span>}
        </div>
        <div className="small">{t('Today')}: {setsLine(row.today, st.unit)}</div>
        {row.last && <div className="small dim">{t('Last time')}: {setsLine(row.last, st.unit)}</div>}
        {row.next && <div className="small accent">{t('Next time')}: {row.next.w != null ? fmtNum(row.next.w) + ' ' + st.unit : ''}{row.next.w != null && row.next.r != null ? ' × ' : ''}{row.next.r != null ? row.next.r : ''} · {nextWord[row.next.kind]}</div>}
      </div>
    })}</div>
  </div>
}

// The cardio of the session, which "Last time and next time" leaves out: minutes, speed and the
// treadmill's incline as they were logged.
function CardioDone({ st, w }) {
  const rows = finishCardio(w)
  if (!rows.length) return null
  return <div style={{ textAlign: 'start', marginBottom: 14 }}>
    <h4 className="sec">{t('Cardio')}</h4>
    <div className="list">{rows.map((row, i) => {
      const ex = EXIDX[row.id]
      return <div key={i} className="item" style={{ display: 'block' }}>
        <span className={'tt ' + exerciseNameClass(ex)} style={{ fontWeight: 600 }}>{ex ? exerciseNameFor(ex) : row.id}</span>
        <div className="small">{row.sets.map(x => setLabel(row.id, x, row.target, speedUnitOf(st))).join('  ·  ')}</div>
      </div>
    })}</div>
  </div>
}

function FinishSummary({ w, prs, e1prs = [], close }) {
  const st = useStore(s => s.S)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc-ink)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsWorkCount(setsDone(w), workSetsDone(w))}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '–'}</div></div>
    </div>
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'start', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} <span className={exerciseNameClass(EXIDX[id])}>{EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id}</span></div>)}
      {e1prs.map(p => <div key={p.id} className="small accent row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} <span className={exerciseNameClass(EXIDX[p.id])}>{EXIDX[p.id] ? exerciseNameFor(EXIDX[p.id]) : p.id}</span> · {fmtNum(p.est)} {st.unit}</div>)}
    </div>}
    <h4 className="sec" style={{ textAlign: 'start' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
    <div style={{ height: 14 }} />
    <LastAndNext st={st} w={w} />
    <CardioDone st={st} w={w} />
    {/* The moment for a progress photo or the clip of a set: the workout is already saved, so
        what is added here goes straight onto its record. */}
    <div style={{ textAlign: 'start' }}><WorkoutMediaSection w={w} hint /></div>
    {/* Back where the workout was opened from, its page taken off the tab's stack: going on to
        Home left the Start screen under it, one back press away (lib/use-tab-nav.js back). */}
    <Button variant="primary" onClick={() => { close(); back() }}>{t('Nice!')}</Button>
  </div>
}
export function finishWorkout() {
  if (S().active?.editingWorkoutId) { saveWorkoutEdits(); return }
  const A = S().active
  if (!A) return
  const done = setsDoneActive(A)
  const total = setUnitsTotal(A.entries)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: doFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: tn('{0} set still unchecked. Finish the workout now?', '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: doFinishWorkout }); return }
  doFinishWorkout()
}
// The workout screen's Finish pill (v1.3.11): one sheet with both ways out, Finish and save or
// Discard. It says what finishWorkout's confirm would have said about sets still unchecked, so
// the save needs no second question. `onDiscard` is the screen's own discard, with its confirm.
// The editor of a saved workout still saves at once.
export function finishWorkoutSheet({ onDiscard } = {}) {
  if (S().active?.editingWorkoutId) { saveWorkoutEdits(); return }
  const A = S().active
  if (!A) return
  const done = setsDoneActive(A)
  const total = setUnitsTotal(A.entries)
  menuSheet({
    title: !done ? t('Nothing logged yet') : done < total ? t('Finish early?') : t('Finish workout?'),
    subtitle: !done ? t('You haven’t checked off any sets. Finish the workout anyway?')
      : done < total ? tn('{0} set still unchecked. Finish the workout now?', '{0} sets still unchecked. Finish the workout now?', total - done) : null,
    sections: [
      { items: [{ icon: 'flag', accent: true, label: t('Finish and save'), onClick: doFinishWorkout }] },
      { items: [onDiscard && { icon: 'trash', danger: true, label: t('Discard workout'), onClick: onDiscard }] },
    ],
  })
}
function doFinishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const past = !!A.backfill
  const prs = []
  const e1prs = []
  // A workout logged into the past is held against the history before it, the way an edit of a
  // saved one is (rebuildPrHistory, below): it gains a badge it leads with, and a later session
  // it outdoes loses its own. It used to report none at all while the editor's Save awarded them
  // (QA 1.3.9). The confirmed weights are left alone either way.
  if (!past) A.entries.forEach(e => {
    const loads = e.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w).filter(w => w > 0)
    const mx = loads.length ? loads.reduce((a, b) => betterWeight(e.id, a, b)) : 0
    // Held against history read the way this session logged a dumbbell weight (lib/dumbbells.js).
    if (beatsWeight(e.id, mx, bestWeightFor(st, e.id, entryDbLoad(e)))) prs.push(e.id)
    // A heavier estimate without a heavier top set is its own kind of progress —
    // same weight for more reps. Reported separately so it can't be read as a load PR.
    const rec = is1RMRecord(st, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = buildCompletedWorkout(A, {
    end: past ? backfillEnd(A) : sessionEnd(A),
    prs,
    snapshotFor: e => isCustomEx(EXIDX[e.id]) ? exerciseMuscleSnapshot(EXIDX[e.id]) : null,
  })
  w.vol = workoutVolume(w)
  let shown = w
  update(s => {
    if (past) {
      // Its start and end are in the past; the stamp says when it was logged, which is what a
      // merge after a reset elsewhere asks of it (lib/sync-merge.js sinceReset).
      stampWorkout(w)
      const replaced = A.backfill.replaceId ? s.workouts.find(x => x.id === A.backfill.replaceId) : null
      const touched = [...new Set([...(replaced?.entries || []), ...w.entries].map(e => e?.id).filter(id => id != null))]
      s.workouts = rebuildPrHistory(completeBackfill(s.workouts, A, w), touched, w)
      shown = s.workouts.find(x => x === w || (w.id != null && x.id === w.id)) || w
      prs.push(...[...(shown.prs || [])])
    } else {
      w.entries.forEach(e => {
        const mx = bestWeightForEntry(e)
        if (mx > 0 && beatsWeight(e.id, mx, (s.exWeights[e.id] || {}).w || 0)) s.exWeights[e.id] = { w: mx, d: w.d }
      })
      s.workouts.push(w)
    }
    s.active = null
    // A rotation pass this app manages starts its next pass the moment the last session lands
    // (lib/rotation.js). A planner's queue is left alone: it completes and waits for its writer.
    refillAfter(s, w)
  })
  useStore.getState().autoBackupNow()
  // Its kcal entry reaches the day's diary now rather than at the hub's next poll.
  void syncNow().then(status => (status ? reportWorkoutKcal(shown) : null))
  useUI.getState().stopRest()
  // A hold still counting (a plank left unchecked, then Finish early) goes with the workout, as
  // on Discard: its bar is app-wide and would chime over the summary, and its callback writes
  // into s.active, which is gone. What it held is not logged, like any set left unchecked.
  useUI.getState().stopWork()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  ui().openSheet(close => <FinishSummary w={shown} prs={prs} e1prs={e1prs} close={close} />, { kind: 'center', locked: true })
}
