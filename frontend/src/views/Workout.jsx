import { Fragment, useEffect, useId, useRef, useState } from 'react'
import SwipeCards from '../components/SwipeCards.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { workoutControls } from '../lib/workout-controls.js'
import { useUI } from '../store/useUI.js'
import { exOr, betterWeight } from '../lib/exercises.js'
import { usesBar } from '../lib/bar.js'
import { loadKindFor, baseWeightFor, inventoryFor, rowLoad, sameLoad, plateDelta, dropGrid } from '../lib/plates.js'
import { effectiveRoutines, effectiveRoutineIds, lastEntryFor, bestWeightFor, bestWeightForEntry, buildSets, freestyleConfig, defaultConfig, setsDoneActive, setUnitsTotal, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, repStep, EFFORT, effortOf, stepEffort, capEffort, cascadeWeight, insertWarmupRow, barFloor, makeWarmupAt, canBeWarmup, makeWorkAt, removeRowAt, removeLastSet, setSpanAt, copyRowAt, copySpanAt, insertRowAt, pairAdjacent, unpairSuperset, cleanupSg, applyIntensifierPlan, pinnedNoteFor, exNoteFor, setsRepsOf } from '../lib/history.js'
import { fmtNum, fmtPlate, exerciseNameText, fmtDate, fmtDaysAgo, todayISO, exCount, DAYN } from '../lib/format.js'
import { speedUnitOf, toSpeed, fromSpeed } from '../lib/speed.js'
import { clampIncline, hasIncline, inclineFits, inclineFrom, INCLINE_STEP } from '../lib/incline.js'
import { beep, vibrate, unlock } from '../lib/sound.js'
import { pinState } from '../lib/queue.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { api, beacon } from '../lib/api.js'
import { pyramidRestFor, maxRecordAt, isPyramid, pyramidLabel } from '../lib/pyramid.js'
import { insertionIndexAfterCurrentUnit, nextUnfinishedUnit, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, warmupRestSecFor, restKind } from '../lib/supersetFlow.js'
import Media from '../components/Media.jsx'
import WorkoutScrollAnchor from '../components/WorkoutScrollAnchor.jsx'
import WorkoutChips from '../components/WorkoutChips.jsx'
import { supersetMeta } from '../lib/superset-meta.js'
import WorkoutThumb, { hasWorkoutMedia } from '../components/WorkoutThumb.jsx'
import { workoutSettingsSheet } from '../components/WorkoutSettingsSheet.jsx'
import { durationSheet } from '../components/DurationWheel.jsx'
import { REST_MAX, fmtRest } from '../lib/duration.js'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, finishWorkout, exitWorkoutEdit, workoutCompleteSheet, confirmSheet, exerciseNoteSheet, sessionNoteSheet, renameWorkoutSheet, swapActiveWorkoutExercise, barWeightSheet, menuSheet, effortPickerSheet, exerciseHistorySheet, addRoutineToSessionSheet, finishWorkoutSheet } from '../sheets.jsx'
import { afterScrollRestore, scrollRestorePending } from '../components/Modals.jsx'
import { effortColor } from '../lib/effort.js'
import Elapsed from '../components/Elapsed.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { defaultIncrement, weightIncrement, stepWeight } from '../lib/progression.js'
import { progressionGuidance } from '../lib/progression-copy.js'
import { buildPlannedEntry, plannedConfigOf, builtOutOfProgression } from '../lib/session-start.js'
import { routineChangesFromEntry, updateRoutineFromEntry } from '../lib/routines.js'
import { sessionNoProg, setSessionNoProg, setEntryNoProg, joinSessionNoProg } from '../lib/session-noprog.js'
import { glyphOf } from '../lib/glyphs.js'
import { markAllSetsDone, sessionHistory } from '../lib/backfill.js'
import { bestSetFor } from '../lib/exercise-history.js'
import { isWarmupRow, isFailureSet, toggleFailure, isDropSet, isRestPauseSet, dropsOf, clustersOf, addDrop, addCluster, removeDropAt, removeClusterAt, setDropAt, setClusterAt, nextDropWeight, nextBurstReps, isSideSet, makeSideSet, setSideField, toggleSide, addSideDrop, removeSideDropAt, setSideDropAt, addSideCluster, removeSideClusterAt, setSideClusterAt, WEIGHT_ORIGIN_MANUAL } from '../lib/workout-model.js'
import { canMoveActiveWorkoutUnit, moveActiveWorkoutUnit, canMoveActiveWorkoutEntry, moveActiveWorkoutEntry } from '../lib/active-workout-order.js'
import { nextOpenSet, workoutKeyAction } from '../lib/workout-keys.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import FocusView from './FocusView.jsx'
import { withMeaning, historyAs, dbLoadFor, entryDbLoad, bellsIn, ownedWeightsFor, stepOwned } from '../lib/dumbbells.js'

// How long after a key starts a hold the same key is not yet its "Done" (#133). A USB button
// that bounces, or a double press, sends two presses a moment apart: the first starts the hold,
// and the second logged it at one second.
const HOLD_KEY_GRACE_MS = 1500

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayIds = effectiveRoutineIds(S, todayISO())
  const todayRoutines = effectiveRoutines(S, todayISO())
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  const todayOvr = S.dayPlan[todayISO()] !== undefined && pinState(S, S.dayPlan[todayISO()]) !== 'done' // a fulfilled pin is no override
  const idSet = new Set(todayIds)
  const others = S.routines.filter(r => !idSet.has(r.id))
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} · {todayRoutines.length ? t('today is {0}', todayName) : t('rest day, but no one’s stopping you')}</div></div></div>
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


// A set-row column's number as it is shown. Most columns show what is stored; one with a `view`
// (cardio speed, stored in km/h) converts it for the screen.
const viewOf = (col, value) => (col.view && value != null && value !== '' ? col.view(value) : value)

// Arabic and Hebrew letters, the presentation forms included. A set summary with one in it is a
// per-side set in Arabic ("يسار 15×8 · يمين 15×7"): forced left to right, its side words stood
// on the wrong side of their numbers and the numbers after them turned round (8×15).
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
// `compact` shrinks the block for a superset member; `dense` (compact view) goes further and
// drops everything that is not a set you are logging — media, tag chips, the note lines, the
// "last time" recap and the progression line — leaving the name, the ⋯ menu, the one-line plan
// the rows are measured against, and the sets.
// Nothing dropped is lost: it is all still on the ⋯ menu, or one ⋮ switch back to list/cards.
// The pause between the left and the right side of one timed per-side set (owner's call): long
// enough to turn over, far shorter than the rest the set earns once both sides are held.
const SWITCH_SIDES_SEC = 10

