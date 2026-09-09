import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { workoutControls } from '../lib/workout-controls.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { usesBar, barWeightFor, plateSplit } from '../lib/bar.js'
import { effectiveRoutines, effectiveRoutineIds, lastEntryFor, bestWeightFor, bestWeightForEntry, buildSets, freestyleConfig, defaultConfig, setsDoneActive, setUnitsTotal, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, repStep, EFFORT, effortOf, stepEffort, capEffort, cascadeWeight, insertWarmupRow, removeRowAt, pairAdjacent, unpairSuperset, cleanupSg, applyIntensifierPlan, pinnedNoteFor, exNoteFor } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { insertionIndexAfterCurrentUnit, nextUnfinishedUnit, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor } from '../lib/supersetFlow.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, finishWorkout, workoutCompleteSheet, confirmSheet, exerciseNoteSheet, sessionNoteSheet, swapActiveWorkoutExercise, barWeightSheet, menuSheet, effortPickerSheet, exerciseHistorySheet, addRoutineToSessionSheet } from '../sheets.jsx'
import { effortColor } from '../lib/effort.js'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { nextPrescription, applyPrescription, defaultIncrement, weightIncrement, stepWeight } from '../lib/progression.js'
import { progressionGuidance } from '../lib/progression-copy.js'
import { glyphOf } from '../lib/glyphs.js'
import { isWarmupRow, isDropSet, isRestPauseSet, dropsOf, clustersOf, addDrop, addCluster, removeDropAt, removeClusterAt, setDropAt, setClusterAt, nextDropWeight, nextBurstReps, isSideSet, makeSideSet, setSideField, toggleSide, addSideDrop, removeSideDropAt, setSideDropAt, addSideCluster, removeSideClusterAt, setSideClusterAt } from '../lib/workout-model.js'
import { canMoveActiveWorkoutUnit, moveActiveWorkoutUnit } from '../lib/active-workout-order.js'

