import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import {
  dayAssignSheet, starterPlanSheet, confirmSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile,
} from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Row, Section, Segmented } from '../components/ui.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import { copyRoutine, deleteRoutine, restoreRoutine, routineSnapshot } from '../lib/routines.js'
import { workoutControls } from '../lib/workout-controls.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useListReorder, moved } from '../lib/use-list-reorder.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import { queueOf, queueView } from '../lib/queue.js'
import { deriveSessionName } from '../lib/session-merge.js'
import { markUndone, undoMarks } from '../lib/sync-merge.js'
import {
  scheduleModeOf, queueRecovery, rotationIds, saveRotation, startNewPass, startPass, stopPass,
  chooseRotation, chooseFixedWeek,
} from '../lib/rotation.js'

// Plan has two views (v1.3.11): Schedule (how you train, and when) and Routines (what you
// train). The last one you looked at comes back: a per-device convenience, never synced, so it
// lives in this browser's storage and not in S.
export const PLAN_VIEW_KEY = 'gym_plan_view'
const readView = () => {
  try { return localStorage.getItem(PLAN_VIEW_KEY) === 'routines' ? 'routines' : 'schedule' } catch { return 'schedule' }
}

/* Undo for Plan's two removals (v1.3.11). Both go through the store's normal update, so sync
   sees an ordinary edit (a routine put back clears its own removal stamp, lib/sync-merge.js). */

/** Deletes a routine with an Undo toast in place of a confirm: the toast puts it back exactly,
 *  list place, weekdays, reschedules and loop included (lib/routines.js routineSnapshot). */
export function deleteRoutineWithUndo(id) {
  const st = useStore.getState()
  const snap = routineSnapshot(st.S, id)
  if (!snap) return false
  const before = st.S
  st.update(s => { deleteRoutine(s, id) })
  // What the removal moved (weekdays, reschedules, the loop), for the Undo to mark as put back:
  // a change another device made to one of them before it saw the removal then still wins.
  snap.marks = undoMarks(before, useStore.getState().S)
  useUI.getState().toast(t('“{0}” gone.', snap.routine.name), { action: t('Undo'), onAction: () => undoDeleteRoutine(snap) })
  return true
}
export function undoDeleteRoutine(snap) {
  let ok = false
  useStore.getState().update(s => { ok = restoreRoutine(s, snap); if (ok && snap.marks) markUndone(s, snap.marks) })
  // False when a sync brought it back first (another device's Undo, or its later edit).
  if (!ok) useUI.getState().toast(t('It’s already back.'))
  return ok
}

/** Takes a routine out of the loop (the swipe and the edit-mode minus), with an Undo. The removal
 *  is the editor's own (`setSeq`), which may sweep the routine's future pins or roll a finished
 *  round over; so while the loop is still what the removal left, Undo puts the loop, the round and
 *  the swept pins back as they were. Once something else changed the loop, it just slots the
 *  routine back in at its old place, through the same save an edit uses. */