function ExerciseBlock({ entryIdx, compact, dense, editing, onToggle, onToggleSide, onField, onAddSet, onRemoveSet, onAddWarmup, onRemoveSetAt, onCopySetAt, onStartTimed, onPairPrev, onPairNext, onSetRowRef, onProgressionSettings, onRest, onNoProg, routineUpdate, onSwap, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onRemoveExercise, busy }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const working = useUI(s => s.work)
  const restEnds = useUI(s => s.timer?.endsAt)
  const swipeHint = useUI(s => (s.swipeHint?.idx === entryIdx ? s.swipeHint : null))
  const setFlash = useUI(s => (s.setFlash?.idx === entryIdx ? s.setFlash : null))
  const optsId = useId()
  const entry = S.active.entries[entryIdx]
  // Drops/bursts mutate the row in place — same card, not a new set with its own long rest.
  // A planned exercise (see the exercise's "Intensifier" config) arrives with these already
  // filled in by applyIntensifierPlan; these only add/edit/remove entries live from here on.
  const mutSet = (i, fn) => update(s => { const row = s.active.entries[entryIdx].sets[i]; s.active.entries[entryIdx].sets[i] = fn(row) }, true)
  // Warm-up or work is the row's phase; switching it moves the row to the edge of the warm-ups.
  const setPhaseAt = (i, warm) => update(s => {
    const e = s.active.entries[entryIdx]
    e.sets = warm ? makeWarmupAt(e.sets, i) : makeWorkAt(e.sets, i)
  }, true)
  const toggleFailureAt = i => update(s => {
    const e = s.active.entries[entryIdx]
    const [start, count] = setSpanAt(e.sets, i)
    const on = !isFailureSet(e.sets[i])
    for (let j = start; j < start + count; j++) if (isFailureSet(e.sets[j]) !== on) e.sets[j] = toggleFailure(e.sets[j])
  }, true)
  const addDropRow = i => mutSet(i, row => {
    // A unilateral set drops per side (issue #60): addSideDrop seeds each side from its own weight.
    if (isSideSet(row)) {
      const pct = entry.target?.intensifier?.type === 'dropset' ? entry.target.intensifier.pct : undefined
      return addSideDrop(row, pct, dropGrid(S, { ...entry.target, id: entry.id }))
    }
    const drops = dropsOf(row)
    const base = drops.length ? drops[drops.length - 1].w : (row.w || 0)
    const pct = entry.target?.intensifier?.type === 'dropset' ? entry.target.intensifier.pct : undefined
    // On a weight you can load: the plates you own, else the exercise's step (lib/plates.js).
    return addDrop(row, { w: nextDropWeight(base, pct, dropGrid(S, { ...entry.target, id: entry.id })), r: row.r })
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
  const setSide = (i, side, field, v) => {
    if (field !== 'w') return mutSet(i, row => setSideField(row, side, field, v))
    update(s => {
      const e = s.active.entries[entryIdx]
      const row = setSideField(e.sets[i], side, field, v)
      row.sides[side].weightOrigin = WEIGHT_ORIGIN_MANUAL
      e.sets[i] = row
      e.sets = cascadeWeight(e.sets, i, v, side, e.target?.backoffStep)
    }, true)
  }
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
  const thumb = !dense && S.gifSize === 'mini' && hasWorkoutMedia(ex)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  // The history the rows were built from: before the session's day when it is logged into the
  // past (sessionHistory), so "last time", the best set and the Best chip are not from later on.
  const H = sessionHistory(S)
  // The routine's own last session of this exercise (or any, for a routine that has none), the
  // same one the rows and the progression line were built from (#216).
  const last = lastEntryFor(H, entry.id, entry.rid)
  const standingNote = exNoteFor(S, entry.id)
  // Only worth surfacing while there is still work left: once the exercise is finished, a note
  // telling you what to do in it is behind you, and the block is already long.
  const pinnedNote = entry.sets.some(s => !s.done) ? pinnedNoteFor(S, entry.id) : null
  // The number is the heaviest logged set, or the working weight you kept.
  // On an assistance machine the best is the least help, and a 0 on either side means "nothing
  // logged" rather than a record (issue #232).
  // Read in the meaning this session logs a dumbbell weight in (lib/dumbbells.js), so a past
  // "40 total" is not a record a "22 each" set has to beat.
  const meaning = entryDbLoad(entry)
  const bestHist = bestWeightFor(H, entry.id, meaning)
  const bestKept = (H.exWeights[entry.id] || {}).w || 0
  const best = cardio ? 0
    : bestHist > 0 && bestKept > 0 ? betterWeight(entry.id, bestHist, bestKept) : Math.max(bestHist, bestKept)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  const guidance = progressionGuidance(plan)
  // The plan this exercise was built from (issue #275), on one quiet line in every view — the
  // routine's "2 × 10" is the thing the rows are measured against. When today's rows open
  // somewhere else, the same line says so: progression moved the sets or reps (a bodyweight
  // climb, a deload, an added set), or they carry last session's reps ("Your last session").
  // An entry built before plans were stamped, and a freestyle one, has no plan to show.
  const planned = entry.planned && mode !== 'cardio' ? entry.planned : null
  const planLine = (() => {
    if (!planned) return null
    const today = entry.target || {}
    // A pyramid reads as its targets, as on the routine row: "12 · 8 · 6 · Max · 12", never the
    // set count times the first target (#367). Its rows are the plan; nothing moves them.
    if (isPyramid(today)) return <div className="small dim planline" style={{ marginBottom: 4 }}>{t('Plan: {0}', pyramidLabel(today.pyramid))}</div>
    const todaySets = today.sets || planned.sets || 1
    const inPlan = timed
      ? today.sec == null || today.sec === planned.sec
      : today.reps == null || (planned.repsMin > 0 ? today.reps >= planned.repsMin && today.reps <= planned.reps : today.reps === planned.reps)
    const note = todaySets !== (planned.sets || 1) || !inPlan
      ? t('today {0}', setsRepsOf({ mode, sets: todaySets, reps: today.reps, sec: today.sec }))
      : entry.carried ? t('reps from your last session') : null
    return <div className="small dim planline" style={{ marginBottom: 4 }}>
      {t('Plan: {0}', setsRepsOf({ ...planned, mode }))}{note ? ' · ' + note : ''}
    </div>
  })()
  // What the rows are held against (#173): the last time in this routine (#216), or the best set
  // of the exercise ever logged — after a bad day, "last time" puts the bad day on the screen as
  // the number to beat. Tapping the line switches between the two, and the choice is the
  // profile's (S.logRef), so every exercise and the next session follow it.
  const refBest = S.logRef === 'best'
  const ref = refBest ? bestSetFor(H, entry.id, mode, meaning) : last
  // An exercise logged before only in another mode (reps then, a hold today) has a last time but
  // no best set to hold today's rows against. The line stays and says so: gone, it took the
  // switch back to "Last time" with it, reachable then only from Settings or another card.
  // How long ago reads at a glance (#363): "3 days ago", counted from the session's own day, so a
  // workout logged into the past is not told its last time was "today". The date itself stays
  // in the hover title and in what a screen reader hears.
  const refLabel = refBest ? t('Best set') : t('Last time')
  const refAgo = ref ? fmtDaysAgo(ref.d, S.active.d || todayISO()) : ''
  const refSets = ref ? (refBest ? [ref.set] : ref.sets).map(s => setLabel(entry.id, s, ref.target, speedUnitOf(S))) : []
  const refText = ref ? `${refLabel} (${refAgo}, ${fmtDate(ref.d, true, true)}): ` + refSets.join(', ') : refBest && last ? t('Best set: nothing logged this way yet') : null
  const refAction = refBest ? t('Show last time instead') : t('Show your best set instead')
  // The button's text is the reference, which says nothing about what a tap does; its name
  // carries both, the reference first as it reads on screen, then the switch.
  const refLine = refText ? <button type="button" className="refline small dim"
    title={refAction} aria-label={`${refText}. ${refAction}`}
    onClick={() => update(s => { s.logRef = refBest ? 'last' : 'best' })}>
    {/* Each set on its own left-to-right island. In Arabic the first one followed the label's
        direction and read 8×60, while those after a Latin "RIR" read 60×8. A set that carries
        words of a right-to-left script keeps its own direction, still isolated (RTL_LETTER). */}
    <span>{ref ? <>{refLabel} (<time dateTime={ref.d} title={fmtDate(ref.d, true, true)}>{refAgo}</time>): {refSets.map((l, i) => <Fragment key={i}>{i ? ', ' : ''}<bdi dir={RTL_LETTER.test(l) ? 'auto' : 'ltr'}>{l}</bdi></Fragment>)}</> : refText}</span>
    <Icon name="history" />
  </button> : null
  // Zero added weight must stay editable: a bodyweight set can become weighted
  // later, or return to zero without losing its load control (issue #460).
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  // A unilateral exercise logs each side on its own (issue #60): work rows render as an L and an
  // R sub-row, each with its own weight/reps/effort and done tick. Warm-ups stay single.
  const perSide = mode === 'reps' && isPerSide(cfg)
  const loadStep = mode === 'reps' ? weightIncrement(cfg, S.unit) : 2.5
  // With the dumbbells you own listed (issue #376), + and − walk from bell to bell — 9, 11, 13 —
  // instead of along the increment's grid; an off-list weight goes to the nearest bell that way.
  const owned = mode === 'reps' ? ownedWeightsFor(S, cfg) : null
  const stepLoad = (v, step, dir) => (owned ? stepOwned(owned, v, dir) : stepWeight(v, step, dir))
  // The weight column says what a dumbbell weight means when the exercise has said (#474): one
  // bell or both together. A one-arm exercise holds one bell, so its plain heading is already true.
  const bells = !bw && bellsIn(cfg) === 2 ? meaning : 'as'
  const loadCol = { f: 'w', step: loadStep, dec: true, hd: bw ? t('Added ({0})', S.unit)
    : bells === 'each' ? t('Each ({0})', S.unit) : bells === 'total' ? t('Both ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : loadCol
  // Speed is stored in km/h and shown in the profile's unit (lib/speed.js): `view` turns the
  // stored number into the one on screen, `store` the one typed or stepped back into km/h.
  const speedUnit = speedUnitOf(S)
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: speedUnit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)'),
    view: v => toSpeed(v, speedUnit), store: v => fromSpeed(v, speedUnit) }
    : timed ? loadCol : repCol
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  // The effort column carries the scale key (`eff`) and its field name; unlike weight/reps it
  // is not a stepper — it opens a colour-coded picker (see effortCell). `f` is s.rir or s.rpe.
  // Cardio's third column is the treadmill's incline (lib/incline.js), on the exercises that have
  // one and on any whose rows already carry a grade. `opt` again: a cleared field is no incline,
  // and `store` keeps whatever is typed on the half percent between 0 and 40.
  const inclineCol = cardio && (inclineFits(ex) || entry.sets.some(hasIncline))
    ? { f: 'incline', step: INCLINE_STEP, dec: true, opt: true, hd: t('Incline (%)'), store: clampIncline } : null
  const col3 = cardio ? inclineCol : mode === 'reps' && eff ? { f: eff.f, eff: kind, hd: t(eff.hd) } : null
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
    if (mode === 'reps' && col.f === 'w') return onField(i, col.f, stepLoad(cur, col.step, dir))
    // The step is in the unit on screen: +0.5 mph, not +0.5 km/h shown as +0.31.
    const next = Math.max(0, Math.round(((viewOf(col, cur) || 0) + dir * col.step) * 100) / 100)
    onField(i, col.f, col.store ? col.store(next) : next)
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  // Which of the optional control groups this profile wants on screen (Settings → During a
  // workout → Workout controls). The lean default keeps the sets and one "more" button; each
  // switch brings one of the old always-visible button rows back.
  const wc = workoutControls(S)
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')}>
      {wc.steppers && <button aria-label={t('Decrease')} onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={viewOf(col, s[col.f]) ?? ''}
        onChange={v => onField(i, col.f, col.store ? col.store(v) : v)} /></span>
      {wc.steppers && <button aria-label={t('Increase')} onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>}
    </div>
  )
  // Plate loading, per set row (lib/plates.js): which plates make THIS row's weight, from the
  // plates you own. 'pairs' splits what is beyond the bar per side, 'single' is one stack (a
  // belt, a sled), 'none' shows nothing. A unilateral row logs each side's own weight; a bar is
  // the same bar for both legs, so the line uses the sides' weight while they agree (or only one
  // side has a number yet) and stays away once they differ. Only reps mode has a weight to load,
  // and a saved workout being corrected (#203) has nothing left to load, so its rows stay bare.
  // The rows and their drop-set sub-rows form one sequence in the order the bar sees them, keyed
  // `i` for a set and `i:dN` for its N-th drop; a rest-pause burst keeps the set's weight, so it
  // is not in the sequence.
  const plateLoading = mode === 'reps' && !editing
  const loadKind = plateLoading ? loadKindFor(S, cfg) : 'none'
  const base = baseWeightFor(S, entry.id)
  const loadSeq = loadKind === 'none' ? [] : (() => {
    const inv = inventoryFor(S)
    const out = []
    entry.sets.forEach((s, i) => {
      let w = s.w
      if (perSide && isSideSet(s)) {
        const L = s.sides.L?.w || 0, R = s.sides.R?.w || 0
        if (L && R && L !== R) return
        w = L || R
      }
      out.push({ key: String(i), load: rowLoad(loadKind, w, base, inv) })
      dropsOf(s).forEach((d, di) => out.push({ key: i + ':d' + di, load: rowLoad(loadKind, d.w, base, inv) }))
    })
    return out
  })()
  // Only a bar is named as one: a plate-loaded machine set to per side with its own weight is
  // not a "Bar 50 lb".
  const loadSummary = loadKind === 'none' ? t('Off')
    : loadKind === 'single' ? t('Single stack')
      : !usesBar(ex) ? t('Per side')
        : base > 0 ? t('Bar {0}', fmtNum(base) + ' ' + S.unit) : t('No bar')
  // The line under a set row (or a drop sub-row): shown on the first loaded row and whenever the
  // stack changes from the loaded row before it, so a run of equal weights shows its plates once.
  // What to strip and what to add rides along, except in the compact view.
  const loadLine = key => {
    const at = loadSeq.findIndex(x => x.key === key)
    const L = at >= 0 ? loadSeq[at].load : null
    if (!L) return null
    let p = at - 1
    while (p >= 0 && !loadSeq[p].load) p--
    const prev = p >= 0 ? loadSeq[p].load : null
    if (prev && sameLoad(prev, L)) return null
    // "+" between plates: "45 + 5 per side" reads as a sum, a dot did not (Boris, 2026-09-13).
    const stack = L.plates.map(w => fmtPlate(w)).join(' + ')
    const text = L.barOnly ? t('Bar only')
      : L.kind === 'pairs' ? t('{0} per side', stack || '–') : t('Load {0}', stack || '–')
    const d = prev && !dense ? plateDelta(prev.plates, L.plates) : null
    const moves = d ? [...d.strip.map(w => '−' + fmtPlate(w)), ...d.add.map(w => '+' + fmtPlate(w))] : []
    return <div className="plateline">
      <Icon name="plate" />
      <span>{text}{L.missing > 0 && <> · <span className="short">{t('{0} short', fmtPlate(L.missing) + ' ' + S.unit)}</span></>}</span>
      {moves.length > 0 && <span className="moves">{moves.join(' ')}</span>}
    </div>
  }
  // Everything about this exercise that is not a set you are logging right now lives behind one
  // button. What used to be a row of buttons in the header, a chip under the bar, a strip of
  // three under the sets and four more below the card is a single list you open once a session,
  // in groups since v1.3.11: what you change today, what you look up, the exercise's settings,
  // the order of the session, and Remove on its own at the end.
  // The exercise's own rest, or the default it falls back to (lib/supersetFlow.js restSecFor).
  const ownRest = entry.target?.restSec > 0 ? entry.target.restSec : 0
  const restSub = ownRest ? fmtRest(ownRest) : t('Default ({0})', fmtRest(S.restSec))
  const openMore = () => menuSheet({
    title: exerciseNameFor(ex),
    titleClass: exerciseNameClass(ex),
    sections: [
      { title: t('Today'), items: [
        onSwap && { icon: 'swap', label: t('Swap exercise'), onClick: onSwap, disabled: busy },
        { icon: 'sunrise', label: t('Add warm-up set'), onClick: onAddWarmup },
        { icon: 'note', label: entry.note ? t('Edit note') : t('Add note'), sub: entry.note || undefined, onClick: () => exerciseNoteSheet(entryIdx) },
        onNoProg && { icon: 'chartLineSlash', label: t('Don’t count for progression'), sub: t('This exercise, this session only'), on: entry.noProg === true, onClick: () => onNoProg(entry.noProg !== true) },
      ] },
      { title: t('Look it up'), items: [
        { icon: 'history', label: t('History'), sub: last ? t('Last time') + ' ' + fmtDate(last.d) : undefined, onClick: () => exerciseHistorySheet(entry.id) },
        { icon: 'info', label: t('How to do it'), onClick: () => exerciseDetailSheet(ex) },
      ] },
      { title: t('Settings'), items: [
        onProgressionSettings && { icon: 'slider', label: t('Exercise settings'), sub: guidance ? t(guidance.policyLabel) : t('Sets, reps, rest, progression'), onClick: onProgressionSettings },
        onRest && { icon: 'timer', label: t('Rest timer'), sub: restSub, onClick: onRest },
        plateLoading && { icon: 'plate', label: t('Plate loading'), sub: loadSummary, onClick: () => barWeightSheet(entry.id, cfg) },
        routineUpdate && { icon: 'clipboard', label: t('Update routine'), sub: routineUpdate.sub, onClick: routineUpdate.run },
      ] },
      { title: t('Order and supersets'), items: [
        onPairPrev && { icon: 'link', label: t('Make superset with previous'), onClick: onPairPrev },
        onPairNext && { icon: 'link', label: t('Make superset with next'), onClick: onPairNext },
        onMoveUp && { icon: 'chevronUp', label: t('Move up'), onClick: onMoveUp, disabled: busy || !canMoveUp },
        onMoveDown && { icon: 'chevronDown', label: t('Move down'), onClick: onMoveDown, disabled: busy || !canMoveDown },
      ] },
      { items: [
        onRemoveExercise && { icon: 'trash', label: t('Remove exercise'), onClick: onRemoveExercise, danger: true, disabled: busy },
      ] },
    ],
  })
  // The set number is the set's own menu: drop / burst / remove — three things that used to
  // sit as chips and an X on every single row.
  // A timed per-side exercise plans in L/R pairs (buildWorkSets, addSet below), so the two
  // halves of a pair read as one set number — "Set 1 — Left" then "Set 1 — Right" — rather than
  // counting every row and making the second half look like an extra set.
  const setNumOf = (s, i) => setNumberAt(entry.sets, i)
  const sideTagOf = s => s.side === 'L' ? t('Left') : s.side === 'R' ? t('Right') : null
  const openSetMenu = (s, i) => {
    const warm = isWarmupRow(s)
    const sideTag = sideTagOf(s)
    menuSheet({
      title: warm ? t('Warm-up') : sideTag ? t('Set {0} ({1})', setNumOf(s, i), sideTag) : t('Set {0}', setNumOf(s, i)),
      subtitle: setLabel(entry.id, s, entry.target, speedUnit),
      sections: [
        // A warm-up logged as a work set (or the other way round) changes phase here. Reps sets
        // only, the kind a warm-up is added as; one work set always stays, and a per-side
        // exercise's work sets keep their sides, so a warm-up there is not made one again.
        { items: [
          !warm && mode === 'reps' && canBeWarmup(s) && entry.sets.some((x, j) => j !== i && !isWarmupRow(x)) && { icon: 'sunrise', label: t('Make it a warm-up set'), onClick: () => setPhaseAt(i, true) },
          warm && mode === 'reps' && !perSide && { icon: 'dumbbell', label: t('Count it as a working set'), onClick: () => setPhaseAt(i, false) },
          // Taken to failure: a toggle with its check, like the menu's other on/off rows. It counts
          // as RIR 0 wherever effort is read, unless a rating was logged on the set. A timed
          // per-side pair is one set, so both halves get it.
          !warm && mode !== 'cardio' && { icon: 'gauge', label: t('Taken to failure'), sub: t('Nothing left in the tank'), on: isFailureSet(s), onClick: () => toggleFailureAt(i) },
        ] },
        { title: t('Add to this set'), items: [
          !warm && mode === 'reps' && !isRestPauseSet(s) && { icon: 'arrowDown', label: t('Drop set'), sub: t('+ Drop'), onClick: () => addDropRow(i) },
          !warm && mode === 'reps' && !isDropSet(s) && { icon: 'bolt', label: t('Rest-pause burst'), sub: t('+ Burst'), onClick: () => addBurstRow(i) },
        ] },
        { items: [
          onCopySetAt && { icon: 'copy', label: t('Copy this set'), onClick: () => onCopySetAt(i) },
          { icon: 'trash', label: t('Remove this set'), danger: true, disabled: !editing && entry.sets.length <= setSpanAt(entry.sets, i)[1], onClick: () => onRemoveSetAt(i) },
        ] },
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
        {wc.steppers && <button aria-label={t('Decrease')} onClick={() => step(-1)}><Icon name="minus" /></button>}
        <button className="val" aria-label={col.hd} onClick={open}>{fmtNum(v)}</button>
        {wc.steppers && <button aria-label={t('Increase')} onClick={() => step(1)}><Icon name="plus" /></button>}
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
    if (col.f === 'w') return setSide(i, side, col.f, stepLoad(cur, col.step, dir))
    // Reps step by one per side: repCol's step of two keeps the *combined* total evenly
    // splittable, but here each side is logged directly, so one tap is one rep.
    const step = col.f === 'r' ? 1 : col.step
    setSide(i, side, col.f, Math.max(0, Math.round(((cur || 0) + dir * step) * 100) / 100))
  }
  const sideCell = (sd, i, side, col, cls) => (
    <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')}>
      {wc.steppers && <button aria-label={t('Decrease')} onClick={() => sideBump(i, side, col, -1)}><Icon name="minus" /></button>}
      <span className="val"><NumberField decimal={col.dec} value={sd[col.f] ?? ''}
        onChange={v => setSide(i, side, col.f, v)} /></span>
      {wc.steppers && <button aria-label={t('Increase')} onClick={() => sideBump(i, side, col, 1)}><Icon name="plus" /></button>}
    </div>
  )
  const sideEffortCell = (sd, i, side, col) => {
    const v = sd[col.f] ?? null
    const rir = col.eff === 'rpe' ? (v == null ? null : 10 - v) : v
    const color = effortColor(rir)
    const open = () => effortPickerSheet(col.eff, v, nv => {
      setSide(i, side, col.f, nv)
      const fresh = useStore.getState().S.active?.entries[entryIdx]?.sets[i]?.sides?.[side]
      if (nv != null && fresh && !fresh.done) onToggleSide(i, side)
    })
    if (v == null) return <button className="effcell is-empty" aria-label={col.hd} onClick={open}>{col.hd}</button>
    const step = dir => setSide(i, side, col.f, stepEffort(col.eff, v, dir))
    return (
      <div className={'stp effcell-stp' + (wc.steppers ? '' : ' plain')}
        style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined}>
        {wc.steppers && <button aria-label={t('Decrease')} onClick={() => step(-1)}><Icon name="minus" /></button>}
        <button className="val" aria-label={col.hd} onClick={open}>{fmtNum(v)}</button>
        {wc.steppers && <button aria-label={t('Increase')} onClick={() => step(1)}><Icon name="plus" /></button>}
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
      <Check checked={sd.done} label={t('Set {0} ({1}) done', setNumOf(s, i), side === 'L' ? t('Left') : t('Right'))} onChange={() => onToggleSide(i, side)} />
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
      <button aria-label={t('Decrease')} onClick={() => onChange(snapWeightStep ? stepLoad(value, step, -1) : Math.max(0, Math.round(((value || 0) - step) * 100) / 100))}><Icon name="minus" /></button>
      <span className="val"><NumberField decimal={dec} value={value ?? ''} onChange={onChange} /></span>
      <button aria-label={t('Increase')} onClick={() => onChange(snapWeightStep ? stepLoad(value, step, 1) : Math.max(0, Math.round(((value || 0) + step) * 100) / 100))}><Icon name="plus" /></button>
    </div>
  )
  // A plain set row (anything but a reps L/R stack). Its own function since a timed per-side
  // hold draws two of them, L then R, inside one swipe so the pair slides as the one set it is.
  // A set taken to failure wears a small "F" on its number, the button every row's menu opens
  // from. The button's own label speaks for it, so a screen reader hears it with the set number.
  const failMark = s => isFailureSet(s) ? <span className="failmark" aria-hidden="true">{t('F')}</span> : null
  const failSay = (s, label) => isFailureSet(s) ? label + ', ' + t('Taken to failure') : label
  const plainRow = (s, i) => (
    <div ref={el => onSetRowRef?.(i, el)} className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '') + (timed ? ' timed' : '')}>
      <button type="button" className="n" aria-label={failSay(s, sideTagOf(s) ? t('Set {0} ({1})', setNumOf(s, i), sideTagOf(s)) : t('Set {0}', setNumOf(s, i)))} aria-describedby={optsId} title={t('More')} onClick={() => openSetMenu(s, i)}>{setNumOf(s, i)}{failMark(s)}</button>
      {/* Both words sit in the pill's one grid cell (::before/::after, hidden), so Left and
          Right are as wide as the longer of the two in every language and the inputs
          after them line up (#322). */}
      {sideTagOf(s) && <span className="tag acc nocap sidepill" data-l={t('Left')} data-r={t('Right')}><span>{sideTagOf(s)}</span></span>}
      {cell(s, i, col1, 'w')}
      {col2 && cell(s, i, col2, 'r')}
      {col3 && (col3.eff ? effortCell(s, i, col3) : cell(s, i, col3, 'r inc'))}
      {/* A timed set is started, not typed: the timer counts the hold down and checks the
          set off itself. The checkbox stays for anyone who timed it on their own watch. */}
      {timed && !editing && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
        onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
      <Check checked={s.done} label={sideTagOf(s) ? t('Set {0} ({1}) done', setNumOf(s, i), sideTagOf(s)) : t('Set {0} done', setNumOf(s, i))} onChange={() => onToggle(i)} />
    </div>
  )
  // Swipe on sets (v1.3.11, Settings → Workout): a set row swiped toward the start of the line is
  // removed with an Undo, toward the end copied below itself. Off, the row is the plain row it
  // was, and the Cards swipe works from it again. The row closes whenever its exercise's rows
  // change, the row is ticked, or a rest or hold starts: rows are keyed by index, so an open row
  // could otherwise end up showing another set.
  const swipeOn = !!(wc.swipeSets && onCopySetAt && onRemoveSetAt)
  const dismissHint = () => { if (useUI.getState().swipeHint) setUI({ swipeHint: null }) }
  const swipeRow = (s, i, row) => {
    if (!swipeOn) return row
    // A timed per-side pair comes here once, at its L row, and stands for both rows.
    const [from, count] = setSpanAt(entry.sets, i)
    const mine = j => j != null && j >= from && j < from + count
    return <SwipeRow canDelete={editing || entry.sets.length > count}
      onDelete={() => onRemoveSetAt(i)} onCopy={() => onCopySetAt(i)}
      onBlocked={() => useUI.getState().toast(t('Keep at least one set, champ'))}
      onStart={dismissHint}
      closeKey={[entry.sets.length, s.done ? 1 : 0, count === 2 && entry.sets[from + 1]?.done ? 1 : 0, s.sides?.L?.done ? 1 : 0, s.sides?.R?.done ? 1 : 0, restEnds || 0, working?.endsAt || 0, S.active.cur].join('|')}
      flash={setFlash && mine(setFlash.i) ? setFlash.id : 0}
      peek={swipeHint && mine(swipeHint.i) ? swipeHint.id : 0}>
      {row}
    </SwipeRow>
  }
  return <>
    {/* Animations set to Small: a thumbnail beside the name instead of a strip above it, so the
        first set is on screen without scrolling; a tap brings the full animation back. */}
    {!dense && !thumb && <Media ex={ex} key={entry.id} compact={compact} minimizable />}
    <div className="row between exhd" style={{ marginBottom: 6 }}>
      {thumb && <WorkoutThumb ex={ex} onExpand={() => update(s => { s.gifSize = 'full' })} />}
      <div style={{ flex: 1, minWidth: 0, fontSize: (compact || dense) ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2 }} className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</div>
      <div className="row" style={{ gap: 2, flex: 'none' }}>
        {entry.note && <button className="iconbtn" aria-label={t('Note')} title={t('Note')} style={{ color: 'var(--acc)' }}
          onClick={() => exerciseNoteSheet(entryIdx)}><Icon name="note" /></button>}
        <button className="iconbtn" aria-label={t('More')} title={t('More')} onClick={openMore}><Icon name="more" /></button>
      </div>
    </div>
    {/* Kept out of progression: by hand for this session (the ⋯ menu, with its undo right here),
        or by a deload or rehab routine, which owns that choice and offers no undo. On in every
        view, compact included: it changes what the next session is built from. */}
    {entry.noProg === true && <div className="noprog">
      <Icon name="chartLineSlash" /><span>{t('Not counted for progression')}</span>
      {onNoProg && <button type="button" className="chip" onClick={() => onNoProg(false)}>{t('Undo')}</button>}
    </div>}
    {/* compact view keeps the plan line: it is what the rows are measured against */}
    {dense && planLine}
    {wc.pairButtons && !compact && !dense && (onPairPrev || onPairNext) && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {onPairPrev && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with previous')} onClick={onPairPrev}>{t('Make superset with previous')}</Button>}
      {onPairNext && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with next')} onClick={onPairNext}>{t('Make superset with next')}</Button>}
    </div>}
    {/* compact view drops everything from here to the sets card — it is all still on the ⋯ menu
        (note, details, history, bar weight, progression) or is display-only (tags, "last time"). */}
    {!dense && <>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* A unilateral exercise is logged per side directly (the L/R rows below for reps, a
          "Left"/"Right" tag on each doubled row for a timed hold), so the old "{n} per side"
          chip — which halved the combined total for display — is gone: the split is no longer
          derived, it is what you enter. The tag only flags that this is per-side. */}
      {!cardio && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="sides" />{t('Per side')}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(MUSCLE_NAME[ex.tg] || ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {/* Three notes can apply to one exercise and they are not interchangeable, so each keeps its
        own line and its own icon: the plan's instruction (cfg.note, from the routine), the
        standing fact about the movement (exNotes), and the message you pinned to yourself last
        session. Today's own note is edited through the button in the header and shown last. */}
    {cfg.note && <div className="exnote">{cfg.note}</div>}
    {standingNote && <div className="exnote"><Icon name="info" style={{ fontSize: 13, marginInlineEnd: 5, verticalAlign: '-2px' }} />{standingNote}</div>}
    {pinnedNote && <div className="exnote" style={{ color: 'var(--yellow)' }}>
      <Icon name="pin" style={{ fontSize: 13, marginInlineEnd: 5, verticalAlign: '-2px' }} />
      {t('From {0}:', fmtDate(pinnedNote.d, true))} {pinnedNote.note}
    </div>}
    {entry.note && <div className="exnote">{entry.note}</div>}
    {planLine}
    {refLine}
    {guidance && onProgressionSettings && <button type="button" className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}
      aria-label={t('Open exercise settings')} onClick={onProgressionSettings}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span><strong>{t(guidance.policyLabel)}</strong> · {t(...guidance.why)}</span>
    </button>}
    </>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* the header carries the same eff3/timed sizing as the rows, or the labels drift off their
          columns; over L/R rows it also has to skip the side badge that sits in front of the weight cell */}
      <div className={'sethead' + (col3 ? ' eff3' : '') + (timed ? ' timed' : '') + (perSide ? ' per-side' : '') + (wc.steppers ? '' : ' plain')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{col3 && <span className={col3.eff ? 'eff-sp' : 'r-sp'}>{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
      <span id={optsId} className="vh">{t('Options: copy, remove')}</span>
      {entry.sets.map((s, i) => {
        const warm = isWarmupRow(s)
        const warmBefore = i > 0 && isWarmupRow(entry.sets[i - 1])
        const isFirstWarmup = warm && !warmBefore
        // Numbering restarts per phase: with two warm-ups the first work set reads 1, not 3.
        const phaseNum = entry.sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
        // A timed per-side hold is an L row and an R row that delete and copy as one set, so they
        // also swipe as one: the L row's turn draws both, the R row's draws neither.
        const [spanStart, spanCount] = setSpanAt(entry.sets, i)
        const pairHead = spanCount === 2 && spanStart === i
        const pairTail = spanCount === 2 && spanStart !== i
        return <div key={i}>
          {isFirstWarmup && <div className="setph">{t('Warm-up')}</div>}
          {!warm && warmBefore && <div className="setsep" />}
          {/* A pyramid's Max set: the reps are what you managed, not a number to hit. */}
          {/* With the record to beat at this set's weight or heavier, from before this session. */}
          {!warm && s.max && <div className="setph">{t('Max: as many reps as you can')}{(() => {
            const rec = maxRecordAt(H.workouts, entry.id, s.w)
            if (!rec) return null
            return ' · ' + (rec.w > 0 ? tn('Record: {0} rep at {1}', 'Record: {0} reps at {1}', rec.r, fmtNum(rec.w) + ' ' + S.unit) : tn('Record: {0} rep', 'Record: {0} reps', rec.r))
          })()}</div>}
          {!pairTail && swipeRow(s, i, perSide && isSideSet(s) ? (
            // Unilateral set: the number sits beside a two-row L/R stack, each side logged and
            // ticked on its own (issue #60). Warm-ups split the same way as the work sets they
            // ramp toward, so a warm-up side set shows L/R too (#388).
            <div ref={el => onSetRowRef?.(i, el)} className={'setrow-side' + (s.done ? ' done' : '')}>
              <button type="button" className="n" aria-label={failSay(s, t('Set {0}', phaseNum))} aria-describedby={optsId} title={t('More')} onClick={() => openSetMenu(s, i)}>{phaseNum}{failMark(s)}</button>
              <div className="side-rows">
                {sideRow(s, i, 'L', col1, col2, col3)}
                {sideExtras(s, i, 'L')}
                {sideRow(s, i, 'R', col1, col2, col3)}
                {sideExtras(s, i, 'R')}
              </div>
            </div>
          ) : pairHead ? <>{plainRow(s, i)}{plainRow(entry.sets[i + 1], i + 1)}</> : plainRow(s, i))}
          {swipeHint && swipeHint.i === i && swipeOn && <div className="swhint">
            <button type="button" onClick={() => setUI({ swipeHint: null })}>
              <Icon name="swap" /><span>{t('Psst: swipe a set. Left deletes, right copies.')}</span><Icon name="xmark" />
            </button>
          </div>}
          {loadLine(String(i))}
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
            )).flatMap((el, di) => [el, <Fragment key={'dl' + di}>{loadLine(i + ':d' + di)}</Fragment>])}
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
        <Button size="sm" icon="sunrise" onClick={onAddWarmup}>{t('Add warm-up set')}</Button>
        <Button size="sm" icon="minus" disabled={entry.sets.length <= setSpanAt(entry.sets, entry.sets.length - 1)[1]} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div> : <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>}
    </div>
  </>
}

/* ---------- swipe on sets: delete, undo, copy (v1.3.11) ---------- */
// The swipe, the set-number menu and the Undo on the toast all come through here, so a set is
// removed, put back and copied the same way whichever you used, and always through the store's
// normal update: the sync sees an ordinary edit (with its _rev/baseRev), never an old snapshot
// written back over newer state.
//
// Rows have no id of their own, so whatever points at a row by its index has to move with it:
// the running hold (its callback writes the seconds to a row) and the rest a set started
// (timer.forSet). Removing the set either one belongs to stops it first; Undo does not start it
// again. Rows above or below just shift.
let holdAt = null    // { owner, idx, i }: the row a running hold will write to (startTimed)
let flashSeq = 0
// UI state written from here and from effects; a test that stubs the UI store without setState
// simply does not see it.
const setUI = patch => useUI.setState?.(patch)
const shiftRowRefs = (idx, from, by) => {
  if (holdAt && holdAt.idx === idx && holdAt.i >= from) holdAt = { ...holdAt, i: holdAt.i + by }
  // The hold's saved owner (useUI.work.owner, what a reload brings it back to) moves with it.
  const wk = useUI.getState().work
  if (wk?.owner && wk.owner.idx === idx && wk.owner.i >= from) setUI({ work: { ...wk, owner: { ...wk.owner, i: wk.owner.i + by } } })
  const rest = useUI.getState().timer
  if (rest && rest.forIdx === idx && rest.forSet != null && rest.forSet >= from) setUI({ timer: { ...rest, forSet: rest.forSet + by } })
}
/** The number a set row shows: counted per phase (warm-ups and work sets each from 1), and a
 *  timed per-side L/R pair as one set. */
export function setNumberAt(sets, i) {
  const s = sets[i]
  const warm = isWarmupRow(s)
  const phaseNum = sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
  return s?.side ? Math.ceil(phaseNum / 2) : phaseNum
}
/** Removes set `i` of active entry `idx`, with an Undo on the toast. In a live session one set
 *  always stays (removeRowAt); the editor of a saved workout may take them all. */
export function deleteActiveSet(idx, i, { editing = false } = {}) {
  const A = useStore.getState().S.active
  const e = A?.entries?.[idx]
  const row = e?.sets?.[i]
  if (!row) return false
  const ui = useUI.getState()
  // A timed per-side hold is an L row and an R row that read as one set: both go, and both come back.
  const [start, count] = setSpanAt(e.sets, i)
  if (!editing && e.sets.length <= count) { ui.toast(t('Keep at least one set, champ')); return false }
  const inSpan = j => j != null && j >= start && j < start + count
  let stopped = false
  const holdHere = ui.work && ((holdAt && holdAt.idx === idx && inSpan(holdAt.i)) || (ui.work.owner && ui.work.owner.idx === idx && inSpan(ui.work.owner.i)))
  if (holdHere) { holdAt = null; ui.stopWork(); stopped = true }
  const rest = ui.timer
  if (rest && rest.forIdx === idx && inSpan(rest.forSet)) { ui.stopRest(); stopped = !rest.ready || stopped }
  shiftRowRefs(idx, start + count, -count)
  const n = setNumberAt(e.sets, i)
  const warm = isWarmupRow(row)
  const token = { activeId: A.id, idx, entryId: e.id, i: start, rows: structuredClone(e.sets.slice(start, start + count)) }
  useStore.getState().update(s => {
    const en = s.active?.entries?.[idx]
    if (!en) return
    if (editing) en.sets.splice(start, count)
    else en.sets = removeRowAt(en.sets, i)
  }, true)
  const msg = warm ? t('Warm-up gone.') : stopped ? t('Set {0} gone. Its timer stopped too.', n) : t('Set {0} gone.', n)
  ui.toast(msg, { action: t('Undo'), onAction: () => undoDeleteSet(token) })
  return true
}
/** Puts a removed set back exactly as it was, at its old place in the same exercise. If the
 *  exercise moved, it is found by its id; if it is gone, or the workout is, there is nothing to
 *  put it back into. */
export function undoDeleteSet(token) {
  const A = useStore.getState().S.active
  const ui = useUI.getState()
  const at = !A || A.id !== token.activeId ? -1
    : A.entries[token.idx]?.id === token.entryId ? token.idx
      : A.entries.findIndex(en => en.id === token.entryId)
  if (at < 0) { ui.toast(t('Too late, that one’s gone')); return false }
  const rows = token.rows || [token.row]
  const i = Math.min(token.i, A.entries[at].sets.length)
  shiftRowRefs(at, i, rows.length)
  useStore.getState().update(s => {
    const en = s.active.entries[at]
    en.sets = rows.reduce((acc, r, k) => insertRowAt(acc, i + k, r), en.sets)
  }, true)
  setUI({ setFlash: { idx: at, i, id: ++flashSeq } })
  return true
}
/** "One more like this one": a copy of set `i` right below it (lib/history.js copyRowAt). */
export function copyActiveSet(idx, i) {
  const e = useStore.getState().S.active?.entries?.[idx]
  if (!e?.sets?.[i]) return false
  const { start, end } = copySpanAt(e.sets, i)
  shiftRowRefs(idx, end + 1, end - start + 1)
  useStore.getState().update(s => {
    const en = s.active?.entries?.[idx]
    if (en) en.sets = copyRowAt(en.sets, i)
  }, true)
  setUI({ setFlash: { idx, i: end + 1, id: ++flashSeq } })
  useUI.getState().toast(t('Copied. One more like that one.'))
  return true
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

// Whether a set row sits wholly between the fixed bars at the top and at the bottom: the status bar
// and the connection bar above, the tab bar and the rest or hold bar below. The Cards header
// scrolls with the page, so it takes nothing off the top, and a row is short enough to be all in
// or all out.
const rowOnScreen = el => {
  if (typeof window === 'undefined' || typeof el.getBoundingClientRect !== 'function') return false
  const r = el.getBoundingClientRect()
  let bottom = window.innerHeight
  for (const id of ['timer', 'tabbar']) {
    const bar = document.getElementById(id)
    const top = bar && typeof bar.getBoundingClientRect === 'function' ? bar.getBoundingClientRect().top : null
    if (top != null && top < bottom) bottom = top
  }
  return r.bottom <= bottom && r.top >= coveredTop()
}
// How much of the top of the screen the fixed bars cover. The installed app draws the page under
// the translucent status bar (viewport-fit=cover), and the connection bar (SyncBanner) sits below
// it while there is no server to reach. index.css keeps the two as --sat and --conn, but --sat is
// a max() of env() and --native-sat, and a custom property's computed value is the expression as
// text ("max(0px,47px)"), not a length. So it is measured off an element that is that tall.
const coveredTop = () => {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:calc(var(--sat) + var(--conn));visibility:hidden;pointer-events:none'
  document.body.appendChild(probe)
  const inset = probe.offsetHeight || 0
  probe.remove()
  return inset
}

function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest: liveRest, stopRest, stopWork, work, timer } = useUI()
  const A = S.active
  const editing = !!A.editingWorkoutId
  // A past workout has no rest to time — the sets were done days ago. The work timer for
  // timed sets stays, since counting a hold is how its duration gets entered.
  const startRest = (A.backfill || editing) ? () => {} : liveRest
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
  // stripped — just names, the one-line plan and set rows. Every set handler below is already entry-index
  // parameterised, so these only change what is rendered — completion, rest, top-weight and
  // auto-advance share one path. Unknown/absent values read as cards, keeping every
  // pre-existing profile (and a session started before this field) as it was.
  const requestedView = A.workoutView || S.workoutView
  const workoutView = ['list', 'compact', 'focus'].includes(requestedView) ? requestedView : 'cards'
  const listMode = workoutView === 'list' || workoutView === 'compact'
  const focusMode = workoutView === 'focus'
  const dense = workoutView === 'compact'
  // A superset's heading: its own name and rest between rounds when it has them (#292).
  const ssTitle = u => {
    const m = supersetMeta(A.entries, u, { onTarget: true })
    if (m.rest > 0) return t('{0} · back-to-back, {1} rest after each round', m.name || t('Superset'), fmtRest(m.rest))
    return m.name ? t('{0} · do these back-to-back, rest when done', m.name) : t('Superset · do these back-to-back, rest when done')
  }
  // Collapse finished exercises in the list (#241). The current unit stays open, superset
  // members included, until you move on (ticking its last set does that, see toggle); an empty
  // exercise or a half-done warm-up or side stays open too.
  // The session's own choice (the Layout menu) wins over the saved one (Settings → Workout), the
  // way the layout itself does, so someone who always wants it switches it on once.
  const collapseOn = listMode && !!(A.collapseCompleted ?? S.collapseCompleted)
  // A finished unit you tapped open again to look at or fix (Discord: "minimize completed exercises
  // so I view only what I have yet to do"). This screen's own memory: a reload folds it back.
  // Keyed by index like the units, so a different number of exercises starts over.
  const [openedState, setOpenedState] = useState(() => ({ len: A.entries.length, keys: new Set() }))
  const opened = openedState.len === A.entries.length ? openedState.keys : new Set()
  const finished = u => u.every(idx => A.entries[idx].sets.length > 0 && A.entries[idx].sets.every(s => s.done))
  const collapsed = new Set(collapseOn ? units.filter(u =>
    !u.includes(cur) && !opened.has(u.join('-')) && finished(u),
  ).map(u => u.join('-')) : [])
  const setUnitOpen = (key, open) => setOpenedState(prev => {
    const keys = new Set(prev.len === A.entries.length ? prev.keys : [])
    if (open) keys.add(key); else keys.delete(key)
    return { len: A.entries.length, keys }
  })
  const wc = workoutControls(S)
  // Superset flow: center the actionable row when completing a set moves to the partner or
  // back to the first exercise of the next round. Entry-bound maps keep repeated exercise IDs
  // distinct, while each rendered set index identifies the existing row within that entry.
  const exRefs = useRef(new Map())
  const setRefs = useRef(new Map())
  const focusPointerEpoch = useRef(0)
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
  const progressHighWater = useRef(A.entries.map(e => e.sets.filter(s => s.done).length))
  // The marks are index-keyed, and removing an exercise shifts every index above it down
  // (removeActiveExercise splices). Re-baseline whenever the list length changes, otherwise a
  // shifted exercise inherits its predecessor's mark and its real progress reads as a re-check.
  useEffect(() => {
    progressHighWater.current = A.entries.map(e => e.sets.filter(s => s.done).length)
  }, [A.entries.length])
  // A removed set takes its tick with it (deleteActiveSet): the exercise's mark comes down to what
  // is ticked now, or ticking the next set would read as a re-check and start no rest. Only on the
  // way down; a set added or put back by Undo leaves the mark where it is.
  const setCounts = A.entries.map(e => e.sets.length)
  const lastCounts = useRef(setCounts)
  useEffect(() => {
    const was = lastCounts.current
    lastCounts.current = setCounts
    if (was.length !== setCounts.length) return
    setCounts.forEach((n, k) => {
      if (n < was[k]) progressHighWater.current[k] = Math.min(progressHighWater.current[k] || 0, A.entries[k].sets.filter(s => s.done).length)
    })
  }, [setCounts.join(',')])
  // The one-time swipe hint (v1.3.11): the first time the screen shows an unticked set with swiping
  // on, that row nudges toward delete and toward copy, with a chip under it saying so. Seen once
  // per person (S.hints, synced), not per device. In Cards only the exercise on screen qualifies.
  const hintSeen = !!(S.hints && S.hints.swipeSets)
  const hintTm = useRef(null)
  useEffect(() => {
    if (!wc.swipeSets || hintSeen || !A.entries.length) return
    const tm = setTimeout(() => {
      const A2 = useStore.getState().S.active
      if (!A2 || useStore.getState().S.hints?.swipeSets) return
      const c = Math.min(Math.max(A2.cur || 0, 0), A2.entries.length - 1)
      const shownUnit = unitOf(supersetUnits(A2.entries), c)
      const order = listMode ? [c, ...A2.entries.keys()] : shownUnit
      let at = null
      for (const k of order) {
        const j = A2.entries[k]?.sets.findIndex(x => !x.done) ?? -1
        if (j >= 0) { at = { idx: k, i: j }; break }
      }
      if (!at) return
      update(s => { s.hints = { ...(s.hints || {}), swipeSets: true } })
      const id = Date.now()
      setUI({ swipeHint: { ...at, id } })
      clearTimeout(hintTm.current)
      hintTm.current = setTimeout(() => { if (useUI.getState().swipeHint?.id === id) setUI({ swipeHint: null }) }, 6000)
    }, 600)
    return () => clearTimeout(tm)
  }, [wc.swipeSets, hintSeen, A.entries.length, cur, listMode])
  useEffect(() => () => { clearTimeout(hintTm.current); setUI({ swipeHint: null, setFlash: null }) }, [])
  useEffect(() => {
    const liveEntries = new Set(A.entries)
    for (const entry of exRefs.current.keys()) {
      if (!liveEntries.has(entry)) exRefs.current.delete(entry)
    }
    for (const entry of setRefs.current.keys()) {
      if (!liveEntries.has(entry)) setRefs.current.delete(entry)
    }
  })
  // What this render shows, for a scroll that may run after it (below): the store clones the
  // whole state on every write and the ref maps above are keyed by entry object, so an entry
  // kept from an earlier render can be a key nothing is under any more.
  const shown = useRef(null)
  shown.current = { entries: A.entries, cur }
  // The marker's index when the effect below last ran. The effect also runs on mount, when two
  // exercises are paired, on List → Cards and when a unit is moved up or down. Each of those used
  // to ask for the same scroll, and a sheet closing in the same tap (the weigh-in sheet a session
  // starts through, the exercise ⋯ menu, the Layout menu) undid it on the spot. Once the scroll
  // waits for that restore they would land, and a session started through the weigh-in sheet
  // would open with its header off screen. So a run the marker did not cause scrolls only a row
  // that is off screen, and never while a sheet is still putting the page back. Coming back to
  // the session with the row below the fold still brings it back, as it always did.
  const lastCur = useRef(null)
  useEffect(() => {
    // Judged by index alone. A unit moved up or down carries the marker's index with it, and
    // moveUnitAt records the new index here itself before this runs, so that reads as no move;
    // a superset of two rows of the same exercise still reads the tick from one to the other as
    // a move.
    const was = lastCur.current
    lastCur.current = cur
    const moved = was != null && was !== cur
    if (!isSuperset || listMode) return
    // A run the marker did not cause, with a sheet closing in the same tap, never scrolled: the
    // restore undid it. Keep that by not asking at all. Asking after the restore and then judging
    // the row would centre a first row that a tall first block (a note, "Last time", the
    // progression line) pushes partly under the tab bar, and scroll the header away.
    if (!moved && scrollRestorePending()) return
    // Rating the set (RIR or RPE, one picker) closes the sheet and ticks the set in one tap, and
    // the sheet's un-pin puts the page back where it stood, now and once more a frame later
    // (components/Modals.jsx). A scroll asked for in this same commit was undone a few ms later,
    // every time, and the partner's row stayed below the fold. With no sheet closing in the last
    // third of a second, afterScrollRestore runs this at once, as the tick always did.
    return afterScrollRestore(() => {
      const { entries, cur: at } = shown.current
      const entry = entries[at]
      const firstIncomplete = entry?.sets.findIndex(s => !s.done) ?? -1
      const setIdx = firstIncomplete >= 0 ? firstIncomplete : (entry?.sets.length ?? 0) - 1
      const el = (setIdx >= 0 && setRefs.current.get(entry)?.get(setIdx)) || exRefs.current.get(entry)
      if (!el || typeof el.scrollIntoView !== 'function') return
      if (!moved && rowOnScreen(el)) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [cur, isSuperset, listMode, A.entries.length])
  // The list opens at the exercise you are on, not at the top of the session (issue #224): you
  // switch to it mid-workout to look at what comes before and after. Only on the way in — once
  // the list is open, "current" moves because you tick rows in it, and a list that scrolls
  // itself under your thumb is worse than one that stays put. List ↔ Compact counts as a way
  // in: the rows change height, so the same scroll offset lands somewhere else.
  //
  // The scroll waits for the next frame rather than running in the effect itself. App.jsx
  // restores the route's remembered position in a frame it asked for during the same commit
  // (a back navigation), and a sheet closing (⋯ → Layout → List) puts the page back
  // where it was before the sheet opened, in an effect cleanup that runs before this one —
  // both would win over a scroll made right here. A frame asked for now runs after theirs.
  const listRef = useRef(null)
  const hdrRef = useRef(null)
  useEffect(() => {
    if (!listMode) return
    const schedule = callback => window.requestAnimationFrame
      ? window.requestAnimationFrame(callback)
      : window.setTimeout(callback, 0)
    const cancel = frame => window.cancelAnimationFrame
      ? window.cancelAnimationFrame(frame)
      : window.clearTimeout(frame)
    // scrollToUnit (below) clears the sticky header at whatever height it has right now.
    const frame = schedule(() => scrollToUnit(listRef.current?.querySelector('.wl-unit.cur')))
    return () => cancel(frame)
  }, [workoutView])

  const total = setUnitsTotal(A.entries)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    // Typing a duration IS the new plan, the same way ticking the row ends it: a plan a displaced
    // hold put aside must not outrank what you just typed, or the field would read 45 and the ▶
    // would still hold the 30 the row was asking for before.
    if (field === 'sec') delete e.sets[i].planSec
    // Changing a work set's weight cascades to the following inherited work sets, so a correction
    // carries through without retyping every row while explicit manual exceptions stay put. A
    // warm-up edit stays on its own row, and the later rungs keep their ramp loads.
    if (field === 'w') {
      e.sets[i].weightOrigin = WEIGHT_ORIGIN_MANUAL
      e.sets = cascadeWeight(e.sets, i, v, undefined, e.target?.backoffStep)
    }
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), ...inclineFrom(l), done: false })
    else if (m === 'time') {
      const sec = l ? l.sec : (e.target.sec || 45)
      const w = l ? (l.w || 0) : (e.target.weight || 0)
      // A timed per-side exercise is planned in pairs (buildWorkSets), so one more "set" is one
      // more hold on each side, not a lone row an L/R count would fall out of sync with.
      if (isPerSide({ ...(e.target || {}), id: e.id })) e.sets.push({ sec, w, done: false, side: 'L' }, { sec, w, done: false, side: 'R' })
      else e.sets.push({ sec, w, done: false })
    }
    else {
      // An extra set past a pyramid copies the last one's target, Max included.
      const row = { w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false, ...(l && l.max ? { max: true } : {}) }
      // A unilateral exercise keeps adding per-side rows (issue #60): seed each side from the
      // previous set's own side when it had one, else split the row's total evenly.
      e.sets.push(isPerSide({ ...(e.target || {}), id: e.id })
        ? (l && isSideSet(l)
          ? makeSideSet({ w: l.sides.L.w, r: (l.sides.L.r || 0) * 2 })
          : makeSideSet(row))
        : row)
    }
  })
  const removeSet = idx => mutEntry(idx, e => { e.sets = removeLastSet(e.sets) })
  const addWarmup = idx => mutEntry(idx, e => {
    const m = modeOf({ ...(e.target || {}), id: e.id })
    // A warm-up of a dumbbell lift lands on a bell you own when the profile lists them (#376).
    const ramp = (m === 'reps' && ownedWeightsFor(S, { ...(e.target || {}), id: e.id })) || defaultIncrement(e.id, S.unit)
    e.sets = insertWarmupRow(e.sets, m, e.target || {}, ramp, barFloor(S, e.id))
  })
  // The set-number menu's Remove and the swipe both go through deleteActiveSet, Undo and all.
  const removeSetAt = (idx, i) => deleteActiveSet(idx, i, { editing })
  const pairAt = (first, second) => update(s => {
    if (focusMode) focusPointerEpoch.current++
    s.active.entries = pairAdjacent(s.active.entries, first, second)
  })
  const unpairAt = idx => update(s => {
    if (focusMode) focusPointerEpoch.current++
    s.active.entries = unpairSuperset(s.active.entries, idx)
  })
  const onPairPrev = !isSuperset && cur > 0 ? () => pairAt(cur - 1, cur) : null
  const onPairNext = !isSuperset && cur < A.entries.length - 1 ? () => pairAt(cur, cur + 1) : null
  // `member`: the exercise ⋯ menu's move, which reorders a superset member inside its superset
  // (lib/active-workout-order.js moveActiveWorkoutEntry). The buttons below the exercise move the
  // whole unit. Both return the same index permutation, so everything below remaps the same way.
  const moveUnitAt = (at, direction, member = false) => {
    const ui = useUI.getState()
    const active = useStore.getState().S.active
    const canMove = member ? canMoveActiveWorkoutEntry : canMoveActiveWorkoutUnit
    if (ui.work || !canMove(active, at, direction)) return
    // Invalidate an old timed callback before indexes shift. A running rest is not cancelled:
    // it belongs to an exercise (timer.forIdx), and that exercise only changes position.
    ui.stopWork()
    focusPointerEpoch.current++
    update(s => {
      const moved = (member ? moveActiveWorkoutEntry : moveActiveWorkoutUnit)(s.active, at, direction)
      if (!moved) return
      // The marker follows its unit: the superset card's scroll must not read that as a move.
      lastCur.current = s.active.cur
      progressHighWater.current = moved.indices.map(index => progressHighWater.current[index])
      const rest = useUI.getState().timer
      if (rest && rest.forIdx != null) {
        const forIdx = moved.indices.indexOf(rest.forIdx)
        if (forIdx >= 0) useUI.setState({ timer: { ...rest, forIdx } })
      }
    }, true)
  }

  const moveCurrentUnit = direction => moveUnitAt(cur, direction)

  // "Don't count for progression" from an exercise's ⋯ menu (Discord, asierlama: an injury day).
  // It stamps the entry's `noProg`, the flag a deload routine freezes onto its entries: the saved
  // workout keeps it (finish-workout.js), and the next prescription and "last time" read past
  // this entry (history.js entryExcluded). This exercise, this session; the routine is untouched.
  // Unlike a deload's, its rows keep the prescription through any rebuild (builtOutOfProgression),
  // so switching it off again leaves the numbers this session should count at. Counting one
  // exercise again also ends "the whole workout" from the header ⋮ (lib/session-noprog.js).
  const setNoProg = (idx, on) => update(s => setEntryNoProg(s.active, idx, on))
  // A deload or rehab routine keeps its own exercises out (RoutineEdit). That is the routine's
  // setting, so its entries get the marker but no switch.
  const routineKeepsOut = e => !!e?.rid && S.routines.some(r => r.id === e.rid && r.excludeFromProgression === true)
  // The same for the whole session from the header ⋮ (Discord, asierlama: "exclude the current
  // workout" on an injury day): every exercise gets the marker, and one added later joins them.
  // Absent when a deload or rehab routine already keeps every exercise out, since nothing is left
  // for the switch to change. Off counts them all again, apart from those.
  const noProgSwitchable = !A.entries.length || A.entries.some(e => !routineKeepsOut(e))
  const toggleSessionNoProg = () => update(s => setSessionNoProg(s.active, !sessionNoProg(s.active), routineKeepsOut))
  // Warm-ups added in the session, and the rest or note edited on the exercise's settings sheet
  // from inside it, belong to this session only: the routine is the plan, and finishing never
  // edits it (lib/session-routines.js). This is the explicit way to keep them — an item in the
  // exercise's ⋯ menu, there only while the routine's slot says something else than the session
  // did. Sets, reps and weight are not part of it (routineChangesFromEntry).
  const restWord = v => (Number(v) > 0 ? fmtRest(v) : t('Default ({0})', fmtRest(S.restSec)))
  const routineUpdateFor = idx => {
    const entry = A.entries[idx]
    const routine = !editing && entry?.rid ? S.routines.find(r => r.id === entry.rid) : null
    const found = routine ? routineChangesFromEntry(routine, A.entries, idx) : null
    if (!found) return null
    const activeId = A.id
    const entryId = entry.id
    return {
      // A rest reads as the wheel shows it: "3:00", and 0 (no rest of its own) as the default.
      sub: found.changes.map(c => c.key === 'note' ? t('Note')
        : c.key === 'warmupSets' ? t('Warm-up sets') + ' ' + c.from + ' → ' + c.to
        : t('Rest') + ' ' + restWord(c.from) + ' → ' + restWord(c.to)).join(' · '),
      run: () => confirmSheet({
        title: t('Update “{0}”?', routine.name),
        message: t('Copy this exercise’s warm-up sets, and the rest and note from its Exercise settings, into the routine. A note added for today stays with this workout. Your workout history is kept.'),
        confirmText: t('Update routine'),
        onConfirm: () => {
          let applied = null
          update(s => {
            // The sheet can outlive the workout, or the exercise at this index: fail closed.
            const target = s.routines.find(r => r.id === routine.id)
            if (!target || s.active?.id !== activeId || s.active.entries?.[idx]?.id !== entryId) return
            applied = updateRoutineFromEntry(target, s.active.entries, idx)
          })
          if (applied) useUI.getState().toast(t('Routine updated'))
        },
      }),
    }
  }

  // One prop object per entry so the card and list layouts share the exact same wiring. The
  // exercise-level actions (swap, move, remove) address the entry itself, so the "more" menu of
  // a superset member acts on that member, not on whatever the marker happens to point at.
  const swapExercise = idx => {
    if (focusMode) focusPointerEpoch.current++
    swapActiveWorkoutExercise(idx)
  }
  const blockProps = idx => ({
    editing,
    onSwap: () => swapExercise(idx),
    onMoveUp: () => moveUnitAt(idx, -1, true),
    onMoveDown: () => moveUnitAt(idx, 1, true),
    canMoveUp: canMoveActiveWorkoutEntry(A, idx, -1),
    canMoveDown: canMoveActiveWorkoutEntry(A, idx, 1),
    onRemoveExercise: () => confirmRemoveExercise(idx),
    busy: !!work,
    onToggle: (i, onFocusProgress) => toggle(idx, i, undefined, { onFocusProgress }),
    onToggleSide: (i, side, onFocusProgress) => toggle(idx, i, side, { onFocusProgress }),
    onField: (i, f, v) => setField(idx, i, f, v),
    onMutateSet: (i, fn) => mutEntry(idx, entry => { entry.sets[i] = fn(entry.sets[i]) }),
    onAddSet: () => addSet(idx),
    onRemoveSet: () => removeSet(idx),
    onAddWarmup: () => addWarmup(idx),
    onRemoveSetAt: i => removeSetAt(idx, i),
    onCopySetAt: i => copyActiveSet(idx, i),
    onStartTimed: (i, onFocusProgress) => startTimed(idx, i, onFocusProgress),
    onProgressionSettings: editing ? null : () => openProgressionSettings(idx),
    onRest: editing ? null : () => openExerciseRest(idx),
    onNoProg: routineKeepsOut(A.entries[idx]) ? null : on => setNoProg(idx, on),
    routineUpdate: routineUpdateFor(idx),
  })
  const selectFocusEntry = idx => update(s => { if (s.active) s.active.cur = idx })
  const advanceFocusUnit = () => update(s => {
    if (!s.active) return
    const next = nextUnfinishedUnit(s.active.entries, supersetUnits(s.active.entries), s.active.cur)
    if (next) s.active.cur = next[0]
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
  // When the list was only opened for this session and cards are the saved default, "Set
  // current" has no purpose besides picking which exercise to look at next, so it also goes
  // back to card view (#260) rather than leaving you in the list to open Cards yourself. It
  // stays in the list when the list is the saved default, which is a choice to keep, and when
  // the exercise buttons are on, because then the tap also picks what Move/Swap/Remove below
  // act on and the list is where you use them.
  const focusUnit = firstIdx => update(s => {
    if (!s.active) return
    s.active.cur = firstIdx
    if (!workoutControls(s).exerciseButtons && (s.workoutView || 'cards') === 'cards') s.active.workoutView = 'cards'
  })
  // The header ⋮ re-lays-out the running session without touching the saved default
  // (Settings → During a workout → Workout view). It writes s.active.workoutView, which the
  // render above prefers over S.workoutView.
  const setWorkoutView = v => update(s => { if (s.active) s.active.workoutView = v })
  const LAYOUT_LABEL = {
    cards: t('Cards'),
    list: t('List'),
    compact: t('Compact'),
    focus: t('Focus'),
  }
  const openLayoutMenu = () => menuSheet({
    title: t('Layout'),
    items: [
      { icon: 'layout', label: t('Cards'), on: workoutView === 'cards', onClick: () => setWorkoutView('cards') },
      { icon: 'list', label: t('List'), on: workoutView === 'list', onClick: () => setWorkoutView('list') },
      { icon: 'compact', label: t('Compact'), on: workoutView === 'compact', onClick: () => setWorkoutView('compact') },
      { icon: 'target', label: t('Focus'), on: workoutView === 'focus', onClick: () => setWorkoutView('focus') },
      listMode && { icon: 'minimize', label: t('Collapse completed exercises'),
        sub: t('Keep the current exercise open'), on: collapseOn,
        onClick: () => update(s => { if (s.active) s.active.collapseCompleted = !collapseOn }) },
    ],
  })
  // Logging a past workout (#284): the sets were done days ago, so one tap ticks them all and
  // offers the finish, the same sheet the last set of a live session opens. What went
  // differently is still edited on the rows before finishing.
  const markAllDone = () => {
    update(s => { if (s.active) s.active.entries = markAllSetsDone(s.active.entries) }, true)
    const fresh = useStore.getState().S.active
    // Ticked here rather than row by row: without this, unticking and reticking one of them
    // would count as new progress and replay the flow a first tick runs.
    if (fresh) progressHighWater.current = fresh.entries.map(e => e.sets.filter(s => s.done).length)
    workoutCompleteSheet()
  }
  // Adds an exercise after the current unit: the button under the session and the ⋯ menu's Add.
  const addExercise = () => exercisePicker((ex, quick) => {
    // A freehand add inherits the current unit's routine (its `rid`) so it lands in that
    // routine's block in a combined session and gets a real prescription; a routine-less
    // freestyle session has no `rid` to inherit. It inherits the block's `noProg` too: an
    // exercise added to a rehab or deload routine's block is kept out of progression like the
    // rest of it, the way a swap or an edit there is — it takes the routine's own numbers and
    // never becomes the baseline the regular sessions progress from. An exercise kept out by
    // hand (its ⋯ menu) is that exercise's own choice for today and is not passed on; a session
    // kept out as a whole (the header ⋮) takes the new one with it (joinSessionNoProg).
    const curEntry = A.entries[A.cur]
    const curRid = curEntry?.rid
    const routine = curRid ? S.routines.find(r => r.id === curRid) : null
    const freestyle = !routine
    const noProg = !freestyle && builtOutOfProgression(curEntry, routine)
    // Freestyle has no routine prescription to apply: show the last target in the config
    // sheet and carry its completed rows forward. A planned session uses its configured
    // target when progression is off, while progression-enabled sessions keep their path.
    const seed = freestyle ? freestyleConfig(sessionHistory(S), { id: ex.id, ...defaultConfig(ex.id) }) : null
    const commit = cfg => {
      if (focusMode) focusPointerEpoch.current++
      update(s => {
        const full = { ...cfg, id: ex.id }
        // A planned session builds the exercise the way its routine would (prescription, reps
        // source, target); freestyle reproduces what you did last time.
        // Read from before the session's day when it is logged into the past (sessionHistory).
        const past = sessionHistory(s)
        // Freestyle stamps the meaning of a dumbbell weight and reads last time in it, the way
        // buildPlannedEntry does for a planned exercise (lib/dumbbells.js).
        const built = freestyle
          ? { target: withMeaning(s, cfg, ex.id), plan: null, sets: applyIntensifierPlan(buildSets(historyAs(past, ex.id, dbLoadFor(s, full)), full, {
            step: modeOf(full) === 'reps' ? (ownedWeightsFor(s, full) || weightIncrement(full, s.unit)) : defaultIncrement(ex.id, s.unit), preferLast: true,
          }), full, dropGrid(s, full)) }
          : buildPlannedEntry(past, full, routine, { noProg })
        const insertAt = insertionIndexAfterCurrentUnit(supersetUnits(s.active.entries), s.active.cur, s.active.entries.length)
        s.active.entries.splice(insertAt, 0, joinSessionNoProg(s.active, { id: ex.id, ...built, ...(curRid ? { rid: curRid } : {}), ...(noProg ? { noProg: true } : {}) }))
        s.active.cur = insertAt
        useUI.getState().shiftRestOwner(insertAt, 1)
      })
    }
    // The "+" on a picker row reads as "add this now" — routed through the same detail
    // sheet before, so it added nothing until you'd scrolled past it and found the real
    // button. Quick-add commits with the same default (or, freestyle, last-session) config
    // the sheet would have opened with; tapping the row still opens that sheet for anyone
    // who wants to set sets/reps first.
    if (quick) { commit(seed || defaultConfig(ex.id)); useUI.getState().toast(t('“{0}” added to {1}', exerciseNameText(ex), routine ? routine.name : t('Freestyle'))) }
    // The confirm names what it changes: this workout, never the routine behind it.
    else exConfigSheet(ex, null, commit, null, routine, seed, null, t('Add to this workout'))
  })
  // Ending the session without saving it. The ⋯ menu's last item since the header's ✕ became the
  // ⌄ that only leaves the screen (v1.3.11).
  const discardWorkout = () => confirmSheet({
    title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true,
    onConfirm: () => { update(s => { s.active = null }); stopRest(); stopWork(); nav('/home') },
  })
  // The header ⋯, in groups: the settings you change at the gym first (their own sheet, the same
  // values as Settings), then what to add, what to change about this workout, and Discard last.
  // Layout here stays this session's own (s.active.workoutView); the settings sheet's Layout is
  // the saved one.
  const openViewMenu = () => menuSheet({
    sections: [
      { items: [
        { icon: 'gear', accent: true, chevron: true, label: t('Workout settings'),
          sub: [S.restSec > 0 ? t('{0} rest', fmtRest(S.restSec)) : t('No rest timer'), S.sound ? t('Sound') : t('Silent')].join(' · '),
          onClick: workoutSettingsSheet },
      ] },
      { title: t('Add'), items: [
        { icon: 'plusCircle', label: t('Add exercise'), onClick: addExercise },
        !editing && { icon: 'clipboard', label: t('Add routine'), sub: t('Bring another routine into this session'), onClick: addRoutineToSessionSheet },
      ] },
      { title: t('This workout'), items: [
        A.backfill && A.entries.length > 0 && { icon: 'checkCircle', label: t('Mark all sets done'), onClick: markAllDone },
        { icon: 'pencil', label: t('Rename workout'), onClick: renameWorkoutSheet },
        { icon: 'layout', label: t('Layout'), sub: LAYOUT_LABEL[workoutView] || LAYOUT_LABEL.cards, onClick: openLayoutMenu },
        { icon: 'note', label: A.note ? t('Edit session note') : t('Add session note'), onClick: sessionNoteSheet },
        noProgSwitchable && { icon: 'chartLineSlash', label: t('Don’t count for progression'), sub: t('Every exercise in this workout'), on: sessionNoProg(A), onClick: toggleSessionNoProg },
      ] },
      { items: [
        !editing && { icon: 'trash', label: t('Discard workout'), danger: true, onClick: discardWorkout },
      ] },
    ],
  })
  // An exercise's own rest, from its ⋯ menu: the same wheel as the default rest timer, where 0:00
  // means "no rest of its own", so the default applies. Like everything edited on the exercise
  // from inside the session it is this session's; the menu's Update routine offers to keep it.
  const openExerciseRest = idx => {
    const state = useStore.getState().S
    const entry = state.active?.entries?.[idx]
    if (!entry) return
    const activeId = state.active.id
    const entryId = entry.id
    durationSheet({
      title: t('Rest for this exercise'),
      value: entry.target?.restSec > 0 ? entry.target.restSec : 0, max: REST_MAX,
      off: t('Default ({0})', fmtRest(state.restSec)),
      footer: t('Rest after each set of this exercise. 0:00 means your default rest.'),
      onDone: v => update(s => {
        const e = s.active?.id === activeId ? s.active.entries?.[idx] : null
        if (!e || e.id !== entryId) return
        e.target = { ...(e.target || {}), restSec: v }
      }),
    })
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
    // The sheet opens at the plan's sets and reps rather than today's prescription (see
    // plannedConfigOf), so saving it unchanged rebuilds the rows the entry already has.
    const opened = plannedConfigOf(entry)
    exConfigSheet(exOr(entryId), opened, cfg => {
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
        // The weight the sheet showed is today's. Left as it was, it is not an edit of the plan's:
        // stamped as the plan, a later edit of the reps would restart from today's load as though
        // it had been typed in (nextPrescription), so the plan keeps its own.
        if ((cfg.weight || 0) === (opened.weight || 0) && activeEntry.planned?.weight != null) full.weight = activeEntry.planned.weight
        const activeRoutine = s.routines.find(r => r.id === activeEntry.rid)
        // A config without a set count keeps the rows the session already has.
        if (!(full.sets > 0)) full.sets = activeEntry.sets.filter(x => !isWarmupRow(x)).length || 1
        // The sheet edits sets, reps, weight and warm-ups as well as the rule — so the rows are
        // rebuilt from the new config exactly the way the session start builds them (same reps
        // source, same prescription, same stamped target, and in a workout logged into the past the
        // same history from before its day), and only what you already logged is
        // kept in place (done warm-ups first, then done work sets, then the fresh remainder).
        // Without a prescription only in a routine kept out of progression: an exercise kept out
        // by hand keeps its prescription, so its Undo leaves the numbers it should count at.
        const built = buildPlannedEntry(sessionHistory(s), full, activeRoutine, { noProg: builtOutOfProgression(activeEntry, activeRoutine) })
        const fresh = built.sets
        const doneWarm = activeEntry.sets.filter(x => x.done && isWarmupRow(x))
        const doneWork = activeEntry.sets.filter(x => x.done && !isWarmupRow(x))
        const freshWarm = fresh.filter(isWarmupRow)
        const freshWork = fresh.filter(x => !isWarmupRow(x))
        activeEntry.target = built.target
        activeEntry.plan = built.plan
        activeEntry.planned = built.planned
        if (built.carried) activeEntry.carried = true
        else delete activeEntry.carried
        activeEntry.sets = [...doneWarm, ...freshWarm.slice(doneWarm.length), ...doneWork, ...freshWork.slice(doneWork.length)]
      })
    }, null, routine)
  }

  // Remove a whole exercise from the session. The confirmation always asks first; in a
  // superset it asks WHICH exercise of the group to remove.
  const removeExercise = idx => { focusPointerEpoch.current++; removeActiveExercise(idx) }
  const confirmRemoveExercise = idx => {
    const e = A.entries[idx]
    if (!e) return
    const hasDone = (e.sets || []).some(s => s.done)
    confirmSheet({
      title: t('Remove {0}?', exerciseNameText(exOr(e.id))),
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
              <div className="grow"><div className={`tt ${exerciseNameClass(exOr(A.entries[idx]?.id))}`}>{exerciseNameFor(exOr(A.entries[idx]?.id))}</div></div>
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
  const startTimed = (idx, i, onFocusProgress) => {
    if (editing) return
    const e = A.entries[idx]
    // This tap may be the only one before the hold's countdown beeps (a timed first exercise):
    // get the audio context running while it still counts as a gesture (iOS, #152).
    unlock(S.sound)
    // How long to hold: the row's own seconds, unless it is carrying a plan from a hold that was
    // displaced before it finished. `sec` on a timed row is both the plan and the log, so writing
    // what a part-held set managed would otherwise become the next hold's target — 3 seconds of a
    // 30 second plank, and every hold after it is 3 seconds. planSec keeps the plan aside until
    // the row is held to the end, ticked, or given a duration you typed yourself, and it never
    // reaches S.workouts (lib/finish-workout.js).
    const plan = (!e.sets[i].done && e.sets[i].planSec) || e.sets[i].sec || 45
    const owner = { idx, i }
    useUI.getState().startWork(plan, exerciseNameText(exOr(e.id)), holdDone(owner, plan, onFocusProgress), { idx, i, id: e.id })
    // After startWork: a hold it displaced has already written its seconds to its own row.
    holdAt = { owner, idx, i }
  }
  // What a hold hands back to its row: on its end, its Done, or a rest displacing it. Also bound
  // again to a hold restored after a reload (useUI.bindWork, below).
  const holdDone = (owner, plan, onFocusProgress) => (elapsed, { abandoned = false, chimed = false } = {}) => {
    const { idx } = owner
    // The row may have moved while the hold ran (a set copied or removed above it): write to
    // where it is now. holdAt is that place (deleteActiveSet, copyActiveSet).
    const mine = holdAt?.owner === owner
    const i = mine ? holdAt.i : owner.i
    if (mine) holdAt = null
    // A hold a rest displaced (useUI.abandonWork: a set ticked on another row, or another
    // exercise) keeps its seconds and nothing else. It is not a finish: the row stays unticked
    // and starts no rest, because the rest that displaced the hold is already counting down —
    // and the plan it was held against is put aside so the row still knows what it is asking for.
    if (abandoned) {
      // A row ticked by hand while its hold ran comes through here too — toggle starts the rest
      // that displaces the hold, so the hand-back lands on a row that is already ticked. It
      // still wants the seconds (that is what was held, not the target), but a finished row has
      // no use for a plan set aside.
      mutEntry(idx, en => { if (en.sets[i].planSec == null && !en.sets[i].done) en.sets[i].planSec = plan; en.sets[i].sec = elapsed })
      return
    }
    mutEntry(idx, en => { en.sets[i].sec = elapsed; delete en.sets[i].planSec })
    if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i, undefined, { quiet: chimed, onFocusProgress })
  }
  // A hold that came back from a reload has no handler yet: this screen gives it its own.
  const holdDoneRef = useRef(holdDone)
  holdDoneRef.current = holdDone
  useEffect(() => {
    useUI.getState().bindWork?.(wk => {
      // From here on it is tracked like a hold started on this screen (holdAt), so a set copied or
      // removed above it moves it along.
      const owner = { idx: wk.owner.idx, i: wk.owner.i }
      holdAt = { owner, idx: owner.idx, i: owner.i }
      return (...a) => holdDoneRef.current(owner, wk.total)(...a)
    })
  }, [])

  // `quiet`: the hold that ticks this set has just ended with the chime and its buzz pattern
  // (store/useUI.js). The tick's own beep would sound over the chime's first note and clip it,
  // and its short buzz would cut the pattern off: a new vibrate call replaces the running one.
  const toggle = (idx, i, side, { quiet = false, onFocusProgress } = {}) => {
    // Ticking a set ends the typing in that row: drop the keyboard before the rest timer, the
    // effort sheet or the next exercise moves in. WebKit keeps the input focused across the
    // button tap, and a focused input with its keyboard gone is what leaves the tab bar
    // mid-screen on iOS (lib/viewport-guard.js).
    if (typeof document !== 'undefined') { const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur?.() }
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
      // When the work happened, for the session's end (lib/finish-workout.js sessionEnd).
      if (!editing && (side ? e.sets[i].sides[side].done : checked)) e.sets[i].at = Date.now()
      // A finished row has no use for a plan set aside by a hold that did not finish.
      if (checked && e.sets[i].planSec != null) delete e.sets[i].planSec
      if (e.sets[i].done && !editing) {
        if (!quiet) { beep(S.sound, 1040, 0.12); vibrate(30) }
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
    if (editing) return
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
      // A pyramid set may carry its own rest, standing in for the exercise's (pyramidRestFor).
      const setRest = { idx, sec: pyramidRestFor(fresh.entries[idx].target, fresh.entries[idx].sets, i) }
      const restSec = restSecFor(fresh.entries, freshUnit || [idx], S.restSec, setRest)
      // A warm-up ramp set may rest shorter than a work set (the exercise's warmupRestSec); the
      // last ramp set, into the first work set, still gets the working rest.
      const restAfter = warmupRestSecFor(fresh.entries[idx], i, restSec)
      // What the rest leads into (the next set, round or exercise), which picks the sound it ends
      // with when Settings → Sound gives that kind one of its own.
      const kind = restKind({ unitDone: freshUnitDone, superset: (freshUnit?.length || 0) > 1 })

      // A re-check of finished work must not navigate or reopen a sheet, but it may still owe
      // you a rest — see restOnRecheck, and the other half of issue #3. A rest that already ran
      // out and only shows Ready is not running: it has nothing left to time. A paused one is
      // still the rest you are in, held on purpose, and a re-check leaves it as it is.
      if (!progress.isNew) {
        const rest = useUI.getState().timer
        if (!restBeforeWarmup && restOnRecheck({ timerRunning: !!(rest && !rest.ready), unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) startRest(restAfter, idx, { kind, forSet: i })
        return
      }

      // With finished exercises folding away in the list, the one you just finished does too: the
      // marker moves on to what is left, so the open unit is the next thing to do (Discord: "view
      // only what I have yet to do"). The scroll anchor holds what is on screen while it folds,
      // and revealCur brings the next exercise up if it was left low on the screen. Only on new
      // progress, never on a re-tick, and never in the other layouts, where the marker stays put.
      if (collapseOn && freshUnitDone && nextUnit && freshUnit?.includes(fresh.cur)) {
        revealCur.current = true
        update(s => { if (s.active) s.active.cur = nextUnit[0] })
      }

      // Between the two sides of one timed per-side set (a side plank's left, then its right):
      // a short "Switch sides" pause instead of the set's whole rest, which comes once both
      // sides are held (owner's call). A rest switched Off stays off.
      const rows = fresh.entries[idx].sets
      const sideOf = r => r && !isWarmupRow(r) ? r.side : null
      const partner = sideOf(rows[i]) === 'L' && sideOf(rows[i + 1]) === 'R' ? rows[i + 1]
        : sideOf(rows[i]) === 'R' && sideOf(rows[i - 1]) === 'L' ? rows[i - 1] : null
      if (m === 'time' && partner && !partner.done && restAfter > 0) {
        startRest(Math.min(SWITCH_SIDES_SEC, restAfter), idx, { kind: 'switch', forSet: i })
        return
      }

      // Singleton units are ordinary exercises: they rest between sets and after the closing
      // one unless the next unit has an unfinished warm-up, and never enter superset navigation.
      // stopRest() first so a rest that belongs after this set replaces the one that was running.
      if (freshUnitDone) stopRest()
      if (!freshUnit || freshUnit.length <= 1) {
        if (!restBeforeWarmup && restAfterSet({ unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) startRest(restAfter, idx, { kind, forSet: i })
        onFocusProgress?.({ unitDone: freshUnitDone })
        return
      }

      const step = supersetFlowStep(fresh.entries, freshUnit, idx)
      if (!step) { onFocusProgress?.({ unitDone: freshUnitDone }); return }
      if (step.unitDone) {
        if (nextUnit?.length && !restBeforeWarmup) startRest(restAfter, idx, { kind, forSet: i })
      } else {
        if (step.nextIdx != null) update(s => { if (s.active) s.active.cur = step.nextIdx })
        if (step.roundDone) startRest(restAfter, idx, { kind, forSet: i })
      }
      onFocusProgress?.({ unitDone: freshUnitDone })
    }
  }

  // After the finished exercise folded away (toggle, above): the new current one is the next thing
  // to do, so if it now sits under the header or low on the screen with little more than its title
  // showing, it glides up under the header. Where it is already in reach the page stays put. Run
  // after a closing sheet has put the page back (the effort picker ticks the set as it closes).
  const revealCur = useRef(false)
  useEffect(() => {
    if (!revealCur.current) return
    revealCur.current = false
    if (!listMode) return
    return afterScrollRestore(() => {
      const el = listRef.current?.querySelector('.wl-unit.cur')
      if (!el || typeof el.getBoundingClientRect !== 'function') return
      const top = el.getBoundingClientRect().top
      const under = hdrRef.current?.getBoundingClientRect?.().bottom || 0
      const screen = window.innerHeight || 0
      if (!screen || (top >= under && top <= screen * 0.55)) return
      scrollToUnit(el, true)
    })
  }, [cur])
  // Brings a list unit to the top of the screen, under the pinned header. The header grows when
  // the name wraps and by the chip row, so the unit's scroll margin (index.css) is fed its height
  // as it is right now. A jump the eye should follow glides, unless the system asks for less motion.
  const scrollToUnit = (el, glide) => {
    if (!el || typeof el.scrollIntoView !== 'function') return
    const hdrH = hdrRef.current?.offsetHeight
    if (hdrH) listRef.current?.style.setProperty('--whdr-h', hdrH + 'px')
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView(glide && !still ? { block: 'start', behavior: 'smooth' } : { block: 'start' })
  }
  // A tap on a chip at the top (#323). Cards and Focus show one unit, so the chip makes it the one
  // on screen: the marker moves because you asked it to, never on its own. The list already shows
  // every unit, so there the chip only scrolls to it and leaves "Current" where it was, the same
  // as scrolling there by hand; the frame wait is the one opening the list uses (above).
  const pickChip = chip => {
    if (listMode) {
      // A folded unit opens as you jump to it: you tapped it to see it.
      if (collapsed.has(chip.key)) setUnitOpen(chip.key, true)
      const go = () => scrollToUnit(listRef.current?.querySelector(`.wl-unit[data-unit-key="${chip.key}"]`), true)
      if (window.requestAnimationFrame) window.requestAnimationFrame(go)
      else window.setTimeout(go, 0)
      return
    }
    if (chip.unit.includes(cur)) return
    update(s => { if (s.active) s.active.cur = chip.unit[0] })
  }
  const chipRow = wc.exerciseChips && A.entries.length > 0
    ? <WorkoutChips entries={A.entries} cur={cur} onPick={pickChip} />
    : null

  // Hardware keys (issue #133, lib/workout-keys.js): Space or Enter ticks the next set, ← and →
  // switch exercise. The listener is added once and calls the handler of the latest render, so
  // toggle() and navigateUnit() always see the session as it is now.
  const tabbed = useRef(false)
  const onKey = useRef(null)
  // In the list the "current" exercise can be off screen. A key that moves it brings it into
  // view the way opening the list does; ticking and tapping never scroll it (see above).
  const showCurrent = () => {
    if (!listMode) return
    const scroll = () => scrollToUnit(listRef.current?.querySelector('.wl-unit.cur'))
    // After the render that moves the marker, as the effect above waits for its frame.
    if (window.requestAnimationFrame) window.requestAnimationFrame(scroll)
    else window.setTimeout(scroll, 0)
  }
  onKey.current = event => {
    // A sheet on top owns the keyboard (Escape closes it, Enter confirms in it).
    if (useUI.getState().sheets.length) return false
    const action = workoutKeyAction(event, { tabbed: tabbed.current, rtl: document.documentElement.dir === 'rtl' })
    if (!action) return false
    event.preventDefault()
    if (action !== 'tick') { navigateUnit(action === 'next' ? 1 : -1); showCurrent(); return true }
    // A hold being timed: the key is its "Done", which logs what was actually held, once the
    // hold has run past its first moments (HOLD_KEY_GRACE_MS).
    const work = useUI.getState().work
    if (work) {
      if (Date.now() - (work.endsAt - work.total * 1000) >= HOLD_KEY_GRACE_MS) useUI.getState().finishWorkEarly()
      return true
    }
    const fresh = useStore.getState().S.active
    const next = nextOpenSet(fresh?.entries, fresh?.cur)
    if (!next) return true
    // The exercise on screen is finished: this press brings up the next one, and the one after
    // ticks its set. A key never logs a set for an exercise that was not in front of you.
    if (!next.current) { focusUnit(next.idx); showCurrent(); return true }
    // A timed set is started rather than ticked, as its play button does; the timer ticks it.
    if (!next.side && modeAt(next.idx) === 'time') startTimed(next.idx, next.i)
    else toggle(next.idx, next.i, next.side)
    return true
  }
  useEffect(() => {
    // A Space that ticked must not also press the button a click left focus on. Preventing the
    // keydown is enough for Chrome; Firefox presses a button on the keyup, so that goes too.
    let spaceTaken = false
    const down = event => {
      if (event.key === 'Tab') { tabbed.current = true; return }
      const taken = onKey.current?.(event) === true
      if (event.key === ' ') spaceTaken = taken
    }
    const up = event => { if (event.key === ' ' && spaceTaken) { spaceTaken = false; event.preventDefault() } }
    const pointer = () => { tabbed.current = false }
    document.addEventListener('keydown', down)
    document.addEventListener('keyup', up)
    document.addEventListener('pointerdown', pointer, true)
    return () => {
      document.removeEventListener('keydown', down)
      document.removeEventListener('keyup', up)
      document.removeEventListener('pointerdown', pointer, true)
    }
  }, [])

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user || editing) return
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
    // The cleanup below runs on in-app navigation only. A closed tab, or a home-screen app swiped
    // away or killed by the phone, unmounts nothing, so "training now" kept the athlete until the
    // server's presence expiry, 70 s after they had gone. So the page going away sends the "left"
    // signal itself, and says why: `closed` on pagehide, which the server acts on at once, and
    // `hidden` on visibilitychange, because iOS kills a hidden home-screen app without a pagehide.
    // The server keeps a `hidden` athlete listed for 45 s and a heartbeat cancels it, so a hidden
    // page that keeps running (a phone locked between sets) goes on heartbeating and never blinks
    // off the list; an iOS app swiped away sends nothing after `hidden` and is gone in 45 s. Each
    // is sent once per hide, re-armed by a heartbeat; the pagehide of a close that went hidden
    // first still sends `closed`, and nothing follows `closed`. A page shown again heartbeats at once.
    let sent = null
    const live = () => { sent = null; ping(true) }
    const leave = reason => {
      if (sent === 'closed' || sent === reason) return
      sent = reason; beacon('/api/activity', { active: false, reason })
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') leave('hidden'); else if (sent && !stopped) live() }
    const onHide = () => leave('closed')
    const onShow = e => { if (e.persisted && sent && !stopped) live() }
    live()
    const iv = setInterval(() => { if (!stopped) live() }, 20000)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      stopped = true; clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      // best-effort "left" signal: the beacon survives a tab close, fetch covers in-app nav
      beacon('/api/activity', { active: false, reason: 'navigated' })
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false, reason: 'navigated' }) }).catch(() => {})
    }
  }, [])

  return <WorkoutScrollAnchor enabled={collapseOn} collapsed={[...collapsed].join(',')}>
    {/* In list mode the whole session scrolls under the header, so the header (name, clock,
        set counter, discard/finish, progress) stays pinned — the one thing you want in view
        while you are somewhere in the middle of a long stack. Cards mode never scrolls far. */}
    <div className={'whdr' + (listMode ? ' stick' : '')} ref={hdrRef}>
    {/* ⌄ leaves the screen and keeps the session running (the tab bar's Resume brings it back);
        in the editor of a saved workout it is the ✕ that closes the editor. Discard is in the ⋯
        menu now, and Finish is a labelled pill rather than a check that looked like a set tick: it
        opens the Finish sheet (Finish and save, Discard), the editor's Save saves at once. */}
    <div className="hdr whdr-bar">
      {editing
        ? <button className="iconbtn" aria-label={t('Close editor')} title={t('Close editor')} onClick={() => exitWorkoutEdit()}><Icon name="xmark" /></button>
        : <button className="iconbtn" aria-label={t('Minimize')} title={t('Minimize')} onClick={() => nav('/home')}><Icon name="chevronDown" /></button>}
      <div className="whdr-mid"><div className="whdr-name">{A.name}</div><div className="sub">{(A.backfill || editing) ? fmtDate(A.d, true) : <Elapsed start={A.start} />} · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn" aria-label={t('Workout options')} title={t('Workout options')} onClick={openViewMenu}><Icon name="more" /></button>
      <button className="btn primary pill whdr-finish" aria-label={editing ? t('Save changes') : undefined}
        onClick={() => (editing ? finishWorkout() : finishWorkoutSheet({ onDiscard: discardWorkout }))}>{editing ? t('Save') : t('Finish')}</button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>
    {/* In the list the chips ride in the pinned header, so any exercise is one tap away from
        anywhere in a long stack. */}
    {listMode && chipRow}
    </div>
    {editing && <p className="muted small">{t('Editing a saved workout. Date and duration stay unchanged.')}</p>}
    {A.backfill && <div className="muted small" style={{ marginBottom: 8 }}>{t('Logging a past workout, so no rest timers.')}</div>}

    {A.entries.length ? (listMode ? (
      <div className="workout-list" data-testid="workout-list" ref={listRef}>
        {units.map((u, ui) => {
          const multi = u.length > 1
          const isCur = u.includes(cur)
          const isCollapsed = collapsed.has(u.join('-'))
          // Finished and tapped open again: it says it can fold back, and does on a tap.
          const reopened = collapseOn && !isCur && !isCollapsed && opened.has(u.join('-')) && finished(u)
          return <section key={u.join('-')} className={'wl-unit' + (isCur ? ' cur' : '')} data-exidx={u[0]} data-unit-key={u.join('-')}>
            <div className="wl-hd">
              <span className="muted small">{multi ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length)}</span>
              <span className="row" style={{ gap: 6 }}>
                {reopened && <button className="chip" aria-expanded="true" aria-controls={'workout-unit-' + u.join('-')}
                  onClick={() => setUnitOpen(u.join('-'), false)}>{t('Fold away')}</button>}
                {isCur
                  ? <span className="tag acc">{t('Current')}</span>
                  : <button className="chip" onClick={() => focusUnit(u[0])}>{t('Set current')}</button>}
              </span>
            </div>
            <div id={'workout-unit-' + u.join('-')}>
            {/* One line per exercise, and the line is the way back in: a tap opens the sets again
                to fix a number, without making it the current exercise. */}
            {isCollapsed ? <button type="button" className="wl-summary" aria-expanded="false" title={t('Show the sets')}
              onClick={() => setUnitOpen(u.join('-'), true)}>
              {u.map(idx => <span key={idx} className="row between" style={{ gap: 8 }}>
                <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{exerciseNameFor(exOr(A.entries[idx].id))}</span>
                <span className="tag acc nocap"><Icon name="check" />{t('{0} sets', A.entries[idx].sets.length)}</span>
              </span>)}
            </button> : multi ? (
              <div className="ss-card">
                <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 5 }}><Icon name="link" />{ssTitle(u)}</span>
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
            </div>
          </section>
        })}
      </div>
    ) : <>
      {/* The chips stand in for "Exercise 2 / 5": the number is on the current chip, and the
          others say what is done and what is waiting (#323). */}
      {chipRow || <div className="muted small" style={{ marginBottom: 6 }}>{isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>}
      <SwipeCards index={unitIdx} count={units.length} revision={A}
        timerKey={timer && `${timer.endsAt}:${timer.forIdx ?? ''}`} workKey={work?.endsAt}
        onNavigate={navigateUnit} renderPreview={direction => {
          // The card slid in shows what the card itself will: in the editor, no hold to start
          // and no plates to load; in a session, the progression line, or the card grows by it
          // the moment it lands. It gets the card's own wiring for that — the preview is inert,
          // so none of it can be pressed. That includes a superset's header with its Unpair, and a
          // lone exercise's "Make superset" buttons when Settings shows them: without them the
          // header's words moved over, or the card grew by a row, as it landed.
          const adjacent = units[unitIdx + direction] || []
          if (!adjacent.length) return null
          return adjacent.length > 1 ? (
            <div className="ss-card">
              <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 5 }}><Icon name="link" />{ssTitle(adjacent)}</span>
                <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(adjacent[0])}>{t('Unpair')}</Button>
              </div>
              {adjacent.map((idx, k) => <div key={idx} className="ss-ex" data-exidx={idx}>
                {k > 0 && <div className="ss-amp">+</div>}
                <ExerciseBlock entryIdx={idx} compact {...blockProps(idx)} />
              </div>)}
            </div>
          ) : <ExerciseBlock entryIdx={adjacent[0]}
            onPairPrev={adjacent[0] > 0 ? () => pairAt(adjacent[0] - 1, adjacent[0]) : null}
            onPairNext={adjacent[0] < A.entries.length - 1 ? () => pairAt(adjacent[0], adjacent[0] + 1) : null}
            {...blockProps(adjacent[0])} />
        }}>
      {focusMode ? (
        <FocusView entryIdx={cur} unit={unit}
          onSelectEntry={selectFocusEntry} onAdvanceUnit={advanceFocusUnit} pointerEpoch={focusPointerEpoch.current}
          onPairPrev={onPairPrev} onPairNext={onPairNext} onUnpair={() => unpairAt(cur)}
          {...blockProps(cur)} />
      ) : isSuperset ? (
        <div className="ss-card">
          <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 5 }}><Icon name="link" />{ssTitle(unit)}</span>
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
      </SwipeCards>
    </>) : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout. Add your first exercise and off you go.')}</div>}

    <div style={{ height: 12 }} />
    {!listMode && <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => navigateUnit(-1)}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => navigateUnit(1)}>{t('Next')}</Button>
    </div>}
    {!listMode && <div style={{ height: 10 }} />}
    {wc.exerciseButtons && listMode && A.entries.length > 0 && <div className="muted small" style={{ marginBottom: 6 }}>{t('Move, swap and remove below act on the exercise marked {0}.', t('Current'))}</div>}
    <Button onClick={addExercise} icon="plus">{t('Add exercise')}</Button>
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
        <Button size="sm" icon="swap" aria-label={t('Swap exercise')} disabled={!!work}
          onClick={() => swapExercise(cur)}>{t('Swap exercise')}</Button>
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
      <Button size="sm" icon="note" variant={A.note ? 'tinted' : undefined} onClick={sessionNoteSheet}>
        {A.note ? t('Edit session note') : t('Add session note')}
      </Button>
    </div>
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {editing ? t('Save changes') : allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div className="workout-end-spacer" />
  </WorkoutScrollAnchor>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