const SWIPE_MIN_DISTANCE = 48
const SWIPE_AXIS_RATIO = 1.25
const SWIPE_IGNORED_TARGETS = 'button,input,textarea,select,a,[role="button"],[role="checkbox"],[role="switch"],[role="slider"],[contenteditable="true"],.exmedia,[data-swipe-ignore]'

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayIds = effectiveRoutineIds(S, todayISO())
  const todayRoutines = effectiveRoutines(S, todayISO())
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const idSet = new Set(todayIds)
  const others = S.routines.filter(r => !idSet.has(r.id))
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayRoutines.length ? t('today is {0}', todayName) : t('rest day, but no one’s stopping you')}</div></div></div>
    {todayRoutines.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayName}</div><div className="muted small">{exCount(todayRoutines.reduce((n, r) => n + r.ex.length, 0))}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayRoutines[0].emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startFlow(todayIds)}>{t('Start {0}', todayName)}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow([r.id])}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow([])}>{t('Freestyle workout (pick as you go)')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
// `compact` shrinks the block for a superset member; `dense` (compact view) goes further and
// drops everything that is not a set you are logging — media, tag chips, the note lines, the
// "last time" recap and the progression line — leaving the name, the ⋯ menu and the sets.
// Nothing dropped is lost: it is all still on the ⋯ menu, or one ⋮ switch back to list/cards.
function ExerciseBlock({ entryIdx, compact, dense, onToggle, onToggleSide, onField, onAddSet, onRemoveSet, onAddWarmup, onRemoveSetAt, onStartTimed, onPairPrev, onPairNext, onSetRowRef, onProgressionSettings, onSwap, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onRemoveExercise, busy }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  // Drops/bursts mutate the row in place — same card, not a new set with its own long rest.
  // A planned exercise (see the exercise's "Intensifier" config) arrives with these already
  // filled in by applyIntensifierPlan; these only add/edit/remove entries live from here on.
  const mutSet = (i, fn) => update(s => { const row = s.active.entries[entryIdx].sets[i]; s.active.entries[entryIdx].sets[i] = fn(row) }, true)
  const addDropRow = i => mutSet(i, row => {
    // A unilateral set drops per side (issue #60): addSideDrop seeds each side from its own weight.
    if (isSideSet(row)) {
      const pct = entry.target?.intensifier?.type === 'dropset' ? entry.target.intensifier.pct : undefined
      return addSideDrop(row, pct)
    }
    const drops = dropsOf(row)
    const base = drops.length ? drops[drops.length - 1].w : (row.w || 0)
    const pct = entry.target?.intensifier?.type === 'dropset' ? entry.target.intensifier.pct : undefined
    return addDrop(row, { w: nextDropWeight(base, pct), r: row.r })
  })
  // A rest-pause row's own reps are always the total across every burst (see
  // applyIntensifierPlan/history.js) — clusters are the breakdown of that total, not extra on
  // top of it — so adding, removing or editing one keeps `r` in step by the same delta.
  const addBurstRow = i => mutSet(i, row => {
    const restSec = entry.target?.intensifier?.type === 'restpause' ? entry.target.intensifier.restSec : (S.restPauseSec || 15)
    if (isSideSet(row)) return addSideCluster(row, restSec)   // per side, each keeps its own r in step
    const clusters = clustersOf(row)
    const base = clusters.length ? clusters[clusters.length - 1].r : (row.r || 0)
    const added = nextBurstReps(base)
    return { ...addCluster(row, { r: added, restSec }), r: (row.r || 0) + added }
  })
  // Per-side weight/reps/effort edits (issue #60): patch one side of a unilateral row, keeping
  // the row's aggregate (r/w/done/effort) in step via the model helper so every other reader
  // stays right. The done tick goes through onToggleSide → toggle() instead, so ticking a side
  // still fires the rest timer / auto-advance / workout-complete flow.
  const setSide = (i, side, field, v) => mutSet(i, row => setSideField(row, side, field, v))
  // Drop/burst edits accept an optional `side` ('L'|'R'): present for a per-side row (edits that
  // one limb's drop/burst), absent for a straight row (edits the row's own).
  const removeDrop = (i, di) => mutSet(i, row => isSideSet(row) ? removeSideDropAt(row, di) : removeDropAt(row, di))
  const removeCluster = (i, ci) => mutSet(i, row => {
    if (isSideSet(row)) return removeSideClusterAt(row, ci)
    const removed = clustersOf(row)[ci]?.r || 0
    return { ...removeClusterAt(row, ci), r: Math.max(0, (row.r || 0) - removed) }
  })
  const setDropField = (i, di, field, v, side) => mutSet(i, row =>
    isSideSet(row) ? setSideDropAt(row, side, di, { [field]: v }) : setDropAt(row, di, { [field]: v }))
  const setClusterField = (i, ci, v, side) => mutSet(i, row => {
    if (isSideSet(row)) return setSideClusterAt(row, side, ci, v)
    const delta = (Number(v) || 0) - (clustersOf(row)[ci]?.r || 0)
    return { ...setClusterAt(row, ci, { r: v }), r: Math.max(0, (row.r || 0) + delta) }
  })
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  const standingNote = exNoteFor(S, entry.id)
  // Only worth surfacing while there is still work left: once the exercise is finished, a note
  // telling you what to do in it is behind you, and the block is already long.
  const pinnedNote = entry.sets.some(s => !s.done) ? pinnedNoteFor(S, entry.id) : null
  // The number is the heaviest logged set, or the working weight you kept.
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  const guidance = progressionGuidance(plan)
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  // A unilateral exercise logs each side on its own (issue #60): work rows render as an L and an
  // R sub-row, each with its own weight/reps/effort and done tick. Warm-ups stay single.
  const perSide = mode === 'reps' && isPerSide(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const loadStep = mode === 'reps' ? weightIncrement(cfg, S.unit) : 2.5
  const loadCol = { f: 'w', step: loadStep, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : (bw && !added) ? repCol : loadCol
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? ((bw && !added) ? null : loadCol)
      : (bw && !added) ? null : repCol
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  // The effort column carries the scale key (`eff`) and its field name; unlike weight/reps it
  // is not a stepper — it opens a colour-coded picker (see effortCell). `f` is s.rir or s.rpe.
  const col3 = mode === 'reps' && eff ? { f: eff.f, eff: kind, hd: t(eff.hd) } : null
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir) => {
    // Read the current value directly from the store rather than from the render-time snapshot.
    // In a superset both ExerciseBlock instances share the same store subscription, so when one
    // member's field changes the partner re-renders too, replacing the closure's `s` reference
    // with a fresh clone before the next tap fires. Reading from the store avoids that stale-
    // closure problem entirely and keeps every tap operating on the real current value.
    const fresh = useStore.getState().S.active?.entries[entryIdx]?.sets[i]
    const cur = fresh ? fresh[col.f] : s[col.f]
    if (mode === 'reps' && col.f === 'w') return onField(i, col.f, stepWeight(cur, col.step, dir))
    onField(i, col.f, Math.max(0, Math.round(((cur || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  // Which of the optional control groups this profile wants on screen (Settings → During a
  // workout → Workout controls). The lean default keeps the sets and one "more" button; each
  // switch brings one of the old always-visible button rows back.
  const wc = workoutControls(S)
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')}>
      {wc.steppers && <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, v)} /></span>
      {wc.steppers && <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>}
    </div>
  )
  // Everything about this exercise that is not a set you are logging right now lives behind one
  // button. What used to be a row of buttons in the header, a chip under the bar, a strip of
  // three under the sets and four more below the card is a single list you open once a session.
  const barInfo = (!cardio && !(bw && !added) && usesBar(ex)) ? (() => {
    const bar = barWeightFor(S, entry.id)
    if (!(bar > 0)) return null
    const nextW = entry.sets.find(s => !s.done)?.w
    const refW = nextW > 0 ? nextW : Math.max(0, ...entry.sets.map(s => s.w || 0))
    const split = plateSplit(refW, bar)
    return { bar, text: t('Bar {0}', fmtNum(bar) + ' ' + S.unit) + (split != null ? ' · ' + t('{0} per side', fmtNum(split) + ' ' + S.unit) : '') }
  })() : null
  const openMore = () => menuSheet({
    title: exerciseNameFor(ex),
    items: [
      { icon: 'pencil', label: entry.note ? t('Edit note') : t('Add note'), sub: entry.note || undefined, onClick: () => exerciseNoteSheet(entryIdx) },
      { icon: 'info', label: t('Details'), onClick: () => exerciseDetailSheet(ex) },
      { icon: 'history', label: t('History'), sub: last ? t('Last time') + ' ' + fmtDate(last.d) : undefined, onClick: () => exerciseHistorySheet(entry.id) },
      onProgressionSettings && { icon: 'chartLine', label: t('Progression settings'), sub: guidance ? t(guidance.policyLabel) : undefined, onClick: onProgressionSettings },
      barInfo && { icon: 'barbell', label: t('Bar weight'), sub: barInfo.text, onClick: () => barWeightSheet(entry.id) },
      { icon: 'flame', label: t('Add warm-up set'), onClick: onAddWarmup },
      onPairPrev && { icon: 'link', label: t('Make superset with previous'), onClick: onPairPrev },
      onPairNext && { icon: 'link', label: t('Make superset with next'), onClick: onPairNext },
      onSwap && { icon: 'shuffle', label: t('Swap exercise'), onClick: onSwap, disabled: busy },
      onMoveUp && { icon: 'chevronUp', label: t('Move up'), onClick: onMoveUp, disabled: busy || !canMoveUp },
      onMoveDown && { icon: 'chevronDown', label: t('Move down'), onClick: onMoveDown, disabled: busy || !canMoveDown },
      onRemoveExercise && { icon: 'trash', label: t('Remove exercise'), onClick: onRemoveExercise, danger: true, disabled: busy },
    ],
  })
  // The set number is the set's own menu: drop / burst / remove — three things that used to
  // sit as chips and an X on every single row.
  const openSetMenu = (s, i) => {
    const warm = isWarmupRow(s)
    menuSheet({
      title: (warm ? t('Warm-up') : t('Set {0}', entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length)),
      subtitle: setLabel(entry.id, s, entry.target),
      items: [
        !warm && mode === 'reps' && !isRestPauseSet(s) && { icon: 'arrowDown', label: t('Drop set'), sub: t('+ Drop'), onClick: () => addDropRow(i) },
        !warm && mode === 'reps' && !isDropSet(s) && { icon: 'bolt', label: t('Rest-pause burst'), sub: t('+ Burst'), onClick: () => addBurstRow(i) },
        { icon: 'trash', label: t('Remove this set'), danger: true, disabled: entry.sets.length <= 1, onClick: () => onRemoveSetAt(i) },
      ],
    })
  }
  // The effort cell is a single button, not a stepper: it shows the rating in the profile's
  // scale, tinted by how close to failure it was, and opens the picker on tap — to set a
  // rating or change one. rirOf-via-effortColor keeps the colour identical whether the value
  // is logged as RIR or RPE. With the +/- buttons switched off (Workout controls) a logged
  // rating is just the tinted value, which still opens the picker.
  const effortCell = (s, i, col) => {
    const v = s[col.f] ?? null
    const rir = col.eff === 'rpe' ? (v == null ? null : 10 - v) : v
    const color = effortColor(rir)
    // Logging an effort concludes the set (issue #64): once you rate how a set felt, it is done —
    // so picking a value also ticks the set and starts the rest timer, sparing the redundant
    // second confirmation. Clearing a rating (null) never un-ticks: ending a set stays a manual
    // undo via the checkmark. Reads `done` live from the store, since a superset re-render can
    // stale the closure's `s`, and only ticks a set that is not already done.
    const pickEffort = nv => {
      onField(i, col.f, nv)
      if (nv == null) return
      const fresh = useStore.getState().S.active?.entries[entryIdx]?.sets[i]
      if (fresh && !fresh.done) onToggle(i)
    }
    const open = () => effortPickerSheet(col.eff, v, pickEffort)
    if (v == null) return (
      <button className="effcell is-empty" aria-label={col.hd} onClick={open}>{col.hd}</button>
    )
    const step = dir => onField(i, col.f, stepEffort(col.eff, v, dir))
    return (
      <div className={'stp effcell-stp' + (wc.steppers ? '' : ' plain')}
        style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined}>
        {wc.steppers && <button aria-label="Decrease" onClick={() => step(-1)}><Icon name="minus" /></button>}
        <button className="val" aria-label={col.hd} onClick={open}>{fmtNum(v)}</button>
        {wc.steppers && <button aria-label="Increase" onClick={() => step(1)}><Icon name="plus" /></button>}
      </div>
    )
  }
  // Per-side versions of the weight/reps stepper and the effort picker. Same markup and stepping
  // rules as the row-level `cell`/`effortCell`, but bound to one side of a unilateral row and
  // routed through setSide so the aggregate stays correct. Reads the live side value from the
  // store for the same stale-closure reason `bump` does.
  const sideBump = (i, side, col, dir) => {
    const fresh = useStore.getState().S.active?.entries[entryIdx]?.sets[i]?.sides?.[side]
    const cur = fresh ? fresh[col.f] : 0
    if (col.f === 'w') return setSide(i, side, col.f, stepWeight(cur, col.step, dir))
    // Reps step by one per side: repCol's step of two keeps the *combined* total evenly
    // splittable, but here each side is logged directly, so one tap is one rep.
    const step = col.f === 'r' ? 1 : col.step
    setSide(i, side, col.f, Math.max(0, Math.round(((cur || 0) + dir * step) * 100) / 100))
  }
  const sideCell = (sd, i, side, col, cls) => (
    <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')}>
      {wc.steppers && <button aria-label="Decrease" onClick={() => sideBump(i, side, col, -1)}><Icon name="minus" /></button>}
      <span className="val"><NumberField decimal={col.dec} value={sd[col.f] ?? ''}
        onChange={v => setSide(i, side, col.f, v)} /></span>
      {wc.steppers && <button aria-label="Increase" onClick={() => sideBump(i, side, col, 1)}><Icon name="plus" /></button>}
    </div>
  )
  const sideEffortCell = (sd, i, side, col) => {
    const v = sd[col.f] ?? null
    const rir = col.eff === 'rpe' ? (v == null ? null : 10 - v) : v
    const color = effortColor(rir)
    const open = () => effortPickerSheet(col.eff, v, nv => setSide(i, side, col.f, nv))
    if (v == null) return <button className="effcell is-empty" aria-label={col.hd} onClick={open}>{col.hd}</button>
    const step = dir => setSide(i, side, col.f, stepEffort(col.eff, v, dir))
    return (
      <div className={'stp effcell-stp' + (wc.steppers ? '' : ' plain')}
        style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined}>
        {wc.steppers && <button aria-label="Decrease" onClick={() => step(-1)}><Icon name="minus" /></button>}
        <button className="val" aria-label={col.hd} onClick={open}>{fmtNum(v)}</button>
        {wc.steppers && <button aria-label="Increase" onClick={() => step(1)}><Icon name="plus" /></button>}
      </div>
    )
  }
  // One side's row: the L or R badge, then the same weight/reps/effort controls as a straight
  // row but bound to that side, and the side's own done tick.
  const sideRow = (s, i, side, col1, col2, col3) => {
    const sd = (s.sides && s.sides[side]) || { w: 0, r: 0, done: false }
    return <div className={'setrow side' + (sd.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
      <span className="sidetag" aria-hidden="true">{side === 'L' ? t('L') : t('R')}</span>
      {sideCell(sd, i, side, col1, 'w')}
      {col2 && sideCell(sd, i, side, col2, 'r')}
      {col3 && sideEffortCell(sd, i, side, col3)}
      <Check checked={sd.done} onChange={() => onToggleSide(i, side)} />
    </div>
  }
  // A side's own drop-set/rest-pause sub-rows (issue #60): the intensifier is logged per limb, so
  // the drops and bursts hang under that side's row, each editable, exactly like a straight set's
  // do under its row. Reads the side object, not the aggregate.
  const sideExtras = (s, i, side) => {
    const sd = (s.sides && s.sides[side]) || {}
    return <>
      {dropsOf(sd).map((d, di) => (
        <div className="subrow" key={'d' + di}>
          <span className="subn">{t('Drop {0}', di + 1)}</span>
          {miniStepper(d.w, loadStep, true, v => setDropField(i, di, 'w', v, side), true)}
          {miniStepper(d.r, 1, false, v => setDropField(i, di, 'r', v, side))}
          <button className="iconbtn" aria-label={t('Remove drop')} onClick={() => removeDrop(i, di)}><Icon name="xmark" /></button>
        </div>
      ))}
      {clustersOf(sd).map((c, ci) => (
        <div className="subrow" key={'c' + ci}>
          <span className="subn">{t('Burst {0}', ci + 1)}</span>
          {miniStepper(c.r, 1, false, v => setClusterField(i, ci, v, side))}
          <span className="dim small">{c.restSec}s</span>
          <button className="iconbtn" aria-label={t('Remove burst')} onClick={() => removeCluster(i, ci)}><Icon name="xmark" /></button>
        </div>
      ))}
    </>
  }
  // A smaller stepper for a drop's weight/reps or a burst's reps — editing what the plan (or a
  // live "+ Drop"/"+ Burst" tap) already put on the row, not typing into a fresh field.
  const miniStepper = (value, step, dec, onChange, snapWeightStep = false) => (
    <div className="stp mini">
      <button aria-label="Decrease" onClick={() => onChange(snapWeightStep ? stepWeight(value, step, -1) : Math.max(0, Math.round(((value || 0) - step) * 100) / 100))}><Icon name="minus" /></button>
      <span className="val"><NumberField decimal={dec} value={value ?? ''} onChange={onChange} /></span>
      <button aria-label="Increase" onClick={() => onChange(snapWeightStep ? stepWeight(value, step, 1) : Math.max(0, Math.round(((value || 0) + step) * 100) / 100))}><Icon name="plus" /></button>
    </div>
  )
  return <>
    {!dense && <Media ex={ex} key={entry.id} compact={compact} minimizable />}
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: (compact || dense) ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{exerciseNameFor(ex)}</div>
      <div className="row" style={{ gap: 2, flex: 'none' }}>
        {entry.note && <button className="iconbtn" aria-label={t('Note')} title={t('Note')} style={{ color: 'var(--acc)' }}
          onClick={() => exerciseNoteSheet(entryIdx)}><Icon name="pencil" /></button>}
        <button className="iconbtn" aria-label={t('More')} title={t('More')} onClick={openMore}><Icon name="more" /></button>
      </div>
    </div>
    {wc.pairButtons && !compact && !dense && (onPairPrev || onPairNext) && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {onPairPrev && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with previous')} onClick={onPairPrev}>{t('Make superset with previous')}</Button>}
      {onPairNext && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with next')} onClick={onPairNext}>{t('Make superset with next')}</Button>}
    </div>}
    {/* compact view drops everything from here to the sets card — it is all still on the ⋯ menu
        (note, details, history, bar weight, progression) or is display-only (tags, "last time"). */}
    {!dense && <>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* A unilateral exercise is logged per side directly (the L/R rows below), so the old
          "{n} per side" chip — which halved the combined total for display — is gone: the split
          is no longer derived, it is what you enter. The tag only flags that this is per-side. */}
      {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('Per side')}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {/* Three notes can apply to one exercise and they are not interchangeable, so each keeps its
        own line and its own icon: the plan's instruction (cfg.note, from the routine), the
        standing fact about the movement (exNotes), and the message you pinned to yourself last
        session. Today's own note is edited through the button in the header and shown last. */}
    {cfg.note && <div className="exnote">{cfg.note}</div>}
    {standingNote && <div className="exnote"><Icon name="info" style={{ fontSize: 13, marginRight: 5, verticalAlign: '-2px' }} />{standingNote}</div>}
    {pinnedNote && <div className="exnote" style={{ color: 'var(--yellow)' }}>
      <Icon name="flag" style={{ fontSize: 13, marginRight: 5, verticalAlign: '-2px' }} />
      {t('From {0}:', fmtDate(pinnedNote.d, true))} {pinnedNote.note}
    </div>}
    {entry.note && <div className="exnote">{entry.note}</div>}
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    {/* Bar + plates for barbell work: what to load per side for the set in front of you
        (first undone set; the heaviest row once everything is checked). The logged number
        stays the total — this chip is the split, and tapping it edits the bar's own weight
        (S.barWeights, per exercise) mid-workout. Weight ≤ bar leaves just the bar. */}
    {barInfo && <div className="small dim" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
      <Icon name="dumbbell" style={{ fontSize: 12 }} />{barInfo.text}
    </div>}
    {guidance && <button type="button" className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}
      aria-label={t('Open progression settings')} onClick={onProgressionSettings}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span><strong>{t(guidance.policyLabel)}</strong> · {t(...guidance.why)}</span>
    </button>}
    </>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
      <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
      {entry.sets.map((s, i) => {
        const warm = isWarmupRow(s)
        const warmBefore = i > 0 && isWarmupRow(entry.sets[i - 1])
        const isFirstWarmup = warm && !warmBefore
        // Numbering restarts per phase: with two warm-ups the first work set reads 1, not 3.
        const phaseNum = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
        return <div key={i}>
          {isFirstWarmup && <div className="setph">{t('Warm-up')}</div>}
          {!warm && warmBefore && <div className="setsep" />}
          {perSide && !warm && isSideSet(s) ? (
            // Unilateral work set: the number sits beside a two-row L/R stack, each side logged
            // and ticked on its own (issue #60).
            <div ref={el => onSetRowRef?.(i, el)} className={'setrow-side' + (s.done ? ' done' : '')}>
              <button type="button" className="n" aria-label={t('Set {0}', phaseNum)} title={t('More')} onClick={() => openSetMenu(s, i)}>{phaseNum}</button>
              <div className="side-rows">
                {sideRow(s, i, 'L', col1, col2, col3)}
                {sideExtras(s, i, 'L')}
                {sideRow(s, i, 'R', col1, col2, col3)}
                {sideExtras(s, i, 'R')}
              </div>
            </div>
          ) : (
          <div ref={el => onSetRowRef?.(i, el)} className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
            <button type="button" className="n" aria-label={t('Set {0}', phaseNum)} title={t('More')} onClick={() => openSetMenu(s, i)}>{phaseNum}</button>
            {cell(s, i, col1, 'w')}
            {col2 && cell(s, i, col2, 'r')}
            {col3 && effortCell(s, i, col3)}
            {/* A timed set is started, not typed: the timer counts the hold down and checks the
                set off itself. The checkbox stays for anyone who timed it on their own watch. */}
            {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
              onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
            <Check checked={s.done} onChange={() => onToggle(i)} />
          </div>
          )}
          {/* Drop-sets and rest-pause bursts extend this same row — no long rest, no new set.
              A planned exercise arrives with these already filled in (applyIntensifierPlan);
              every value here is just as editable as the main row's own weight/reps. */}
          {!warm && mode === 'reps' && <>
            {dropsOf(s).map((d, di) => (
              <div className="subrow" key={'d' + di}>
                <span className="subn">{t('Drop {0}', di + 1)}</span>
                {miniStepper(d.w, loadStep, true, v => setDropField(i, di, 'w', v), true)}
                {miniStepper(d.r, 1, false, v => setDropField(i, di, 'r', v))}
                <button className="iconbtn" aria-label={t('Remove drop')} onClick={() => removeDrop(i, di)}><Icon name="xmark" /></button>
              </div>
            ))}
            {clustersOf(s).map((c, ci) => (
              <div className="subrow" key={'c' + ci}>
                <span className="subn">{t('Burst {0}', ci + 1)}</span>
                {miniStepper(c.r, 1, false, v => setClusterField(i, ci, v))}
                <span className="dim small">{c.restSec}s</span>
                <button className="iconbtn" aria-label={t('Remove burst')} onClick={() => removeCluster(i, ci)}><Icon name="xmark" /></button>
              </div>
            ))}
            {wc.setShortcuts && <div className="setextra">
              {!isRestPauseSet(s) && <button className="chip add" onClick={() => addDropRow(i)}><Icon name="arrowDown" />{t('+ Drop')}</button>}
              {!isDropSet(s) && <button className="chip add" onClick={() => addBurstRow(i)}><Icon name="bolt" />{t('+ Burst')}</button>}
            </div>}
          </>}
        </div>
      })}
      <div style={{ height: 8 }} />
      {wc.setShortcuts ? <div className="row" style={{ flexWrap: 'wrap' }}>
        <Button size="sm" icon="flame" onClick={onAddWarmup}>{t('Add warm-up set')}</Button>
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div> : <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>}
    </div>
  </>
}

/* ---------- active workout ---------- */
export function removeActiveExercise(idx) {
  // Clear the work callback before indexes can shift. This also protects a confirmation sheet
  // that was opened first and confirmed after a timed hold started.
  useUI.getState().stopWork()
  // A rest countdown belongs to the exercise whose set started it (timer.forIdx). Removing that
  // exercise ends the rest — there is nothing left to rest for. Removing any other exercise
  // keeps the countdown and only re-points it, so a pause you are in the middle of survives
  // tidying up the list.
  const rest = useUI.getState().timer
  if (rest && rest.forIdx === idx) useUI.getState().stopRest()
  else useUI.getState().shiftRestOwner(idx + 1, -1)
  useStore.getState().update(s => {
    if (!s.active || !Array.isArray(s.active.entries)) return
    if (idx < 0 || idx >= s.active.entries.length) return
    s.active.entries.splice(idx, 1)
    cleanupSg(s.active.entries)
    if (idx < s.active.cur) s.active.cur--
    if (s.active.cur >= s.active.entries.length) s.active.cur = Math.max(0, s.active.entries.length - 1)
  }, true)
}

function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest: liveRest, stopRest, stopWork, work } = useUI()
  const A = S.active
  // A past workout has no rest to time — the sets were done days ago. The work timer for
  // timed sets stays, since counting a hold is how its duration gets entered.
  const startRest = A.backfill ? () => {} : liveRest
  const units = supersetUnits(A.entries)
  const cur = Number.isInteger(A.cur)
    ? Math.min(Math.max(A.cur, 0), Math.max(0, A.entries.length - 1))
    : 0
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1
  // Cards show one unit at a time with Prev/Next + swipe; list and compact stack every unit so
  // the whole session is visible and scrollable (Settings → During a workout → Workout view,
  // seeded onto s.active and overridable for this session from the header ⋮). compact is list
  // with the per-exercise media, tag chips, note lines, "last time" and progression line
  // stripped — just names and set rows. Every set handler below is already entry-index
  // parameterised, so these only change what is rendered — completion, rest, top-weight and
  // auto-advance share one path. Unknown/absent values read as cards, keeping every
  // pre-existing profile (and a session started before this field) as it was.
  const workoutView = A.workoutView || S.workoutView
  const listMode = workoutView === 'list' || workoutView === 'compact'
  const dense = workoutView === 'compact'
  const wc = workoutControls(S)
  // Superset flow: center the actionable row when completing a set moves to the partner or
  // back to the first exercise of the next round. Entry-bound maps keep repeated exercise IDs
  // distinct, while each rendered set index identifies the existing row within that entry.
  const exRefs = useRef(new Map())
  const setRefs = useRef(new Map())
  const bindExRef = (entry, el) => {
    if (el) exRefs.current.set(entry, el)
    else {
      exRefs.current.delete(entry)
      setRefs.current.delete(entry)
    }
  }
  const bindSetRef = (entry, setIdx, el) => {
    let refs = setRefs.current.get(entry)
    if (el) {
      if (!refs) { refs = new Map(); setRefs.current.set(entry, refs) }
      refs.set(setIdx, el)
    } else if (refs) {
      refs.delete(setIdx)
      if (!refs.size) setRefs.current.delete(entry)
    }
  }
  const swipe = useRef(null)
  const progressHighWater = useRef(A.entries.map(e => e.sets.filter(s => s.done).length))
  // The marks are index-keyed, and removing an exercise shifts every index above it down
  // (removeActiveExercise splices). Re-baseline whenever the list length changes, otherwise a
  // shifted exercise inherits its predecessor's mark and its real progress reads as a re-check.
  useEffect(() => {
    progressHighWater.current = A.entries.map(e => e.sets.filter(s => s.done).length)
  }, [A.entries.length])
  useEffect(() => {
    const liveEntries = new Set(A.entries)
    for (const entry of exRefs.current.keys()) {
      if (!liveEntries.has(entry)) exRefs.current.delete(entry)
    }
    for (const entry of setRefs.current.keys()) {
      if (!liveEntries.has(entry)) setRefs.current.delete(entry)
    }
  })
  useEffect(() => {
    if (!isSuperset || listMode) return
    const entry = A.entries[cur]
    const firstIncomplete = entry?.sets.findIndex(s => !s.done) ?? -1
    const setIdx = firstIncomplete >= 0 ? firstIncomplete : (entry?.sets.length ?? 0) - 1
    const el = (setIdx >= 0 && setRefs.current.get(entry)?.get(setIdx)) || exRefs.current.get(entry)
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [cur, isSuperset, listMode, A.entries.length])

  const total = setUnitsTotal(A.entries)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    // Changing a weight cascades to the following sets of the same phase, so a
    // heavier bar carries through the set instead of retyping every row.
    if (field === 'w') {
      e.sets = cascadeWeight(e.sets, i, v)
    }
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else {
      const row = { w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false }
      // A unilateral exercise keeps adding per-side rows (issue #60): seed each side from the
      // previous set's own side when it had one, else split the row's total evenly.
      e.sets.push(isPerSide({ ...(e.target || {}), id: e.id })
        ? (l && isSideSet(l)
          ? makeSideSet({ w: l.sides.L.w, r: (l.sides.L.r || 0) * 2 })
          : makeSideSet(row))
        : row)
    }
  })
  const removeSet = idx => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })
  const addWarmup = idx => mutEntry(idx, e => {
    const m = modeOf({ ...(e.target || {}), id: e.id })
    e.sets = insertWarmupRow(e.sets, m, e.target || {}, defaultIncrement(e.id, S.unit))
  })
  const removeSetAt = (idx, i) => mutEntry(idx, e => { e.sets = removeRowAt(e.sets, i) })
  const pairAt = (first, second) => update(s => {
    s.active.entries = pairAdjacent(s.active.entries, first, second)
  })
  const unpairAt = idx => update(s => {
    s.active.entries = unpairSuperset(s.active.entries, idx)
  })
  const onPairPrev = !isSuperset && cur > 0 ? () => pairAt(cur - 1, cur) : null
  const onPairNext = !isSuperset && cur < A.entries.length - 1 ? () => pairAt(cur, cur + 1) : null
  const moveUnitAt = (at, direction) => {
    const ui = useUI.getState()
    const active = useStore.getState().S.active
    if (ui.work || !canMoveActiveWorkoutUnit(active, at, direction)) return
    // Invalidate an old timed callback before indexes shift. A running rest is not cancelled:
    // it belongs to an exercise (timer.forIdx), and that exercise only changes position.
    ui.stopWork()
    update(s => {
      const moved = moveActiveWorkoutUnit(s.active, at, direction)
      if (!moved) return
      progressHighWater.current = moved.indices.map(index => progressHighWater.current[index])
      const rest = useUI.getState().timer
      if (rest && rest.forIdx != null) {
        const forIdx = moved.indices.indexOf(rest.forIdx)
        if (forIdx >= 0) useUI.setState({ timer: { ...rest, forIdx } })
      }
    }, true)
  }

  const moveCurrentUnit = direction => moveUnitAt(cur, direction)

  // One prop object per entry so the card and list layouts share the exact same wiring. The
  // exercise-level actions (swap, move, remove) address the entry itself, so the "more" menu of
  // a superset member acts on that member, not on whatever the marker happens to point at.
  const blockProps = idx => ({
    onSwap: () => swapActiveWorkoutExercise(idx),
    onMoveUp: () => moveUnitAt(idx, -1),
    onMoveDown: () => moveUnitAt(idx, 1),
    canMoveUp: canMoveActiveWorkoutUnit(A, idx, -1),
    canMoveDown: canMoveActiveWorkoutUnit(A, idx, 1),
    onRemoveExercise: () => confirmRemoveExercise(idx),
    busy: !!work,
    onToggle: i => toggle(idx, i),
    onToggleSide: (i, side) => toggle(idx, i, side),
    onField: (i, f, v) => setField(idx, i, f, v),
    onAddSet: () => addSet(idx),
    onRemoveSet: () => removeSet(idx),
    onAddWarmup: () => addWarmup(idx),
    onRemoveSetAt: i => removeSetAt(idx, i),
    onStartTimed: i => startTimed(idx, i),
    onProgressionSettings: () => openProgressionSettings(idx),
  })
  const navigateUnit = direction => {
    const targetFor = active => {
      if (!active || !Array.isArray(active.entries) || !Number.isInteger(active.cur)) return null
      if (active.cur < 0 || active.cur >= active.entries.length) return null
      const freshUnits = supersetUnits(active.entries)
      const freshUnitIdx = freshUnits.findIndex(candidate => candidate.includes(active.cur))
      return freshUnitIdx < 0 ? null : freshUnits[freshUnitIdx + direction]?.[0] ?? null
    }
    if (targetFor(useStore.getState().S.active) == null) return
    update(s => {
      const target = targetFor(s.active)
      if (target != null) s.active.cur = target
    })
  }
  // List mode shows every unit at once, so the "current" exercise is chosen by tapping
  // "Set current" on its header instead of Prev/Next. The bottom Move/Swap/Remove actions
  // keep operating on it, and completing sets still advances it on its own.
  const focusUnit = firstIdx => update(s => { if (s.active) s.active.cur = firstIdx })
  // The header ⋮ re-lays-out the running session without touching the saved default
  // (Settings → During a workout → Workout view). It writes s.active.workoutView, which the
  // render above prefers over S.workoutView.
  const setWorkoutView = v => update(s => { if (s.active) s.active.workoutView = v })
  const LAYOUT_LABEL = { cards: t('Cards'), list: t('List'), compact: t('Compact') }
  const openLayoutMenu = () => menuSheet({
    title: t('Layout'),
    items: [
      { icon: 'clipboard', label: t('Cards'), on: workoutView === 'cards', onClick: () => setWorkoutView('cards') },
      { icon: 'list', label: t('List'), on: workoutView === 'list', onClick: () => setWorkoutView('list') },
      { icon: 'minimize', label: t('Compact'), on: workoutView === 'compact', onClick: () => setWorkoutView('compact') },
    ],
  })
  // The header ⋮: bring another routine into the session, then the layout switch nested a
  // level down (it used to be the whole menu).
  const openViewMenu = () => menuSheet({
    items: [
      { icon: 'plus', label: t('Add routine'), sub: t('Bring another routine into this session'), onClick: addRoutineToSessionSheet },
      { icon: 'list', label: t('Layout'), sub: LAYOUT_LABEL[workoutView] || LAYOUT_LABEL.cards, onClick: openLayoutMenu },
    ],
  })
  const onSwipePointerDown = event => {
    if (swipe.current || (event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen')) return
    if (event.target.closest?.(SWIPE_IGNORED_TARGETS)) return
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const finishSwipe = (event, navigate) => {
    const start = swipe.current
    if (!start || start.id !== event.pointerId) return
    swipe.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (!navigate) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SWIPE_AXIS_RATIO) return
    navigateUnit(dx < 0 ? 1 : -1)
  }

  const openProgressionSettings = idx => {
    const state = useStore.getState().S
    const entry = state.active?.entries?.[idx]
    if (!entry) return
    const activeId = state.active.id
    const entryId = entry.id
    const entryCount = state.active.entries.length
    // A combined session's entries each carry a `rid`; progression settings read from that
    // entry's own routine, not a session-wide one.
    const routine = state.routines.find(r => r.id === entry.rid)
    exConfigSheet(exOr(entryId), entry.target, cfg => {
      // Store updates clone the state tree. If this exact object is no longer at the captured
      // index, the list changed while the sheet was open; an id check alone cannot distinguish
      // duplicate occurrences of the same exercise, so fail closed before cloning again.
      // Every store write clones the tree (the bar-weight stepper inside this very sheet does
      // one), so object identity is useless here. Same workout, same list length and the same
      // exercise at the captured index is what "nothing shifted" means.
      const current = useStore.getState().S
      if (current.active?.id !== activeId || current.active.entries?.length !== entryCount || current.active.entries?.[idx]?.id !== entryId) return
      update(s => {
        const activeEntry = s.active?.id === activeId ? s.active.entries?.[idx] : null
        // The sheet may outlive its workout or entry. Never apply its result to whatever later
        // happens to occupy the same index.
        if (!activeEntry || activeEntry.id !== entryId) return
        const full = { ...cfg, id: activeEntry.id }
        const activeRoutine = s.routines.find(r => r.id === activeEntry.rid)
        const step = modeOf(full) === 'reps' ? weightIncrement(full, s.unit) : defaultIncrement(activeEntry.id, s.unit)
        // A config without a set count keeps the rows the session already has.
        if (!(full.sets > 0)) full.sets = activeEntry.sets.filter(x => !isWarmupRow(x)).length || 1
        const plan = nextPrescription(s, full, activeRoutine)
        // The sheet edits sets, reps, weight and warm-ups as well as the rule — so the rows are
        // rebuilt from the new config the way the session was, and only what you already logged
        // is kept in place (done warm-ups first, then done work sets, then the fresh remainder).
        const fresh = applyIntensifierPlan(applyPrescription(buildSets(s, full, { step, useTarget: plan.kind === 'off' }), plan, step), full)
        const doneWarm = activeEntry.sets.filter(x => x.done && isWarmupRow(x))
        const doneWork = activeEntry.sets.filter(x => x.done && !isWarmupRow(x))
        const freshWarm = fresh.filter(isWarmupRow)
        const freshWork = fresh.filter(x => !isWarmupRow(x))
        activeEntry.target = { ...cfg }
        activeEntry.plan = plan
        activeEntry.sets = [...doneWarm, ...freshWarm.slice(doneWarm.length), ...doneWork, ...freshWork.slice(doneWork.length)]
      })
    }, null, routine)
  }

  // Remove a whole exercise from the session. The confirmation always asks first; in a
  // superset it asks WHICH exercise of the group to remove.
  const removeExercise = removeActiveExercise
  const confirmRemoveExercise = idx => {
    const e = A.entries[idx]
    if (!e) return
    const hasDone = (e.sets || []).some(s => s.done)
    confirmSheet({
      title: t('Remove {0}?', exerciseNameFor(exOr(e.id))),
      message: hasDone
        ? t('The sets you logged for this exercise in this session will be lost.')
        : t('This removes the exercise from your current session.'),
      confirmText: t('Remove'), danger: true, onConfirm: () => removeExercise(idx)
    })
  }
  const removeExerciseSheet = () => {
    if (unit.length > 1) {
      useUI.getState().openSheet(close => (
        <div>
          <h3>{t('Remove exercise')}</h3>
          <div className="muted small" style={{ marginBottom: 12 }}>{t('Which exercise in this superset do you want to remove?')}</div>
          <div className="list">
            {unit.map(idx => <div key={idx} className="item" onClick={() => { close(); confirmRemoveExercise(idx) }}>
              <div className="grow"><div className="tt">{exerciseNameFor(exOr(A.entries[idx]?.id))}</div></div>
              <Icon name="chevronRight" />
            </div>)}
          </div>
        </div>
      ))
    } else confirmRemoveExercise(cur)
  }

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, exerciseNameFor(exOr(e.id)), elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i, side) => {
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    let exJustDone = false, workoutDone = false, checked = false
    update(s => {
      const e = s.active.entries[idx]
      // A per-side tick flips just that side; the row's own `done` (both sides) is then
      // recomputed by toggleSide, so every completion check below still reads a single boolean.
      if (side) e.sets[i] = toggleSide(e.sets[i], side)
      else e.sets[i].done = !e.sets[i].done
      checked = e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        // The unit that owns the ticked set — not the marked one. Since !92 the marker no longer
        // follows a finished exercise, and in list mode any exercise can be worked on, so judging
        // the marker's unit here declared the workout complete after one set elsewhere.
        const ownUnit = unitOf(units, idx)
        const unitDone = ownUnit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (unitDone) workoutDone = !nextUnfinishedUnit(A.entries, supersetUnits(A.entries), idx)
        if (e.sets.every(x => x.done)) {
          exJustDone = true
          // topW is captured now; exWeights only at the finish (doFinishWorkout), so a typo you
          // correct before finishing, or a discarded workout, never becomes the remembered best.
          e.topW = bestWeightForEntry(e) || null
        }
      }
    }, true)
    if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))

    // Only progress beyond this exercise's high-water mark may navigate or change rest. This
    // prevents an uncheck/re-check of finished work from replaying the flow side effects.
    const fresh = useStore.getState().S.active
    if (fresh && checked && fresh.entries[idx]) {
      const progress = setProgressHighWater(fresh.entries[idx], progressHighWater.current[idx] || 0)
      progressHighWater.current[idx] = progress.highWater

      const freshUnits = supersetUnits(fresh.entries)
      const freshUnit = freshUnits.find(u => u.includes(idx))
      const freshUnitDone = freshUnit?.every(ui => fresh.entries[ui].sets.every(x => x.done))
      const nextUnit = freshUnitDone ? nextUnfinishedUnit(fresh.entries, freshUnits, idx) : null
      const freshWorkoutDone = freshUnitDone && !nextUnit
      const restBeforeWarmup = nextUnit?.some(ui =>
        fresh.entries[ui].sets.some(set => isWarmupRow(set) && !set.done),
      )
      // The rest this set has earned: the exercise's own restSec when it set one, the global
      // timer when it did not, and the longest of the group's across a superset (issue #10).
      // Resolved once here so every branch below times the same break.
      const restSec = restSecFor(fresh.entries, freshUnit || [idx], S.restSec)

      // A re-check of finished work must not navigate or reopen a sheet, but it may still owe
      // you a rest — see restOnRecheck, and the other half of issue #3.
      if (!progress.isNew) {
        if (!restBeforeWarmup && restOnRecheck({ timerRunning: !!useUI.getState().timer, unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) startRest(restSec, idx)
        return
      }

      // Singleton units are ordinary exercises: they rest between sets and after the closing
      // one unless the next unit has an unfinished warm-up, and never enter superset navigation.
      // stopRest() first so a rest that belongs after this set replaces the one that was running.
      if (freshUnitDone) stopRest()
      if (!freshUnit || freshUnit.length <= 1) {
        if (!restBeforeWarmup && restAfterSet({ unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) startRest(restSec, idx)
        return
      }

      const step = supersetFlowStep(fresh.entries, freshUnit, idx)
      if (!step) return
      if (step.unitDone) {
        if (nextUnit?.length && !restBeforeWarmup) startRest(restSec, idx)
      } else {
        if (step.nextIdx != null) update(s => { if (s.active) s.active.cur = step.nextIdx })
        if (step.roundDone) startRest(restSec, idx)
      }
    }
  }

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = setUnitsTotal(A2.entries)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  return <div className="narrow">
    {/* In list mode the whole session scrolls under the header, so the header (name, clock,
        set counter, discard/finish, progress) stays pinned — the one thing you want in view
        while you are somewhere in the middle of a long stack. Cards mode never scrolls far. */}
    <div className={'whdr' + (listMode ? ' stick' : '')}>
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); stopWork(); nav('/home') } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub">{A.backfill ? fmtDate(A.d, true) : <Elapsed start={A.start} />} · {t('{0} sets', done + '/' + total)}</div></div>
      <div className="row" style={{ gap: 4, flex: 'none' }}>
        <button className="iconbtn" aria-label={t('Workout view')} title={t('Workout view')} onClick={openViewMenu}><Icon name="more" /></button>
        <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
      </div>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>
    </div>
    {A.backfill && <div className="muted small" style={{ marginBottom: 8 }}>{t('Logging a past workout — no rest timers.')}</div>}

    {A.entries.length ? (listMode ? (
      <div className="workout-list" data-testid="workout-list">
        {units.map((u, ui) => {
          const multi = u.length > 1
          const isCur = u.includes(cur)
          return <section key={u.join('-')} className={'wl-unit' + (isCur ? ' cur' : '')} data-exidx={u[0]}>
            <div className="wl-hd">
              <span className="muted small">{multi ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length)}</span>
              {isCur
                ? <span className="tag acc">{t('Current')}</span>
                : <button className="chip" onClick={() => focusUnit(u[0])}>{t('Set current')}</button>}
            </div>
            {multi ? (
              <div className="ss-card">
                <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 5 }}><Icon name="link" />{t('Superset · do these back-to-back, rest when done')}</span>
                  <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(u[0])}>{t('Unpair')}</Button>
                </div>
                {u.map((idx, k) => {
                  const entry = A.entries[idx]
                  return <div key={idx} ref={el => bindExRef(entry, el)} className="ss-ex" data-exidx={idx}>
                    {k > 0 && <div className="ss-amp">+</div>}
                    <ExerciseBlock entryIdx={idx} compact dense={dense} onSetRowRef={(setIdx, el) => bindSetRef(entry, setIdx, el)}
                      {...blockProps(idx)} />
                  </div>
                })}
              </div>
            ) : (
              <ExerciseBlock entryIdx={u[0]} dense={dense}
                onPairPrev={u[0] > 0 ? () => pairAt(u[0] - 1, u[0]) : null}
                onPairNext={u[0] < A.entries.length - 1 ? () => pairAt(u[0], u[0] + 1) : null}
                {...blockProps(u[0])} />
            )}
          </section>
        })}
      </div>
    ) : <>
      <div className="muted small" style={{ marginBottom: 6 }}>{isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      <div className="workout-swipe-surface" data-testid="workout-swipe-surface"
        onPointerDown={onSwipePointerDown}
        onPointerUp={event => finishSwipe(event, true)}
        onPointerCancel={event => finishSwipe(event, false)}
        onLostPointerCapture={event => {
          if (swipe.current?.id === event.pointerId) swipe.current = null
        }}>
      {isSuperset ? (
        <div className="ss-card">
          <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 5 }}><Icon name="link" />{t('Superset · do these back-to-back, rest when done')}</span>
            <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(cur)}>{t('Unpair')}</Button>
          </div>
          {unit.map((idx, k) => {
            const entry = A.entries[idx]
            return <div key={idx} ref={el => bindExRef(entry, el)} className="ss-ex" data-exidx={idx}>
              {k > 0 && <div className="ss-amp">+</div>}
              <ExerciseBlock entryIdx={idx} compact onSetRowRef={(setIdx, el) => bindSetRef(entry, setIdx, el)}
                {...blockProps(idx)} />
            </div>
          })}
        </div>
      ) : (
        <ExerciseBlock entryIdx={cur} onPairPrev={onPairPrev} onPairNext={onPairNext} {...blockProps(cur)} />
      )}
      </div>
    </>) : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 12 }} />
    {!listMode && <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => navigateUnit(-1)}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => navigateUnit(1)}>{t('Next')}</Button>
    </div>}
    {!listMode && <div style={{ height: 10 }} />}
    {wc.exerciseButtons && listMode && A.entries.length > 0 && <div className="muted small" style={{ marginBottom: 6 }}>{t('Move, swap and remove below act on the exercise marked {0}.', t('Current'))}</div>}
    <Button onClick={() => exercisePicker((ex, quick) => {
      // A freehand add inherits the current unit's routine (its `rid`) so it lands in that
      // routine's block in a combined session and gets a real prescription; a routine-less
      // freestyle session has no `rid` to inherit. `noProg` is never set independently here —
      // the only mid-session route to an excluded entry is "Add routine".
      const curRid = A.entries[A.cur]?.rid
      const routine = curRid ? S.routines.find(r => r.id === curRid) : null
      const freestyle = !routine
      // Freestyle has no routine prescription to apply: show the last target in the config
      // sheet and carry its completed rows forward. A planned session uses its configured
      // target when progression is off, while progression-enabled sessions keep their path.
      const seed = freestyle ? freestyleConfig(S, { id: ex.id, ...defaultConfig(ex.id) }) : null
      const commit = cfg => update(s => {
        const full = { ...cfg, id: ex.id }
        const plan = freestyle ? null : nextPrescription(s, full, routine)
        const sets = buildSets(s, full, {
          step: modeOf(full) === 'reps' ? weightIncrement(full, s.unit) : defaultIncrement(ex.id, s.unit),
          ...(freestyle ? { preferLast: true } : {}),
          ...(plan?.kind === 'off' ? { useTarget: true } : {})
        })
        const progressed = freestyle ? sets : applyPrescription(sets, plan, modeOf(full) === 'reps' ? weightIncrement(full, s.unit) : defaultIncrement(ex.id, s.unit))
        const insertAt = insertionIndexAfterCurrentUnit(supersetUnits(s.active.entries), s.active.cur, s.active.entries.length)
        s.active.entries.splice(insertAt, 0, { id: ex.id, target: { ...cfg }, plan, sets: applyIntensifierPlan(progressed, full), ...(curRid ? { rid: curRid } : {}) })
        s.active.cur = insertAt
        useUI.getState().shiftRestOwner(insertAt, 1)
      })
      // The "+" on a picker row reads as "add this now" — routed through the same detail
      // sheet before, so it added nothing until you'd scrolled past it and found the real
      // button. Quick-add commits with the same default (or, freestyle, last-session) config
      // the sheet would have opened with; tapping the row still opens that sheet for anyone
      // who wants to set sets/reps first.
      if (quick) { commit(seed || defaultConfig(ex.id)); useUI.getState().toast(t('“{0}” added to {1}', exerciseNameFor(ex), routine ? routine.name : t('Freestyle'))) }
      else exConfigSheet(ex, null, commit, null, routine, seed)
    })} icon="plus">{t('Add exercise')}</Button>
    {wc.exerciseButtons && A.entries.length > 0 && <>
      <div style={{ height: 6 }} />
      <div className="row">
        <Button size="sm" icon="chevronUp" aria-label={t('Move up')}
          disabled={!!work || !canMoveActiveWorkoutUnit(A, cur, -1)} onClick={() => moveCurrentUnit(-1)}>{t('Move up')}</Button>
        <Button size="sm" trailingIcon="chevronDown" aria-label={t('Move down')}
          disabled={!!work || !canMoveActiveWorkoutUnit(A, cur, 1)} onClick={() => moveCurrentUnit(1)}>{t('Move down')}</Button>
      </div>
      <div style={{ height: 6 }} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Button size="sm" icon="shuffle" aria-label={t('Swap exercise')} disabled={!!work}
          onClick={() => swapActiveWorkoutExercise(cur)}>{t('Swap exercise')}</Button>
      </div>
      <div style={{ height: 6 }} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Button size="sm" icon="minus" style={{ color: 'var(--red)' }} disabled={!!work} onClick={removeExerciseSheet}>{t('Remove exercise')}</Button>
      </div>
    </>}
    <div style={{ height: 10 }} />
    {/* Wrapping up is when you know how the session went, so the note sits with the finish
        button rather than somewhere in the header. */}
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
      <Button size="sm" icon="pencil" variant={A.note ? 'tinted' : undefined} onClick={sessionNoteSheet}>
        {A.note ? t('Edit session note') : t('Add session note')}
      </Button>
    </div>
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