export function takeOutOfLoop(id, setSeq, seq, label) {
  const at = seq.indexOf(id)
  if (at < 0) return false
  const before = useStore.getState().S
  const snap = structuredClone({ rotation: before.rotation ?? null, queue: before.queue ?? null, dayPlan: before.dayPlan ?? {} })
  setSeq(seq.filter(x => x !== id))
  const after = useStore.getState().S
  const mark = loopMark(after)
  const marks = undoMarks(before, after)
  const name = before.routines.find(r => r.id === id)?.name ?? id
  useUI.getState().toast(t('“{0}” is out of the loop.', name), { action: t('Undo'), onAction: () => undoTakeOut({ id, at, label, snap, mark, marks }) })
  return true
}
// What the loop looked like right after a removal: the saved loop, the pass and the mode switch.
const loopMark = S => JSON.stringify([S.rotation ?? null, S.queue ?? null, S.scheduleMode ?? null])
export function undoTakeOut({ id, at, label, snap, mark, marks }) {
  if (!useStore.getState().S.routines.some(r => r.id === id)) {
    useUI.getState().toast(t('Too late, that one’s gone'))
    return false
  }
  useStore.getState().update(s => {
    if (loopMark(s) === mark) {
      s.rotation = snap.rotation
      s.queue = snap.queue
      const pins = Object.entries(snap.dayPlan).filter(([iso]) => s.dayPlan?.[iso] == null)
      if (pins.length) s.dayPlan = { ...(s.dayPlan || {}), ...Object.fromEntries(pins) }
      // Put back exactly: a reorder another device made before it saw the removal still wins.
      if (marks) markUndone(s, marks)
      return
    }
    // Only a loop that is still this app's and still running gets a pass written. After "Fixed
    // week", or with a coach's or planner's queue in charge, a new pass would quietly take over
    // again, so the routine just goes back into the saved loop for the next time it starts.
    const q = queueOf(s)
    const ours = scheduleModeOf(s) === 'rotation' && (!s.queue || (!!q && !!s.rotation && q.rotationId === s.rotation.id))
    if (!ours) {
      const seq = Array.isArray(s.rotation?.sequence) ? s.rotation.sequence : null
      if (seq && !seq.includes(id)) {
        const next = seq.slice()
        next.splice(Math.min(at, next.length), 0, id)
        s.rotation = { ...s.rotation, sequence: next }
      }
      return
    }
    const ids = q?.ids ?? rotationIds(s)
    if (ids.includes(id)) return
    const next = ids.slice()
    next.splice(Math.min(at, next.length), 0, id)
    saveRotation(s, next, s.queue?.label || s.rotation?.label || label)
  })
  return true
}

// The flash a row lands with when a swipe brought it (a duplicate, an undo): one per new value.
let flashSeq = 0

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const [view, setViewState] = useState(readView)
  const setView = v => {
    setViewState(v)
    try { localStorage.setItem(PLAN_VIEW_KEY, v) } catch { /* private mode: the view just isn't remembered */ }
  }

  /* The Coach's way in from Plan. It used to be a banner over the week; it is the last entry of the
     Plan menu now, gated by the same predicate every other Coach surface uses, so an instance
     without the feature sees exactly the menu it would have without it. */
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  // Share, print, import, starter plans and the Coach: one menu behind the header button, so the
  // two views below are only about the plan itself.
  const openMenu = () => {
    const has = planHasRoutines(S)
    menuSheet({
      title: t('Plan'),
      subtitle: has ? null : t('Add an exercise to a routine first. An empty plan has nothing to share.'),
      items: [
        { icon: 'share', label: t('Export plan file'), sub: t('A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.'), disabled: !has, onClick: exportPlanFile },
        { icon: 'note', label: t('Print / Save as PDF'), disabled: !has, onClick: printWholePlan },
        { icon: 'download', label: t('Import a plan file'), onClick: () => fileRef.current?.click() },
        { icon: 'clipboard', label: t('Load starter plan'), onClick: starterPlanSheet },
        showCoach && { icon: 'sparkles', label: t('Coach'), sub: t('Plan design and reviews, from your own training'), onClick: () => nav('/coach') },
      ],
    })
  }
  const pickFile = ev => { const f = ev.target.files[0]; ev.target.value = ''; importPlanFile(f) }

  const mode = scheduleModeOf(S)

  return <div className="narrow plan">
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{mode === 'rotation' ? t('Your routines in a loop') : t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={openMenu} aria-label={t('Plan options')} title={t('Plan options')}><Icon name="share" /></button>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
    <Segmented className="plan-views" value={view} onChange={setView}
      options={[{ value: 'schedule', label: t('Schedule') }, { value: 'routines', label: t('Routines') }]} />
    {view === 'routines'
      ? <Routines S={S} update={update} nav={nav} />
      : <Schedule S={S} update={update} nav={nav} mode={mode} />}
  </div>
}

/* ================================ Schedule ================================ */

function Schedule({ S, update, nav, mode }) {
  const [editLoop, setEditLoop] = useState(false)
  /* The rotation editor. What it shows is the live pass when there is one, otherwise the saved
     sequence — S.rotation is only a definition, so the pass is the truth whenever it exists.
     Every edit writes straight through saveRotation: an edit IS the save (and, for a queue
     somebody else wrote, the adoption), so there is no half-edited state to lose. `since` and
     `startsOn` carry over, so progress already logged survives a reorder. */
  const liveQ = queueOf(S)
  const seq = liveQ?.ids ?? rotationIds(S)
  // A loop the app makes has no name of its own: Home shows it as 'Rotation' in the language on
  // screen. Stored as text, it stayed in the language it was made in (QA 2026-10-06).
  const seqLabel = liveQ?.label || S.rotation?.label || ''
  // Ownership, not presence: a planner's queue has no rotationId, or one that does not match the
  // saved rotation here — that's what makes it someone else's to write, not this app's.
  const managed = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  const external = !!liveQ && !managed
  const recovery = queueRecovery(S)
  const qv = liveQ ? queueView(S, todayISO()) : null

  // "How you train" is the same switch as Settings' (lib/rotation.js chooseRotation /
  // chooseFixedWeek), on the same keys. Leaving a running loop asks first: its progress goes,
  // the loop itself and the weekdays stay. With nothing running there is nothing to lose.
  const setMode = v => {
    if (v === mode) return
    if (v === 'rotation') { update(s => { chooseRotation(s) }); return }
    if (!liveQ) { update(s => { chooseFixedWeek(s) }); return }
    confirmSheet({
      title: t('Back to a fixed week?'),
      message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
      confirmText: t('Use Fixed Week'),
      onConfirm: () => update(s => { chooseFixedWeek(s) }),
    })
  }

  const setSeq = ids => update(s => {
    // Emptying the sequence stops the pass but stays on Rotation with an empty loop ('No rotation
    // yet'), so taking out the last routine to swap it for another never throws you onto the
    // weekday grid. Leaving the rotation is the 'How you train' switch's job.
    if (ids.length) saveRotation(s, ids, seqLabel)
    else {
      stopPass(s)
      if (s.rotation) s.rotation = { ...s.rotation, sequence: [] }
      s.scheduleMode = 'rotation'
    }
  })
  const loopReorder = useListReorder(seq.length, (from, to) => setSeq(moved(seq, from, to)))
  const takeOut = id => takeOutOfLoop(id, setSeq, seq, seqLabel)
  const swipe = workoutControls(S).swipeSets && !external
  const addToSeq = () => menuSheet({
    title: t('Add to the rotation'),
    items: S.routines.filter(r => !seq.includes(r.id)).map(r => ({
      icon: glyphOf(r.emoji), label: r.name, onClick: () => setSeq([...seq, r.id]),
    })),
  })
  // The only path from a coach-written queue into a managed one: behind a confirmation that says
  // what happens — the coach gives up control: this app owns the queue and refills it itself, and a
  // later week written by the coach's app simply replaces it (the whole queue object, token and all).
  // The rotation takes a name of its own here rather than the planner's (e.g. "US W1") — that
  // name is this one pass's, and refillAfter would otherwise repeat it on every pass after it.
  // A loop of your own saved here is overwritten by the adoption, so the confirm says so.
  const ownSeq = S.rotation?.sequence || []
  const replacesOwn = ownSeq.length > 0 && (ownSeq.length !== seq.length || ownSeq.some((id, i) => id !== seq[i]))
  const adopt = () => confirmSheet({
    title: t('Use this rotation?'),
    message: t('Your coach gives up control of this week: openGym owns the queue from here on and repeats these sessions by itself once they are all done. A new week from the coach’s app would replace this rotation.')
      + (replacesOwn ? ' ' + t('Your own loop gets replaced.') : ''),
    confirmText: t('Use this rotation'),
    onConfirm: () => update(s => saveRotation(s, seq, '')),
  })

  const ws = weekStartOf(S)
  const todayDow = new Date().getDay()
  const routineOf = id => S.routines.find(x => x.id === id)
  const dayRoutines = d => [].concat(S.week[d] || []).map(routineOf).filter(Boolean)
  // One weekday: what is on it at a glance, and a tap to change it (dayAssignSheet picks one
  // routine, several for a combined day, or a rest day).
  const dayRow = (d, rs = dayRoutines(d)) => {
    return <div key={d} className="item plan-day" data-day={d} aria-label={t(DAYN[d])} {...tappable(() => dayAssignSheet(d))}>
      <span className={'plan-day-n' + (d === todayDow ? ' today' : '')} aria-hidden="true">{t(DAYS[d])}</span>
      <span className={'lrow-i' + (rs.length ? '' : ' rest')}><Icon name={rs.length ? glyphOf(rs[0].emoji) : 'moon'} /></span>
      <div className="grow">
        <div className="tt">{rs.length ? deriveSessionName(rs.map(r => r.name)) : t('Rest day')}</div>
        <div className="ss">{rs.length === 1 ? exCount(rs[0].ex.length) : rs.length ? routineCount(rs.length) : t('Tap to plan something')}</div>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
  }
  // Beside a loop, a weekday shows only what it adds to it: a routine that is in the loop already
  // is the loop's session, the same rule Home follows (effectiveRoutineIds, history.js).
  const extraRoutines = d => dayRoutines(d).filter(r => !seq.includes(r.id))
  const plannedDays = weekOrder(ws).filter(d => extraRoutines(d).length)
  const doneCount = qv ? qv.items.filter(i => i.state === 'done').length : 0
  const stateWord = item => item.state === 'pinned' ? fmtDate(item.on, true)
    : { done: t('Done'), next: t('Up next'), later: t('Later') }[item.state]
  const editing = editLoop && !external

  return <>
    <Section className="plan-mode" footer={mode === 'rotation'
      ? t('Routines in a loop. Whatever is next stays next until you train it, whatever the day.')
      : t('The same routines on the same weekdays, every week.')}>
      <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
        {/* A planner's own queue is not this app's to switch off: text, not a control. */}
        {external
          ? <span className="small dim plan-mode-locked">{t('Rotation')} · {t('Externally managed')}</span>
          : <Segmented className="seg-inline" value={mode} onChange={setMode}
              options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]} />}
      </Row>
    </Section>

    {!S.routines.length && <div className="empty plan-empty">
      <div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}
      <div style={{ marginTop: 12 }}><Button icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button></div>
    </div>}

    {/* A queue payload that arrived unusable: a fix-up, shown whichever way you train. Giving it
        up also gives up S.scheduleMode='rotation', or the loop would sit there with no queue. */}
    {recovery && <div className="empty">
      {t('This rotation couldn’t be read. Another device may have written it.')}
      <div style={{ marginTop: 10 }}>
        <Button size="sm" variant="tinted" aria-label={t('Discard it')} onClick={() => update(s => { s.queue = null; s.scheduleMode = 'week' })}>{t('Discard it')}</Button>
      </div>
    </div>}

    {mode === 'week' ? <>
      <h4 className="sec">{t('This week')}</h4>
      <div className="list plan-week">{weekOrder(ws).map(d => dayRow(d))}</div>
      <p className="sect-f">{t('Want two routines on one day? Tap the day and pick both.')}</p>
    </> : <div className="rotation">
      <div className="row between plan-sec-h">
        <h4 className="sec">{t('The loop')}{external && <span className="tag" style={{ marginInlineStart: 8 }}>{t('Externally managed')}</span>}</h4>
        {/* A coach's own queue is read-only here: the one way to change what it holds is to
            adopt it first ("Use this rotation" below), never a tap on one of its rows. */}
        {!external && <div className="row plan-sec-acts" style={{ gap: 6 }}>
          {seq.length > 0 && <button className="plan-textbtn" aria-pressed={editLoop} onClick={() => setEditLoop(e => !e)}>{editLoop ? t('Done') : t('Edit')}</button>}
          <Button size="sm" variant="tinted" icon="plus" aria-label={t('Add routine to the rotation')}
            disabled={S.routines.every(r => seq.includes(r.id))} onClick={addToSeq}>{t('Add')}</Button>
        </div>}
      </div>
      {seq.length ? <div className="list plan-loop" ref={loopReorder.listRef}>
        {seq.map((id, i) => {
          const r = routineOf(id)
          const item = qv?.items[i]
          // The loop's swipe is remove-only (v1.3.11): a routine is in the loop once, so there is
          // nothing to copy. The row the reorder measures is the swipe's outer element.
          const reorderProps = { 'data-reorder-row': '', style: loopReorder.rowStyle(i) }
          const row = <div {...(swipe ? {} : { key: id, ...reorderProps })} className={'item rotation-row' + (item?.state === 'done' ? ' is-done' : '')}>
            {editing && <button className="plan-minus" aria-label={t('Remove {0}', r?.name ?? id)} title={t('Remove')}
              onClick={() => takeOut(id)}><Icon name="minus" /></button>}
            <span className={'plan-order' + (item?.state === 'next' ? ' next' : '')}>{item?.state === 'done' ? <Icon name="check" /> : i + 1}</span>
            <span className="lrow-i"><Icon name={glyphOf(r?.emoji)} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tt">{r?.name ?? id}</div>
              <div className="ss">{item ? stateWord(item) : r ? exCount(r.ex.length) : ''}</div>
            </div>
            {editing && seq.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', r?.name ?? id)} title={t('Drag to reorder')}
              {...loopReorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
          </div>
          return swipe
            ? <SwipeRow key={id} {...reorderProps} className="swrow-item" deleteLabel={t('Remove')} deleteIcon="minus"
              onDelete={() => takeOut(id)}>{row}</SwipeRow>
            : row
        })}
      </div> : <div className="empty">{t('No rotation yet. Add routines in the order you want to train them. The first one you haven’t logged stays up next.')}</div>}
      {seq.length > 0 && <p className="sect-f">
        {qv ? (qv.waiting ? t('Next round starts {0}.', fmtDate(qv.startsOn, true)) : t('{0} of {1} done this round.', doneCount, qv.items.length)) + ' ' : ''}
        {external ? '' : editing ? t('Drag to reorder. Tap the minus to take one out.') : t('Trained out of order? Just pick another routine on Home.')}
      </p>}
      <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {external && <Button size="sm" variant="tinted" aria-label={t('Use this rotation')} onClick={adopt}>{t('Use this rotation')}</Button>}
        {/* Throws the current round away and starts the saved loop again today; nothing logged
            before this moment counts for it (startNewPass, the strict pass). */}
        {!!liveQ && !external && <Button size="sm" icon="reset" aria-label={t('Start the loop over')}
          onClick={() => update(s => startNewPass(s, undefined, undefined, useStore.getState().A))}>{t('Start the loop over')}</Button>}
        {/* Rotation chosen and a loop saved, but no round running (it was stopped elsewhere). */}
        {!liveQ && !recovery && seq.length > 0 && <Button size="sm" variant="tinted" icon="play" aria-label={t('Start the loop')}
          onClick={() => update(s => startPass(s))}>{t('Start the loop')}</Button>}
      </div>
      {/* The weekday routines ride along beside a loop (effectiveRoutineIds, history.js) and feed
          the same tally (weekTally, queue.js), so the days that still add one stay in sight; a
          day whose only routines are in the loop already adds nothing and is left out. */}
      {plannedDays.length > 0 && <>
        <h4 className="sec">{t('Also on fixed days')}</h4>
        <div className="list plan-week">{plannedDays.map(d => dayRow(d, extraRoutines(d)))}</div>
        <p className="sect-f">{t('These count on top of the loop. Tap a day to change or clear it.')}</p>
      </>}
    </div>}

    {/* Weekly muscle volume is analysis: it moved to Stats, next to Muscle balance. Stats only
        shows that card once there is a routine, so the link waits for one too. */}
    {S.routines.length > 0 && <Section className="plan-link">
      <Row icon="chart" iconTint="var(--indigo)" title={t('Weekly muscle volume')} subtitle={t('Now in Stats, next to Muscle balance')}
        accessory="chevron" onClick={() => nav('/stats?focus=weekly-volume')} />
    </Section>}
  </>
}

/* ================================ Routines ================================ */

function Routines({ S, update, nav }) {
  const [edit, setEdit] = useState(false)
  const [flash, setFlash] = useState(null)
  const swipe = workoutControls(S).swipeSets
  const routines = S.routines
  // The order of this list is the order of `S.routines`, and every other screen reads the same
  // array (the Start screen, the day sheets, the routine pickers), so moving a routine here moves
  // it everywhere (#142). Reordering lives behind Edit, like on an iPhone.
  const reorder = useListReorder(routines.length, (from, to) => update(s => {
    if (to < 0 || to >= s.routines.length) return
    const [m] = s.routines.splice(from, 1)
    s.routines.splice(to, 0, m)
  }))

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  // The same delete as RoutineEdit's "Delete routine" button (lib/routines.js), with an Undo in
  // place of its confirm (v1.3.11): the swipe and the edit-mode minus both land here.
  const remove = r => deleteRoutineWithUndo(r.id)
  // The swipe's other side: a copy right below the original, named the way "Copy routine" names
  // one, and staying on this list rather than opening it.
  const duplicate = r => {
    const copy = copyRoutine(r, t('Copy'))
    update(s => {
      const at = s.routines.findIndex(x => x.id === r.id)
      s.routines.splice(at < 0 ? s.routines.length : at + 1, 0, copy)
    })
    setFlash({ id: copy.id, n: ++flashSeq })
    // With its own Undo: the toast takes the place of any Undo still showing (one toast at a
    // time), so the newest swipe is at least the one you can take back.
    useUI.getState().toast(t('Copied as “{0}”.', copy.name), { action: t('Undo'), onAction: () => {
      update(s => { if (s.routines.some(x => x.id === copy.id)) deleteRoutine(s, copy.id) })
    } })
  }
  // The weekdays a routine is on, short, in the order the week runs.
  const order = weekOrder(weekStartOf(S))
  const daysOf = id => order.filter(d => [].concat(S.week[d] || []).includes(id)).map(d => t(DAYS[d]))
  const sub = r => [exCount(r.ex.length), daysOf(r.id).join(', ')].filter(Boolean).join(' · ')

  return <>
    <div className="row between plan-sec-h plan-routines-bar">
      {routines.length > 0
        ? <button className="plan-textbtn" aria-pressed={edit} onClick={() => setEdit(e => !e)}>{edit ? t('Done') : t('Edit')}</button>
        : <span />}
      <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
    </div>
    {routines.length ? <>
      {edit
        ? <div className="list routine-list plan-routines is-editing" ref={reorder.listRef}>{routines.map((r, i) =>
          <div key={r.id} data-reorder-row className="item plan-routine" style={reorder.rowStyle(i)}>
            <button className="plan-minus" aria-label={t('Delete {0}', r.name)} title={t('Delete routine')} onClick={() => remove(r)}><Icon name="minus" /></button>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            {routines.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', r.name)} title={t('Drag to reorder')}
              {...reorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
          </div>)}</div>
        : <div className="list routine-list plan-routines">{routines.map(r => {
          const row = <div key={r.id} className="item plan-routine" {...tappable(() => nav('/plan/r/' + r.id))}>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            <Icon name="chevronRight" className="chev" /></div>
          // Swipe (v1.3.11, Settings → Swipe actions): toward the start deletes with an Undo,
          // toward the end duplicates. Edit's minus and the routine's own page stay the way in
          // for a keyboard and a screen reader.
          return swipe
            ? <SwipeRow key={r.id} className="swrow-item" copyLabel={t('Duplicate')}
              onDelete={() => remove(r)} onCopy={() => duplicate(r)}
              flash={flash?.id === r.id ? flash.n : 0}>{row}</SwipeRow>
            : row
        })}</div>}
      <p className="sect-f">{edit ? t('Drag to reorder. Tap the minus to delete.') : t('Tap a routine to edit it. Reorder and delete are behind Edit.')}</p>
    </> : <>
      <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}</div>
      <Button icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
    </>}
  </>
}
