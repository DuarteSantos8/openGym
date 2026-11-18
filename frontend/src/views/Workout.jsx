import { Fragment, useEffect, useId, useRef, useState } from 'react'
import './Workout.css'
import SwipeCards from '../components/SwipeCards.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { workoutControls } from '../lib/workout-controls.js'
import { useUI } from '../store/useUI.js'
import { autoHoldsFor, forecastHolds, nextAutoHold } from '../lib/auto-holds.js'
import { EXIDX, exOr, betterWeight, isAssisted } from '../lib/exercises.js'
import { bestsFor, lastRowFor, oddValues } from '../lib/typo-check.js'
import { usesBar } from '../lib/bar.js'
import { loadKindFor, baseWeightFor, inventoryFor, rowLoad, sameLoad, plateDelta, dropGrid } from '../lib/plates.js'
import { plateText } from '../lib/plate-text.js'
import { effectiveRoutines, effectiveRoutineIds, lastEntryFor, bestWeightFor, bestWeightForEntry, freestyleConfig, pickedExerciseConfig, setsDoneActive, setUnitsTotal, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, repStep, EFFORT, effortOf, stepEffort, capEffort, cascadeWeight, liveReramp, insertWarmupRow, barFloor, makeWarmupAt, canBeWarmup, makeWorkAt, removeRowAt, removeLastSet, setSpanAt, copyRowAt, copySpanAt, insertRowAt, pairAdjacent, unpairSuperset, cleanupSg, applyIntensifierPlan, pinnedNoteFor, exNoteFor, setsRepsOf, sessionVolume } from '../lib/history.js'
import { cleanNum, fmtNum, fmtPlate, fmtVol, fmtWeight, exerciseNameText, fmtDate, fmtDaysAgo, todayISO, exCount, DAYN } from '../lib/format.js'
import { speedUnitOf, toSpeed, fromSpeed } from '../lib/speed.js'
import { byDistance, withCardioBy, distUnitOf, distLabel, toDist, fromDist, distanceKmOf, settleSpeed } from '../lib/distance.js'
import { clampIncline, inclineFrom, INCLINE_STEP, clampLevel, levelFrom, cardioCol } from '../lib/incline.js'
import { beep, vibrate, unlock } from '../lib/sound.js'
import { pinState } from '../lib/queue.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { nameIn, said } from '../lib/a11y-name.js'
import { api, beacon } from '../lib/api.js'
import { pyramidRestFor, maxRecordAt, isPyramid, pyramidLabel } from '../lib/pyramid.js'
import { insertionIndexAfterCurrentUnit, nextUnfinishedUnit, setProgressHighWater, supersetFlowStep, restAfterSet, restOnRecheck, restSecFor, warmupRestSecFor, sideRestFor, ownSetRest, ownExerciseRest, stepUnitIndex, advanceAfterTimedRest, transitionRestFor, restKindAfter } from '../lib/supersetFlow.js'
import Media from '../components/Media.jsx'
import WorkoutScrollAnchor from '../components/WorkoutScrollAnchor.jsx'
import WorkoutChips from '../components/WorkoutChips.jsx'
import { filmSetSheet, SetVideoBadge, ActiveSetVideo } from '../components/SetVideo.jsx'
import { setVideoOf, filmTarget } from '../lib/set-videos.js'
import { fmtClip } from '../lib/media-refs.js'
import { supersetMeta } from '../lib/superset-meta.js'
import { circuitOf } from '../lib/circuit.js'
import { circuitLine } from '../lib/circuit-copy.js'
import CircuitCard from '../components/CircuitCard.jsx'
import { useCircuit } from '../store/useCircuit.js'
import WorkoutThumb, { hasWorkoutMedia } from '../components/WorkoutThumb.jsx'
import { workoutSettingsSheet } from '../components/WorkoutSettingsSheet.jsx'
import { SessionMapButton } from '../components/SessionMuscles.jsx'
import { durationSheet } from '../components/DurationWheel.jsx'
import { REST_MAX, fmtRest, restWheelValue } from '../lib/duration.js'
import { youtubeSearchUrl } from '../lib/youtube.js'
import { openExternal } from '../components/CustomMedia.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, finishWorkout, exitWorkoutEdit, workoutCompleteSheet, confirmSheet, exerciseNoteSheet, sessionNoteSheet, renameWorkoutSheet, swapActiveWorkoutExercise, barWeightSheet, menuSheet, effortPickerSheet, exerciseHistorySheet, addRoutineToSessionSheet, finishWorkoutSheet, finishWorkoutNow, swapActiveWorkoutToBackup, setNoteSheet } from '../sheets.jsx'
import { afterScrollRestore, scrollRestorePending } from '../components/Modals.jsx'
import { effortColor } from '../lib/effort.js'
import Elapsed from '../components/Elapsed.jsx'
import LiveHeartRate from '../components/LiveHeartRate.jsx'
import LiveCard from '../components/LiveCard.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
import { defaultIncrement, weightIncrement, stepWeight } from '../lib/progression.js'
import { progressionGuidance } from '../lib/progression-copy.js'
import { rpeAs } from '../lib/programmes.js'
import { buildPlannedEntry, buildSessionEntry, plannedConfigOf, builtOutOfProgression } from '../lib/session-start.js'
import { routineChangesFromEntry, updateRoutineFromEntry, routineSlotIndex, ownWarmupsChange, keepOwnWarmups, replaceSlotExercise } from '../lib/routines.js'
import { ownRowsLine } from '../lib/warmup-ramp.js'
import { useCoachGate } from '../lib/use-coach-gate.js'
// Opened in the same tick as the menu closes, like every other sheet from that menu: a sheet that
// opened a moment later (after a dynamic import) took the menu's history entry with it on close.
import { workoutCoachSheet } from '../components/WorkoutCoachSheet.jsx'
import { splitLabel } from '../lib/gym-split.js'
import { hasConsent } from '../lib/coach.js'
import { sessionNoProg, setSessionNoProg, setEntryNoProg, joinSessionNoProg } from '../lib/session-noprog.js'
import { glyphOf } from '../lib/glyphs.js'
import { markAllSetsDone, sessionHistory } from '../lib/backfill.js'
import { bindWatchActions, markDiscarded, watchTickRest, applyRestStep, restAtFor, setStamp } from '../lib/watch-sync.js'
import { bestSetFor } from '../lib/exercise-history.js'
import { bindLiveActions } from '../lib/live-activity.js'
import { bindWidgetActions } from '../lib/widget-logger.js'
import { isWarmupRow, isFailureSet, toggleFailure, isDropSet, isRestPauseSet, isClusterSet, dropsOf, clustersOf, addDrop, addCluster, removeDropAt, removeClusterAt, setDropAt, setClusterAt, nextDropWeight, nextBurstReps, isSideSet, makeSideSet, setSideField, toggleSide, addSideDrop, removeSideDropAt, setSideDropAt, addSideCluster, removeSideClusterAt, setSideClusterAt, WEIGHT_ORIGIN_MANUAL, markWarmupEdited } from '../lib/workout-model.js'
import { canMoveActiveWorkoutUnit, moveActiveWorkoutUnit, canMoveActiveWorkoutEntry, moveActiveWorkoutEntry } from '../lib/active-workout-order.js'
import { nextOpenSet, workoutKeyAction } from '../lib/workout-keys.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import FocusView from './FocusView.jsx'
import { startOrPreview } from '../components/StartSheets.jsx'
import { isPaused, canPause, pauseWorkout, resumeWorkout } from '../lib/workout-pause.js'
import { SeasonDeco } from '../components/Seasonal.jsx'
import { entryDbLoad, bellsIn, ownedWeightsFor, stepOwned } from '../lib/dumbbells.js'
import { sessionGymView, gymsOf, activeGym, gymLabel, switchGym, reRoundOpenSets } from '../lib/gym-inventory.js'
import { gymNoteFor } from '../lib/journal.js'
import { exView, viewEntry, inEntryUnit, shownWeight } from '../lib/ex-unit.js'
import { setTrendOn, setTrendsFor, trendGlyph, trendLabel } from '../lib/set-trend.js'
import { formulaOf } from '../lib/onerm.js'
import { cues } from '../lib/spoken-cues.js'
import { recordBaseline, entryRecords, recordHint, liveRecordsOn, recordHintsOn, recordSoundOn } from '../lib/set-records.js'
import { RecordMark, RecordHintLine } from '../components/SetRecord.jsx'
import { setNoteOf } from '../lib/set-notes.js'
import { SET_TAGS, setTagOf, setTagName, withSetTag } from '../lib/set-tags.js'
import { isOn } from '../lib/modules.js'
import CardioEffortChip from '../components/CardioEffortChip.jsx'
import { tempoSheet, tempoGuideSheet, TempoTag } from '../components/Tempo.jsx'
import { tempoOf, normalizeTempo, guideReps } from '../lib/tempo.js'
import { usesBands, setBandsOf, toggleSetBand } from '../lib/bands.js'
import { BandChips } from '../components/Bands.jsx'
import { isoDir } from '../lib/bidi.js'

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
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 'var(--fs-title2)' }}><Icon name={glyphOf(todayRoutines[0].emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startOrPreview(todayIds)}>{t('Start {0}', todayName)}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startOrPreview([r.id])}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow([])}>{t('Freestyle workout (pick as you go)')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}


// The open warm-ups follow the first work set when its weight changes mid-workout (#156,
// lib/history.js liveReramp): 100 → 110 and the rungs not done yet move with it, on this gym's
// plates. A rung you typed yourself or already did stays. `e` is the entry in its own unit.
function rerampOpen(s, e, i) {
  if (!e?.sets || isWarmupRow(e.sets[i]) || e.sets.findIndex(x => !isWarmupRow(x)) !== i) return
  const cfg = { ...(e.target || {}), id: e.id }
  if (modeOf(cfg) !== 'reps') return
  const V = exView(s, e.id)
  e.sets = liveReramp(e.sets, dropGrid(V, cfg), barFloor(V, e.id), isAssisted(cfg))
}

// A set-row column's number as it is shown. Most columns show what is stored; one with a `view`
// (cardio speed, stored in km/h) converts it for the screen.
const viewOf = (col, value) => (col.view && value != null && value !== '' ? col.view(value) : value)
// A column that reads its value from the whole row (cardio distance, #887: speed × time on a row
// logged by speed) has `get`; the others read their own field.
const valueOf = (col, s) => (col.get ? col.get(s) : s?.[col.f])

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
// `compact` shrinks the block for a superset member; `dense` (compact view) goes further and
// drops everything that is not a set you are logging — media, tag chips, the note lines, the
// "last time" recap and the progression line — leaving the name, the ⋯ menu, the one-line plan
// the rows are measured against, and the sets.
// Nothing dropped is lost: it is all still on the ⋯ menu, or one ⋮ switch back to list/cards.
// The pause between the left and the right side of one timed per-side set (owner's call): long
// enough to turn over, far shorter than the rest the set earns once both sides are held.
const SWITCH_SIDES_SEC = 10

// The next rung of a skill ladder, offered under the progression line: what it is, and Swap in
// routine, which puts it in this exercise's slot from the next session on (today stays as it is).
function LadderNext ({ entry, next }) {
  const update = useStore(s => s.update)
  const live = useStore(s => s.S)
  const routine = entry?.rid ? (live.routines || []).find(r => r.id === entry.rid) : null
  const slot = routine ? routine.ex.findIndex(x => x.id === entry.id) : -1
  const [done, setDone] = useState(false)
  const swap = () => {
    update(s => {
      const r = (s.routines || []).find(x => x.id === entry.rid)
      const i = r ? r.ex.findIndex(x => x.id === entry.id) : -1
      if (i < 0) return
      const cur = r.ex[i]
      // Back to the bottom of the range on the new rung, the rule kept.
      r.ex[i] = { ...replaceSlotExercise(cur, next, s, r.id), prog: cur.prog || 'ladder' }
    })
    setDone(true)
    useUI.getState().toast(t('{0} is in {1} from next time.', exerciseNameText(EXIDX[next]), routine.name))
  }
  return <div className="ladder-next" data-ladder-next={next}>
    <Icon name="stairs" className="ladder-next-i" />
    <span className="grow"><span className="small dim">{t('Next rung')}</span><b>{exerciseNameText(EXIDX[next])}</b></span>
    {slot >= 0 && !done && <Button size="sm" variant="tinted" onClick={swap}>{t('Swap in routine')}</Button>}
    {done && <Icon name="check" className="ladder-next-ok" />}
  </div>
}

function ExerciseBlock({ entryIdx, compact, listed, dense, editing, onToggle, onToggleSide, onField, onAddSet, onRemoveSet, onAddWarmup, onKeepWarmups, onAskCoach, onRemoveSetAt, onCopySetAt, onStartTimed, onPairPrev, onPairNext, onSetRowRef, onProgressionSettings, onRest, onNoProg, routineUpdate, onSwap, onSwapBackup, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onRemoveExercise, busy }) {
  // The block reads the state as its exercise sees it (lib/ex-unit.js): in the exercise's own
  // weight unit when it has one (#657), so its rows, steppers, plates, owned weights, "last time"
  // and records all speak that unit. Every change goes through inEntryUnit or the parent's
  // onField (mutEntry), which store it back in the profile's unit.
  const live = useStore(s => s.S)
  const S = exView(sessionGymView(live), live.active.entries[entryIdx]?.id)
  const update = useStore(s => s.update)
  const working = useUI(s => s.work)
  const restEnds = useUI(s => s.timer?.endsAt)
  const swipeHint = useUI(s => (s.swipeHint?.idx === entryIdx ? s.swipeHint : null))
  const setFlash = useUI(s => (s.setFlash?.idx === entryIdx ? s.setFlash : null))
  const optsId = useId()
  const entry = S.active.entries[entryIdx]
  // The set whose form video plays under its row (SetVideo.jsx), by index; one at a time.
  const [videoAt, setVideoAt] = useState(null)
  // Rows are keyed by index: one added or removed above would put the player under another set.
  const rowCount = entry?.sets?.length
  useEffect(() => { setVideoAt(null) }, [rowCount])
  // Drops/bursts mutate the row in place — same card, not a new set with its own long rest.
  // A planned exercise (see the exercise's "Intensifier" config) arrives with these already
  // filled in by applyIntensifierPlan; these only add/edit/remove entries live from here on.
  const mutSet = (i, fn) => update(s => inEntryUnit(s, entryIdx, e => { e.sets[i] = fn(e.sets[i]) }), true)
  // A row as it is now in the store (not the render's copy), in the exercise's unit.
  const liveRow = i => { const st = useStore.getState().S; return viewEntry(st, st.active?.entries[entryIdx])?.sets[i] }
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
  // One set's own rest for this session (#609): null takes it away, 0 is "No timer". It sits on
  // the set's first row, the one the rest flow reads (ownSetRest). The wheel may outlive the
  // set it was opened for, so a Done after the rows moved or the workout changed does nothing.
  const setRestAt = (i, sec) => {
    const at = useStore.getState().S.active
    const ref = { id: at?.id, entryId: at?.entries?.[entryIdx]?.id, rows: at?.entries?.[entryIdx]?.sets?.length }
    return () => update(s => {
      const e = s.active?.entries?.[entryIdx]
      if (!e || s.active.id !== ref.id || e.id !== ref.entryId || e.sets.length !== ref.rows) return
      const row = e.sets[setSpanAt(e.sets, i)[0]]
      if (!row) return
      if (sec == null) delete row.restSec
      else row.restSec = Math.max(0, Math.min(REST_MAX, Math.round(sec)))
    }, true)
  }
  // One set's own tempo for this session (#572): null goes back to the exercise's. On the set's
  // first row, like its rest, with the same guard against a sheet that outlived its rows.
  const setTempoAt = (i, tempo) => {
    const at = useStore.getState().S.active
    const ref = { id: at?.id, entryId: at?.entries?.[entryIdx]?.id, rows: at?.entries?.[entryIdx]?.sets?.length }
    update(s => {
      const e = s.active?.entries?.[entryIdx]
      if (!e || s.active.id !== ref.id || e.id !== ref.entryId || e.sets.length !== ref.rows) return
      const row = e.sets[setSpanAt(e.sets, i)[0]]
      if (!row) return
      const v = normalizeTempo(tempo)
      if (!v || v === normalizeTempo(e.target?.tempo)) delete row.tempo
      else row.tempo = v
    }, true)
  }
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
    const kind = entry.target?.intensifier?.type
    const restSec = kind === 'restpause' || kind === 'cluster' ? entry.target.intensifier.restSec : (S.restPauseSec || 15)
    if (isSideSet(row)) return addSideCluster(row, restSec)   // per side, each keeps its own r in step
    const clusters = clustersOf(row)
    const base = clusters.length ? clusters[clusters.length - 1].r : (row.r || 0)
    // One more mini-set of a cluster set is another chunk of the same size; a burst halves.
    const added = isClusterSet(row) ? (entry.target?.intensifier?.size || base || 1) : nextBurstReps(base)
    return { ...addCluster(row, { r: added, restSec }), r: (row.r || 0) + added }
  })
  // Per-side weight/reps/effort edits (issue #60): patch one side of a unilateral row, keeping
  // the row's aggregate (r/w/done/effort) in step via the model helper so every other reader
  // stays right. The done tick goes through onToggleSide → toggle() instead, so ticking a side
  // still fires the rest timer / auto-advance / workout-complete flow.
  const setSide = (i, side, field, v) => {
    if (field !== 'w') return mutSet(i, row => markWarmupEdited(setSideField(row, side, field, v), field))
    update(s => inEntryUnit(s, entryIdx, e => {
      const row = setSideField(e.sets[i], side, field, v)
      row.sides[side].weightOrigin = WEIGHT_ORIGIN_MANUAL
      e.sets[i] = markWarmupEdited(row, field)
      e.sets = cascadeWeight(e.sets, i, v, side, e.target?.backoffStep)
      rerampOpen(s, e, i)
    }), true)
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
  // The compact layout gets the small still too (Discord 11-02), unless animations are off: a
  // glance at which machine it is, with How to do it a tap away.
  const thumb = (dense ? S.gifSize !== 'off' : S.gifSize === 'mini') && hasWorkoutMedia(ex)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  // The history the rows were built from: before the session's day when it is logged into the
  // past (sessionHistory), so "last time", the best set and the Best chip are not from later on.
  const H = sessionHistory(S)
  // The routine's own last session of this exercise (or any, for a routine that has none), the
  // same one the rows and the progression line were built from (#216).
  const last = lastEntryFor(H, entry.id, entry.rid)
  // Each finished set against the same set last time (#907, lib/set-trend.js): a small arrow on
  // the set's number, said in words to a screen reader. Settings → Workout can switch it off.
  const trends = setTrendOn(S) ? setTrendsFor(entry, last, { formula: formulaOf(S) }) : null
  const trendMark = i => {
    const tr = trends?.[i]
    return tr ? <span className={'settrend ' + (tr.dir > 0 ? 'up' : tr.dir < 0 ? 'down' : 'same')} aria-hidden="true">{trendGlyph(tr)}</span> : null
  }
  const trendSay = (i, label) => (trends?.[i] ? label + ', ' + trendLabel(trends[i], S.unit) : label)
  const standingNote = exNoteFor(S, entry.id)
  // A note pinned at the gym you are at (lib/journal.js gymNoteFor): "seat 4" for this machine only.
  const gymNote = gymNoteFor(S, entry.id)
  // An exercise kept per gym (#988): which gym (and brand) its numbers come from today.
  const splitTag = splitLabel(S, entry.id, S.active?.gym?.name)
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
  // Records on the set (lib/set-records.js): the trophy on a set the moment it is ticked, and the
  // quiet line before the next one saying how close it is. Rep work only, and not while a saved
  // workout is being corrected: its records are History's to show.
  const recBase = mode === 'reps' && !editing && (liveRecordsOn(S) || recordHintsOn(S)) ? recordBaseline(H, entry.id, { as: meaning, formula: formulaOf(S) }) : null
  const recs = recBase && liveRecordsOn(S) ? entryRecords(entry, recBase, formulaOf(S)) : null
  const hintAt = recBase && recordHintsOn(S) ? entry.sets.findIndex(x => !x.done && !isWarmupRow(x)) : -1
  const hint = hintAt >= 0 ? (() => {
    const row = entry.sets[hintAt]
    // A per-side row is planned as one load for both sides: its first open side speaks for it.
    const side = isSideSet(row) ? (!row.sides.L.done ? row.sides.L : row.sides.R) : row
    return recordHint({ w: side.w, r: side.r }, recBase, formulaOf(S))
  })() : null
  const recordLine = i => <>
    {recs?.[i]?.length > 0 && <RecordMark kinds={recs[i]} assisted={recBase.assisted} />}
    {hint && hintAt === i && <RecordHintLine hint={hint} assisted={recBase.assisted} />}
  </>
  const bestKept = (H.exWeights[entry.id] || {}).w || 0
  const best = cardio ? 0
    : bestHist > 0 && bestKept > 0 ? betterWeight(entry.id, bestHist, bestKept) : Math.max(bestHist, bestKept)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  // Rows set for today by a session target (#972) are not the policy's, so its "why" would explain
  // numbers that are not on screen. The plan line below still shows what the routine asks for.
  const guidance = entry.sessionTarget ? null : progressionGuidance(plan)
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
      ? t('today {0}', setsRepsOf({ mode, sets: todaySets, reps: today.reps, sec: today.sec, m: today.m }))
      : entry.carried ? t('reps from your last session') : null
    return <div className="small dim planline" style={{ marginBottom: 4 }}>
      {/* A session stamped before `planned` kept a carry's metres: today's, not the 20 m default. */}
      {t('Plan: {0}', setsRepsOf({ ...(mode === 'distance' && today.m > 0 ? { m: today.m } : {}), ...planned, mode }))}{note ? ' · ' + note : ''}
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
        words of a right-to-left script keeps its own direction, still isolated (lib/bidi.js). */}
    <span>{ref ? <>{refLabel} (<time dateTime={ref.d} title={fmtDate(ref.d, true, true)}>{refAgo}</time>): {refSets.map((l, i) => <Fragment key={i}>{i ? ', ' : ''}<bdi dir={isoDir(l)}>{l}</bdi></Fragment>)}</> : refText}</span>
    <Icon name="history" />
  </button> : null
  // Zero added weight must stay editable: a bodyweight set can become weighted
  // later, or return to zero without losing its load control (issue #460).
  const cfg = { ...(entry.target || {}), id: entry.id }
  // The tempo of the set up next (or of the last one, once all are done), and its guide.
  const tempoIdx = (() => { const k = entry.sets.findIndex(x => !x.done && !isWarmupRow(x)); return k >= 0 ? k : entry.sets.length - 1 })()
  const tempoNow = mode === 'reps' && tempoIdx >= 0 ? tempoOf(entry.target, entry.sets[tempoIdx]) : null
  const openTempoGuide = () => {
    const row = entry.sets[tempoIdx]
    tempoGuideSheet({ tempo: tempoNow, reps: guideReps(row, entry.target), name: exerciseNameText(ex),
      onTick: !editing && row && !row.done && !isSideSet(row) ? () => onToggle(tempoIdx) : null })
  }
  const bw = !cardio && isBw(cfg)
  // A unilateral exercise logs each side on its own (issue #60): work rows render as an L and an
  // R sub-row, each with its own weight/reps/effort and done tick. Warm-ups stay single.
  const perSide = mode === 'reps' && isPerSide(cfg)
  // Resistance bands per set (lib/bands.js): band equipment, or switched on in the exercise's settings.
  const bandsHere = mode === 'reps' && usesBands(S, entry.id, entry.target)
  const loadStep = mode === 'reps' ? weightIncrement(cfg, S.unit) : 2.5
  // With the dumbbells you own listed (issue #376), + and − walk from bell to bell — 9, 11, 13 —
  // instead of along the increment's grid; an off-list weight goes to the nearest bell that way.
  // A machine's own stack (#688) is walked the same way: 5, 11.3, 18.1.
  const owned = mode === 'reps' ? ownedWeightsFor(S, cfg) : null
  // From the weight on screen: a stored 44.996 lb steps as the 45 it shows.
  const stepLoad = (v, step, dir) => { const c = cleanNum(v, step); return owned ? stepOwned(owned, c, dir) : stepWeight(c, step, dir) }
  // The weight column says what a dumbbell weight means when the exercise has said (#474): one
  // bell or both together. A one-arm exercise holds one bell, so its plain heading is already true.
  const bells = !bw && bellsIn(cfg) === 2 ? meaning : 'as'
  const loadCol = { f: 'w', step: loadStep, dec: true, hd: bw ? t('Added ({0})', S.unit)
    : bells === 'each' ? t('Each ({0})', S.unit) : bells === 'total' ? t('Both ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  // A carry or a sled (Reddit, #1011): the metres first, then the load, like a timed hold's seconds.
  const distance = mode === 'distance'
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : distance ? { f: 'm', step: 5, dec: false, hd: t('Metres') }
        : loadCol
  // Speed is stored in km/h and shown in the profile's unit (lib/speed.js): `view` turns the
  // stored number into the one on screen, `store` the one typed or stepped back into km/h.
  const speedUnit = speedUnitOf(S)
  // Logged by distance instead (#887, lib/distance.js): the distance in km or mi, and the speed
  // worked out from it and the minutes. The column's heading switches between the two.
  const distUnit = distUnitOf(S)
  const byDist = cardio && byDistance(S, entry.id)
  const col2 = byDist ? { f: 'km', step: distUnit === 'mi' ? 0.1 : 0.5, dec: true, hd: t('Distance ({0})', distLabel(distUnit)),
    get: s => { const km = distanceKmOf(s); return km > 0 ? Math.round(km * 10000) / 10000 : (Number(s?.km) === 0 ? 0 : undefined) },
    view: v => toDist(v, distUnit), store: v => fromDist(v, distUnit) }
    : cardio ? { f: 'speed', step: 0.5, dec: true, hd: speedUnit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)'),
    view: v => toSpeed(v, speedUnit), store: v => fromSpeed(v, speedUnit) }
    : timed || distance ? loadCol : repCol
  const switchCardioBy = () => update(st => { st.cardioBy = withCardioBy(st.cardioBy, entry.id, byDist ? 'speed' : 'distance') })
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
  // A bike, a rower or a cross trainer gets its resistance level there instead (cardioCol).
  const third = cardio ? cardioCol(ex, entry.sets) : null
  const inclineCol = third === 'incline'
    ? { f: 'incline', step: INCLINE_STEP, dec: true, opt: true, hd: t('Incline (%)'), store: clampIncline }
    : third === 'level' ? { f: 'level', step: 1, dec: false, opt: true, hd: t('Level'), store: clampLevel } : null
  const col3 = cardio ? inclineCol : mode === 'reps' && eff ? { f: eff.f, eff: kind, hd: t(eff.hd) } : null
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir) => {
    // Read the current value directly from the store rather than from the render-time snapshot.
    // In a superset both ExerciseBlock instances share the same store subscription, so when one
    // member's field changes the partner re-renders too, replacing the closure's `s` reference
    // with a fresh clone before the next tap fires. Reading from the store avoids that stale-
    // closure problem entirely and keeps every tap operating on the real current value.
    const fresh = liveRow(i)
    const cur = valueOf(col, fresh || s)
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
    <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')} role="group" aria-label={inSet(s, i, col.hd)}>
      {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Decrease')))} onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={viewOf(col, valueOf(col, s)) ?? ''} aria-label={inSet(s, i, col.hd)}
        onChange={v => onField(i, col.f, col.store ? col.store(v) : v)} /></span>
      {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Increase')))} onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>}
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
    if (!isOn(S, 'plates')) return null   // Settings → Modules: Plates and warm-ups off
    const at = loadSeq.findIndex(x => x.key === key)
    const L = at >= 0 ? loadSeq[at].load : null
    if (!L) return null
    let p = at - 1
    while (p >= 0 && !loadSeq[p].load) p--
    const prev = p >= 0 ? loadSeq[p].load : null
    if (prev && sameLoad(prev, L)) return null
    // "+" between plates: "45 + 5 per side" reads as a sum, a dot did not (Boris, 2026-09-13).
    // The first line names the bar it counts with (lib/plate-text.js).
    const text = plateText(L, { unit: S.unit, base, first: !prev, bar: usesBar(ex) })
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
  // three under the sets and four more below the card is a single list you open once a session.
  // Since v1.4.4 it leads with the handful you reach for at the gym (note, swap, warm-up, rest,
  // history) and folds the rest under one More row (MenuSheet's `more`): the exercise's
  // settings, the how-to, the order of the session and the progression toggle. Remove stays
  // last, on its own.
  // The exercise's own rest, or the default it falls back to (lib/supersetFlow.js restSecFor).
  const ownRest = ownExerciseRest(entry.target)
  const restSub = ownRest === 0 ? t('No timer') : ownRest ? fmtRest(ownRest) : t('Default ({0})', fmtRest(S.restSec))
  const backups = (entry.target?.subs || []).map(id => EXIDX[id]).filter(b => b && b.id !== entry.id)
  // Form videos are a module (Settings → Modules): off, nothing offers to film; filmed ones stay.
  const videosOn = isOn(S, 'videos')
  // Settings → Modules → Effort off: no cardio chip either (the set menu keeps its row).
  const effortOn = isOn(S, 'effort')
  const filmAt = videosOn ? filmTarget(entry) : -1
  const setTitle = (s, i) => isWarmupRow(s) ? t('Warm-up') : sideTagOf(s) ? t('Set {0} ({1})', setNumOf(s, i), sideTagOf(s)) : t('Set {0}', setNumOf(s, i))
  // A timed per-side hold is one set over two rows; its video sits on the first of them.
  const filmSet = i => {
    const at = setSpanAt(entry.sets, i)[0]
    filmSetSheet({ entry: entryIdx, set: at }, t('Film {0}', setTitle(entry.sets[at], at)))
  }
  const openMore = () => menuSheet({
    title: exerciseNameFor(ex),
    titleClass: exerciseNameClass(ex),
    sections: [
      { items: [
        { icon: 'note', label: entry.note ? t('Edit note') : t('Add note'), sub: entry.note || undefined, onClick: () => exerciseNoteSheet(entryIdx) },
        onSwap && { icon: 'swap', label: t('Swap exercise'), onClick: onSwap, disabled: busy },
        // The slot's planned backups (#649), one tap each: the machine is taken, the plan says what next.
        ...(onSwapBackup ? backups.map(b => ({ icon: 'swap', label: t('Swap to {0}', exerciseNameText(b)), sub: entry.target?.subCfg?.[b.id] ? t('Planned backup, with its own plan') : t('Planned backup, same sets and reps'), onClick: () => onSwapBackup(b.id), disabled: busy })) : []),
        { icon: 'sunrise', label: t('Add warm-up set'), onClick: onAddWarmup },
        // Today's warm-ups as the routine's own from now on (#525, lib/warmup-ramp.js).
        onKeepWarmups && { icon: 'sunrise', label: t('Keep these warm-ups'), sub: t('Saved in the routine, scaled to your work weight'), onClick: onKeepWarmups },
        onRest && { icon: 'timer', label: t('Rest timer'), sub: restSub, onClick: onRest },
        { icon: 'history', label: t('History'), sub: last ? t('Last time') + ' ' + fmtDate(last.d) : undefined, onClick: () => exerciseHistorySheet(entry.id) },
        // The Coach on this exercise, for the rest of this workout (components/WorkoutCoachSheet.jsx).
        onAskCoach && { icon: 'sparkles', label: t('Ask the Coach'), sub: t('It hurts, it’s taken, no time, feeling great'), onClick: onAskCoach },
      ] },
      { more: [
        { title: t('Exercise'), items: [
          onProgressionSettings && { icon: 'slider', label: t('Exercise settings'), sub: guidance ? t(guidance.policyLabel) : t('Sets, reps, rest, progression'), onClick: onProgressionSettings },
          plateLoading && { icon: 'plate', label: t('Plate loading'), sub: loadSummary, onClick: () => barWeightSheet(entry.id, cfg) },
          { icon: 'info', label: t('How to do it'), onClick: () => exerciseDetailSheet(ex) },
          youtubeSearchUrl(ex) && { icon: 'play', label: t('Watch on YouTube'), sub: t('Opens a search for good form'), onClick: () => openExternal(youtubeSearchUrl(ex)) },
          routineUpdate && { icon: 'clipboard', label: t('Update routine'), sub: routineUpdate.sub, onClick: routineUpdate.run },
        ] },
        { title: t('Order and supersets'), items: [
          onPairPrev && { icon: 'link', label: t('Make superset with previous'), onClick: onPairPrev },
          onPairNext && { icon: 'link', label: t('Make superset with next'), onClick: onPairNext },
          onMoveUp && { icon: 'chevronUp', label: t('Move up'), onClick: onMoveUp, disabled: busy || !canMoveUp },
          onMoveDown && { icon: 'chevronDown', label: t('Move down'), onClick: onMoveDown, disabled: busy || !canMoveDown },
        ] },
        { title: t('This session'), items: [
          // Your own form video of the set about to be done (lib/set-videos.js filmTarget). Under
          // More here: the set's own menu has it on show, one tap from the set number.
          filmAt >= 0 && { icon: 'camera', label: t('Film a set'), sub: setTitle(entry.sets[filmAt], filmAt), onClick: () => filmSet(filmAt) },
          onNoProg && { icon: 'chartLineSlash', label: t('Don’t count for progression'), sub: t('This exercise, this session only'), on: entry.noProg === true, onClick: () => onNoProg(entry.noProg !== true) },
        ] },
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
  // What a screen reader calls a row (P4): "Set 2", "Set 2 (Left)", and "Warm-up 1" for a warm-up,
  // whose number starts over, so it no longer shares "Set 1" with the first work set. Every
  // control in the row carries it (inSet), since each row has the same steppers and fields:
  // "Set 2: Weight (kg)", "Set 2: Reps: Increase". `side` names one half of an L/R stack.
  const setSay = (s, i, side) => {
    const n = setNumOf(s, i), tag = side ? (side === 'L' ? t('Left') : t('Right')) : sideTagOf(s)
    if (isWarmupRow(s)) return tag ? t('Warm-up {0}', n) + ' (' + tag + ')' : t('Warm-up {0}', n)
    return tag ? t('Set {0} ({1})', n, tag) : t('Set {0}', n)
  }
  // With several exercises on screen (a superset, the list views) every one of them has a
  // "Set 1", so there the exercise comes last in the name: "Set 1: Reps, Barbell Curl".
  // The same exercise twice in one session (squats, then back-off squats at the end): its place
  // in the session goes with the name, "5. Squat", as the routine editor does it.
  const several = !!(compact || listed)
  // Ironvane redesign, step 3 (workout logging): the one-exercise page — not a superset's or the
  // list view's blocks, not the compact view — gets the How-to card, a Last column in the set rows
  // and the Note · Plates · Swap · More row under the sets.
  const roomy = !compact && !listed && !dense
  // What each work set lifted last time ("60×8"), in the row it lines up with: last time's work
  // sets in order (lib/history.js lastEntryFor keeps work sets only), warm-ups skipped. Only in
  // plain reps rows with two columns; a narrow card hides it (index.css, container query).
  const showLast = roomy && mode === 'reps' && !col3 && !perSide && !timed && !!last?.sets?.length
  const lastAt = i => {
    if (isWarmupRow(entry.sets[i])) return ''
    const k = entry.sets.slice(0, i + 1).filter(x => !isWarmupRow(x)).length - 1
    const p = last.sets[k]
    if (!p || !(p.r > 0)) return ''
    return p.w > 0 ? fmtNum(p.w) + '×' + p.r : String(p.r)
  }
  const exSay = S.active.entries.filter(x => x.id === entry.id).length > 1 ? `${entryIdx + 1}. ${exerciseNameText(ex)}` : exerciseNameText(ex)
  const inEx = label => (several ? label + ', ' + said(exSay) : label)
  const inSet = (s, i, label, side) => inEx(nameIn(setSay(s, i, side), label))
  // A drop or a burst under a row: "Set 2: Drop 1: Reps".
  const subSay = (s, i, sub, label, side) => inSet(s, i, label ? nameIn(sub, label) : sub, side)
  const doneSay = (s, i, side) => {
    if (isWarmupRow(s)) return inSet(s, i, t('Done'), side)
    const tag = side ? (side === 'L' ? t('Left') : t('Right')) : sideTagOf(s)
    return inEx(tag ? t('Set {0} ({1}) done', setNumOf(s, i), tag) : t('Set {0} done', setNumOf(s, i)))
  }
  // What a set rests without a rest of its own, as the flow works it out (restSecFor,
  // warmupRestSecFor), so the set menu can name it.
  const setRestDefault = i => {
    const all = S.active?.entries || []
    const unit = supersetUnits(all).find(u => u.includes(entryIdx)) || [entryIdx]
    const work = restSecFor(all, unit, S.restSec, { idx: entryIdx, sec: pyramidRestFor(entry.target, entry.sets, i) })
    return warmupRestSecFor(entry, i, work, S.warmupRestSec)
  }
  const openSetRest = i => {
    const start = setSpanAt(entry.sets, i)[0]
    const own = ownSetRest(entry.sets[start])
    const dflt = t('Default ({0})', fmtRest(setRestDefault(start)))
    menuSheet({
      title: t('Rest after this set'),
      items: [
        { icon: 'timer', label: dflt, on: own == null, onClick: setRestAt(start, null) },
        { icon: 'pause', label: t('No timer'), on: own === 0, onClick: setRestAt(start, 0) },
        { icon: 'clock', label: t('Pick a time'), on: own > 0, onClick: () => {
          const save = sec => setRestAt(start, sec > 0 ? sec : 0)()
          durationSheet({ title: t('Rest after this set'), value: own > 0 ? own : setRestDefault(start), max: REST_MAX, off: t('No timer'), onDone: save })
        } },
      ],
    })
  }
  // The colour tags to pick from: each with its shape and name, the one on the set ticked.
  const tagSheet = (i, title) => {
    const cur = setTagOf(entry.sets[i])?.id || null
    menuSheet({
      title: t('Colour tag'), subtitle: title,
      sections: [{ items: [
        ...SET_TAGS.map(tag => ({ lead: <span className="settag big" style={{ '--tag': tag.color }}>{tag.shape}</span>, label: setTagName(tag.id), on: cur === tag.id, onClick: () => mutSet(i, row => withSetTag(row, tag.id)) })),
        cur && { icon: 'xmark', label: t('No tag'), onClick: () => mutSet(i, row => withSetTag(row, null)) },
      ].filter(Boolean) }],
    })
  }
  const openSetMenu = (s, i) => {
    const warm = isWarmupRow(s)
    const sideTag = sideTagOf(s)
    const ownRestHere = ownSetRest(entry.sets[setSpanAt(entry.sets, i)[0]])
    const spanStart = setSpanAt(entry.sets, i)[0]
    const video = setVideoOf(entry.sets[spanStart])
    const noteHere = setNoteOf(entry.sets[spanStart])
    const tagHere = setTagOf(entry.sets[spanStart])
    const tagItem = { icon: 'palette', label: t('Colour tag'), sub: tagHere ? `${tagHere.shape} ${setTagName(tagHere.id)}` : t('Your own code for this set'), onClick: () => tagSheet(spanStart, warm ? t('Warm-up') : t('Set {0}', setNumOf(s, i))) }
    menuSheet({
      title: warm ? t('Warm-up') : sideTag ? t('Set {0} ({1})', setNumOf(s, i), sideTag) : t('Set {0}', setNumOf(s, i)),
      subtitle: setLabel(entry.id, s, entry.target, speedUnit),
      // What you do to a set mid-workout comes first (failure, a drop or a burst on top, a copy);
      // the phase and the set's own rest are rarer and fold under More (v1.4.4). Remove stays last.
      sections: [
        { items: [
          // Taken to failure: a toggle with its check, like the menu's other on/off rows. It counts
          // as RIR 0 wherever effort is read, unless a rating was logged on the set. A timed
          // per-side pair is one set, so both halves get it.
          !warm && mode !== 'cardio' && { icon: 'gauge', label: t('Taken to failure'), sub: t('Nothing left in the tank'), on: isFailureSet(s), onClick: () => toggleFailureAt(i) },
          // Cardio's effort lives here, not in a column (the third one is the incline): RPE only,
          // whatever the profile logs, since reps in reserve mean nothing on a treadmill. Stored as
          // `rpe` on the set, which the fatigue model already reads (recovery.js via rirOf).
          !warm && cardio && { icon: 'gauge', label: t('How hard it felt'), sub: s.rpe != null ? t(EFFORT.rpe.hd) + ' ' + fmtNum(s.rpe) : t('Not rated yet'), onClick: () => effortPickerSheet('rpe', s.rpe ?? null, nv => onField(i, 'rpe', nv), { cardio: true }) },
          !warm && mode === 'reps' && !isRestPauseSet(s) && { icon: 'arrowDown', label: t('Drop set'), sub: t('+ Drop'), onClick: () => addDropRow(i) },
          !warm && mode === 'reps' && !isDropSet(s) && (isClusterSet(s)
            ? { icon: 'bolt', label: t('One more mini-set'), sub: t('+ Mini-set'), onClick: () => addBurstRow(i) }
            : { icon: 'bolt', label: t('Rest-pause burst'), sub: t('+ Burst'), onClick: () => addBurstRow(i) }),
          onCopySetAt && { icon: 'copy', label: t('Copy this set'), onClick: () => onCopySetAt(i) },
          // Your own form video (v1.4.4). Up here rather than under More: it is filmed while the
          // set happens, one tap from the number; once there is one, the same row plays it.
          !videosOn ? null : video
            ? { icon: 'play', label: t('Watch your video'), sub: video.dur != null ? fmtClip(video.dur) : undefined, onClick: () => setVideoAt(spanStart) }
            : { icon: 'camera', label: t('Film this set'), sub: t('Check your form later'), onClick: () => filmSet(i) },
          // A word about this one set (lib/set-notes.js), kept with the workout.
          { icon: 'note', label: noteHere ? t('Edit note') : t('Note'), sub: noteHere || t('A word about this set'), onClick: () => setNoteSheet(entryIdx, spanStart, warm ? t('Warm-up') : t('Set {0}', setNumOf(s, i))) },
          // A colour of your own for this set (lib/set-tags.js): up here once the set has one, under
          // More until then, so the menu stays as it was for everyone who never uses it.
          tagHere && tagItem,
        ] },
        { more: [{ items: [
          // A warm-up logged as a work set (or the other way round) changes phase here. Reps sets
          // only, the kind a warm-up is added as; one work set always stays. A per-side set keeps
          // its two sides either way (#575), so it goes back and forth like any other.
          !warm && mode === 'reps' && canBeWarmup(s) && entry.sets.some((x, j) => j !== i && !isWarmupRow(x)) && { icon: 'sunrise', label: t('Make it a warm-up set'), onClick: () => setPhaseAt(i, true) },
          warm && mode === 'reps' && { icon: 'dumbbell', label: t('Count it as a working set'), onClick: () => setPhaseAt(i, false) },
          // Just this set's tempo, this session (#572): a slow first set, a paused one at the end.
          !warm && mode === 'reps' && { icon: 'stopwatch', label: t('Tempo'), sub: tempoOf(entry.target, entry.sets[spanStart]) || t('None'), onClick: () => tempoSheet({
            title: t('Tempo for this set'), value: tempoOf(entry.target, entry.sets[spanStart]),
            clearLabel: normalizeTempo(entry.target?.tempo) ? t('Like the exercise ({0})', normalizeTempo(entry.target.tempo)) : t('No tempo'),
            onDone: v => setTempoAt(spanStart, v),
          }) },
          // Just this set's rest, this session (#609): a long one before the top set, none after a light one.
          !editing && { icon: 'timer', label: t('Rest after this set'), sub: ownRestHere == null ? t('Default ({0})', fmtRest(setRestDefault(i))) : ownRestHere === 0 ? t('No timer') : fmtRest(ownRestHere), onClick: () => openSetRest(i) },
          !tagHere && tagItem,
        ] }] },
        { items: [
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
      <button className="effcell is-empty" aria-label={inSet(s, i, col.hd)} onClick={open}>{col.hd}</button>
    )
    const step = dir => onField(i, col.f, stepEffort(col.eff, v, dir))
    return (
      <div className={'stp effcell-stp' + (wc.steppers ? '' : ' plain')}
        style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined}>
        {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Decrease')))} onClick={() => step(-1)}><Icon name="minus" /></button>}
        <button className="val" aria-label={inSet(s, i, col.hd)} onClick={open}>{fmtNum(v)}</button>
        {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Increase')))} onClick={() => step(1)}><Icon name="plus" /></button>}
      </div>
    )
  }
  // Per-side versions of the weight/reps stepper and the effort picker. Same markup and stepping
  // rules as the row-level `cell`/`effortCell`, but bound to one side of a unilateral row and
  // routed through setSide so the aggregate stays correct. Reads the live side value from the
  // store for the same stale-closure reason `bump` does.
  const sideBump = (i, side, col, dir) => {
    const fresh = liveRow(i)?.sides?.[side]
    const cur = fresh ? fresh[col.f] : 0
    if (col.f === 'w') return setSide(i, side, col.f, stepLoad(cur, col.step, dir))
    // Reps step by one per side: repCol's step of two keeps the *combined* total evenly
    // splittable, but here each side is logged directly, so one tap is one rep.
    const step = col.f === 'r' ? 1 : col.step
    setSide(i, side, col.f, Math.max(0, Math.round(((cur || 0) + dir * step) * 100) / 100))
  }
  const sideCell = (s, sd, i, side, col, cls) => (
    <div className={'stp ' + cls + (wc.steppers ? '' : ' plain')} role="group" aria-label={inSet(s, i, col.hd, side)}>
      {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Decrease')), side)} onClick={() => sideBump(i, side, col, -1)}><Icon name="minus" /></button>}
      <span className="val"><NumberField decimal={col.dec} value={sd[col.f] ?? ''} aria-label={inSet(s, i, col.hd, side)}
        onChange={v => setSide(i, side, col.f, v)} /></span>
      {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Increase')), side)} onClick={() => sideBump(i, side, col, 1)}><Icon name="plus" /></button>}
    </div>
  )
  const sideEffortCell = (s, sd, i, side, col) => {
    const v = sd[col.f] ?? null
    const rir = col.eff === 'rpe' ? (v == null ? null : 10 - v) : v
    const color = effortColor(rir)
    const open = () => effortPickerSheet(col.eff, v, nv => {
      setSide(i, side, col.f, nv)
      const fresh = useStore.getState().S.active?.entries[entryIdx]?.sets[i]?.sides?.[side]
      if (nv != null && fresh && !fresh.done) onToggleSide(i, side)
    })
    if (v == null) return <button className="effcell is-empty" aria-label={inSet(s, i, col.hd, side)} onClick={open}>{col.hd}</button>
    const step = dir => setSide(i, side, col.f, stepEffort(col.eff, v, dir))
    return (
      <div className={'stp effcell-stp' + (wc.steppers ? '' : ' plain')}
        style={color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined}>
        {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Decrease')), side)} onClick={() => step(-1)}><Icon name="minus" /></button>}
        <button className="val" aria-label={inSet(s, i, col.hd, side)} onClick={open}>{fmtNum(v)}</button>
        {wc.steppers && <button aria-label={inSet(s, i, nameIn(col.hd, t('Increase')), side)} onClick={() => step(1)}><Icon name="plus" /></button>}
      </div>
    )
  }
  // One side's row: the L or R badge, then the same weight/reps/effort controls as a straight
  // row but bound to that side, and the side's own done tick.
  const sideRow = (s, i, side, col1, col2, col3) => {
    const sd = (s.sides && s.sides[side]) || { w: 0, r: 0, done: false }
    return <div className={'setrow side' + (sd.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
      <span className="sidetag" aria-hidden="true">{side === 'L' ? t('L') : t('R')}</span>
      {sideCell(s, sd, i, side, col1, 'w')}
      {col2 && sideCell(s, sd, i, side, col2, 'r')}
      {col3 && sideEffortCell(s, sd, i, side, col3)}
      <Check checked={sd.done} label={doneSay(s, i, side)} onChange={() => onToggleSide(i, side)} />
    </div>
  }
  // A side's own drop-set/rest-pause sub-rows (issue #60): the intensifier is logged per limb, so
  // the drops and bursts hang under that side's row, each editable, exactly like a straight set's
  // do under its row. Reads the side object, not the aggregate.
  const sideExtras = (s, i, side) => {
    const sd = (s.sides && s.sides[side]) || {}
    return <>
      {dropsOf(sd).map((d, di) => (
        <div className={'subrow' + (sd.done ? ' done' : '')} key={'d' + di}>
          <span className="subn">{t('Drop {0}', di + 1)}</span>
          {miniStepper(d.w, loadStep, true, v => setDropField(i, di, 'w', v, side), true, x => subSay(s, i, t('Drop {0}', di + 1), nameIn(col1.hd, x), side))}
          {miniStepper(d.r, 1, false, v => setDropField(i, di, 'r', v, side), false, x => subSay(s, i, t('Drop {0}', di + 1), nameIn(col2?.hd, x), side))}
          <button className="iconbtn" aria-label={subSay(s, i, t('Drop {0}', di + 1), t('Remove'), side)} onClick={() => removeDrop(i, di)}><Icon name="xmark" /></button>
        </div>
      ))}
      {clustersOf(sd).map((c, ci) => (
        <div className={'subrow' + (sd.done ? ' done' : '')} key={'c' + ci}>
          <span className="subn">{isClusterSet(s) ? t('Mini-set {0}', ci + 1) : t('Burst {0}', ci + 1)}</span>
          {miniStepper(c.r, 1, false, v => setClusterField(i, ci, v, side), false, x => subSay(s, i, isClusterSet(s) ? t('Mini-set {0}', ci + 1) : t('Burst {0}', ci + 1), nameIn(col2?.hd, x), side))}
          <span className="dim small">{c.restSec}s</span>
          <button className="iconbtn" aria-label={subSay(s, i, isClusterSet(s) ? t('Mini-set {0}', ci + 1) : t('Burst {0}', ci + 1), t('Remove'), side)} onClick={() => removeCluster(i, ci)}><Icon name="xmark" /></button>
        </div>
      ))}
    </>
  }
  // A smaller stepper for a drop's weight/reps or a burst's reps — editing what the plan (or a
  // live "+ Drop"/"+ Burst" tap) already put on the row, not typing into a fresh field.
  // `say(what)` names it for a screen reader: say() is "Set 2: Drop 1: Reps", say('Decrease')
  // "Set 2: Drop 1: Reps: Decrease", with the exercise after it where several are on screen (P4).
  const miniStepper = (value, step, dec, onChange, snapWeightStep = false, say = x => x) => (
    <div className="stp mini" role="group" aria-label={say() || undefined}>
      <button aria-label={say(t('Decrease'))} onClick={() => onChange(snapWeightStep ? stepLoad(value, step, -1) : Math.max(0, Math.round(((value || 0) - step) * 100) / 100))}><Icon name="minus" /></button>
      <span className="val"><NumberField decimal={dec} value={value ?? ''} onChange={onChange} aria-label={say() || undefined} /></span>
      <button aria-label={say(t('Increase'))} onClick={() => onChange(snapWeightStep ? stepLoad(value, step, 1) : Math.max(0, Math.round(((value || 0) + step) * 100) / 100))}><Icon name="plus" /></button>
    </div>
  )
  // A plain set row (anything but a reps L/R stack). Its own function since a timed per-side
  // hold draws two of them, L then R, inside one swipe so the pair slides as the one set it is.
  // A set taken to failure wears a small "F" on its number, the button every row's menu opens
  // from. The button's own label speaks for it, so a screen reader hears it with the set number.
  const failMark = s => isFailureSet(s) ? <span className="failmark" aria-hidden="true">{t('F')}</span> : null
  // The set's colour tag: its shape in its colour, beside the number; said with the number.
  const tagMark = s => { const tag = setTagOf(s); return tag ? <span className="settag" style={{ '--tag': tag.color }} aria-hidden="true">{tag.shape}</span> : null }
  const failSay = (s, label) => { const tag = setTagOf(s); const l = isFailureSet(s) ? label + ', ' + t('Taken to failure') : label; return tag ? l + ', ' + setTagName(tag.id) : l }
  const plainRow = (s, i) => (
    <div ref={el => onSetRowRef?.(i, el)} data-tour="set" className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '') + (timed ? ' timed' : '')}>
      <button type="button" className="n" aria-label={inEx(trendSay(i, failSay(s, setSay(s, i))))} aria-describedby={optsId} title={t('More')} onClick={() => openSetMenu(s, i)}>{setNumOf(s, i)}{failMark(s)}{tagMark(s)}{trendMark(i)}</button>
      {/* Both words sit in the pill's one grid cell (::before/::after, hidden), so Left and
          Right are as wide as the longer of the two in every language and the inputs
          after them line up (#322). */}
      {sideTagOf(s) && <span className="tag acc nocap sidepill" data-l={t('Left')} data-r={t('Right')}><span>{sideTagOf(s)}</span></span>}
      {/* Said by the "Last time" line above the card; the column is for the eye. */}
      {showLast && <span className="last" aria-hidden="true">{lastAt(i)}</span>}
      {cell(s, i, col1, 'w')}
      {col2 && cell(s, i, col2, col2.dec ? 'r dec' : 'r')}
      {col3 && (col3.eff ? effortCell(s, i, col3) : cell(s, i, col3, 'r inc'))}
      {/* A timed set is started, not typed: the timer counts the hold down and checks the
          set off itself. The checkbox stays for anyone who timed it on their own watch. */}
      {timed && !editing && <button className="setgo" aria-label={inSet(s, i, t('Start set'))} disabled={s.done || !!working}
        onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
      <Check checked={s.done} tour="tick" label={doneSay(s, i)} onChange={() => onToggle(i)} />
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
    return <SwipeRow data-tour="swipe" canDelete={editing || entry.sets.length > count}
      deleteName={inSet(s, i, t('Delete'))} copyName={inSet(s, i, t('Copy set'))}
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
    {!dense && !thumb && <Media ex={ex} notes={entry.target?.notes} key={entry.id} compact={compact} minimizable sayAs={exSay} />}
    <div className="row between exhd" style={{ marginBottom: 8 }}>
      {thumb && <WorkoutThumb ex={ex} dense={dense} sayAs={exSay} onExpand={dense ? () => exerciseDetailSheet(ex) : () => update(s => { s.gifSize = 'full' })} />}
      <div style={{ flex: 1, minWidth: 0, fontSize: (compact || dense) ? 'var(--fs-body)' : 'var(--fs-title3)', fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2 }} className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</div>
      <div className="row" style={{ gap: 2, flex: 'none' }}>
        {entry.note && <button className="iconbtn" aria-label={inEx(t('Note'))} title={t('Note')} style={{ color: 'var(--acc-ink)' }}
          onClick={() => exerciseNoteSheet(entryIdx)}><Icon name="note" /></button>}
        <button className="iconbtn" aria-label={inEx(t('More'))} title={t('More')} onClick={openMore}><Icon name="more" /></button>
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
      {onPairPrev && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with previous')} aria-label={several ? inEx(t('Make superset with previous')) : undefined} onClick={onPairPrev}>{t('Make superset with previous')}</Button>}
      {onPairNext && <Button size="xs" variant="tinted" icon="link" title={t('Make superset with next')} aria-label={several ? inEx(t('Make superset with next')) : undefined} onClick={onPairNext}>{t('Make superset with next')}</Button>}
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
      {/* Tempo (#572): the next set's, which is the exercise's unless that set has its own. */}
      {tempoNow && <TempoTag tempo={tempoNow} onClick={openTempoGuide} />}
      {(ex.tg || ex.bp) && <span className="tag">{t(MUSCLE_NAME[ex.tg] || ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtWeight(best, S.unit)}</span>}
      {splitTag && <span className="tag nocap"><Icon name="mapPin" />{splitTag}</span>}
    </div>
    {roomy && <div className="howto" data-tour="howto">
      <button type="button" className="howto-btn" onClick={() => exerciseDetailSheet(ex)}>
        <Icon name="info" /><span>{t('How to do it')}</span><Icon name="chevronRight" />
      </button>
    </div>}
    {planLine}
    {refLine}
    {standingNote && <div className="exnote"><Icon name="note" /><span>{standingNote}</span></div>}
    {pinnedNote && <div className="exnote pinned"><Icon name="pin" /><span>{pinnedNote}</span></div>}
    {gymNote && <div className="exnote gym"><Icon name="mapPin" /><span>{gymNote}</span></div>}
    {entry.note && <div className="exnote session"><Icon name="note" /><span>{entry.note}</span></div>}
    </>}
    <div className="sets" id={optsId}>
      {entry.sets.map((s, i) => <Fragment key={i}>
        {perSide && isSideSet(s) ? <div className="sideset">
          {swipeRow(s, i, <>
            <div className="setrow sidehd">
              <button type="button" className="n" aria-label={inEx(trendSay(i, failSay(s, setSay(s, i))))} title={t('More')} onClick={() => openSetMenu(s, i)}>{setNumOf(s, i)}{failMark(s)}{tagMark(s)}{trendMark(i)}</button>
              <span className="tag acc nocap">{t('Per side')}</span>
              <Check checked={s.done} label={doneSay(s, i)} onChange={() => onToggle(i)} />
            </div>
            {sideRow(s, i, 'L', col1, col2, col3)}
            {sideRow(s, i, 'R', col1, col2, col3)}
          </>)}
          {sideExtras(s, i, 'L')}
          {sideExtras(s, i, 'R')}
        </div> : swipeRow(s, i, plainRow(s, i))}
        {recordLine(i)}
        {loadLine(String(i))}
        {dropsOf(s).map((d, di) => <Fragment key={'d' + di}>
          <div className={'subrow' + (s.done ? ' done' : '')}>
            <span className="subn">{t('Drop {0}', di + 1)}</span>
            {miniStepper(d.w, loadStep, true, v => setDropField(i, di, 'w', v), true, x => subSay(s, i, t('Drop {0}', di + 1), nameIn(col1.hd, x)))}
            {miniStepper(d.r, 1, false, v => setDropField(i, di, 'r', v), false, x => subSay(s, i, t('Drop {0}', di + 1), nameIn(col2?.hd, x)))}
            <button className="iconbtn" aria-label={subSay(s, i, t('Drop {0}', di + 1), t('Remove'))} onClick={() => removeDrop(i, di)}><Icon name="xmark" /></button>
          </div>
          {loadLine(i + ':d' + di)}
        </Fragment>)}
        {clustersOf(s).map((c, ci) => <div className={'subrow' + (s.done ? ' done' : '')} key={'c' + ci}>
          <span className="subn">{isClusterSet(s) ? t('Mini-set {0}', ci + 1) : t('Burst {0}', ci + 1)}</span>
          {miniStepper(c.r, 1, false, v => setClusterField(i, ci, v), false, x => subSay(s, i, isClusterSet(s) ? t('Mini-set {0}', ci + 1) : t('Burst {0}', ci + 1), nameIn(col2?.hd, x)))}
          <span className="dim small">{c.restSec}s</span>
          <button className="iconbtn" aria-label={subSay(s, i, isClusterSet(s) ? t('Mini-set {0}', ci + 1) : t('Burst {0}', ci + 1), t('Remove'))} onClick={() => removeCluster(i, ci)}><Icon name="xmark" /></button>
        </div>)}
        {setNoteOf(s) && <div className="setnote"><Icon name="note" />{setNoteOf(s)}</div>}
        {videoAt === i && <ActiveSetVideo entry={entry} setIdx={i} onClose={() => setVideoAt(null)} />}
        {setVideoOf(s) && videoAt !== i && <SetVideoBadge video={setVideoOf(s)} onClick={() => setVideoAt(i)} />}
      </Fragment>)}
    </div>
    {bandsHere && <BandChips entry={entry} onToggle={i => mutSet(i, row => toggleSetBand(row))} />}
    {cardio && effortOn && <CardioEffortChip entry={entry} onPick={v => onField(entry.sets.length - 1, 'rpe', v)} />}
    {roomy && <div className="exactions">
      <button type="button" onClick={() => exerciseNoteSheet(entryIdx)}><Icon name="note" /><span>{t('Note')}</span></button>
      {plateLoading && <button type="button" onClick={() => barWeightSheet(entry.id, cfg)}><Icon name="plate" /><span>{t('Plates')}</span></button>}
      {onSwap && <button type="button" onClick={onSwap} disabled={busy}><Icon name="swap" /><span>{t('Swap')}</span></button>}
      <button type="button" aria-label={inEx(t('More'))} title={t('Exercise options')} onClick={openMore}><Icon name="more" /><span>{t('More')}</span></button>
    </div>}
    <div className="setactions">
      <Button size="sm" variant="ghost" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      {onRemoveSet && <Button size="sm" variant="ghost" icon="minus" onClick={onRemoveSet} disabled={entry.sets.length <= 1}>{t('Remove set')}</Button>}
    </div>
    {entry.sets.some(s => s.done) && <div className="small dim setsummary">{t('{0} sets', entry.sets.filter(s => s.done).length + '/' + entry.sets.length)}</div>}
  </>
}

function setNumberAt(sets, i) {
  const s = sets[i]
  if (isWarmupRow(s)) return sets.slice(0, i + 1).filter(isWarmupRow).length
  if (s?.side === 'R' && sets[i - 1]?.side === 'L') return setNumberAt(sets, i - 1)
  return sets.slice(0, i + 1).filter(x => !isWarmupRow(x) && x.side !== 'R').length
}

function sessionVolume(A, S) {
  return A.entries.reduce((sum, e) => sum + sessionVolume(e, S), 0)
}

function ssTitle(unit) {
  return unit.length > 2 ? t('Circuit') : t('Superset')
}

function WorkoutScrollAnchor({ enabled, collapsed, children }) {
  return <div className="workout-scroll-anchor" data-enabled={enabled ? '1' : '0'} data-collapsed={collapsed}>{children}</div>
}

function ActiveWorkout() {
  const S = useStore(s => s.S)
  const ui = useUI()
  const A = S.active
  const nav = useNavigate()
  const update = useStore(s => s.update)
  const [working, setWorking] = useState(false)
  const listRef = useRef(null)
  const hdrRef = useRef(null)
  const [opened, setOpened] = useState(() => new Set())
  const [visibleExercise, setVisibleExercise] = useState(A.cur || 0)
  const progressHighWater = useRef({})
  const exRefs = useRef(new Map())
  const setRefs = useRef(new Map())
  const focusPointerEpoch = useRef(0)
  const timerBlocking = useUI(s => !!(s.timer || s.work || s.countIn))
  const timerKey = ui.timer ? `${ui.timer.endsAt}-${ui.timer.total}` : ''
  const workKey = ui.work ? `${ui.work.endsAt}-${ui.work.total}` : ''
  const wc = workoutControls(S)
  const workoutView = S.workoutView || 'cards'
  const listMode = workoutView === 'list' || workoutView === 'compactList'
  const focusMode = workoutView === 'focus'
  const dense = workoutView === 'compact' || workoutView === 'compactList'
  const collapseOn = !!S.collapseDone
  const skipDone = !!S.skipDone
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur || 0, Math.max(0, A.entries.length - 1))
  const unitIdx = units.findIndex(u => u.includes(cur))
  const unit = units[unitIdx] || [cur]
  const isSuperset = unit.length > 1
  const done = setsDoneActive(A)
  const total = setUnitsTotal(A.entries)
  const paused = isPaused(A)
  const editing = !!A.editingWorkoutId
  const weighable = A.entries.some(e => !isBw({ ...(e.target || {}), id: e.id }))
  const vol = sessionVolume(A, S)
  const gymNow = activeGym(S)
  const gymShown = gymNow ? gymLabel(gymNow) : null
  const gymSwitchable = gymsOf(S).length > 1
  const noProgSwitchable = A.entries.length > 0
  const collapsed = new Set()
  const mutEntry = (idx, fn) => update(s => inEntryUnit(s, idx, fn), true)
  const setField = (idx, i, field, v) => mutEntry(idx, e => { if (e.sets[i]) e.sets[i][field] = v })
  const modeAt = idx => modeOf({ ...(A.entries[idx]?.target || {}), id: A.entries[idx]?.id })
  const focusUnit = idx => update(s => { if (s.active) s.active.cur = idx })
  const navigateUnit = dir => {
    const ni = stepUnitIndex(A.entries, units, unitIdx, dir, skipDone)
    if (ni !== unitIdx && units[ni]) focusUnit(units[ni][0])
  }
  const advanceFocusUnit = () => {
    const n = nextUnfinishedUnit(A.entries, units, cur)
    if (n) focusUnit(n[0])
    else navigateUnit(1)
  }
  const pairAt = (a, b) => update(s => { if (s.active) pairAdjacent(s.active, a, b) })
  const unpairAt = idx => update(s => { if (s.active) unpairSuperset(s.active, idx) })
  const moveCurrentUnit = dir => update(s => { if (s.active) moveActiveWorkoutUnit(s.active, s.active.cur, dir) })
  const addSet = idx => update(s => {
    const e = s.active?.entries?.[idx]
    if (!e) return
    const last = e.sets[e.sets.length - 1]
    const row = last ? copyRowAt(e.sets, e.sets.length - 1) : { w: 0, r: e.target?.reps || 10, done: false }
    delete row.done
    delete row.at
    e.sets.push(row)
  })
  const deleteSet = (idx, i) => update(s => { const e = s.active?.entries?.[idx]; if (e) e.sets = removeRowAt(e.sets, i) })
  const copySet = (idx, i) => update(s => { const e = s.active?.entries?.[idx]; if (e) e.sets = copyRowAt(e.sets, i) })
  const markAllDone = () => update(s => { if (s.active) markAllSetsDone(s.active) })
  const addExercise = () => exercisePicker(ex => {
    update(s => {
      if (!s.active) return
      const entry = buildSessionEntry(s, ex.id, {})
      s.active.entries.push(entry)
      s.active.cur = s.active.entries.length - 1
    })
  })
  const openSessionNote = () => sessionNoteSheet()
  const openRenameWorkout = () => renameWorkoutSheet()
  const togglePause = () => update(s => {
    if (!s.active) return
    if (isPaused(s.active)) resumeWorkout(s.active)
    else pauseWorkout(s.active)
  })
  const discardWorkout = () => confirmSheet({
    title: t('Discard workout?'), message: t('This session and its logged sets will be deleted.'),
    confirmText: t('Discard'), danger: true, onConfirm: () => { markDiscarded(); update(s => { s.S.active = null }); nav('/home') },
  })
  const openLayoutMenu = () => menuSheet({
    title: t('Layout'),
    items: ['cards', 'compact', 'list', 'compactList', 'focus'].map(key => ({ icon: 'layout', label: t(key), on: workoutView === key, onClick: () => update(s => { s.S.workoutView = key }) })),
  })
  const openGymMenu = () => menuSheet({
    title: t('Gym'),
    items: gymsOf(S).map(g => ({ icon: 'house', label: gymLabel(g), on: gymNow?.id === g.id, onClick: () => update(s => switchGym(s, g.id)) })),
  })
  const openViewMenu = () => menuSheet({
    sections: [
      { items: [{ icon: 'gear', accent: true, chevron: true, label: t('Workout settings'), sub: [S.restSec > 0 ? t('{0} rest', fmtRest(S.restSec)) : t('No rest timer'), S.sound ? t('Sound') : t('Silent')].join(' · '), onClick: workoutSettingsSheet }] },
      { items: [
        canPause(A) && { icon: paused ? 'play' : 'pause', label: paused ? t('Resume workout') : t('Pause workout'), sub: paused ? undefined : t('The clock and the rest wait for you'), onClick: togglePause },
        A.backfill && A.entries.length > 0 && { icon: 'checkCircle', label: t('Mark all sets done'), onClick: markAllDone },
        { icon: 'plusCircle', label: t('Add exercise'), onClick: addExercise },
        { icon: 'note', label: A.note ? t('Edit session note') : t('Add session note'), onClick: openSessionNote },
        { icon: 'layout', label: t('Layout'), sub: t(workoutView), onClick: openLayoutMenu },
      ] },
      { more: [{ items: [
        !editing && { icon: 'clipboard', label: t('Add routine'), sub: t('Bring another routine into this session'), onClick: addRoutineToSessionSheet },
        { icon: 'pencil', label: t('Rename workout'), onClick: openRenameWorkout },
        gymSwitchable && { icon: 'house', label: t('Gym'), sub: gymNow ? gymLabel(gymNow) : t('Pick a gym'), onClick: openGymMenu },
        noProgSwitchable && { icon: 'chartLineSlash', label: t('Don’t count for progression'), sub: t('Every exercise in this workout'), on: sessionNoProg(A), onClick: () => update(s => setSessionNoProg(s, !sessionNoProg(s.active))) },
      ] }] },
    ],
  })
  const openExerciseRest = idx => {
    const entry = A.entries[idx]
    if (!entry) return
    const own = ownExerciseRest(entry.target)
    menuSheet({ title: t('Rest for this exercise'), items: [
      { icon: 'timer', label: t('Default ({0})', fmtRest(S.restSec)), on: own == null, onClick: () => mutEntry(idx, e => { delete e.target.restSec }) },
      { icon: 'pause', label: t('No timer'), on: own === 0, onClick: () => mutEntry(idx, e => { e.target.restSec = 0 }) },
      { icon: 'clock', label: t('Pick a time'), on: own > 0, onClick: () => durationSheet({ title: t('Rest for this exercise'), value: restWheelValue(own, S.restSec), max: REST_MAX, off: t('No timer'), onDone: v => mutEntry(idx, e => { e.target.restSec = v }) }) },
    ] })
  }
  const openProgressionSettings = idx => {
    const entry = A.entries[idx]
    if (!entry) return
    exConfigSheet(exOr(entry.id), plannedConfigOf(entry), cfg => update(s => {
      const e = s.active?.entries?.[idx]
      if (!e) return
      e.target = { ...e.target, ...cfg }
    }))
  }
  const confirmRemoveExercise = idx => confirmSheet({ title: t('Remove exercise?'), message: t('This removes the exercise from your current session.'), confirmText: t('Remove'), danger: true, onConfirm: () => update(s => { if (s.active) { s.active.entries.splice(idx, 1); s.active.cur = Math.max(0, Math.min(s.active.cur, s.active.entries.length - 1)) } }) })
  let holdAt = null
  const startTimed = (idx, i, onFocusProgress, { startedAt = null } = {}) => {
    if (editing) return
    const e = A.entries[idx]
    unlock(S.sound)
    const plan = (!e.sets[i].done && e.sets[i].planSec) || e.sets[i].sec || 45
    const owner = { idx, i }
    const auto = autoHoldsFor(S, e.target)
    ui.startWork(plan, exerciseNameText(exOr(e.id)), holdDone(owner, plan, onFocusProgress), { idx, i, id: e.id }, { startedAt, auto })
    holdAt = { owner, idx, i }
  }
  const holdDone = (owner, plan, onFocusProgress) => (elapsed, { abandoned = false, chimed = false, endedAt = null } = {}) => {
    const { idx } = owner
    const mine = holdAt?.owner === owner
    const i = mine ? holdAt.i : owner.i
    if (mine) holdAt = null
    if (abandoned) { mutEntry(idx, en => { if (en.sets[i].planSec == null && !en.sets[i].done) en.sets[i].planSec = plan; en.sets[i].sec = elapsed }); return }
    mutEntry(idx, en => { en.sets[i].sec = elapsed; delete en.sets[i].planSec })
    const restBefore = useUI.getState().timer
    if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i, undefined, { quiet: chimed, onFocusProgress })
    const late = endedAt && Date.now() - endedAt > 1000 ? endedAt : null
    if (late) mutEntry(idx, en => { if (en.sets[i]?.done) en.sets[i].at = late })
    const rest = useUI.getState().timer
    if (rest && rest !== restBefore && !rest.ready && !rest.paused) { if (late) useUI.getState().backdateRest?.(late); return }
    useUI.getState().autoAfterHold?.(late || Date.now())
  }
  const timedAt = idx => modeAt(idx) === 'time'
  const autoStartRef = useRef(null)
  autoStartRef.current = (owner, startedAt) => startTimed(owner.idx, owner.i, undefined, { startedAt })
  useEffect(() => ui.bindAuto?.({
    peek: () => { const next = nextAutoHold(useStore.getState().S, timedAt); return next && { ...next, label: exerciseNameText(exOr(next.id)) } },
    focus: owner => { if (!owner.current) focusUnit(owner.idx) },
    startHold: (owner, startedAt) => autoStartRef.current?.(owner, startedAt),
    forecast: owner => forecastHolds(useStore.getState().S, owner, { isTimed: timedAt, switchSec: SWITCH_SIDES_SEC }),
    stop: () => update(s => { if (s.active) s.active.autoHoldsOff = true }),
  }), [])
  const holdDoneRef = useRef(holdDone)
  holdDoneRef.current = holdDone
  useEffect(() => ui.bindWork?.(wk => {
    const owner = { idx: wk.owner.idx, i: wk.owner.i }
    holdAt = { owner, idx: owner.idx, i: owner.i }
    return (...a) => holdDoneRef.current(owner, wk.total)(...a)
  }), [])
  const cheerRecord = (idx, i) => {
    const e = S.active?.entries?.[idx]
    if (!e || !liveRecordsOn(S) || modeAt(idx) !== 'reps') return
    const kinds = entryRecords(e, recordBaseline(sessionHistory(S), e.id, { as: entryDbLoad(e), formula: formulaOf(S) }), formulaOf(S))[i] || []
    if (!kinds.length) return
    vibrate([40, 60, 40, 60, 120])
    if (recordSoundOn(S)) { beep(S.sound, 1320, 0.1, 0.14); beep(S.sound, 1760, 0.22, 0.26) }
    cues.record()
  }
  const toggle = (idx, i, side, { quiet = false, onFocusProgress } = {}) => {
    if (typeof document !== 'undefined') { const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur?.() }
    const m = modeAt(idx)
    let exJustDone = false, workoutDone = false, checked = false
    update(s => {
      const e = s.active.entries[idx]
      if (side) e.sets[i] = toggleSide(e.sets[i], side)
      else e.sets[i].done = !e.sets[i].done
      checked = e.sets[i].done
      if (!editing && (side ? e.sets[i].sides[side].done : checked)) e.sets[i].at = Date.now()
      if (checked && e.sets[i].planSec != null) delete e.sets[i].planSec
      if (e.sets[i].done && !editing) {
        if (isPaused(s.active)) resumeWorkout(s.active)
        if (!quiet) { beep(S.sound, 1040, 0.12); vibrate(30) }
        const ownUnit = unitOf(units, idx)
        const unitDone = ownUnit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (unitDone) workoutDone = !nextUnfinishedUnit(A.entries, supersetUnits(A.entries), idx)
        if (e.sets.every(x => x.done)) { exJustDone = true; e.topW = bestWeightForEntry(e) || null }
      }
    }, true)
    if (editing) return
    if (checked && !quiet) cheerRecord(idx, i)
    if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && m === 'cardio') ui.toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') ui.toast(t('Hold logged'))
    if (side && !checked) {
      const sets = useStore.getState().S.active?.entries[idx]?.sets
      const row = sets?.[i]
      const other = side === 'L' ? 'R' : 'L'
      if (row?.sides?.[side]?.done && !row.sides[other]?.done) {
        const ownSec = ownSetRest(sets[setSpanAt(sets, i)[0]])
        const pause = sideRestFor(useStore.getState().S.active.entries[idx].target, { timed: false, ownSec })
        if (pause > 0) ui.startRest(pause, idx, { kind: 'switch', forSet: i })
      }
    }
    const fresh = useStore.getState().S.active
    if (fresh && checked && fresh.entries[idx]) {
      const progress = setProgressHighWater(fresh.entries[idx], progressHighWater.current[idx] || 0)
      progressHighWater.current[idx] = progress.highWater
      const freshUnits = supersetUnits(fresh.entries)
      const freshUnit = freshUnits.find(u => u.includes(idx))
      const freshUnitDone = freshUnit?.every(ui => fresh.entries[ui].sets.every(x => x.done))
      const nextUnit = freshUnitDone ? nextUnfinishedUnit(fresh.entries, freshUnits, idx) : null
      const freshWorkoutDone = freshUnitDone && !nextUnit
      const setRest = { idx, sec: pyramidRestFor(fresh.entries[idx].target, fresh.entries[idx].sets, i) }
      const restSec = restSecFor(fresh.entries, freshUnit || [idx], S.restSec, setRest)
      const ownRest = ownSetRest(fresh.entries[idx].sets[setSpanAt(fresh.entries[idx].sets, i)[0]])
      let restAfter = ownRest ?? warmupRestSecFor(fresh.entries[idx], i, restSec, S.warmupRestSec)
      if (ownRest == null && freshUnitDone && nextUnit) {
        const into = transitionRestFor(fresh.entries, freshUnit || [idx], S.nextRestSec)
        if (into !== null) restAfter = into
      }
      if (!progress.isNew) {
        const rest = useUI.getState().timer
        if (restOnRecheck({ timerRunning: !!(rest && !rest.ready), unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) ui.startRest(restAfter, idx, { forSet: i, rest: restKindAfter({ row: fresh.entries[idx].sets[i], unitDone: freshUnitDone, superset: (freshUnit?.length || 0) > 1 }) })
        return
      }
      if (collapseOn && freshUnitDone && nextUnit && freshUnit?.includes(fresh.cur)) { revealCur.current = true; focusUnit(nextUnit[0]) }
      const rows = fresh.entries[idx].sets
      const sideOf = r => r && !isWarmupRow(r) ? r.side : null
      const partner = sideOf(rows[i]) === 'L' && sideOf(rows[i + 1]) === 'R' ? rows[i + 1] : sideOf(rows[i]) === 'R' && sideOf(rows[i - 1]) === 'L' ? rows[i - 1] : null
      if (m === 'time' && partner && !partner.done) {
        const pause = sideRestFor(fresh.entries[idx].target, { timed: true, restAfter, switchSec: SWITCH_SIDES_SEC })
        if (pause > 0) { ui.startRest(pause, idx, { kind: 'switch', forSet: i }); return }
        if (fresh.entries[idx].target?.sideRestOff === true) { ui.stopRest(); return }
      }
      if (freshUnitDone) ui.stopRest()
      if (!freshUnit || freshUnit.length <= 1) {
        if (restAfterSet({ unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) ui.startRest(restAfter, idx, { forSet: i, rest: restKindAfter({ row: fresh.entries[idx].sets[i], unitDone: freshUnitDone }) })
        onFocusProgress?.({ unitDone: freshUnitDone })
        return
      }
      const step = supersetFlowStep(fresh.entries, freshUnit, idx)
      if (!step) { onFocusProgress?.({ unitDone: freshUnitDone }); return }
      if (step.unitDone) { if (nextUnit?.length) ui.startRest(restAfter, idx, { forSet: i, rest: 'exercise' }) }
      else { if (step.nextIdx != null) focusUnit(step.nextIdx); if (step.roundDone) ui.startRest(restAfter, idx, { forSet: i, rest: 'superset' }) }
      onFocusProgress?.({ unitDone: freshUnitDone })
    }
  }
  const checkedToggle = (idx, i, side, opts) => {
    const live = useStore.getState().S
    const st = exView(live, live.active?.entries?.[idx]?.id)
    const e = st.active?.entries?.[idx]
    const row = side ? e?.sets?.[i]?.sides?.[side] : e?.sets?.[i]
    if (editing || !row || row.done || modeAt(idx) !== 'reps') return toggle(idx, i, side, opts)
    const last = lastEntryFor(st, e.id, e.rid)
    const odd = oddValues(row, bestsFor(st.workouts, e.id), { unit: st.unit, assisted: isAssisted(e.id), last: lastRowFor(last?.sets, e.sets, i, side) })
    if (!odd.length) return toggle(idx, i, side, opts)
    const kg = v => fmtNum(v) + ' ' + st.unit
    const say = ({ f, typed, ref, low }) => f === 'w' ? (low ? t('Weight: {0} is under a third of last time’s {1}.', kg(typed), kg(ref)) : t('Weight: {0} is more than twice your heaviest, {1}.', kg(typed), kg(ref))) : (low ? t('Reps: {0} is under a third of last time’s {1}.', typed, ref) : t('Reps: {0} is more than twice your most, {1}.', typed, ref))
    confirmSheet({ title: t('Is that right?'), message: odd.map(say).join(' '), confirmText: t('Fix it'), cancelText: t('Log as typed'), onCancel: () => toggle(idx, i, side, opts) })
  }
  const allSetsDone = A.entries.length > 0 && A.entries.every(e => e.sets.length > 0 && e.sets.every(s => s.done))
  let primaryAction = null
  if (!editing && !timerBlocking && A.entries.length) {
    if (allSetsDone) primaryAction = { kind: 'finish', label: t('Finish workout'), onClick: () => finishWorkoutSheet({ onDiscard: discardWorkout }) }
    else {
      let next = null
      for (const idx of unit) {
        const i = A.entries[idx]?.sets.findIndex(s => !s.done) ?? -1
        if (i >= 0) { next = { idx, i, row: A.entries[idx].sets[i] }; break }
      }
      if (next) {
        const timedSet = modeAt(next.idx) === 'time'
        const side = !timedSet && next.row.sides ? (!next.row.sides.L?.done ? 'L' : 'R') : undefined
        primaryAction = { kind: timedSet ? 'start' : 'log', label: (timedSet ? t('Start') : t('Log set')) + ' ' + setNumberAt(A.entries[next.idx].sets, next.i), onClick: () => timedSet ? startTimed(next.idx, next.i) : checkedToggle(next.idx, next.i, side) }
      } else if (nextUnfinishedUnit(A.entries, units, cur)) primaryAction = { kind: 'next', label: t('Next'), onClick: advanceFocusUnit }
    }
  }
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  useEffect(() => bindWatchActions({
    setDone: (idx, i, { w, r, sec, side, at, hr, rpe, rir, restEnd }) => {
      if (useStore.getState().S.active?.editingWorkoutId) return
      const now = useStore.getState().S.active?.entries?.[idx]?.sets?.[i]
      const oneSide = side && isSideSet(now) ? side : null
      const wasDone = oneSide ? now.sides[oneSide].done : now?.done
      const eff = rpe != null ? ['rpe', rpe] : rir != null ? ['rir', rir] : null
      const wid = useStore.getState().S.active?.id
      const restFor = (before, timer) => applyRestStep(useUI, watchTickRest({ before, timer, at, restEnd, restAt: restAtFor(wid) }), { wid, at: at || Date.now() })
      const watchRest = () => { if (restEnd !== undefined) { const tm = useUI.getState().timer; restFor(tm, tm) } }
      if (wasDone && at && setStamp(now) > at) {
        if (hr) mutEntry(idx, en => { if (en.sets[i]) en.sets[i].hr = hr })
        if (eff && !oneSide && now.rpe == null && now.rir == null) mutEntry(idx, en => { if (en.sets[i]) en.sets[i][eff[0]] = eff[1] })
        watchRest(); return
      }
      mutEntry(idx, en => {
        const set = en.sets[i]
        if (!set) return
        if (oneSide) {
          if (w != null) en.sets[i] = setSideField(en.sets[i], oneSide, 'w', w)
          if (r != null) en.sets[i] = setSideField(en.sets[i], oneSide, 'r', r)
          if (eff) en.sets[i] = setSideField(en.sets[i], oneSide, eff[0], eff[1])
          return
        }
        if (w != null) set.w = w
        if (r != null) set.r = r
        if (sec != null) set.sec = sec
        if (eff) { delete set.rpe; delete set.rir; set[eff[0]] = eff[1] }
      })
      if (!wasDone) { const before = useUI.getState().timer; toggleRef.current(idx, i, oneSide || undefined); restFor(before, useUI.getState().timer) } else watchRest()
      if (at || hr) mutEntry(idx, en => { const set = en.sets[i]; if (!(oneSide ? set?.sides?.[oneSide]?.done : set?.done)) return; if (at) set.at = at; if (hr) set.hr = hr })
    },
    finish: opts => { if (!useStore.getState().S.active?.editingWorkoutId) finishWorkoutNow(opts) },
    discard: () => { if (!useStore.getState().S.active?.editingWorkoutId) discardWorkout() },
    idleKept: () => ui.toast(t('Your watch thought this workout was forgotten. It keeps going here.')),
  }), [])
  const liveToggleRef = useRef(toggle)
  liveToggleRef.current = toggle
  const tickRowRef = useRef(null)
  tickRowRef.current = (idx, i, opts) => {
    const row = useStore.getState().S.active?.entries?.[idx]?.sets?.[i]
    const open = row && isSideSet(row) ? ['L', 'R'].filter(k => !row.sides?.[k]?.done) : []
    if (open.length) open.forEach(k => liveToggleRef.current(idx, i, k, opts))
    else liveToggleRef.current(idx, i, null, opts)
  }
  const liveMoreRef = useRef(null)
  liveMoreRef.current = {
    addSet, togglePause,
    finish: () => { if (!useStore.getState().S.active?.editingWorkoutId) finishWorkoutSheet({ onDiscard: discardWorkout }) },
    adjust: (idx, i, field, v) => {
      const e = S.active?.entries?.[idx]
      const row = e?.sets?.[i]
      if (!row || row.done || row.sides) return false
      if (field === 'w') setField(idx, i, 'w', shownWeight(S, e.id, v))
      else if (field === 'r') setField(idx, i, 'r', Math.max(0, Math.round(v)))
      else if (field === 'e') {
        const sc = EFFORT[effortOf(S)]
        if (!sc) return false
        mutEntry(idx, en => { const x = en.sets[i]; if (!x) return; delete x.rir; delete x.rpe; if (v >= 0) x[sc.f] = v })
      } else return false
      return true
    },
  }
  useEffect(() => bindWidgetActions({ setDone: (idx, i, { at }) => { const A = useStore.getState().S.active; if (!A || A.editingWorkoutId || A.entries?.[idx]?.sets?.[i]?.done) return; tickRowRef.current(idx, i, { quiet: true }); if (at) mutEntry(idx, en => { const set = en.sets[i]; if (set?.done) set.at = at }) } }), [])
  useEffect(() => bindLiveActions({
    setDone: (idx, i, { at }) => {
      const A = useStore.getState().S.active
      if (!A || A.editingWorkoutId || A.entries?.[idx]?.sets?.[i]?.done) return
      const restBefore = useUI.getState().timer
      const wk = useUI.getState().work
      if (wk?.owner && wk.owner.idx === idx && wk.owner.i === i && useUI.getState().finishWorkEarly) { useUI.getState().finishWorkEarly(at || Date.now()); return }
      tickRowRef.current(idx, i)
      if (!at) return
      mutEntry(idx, en => { const set = en.sets[i]; if (set?.done) set.at = at })
      const rest = useUI.getState().timer
      const late = Math.floor((Date.now() - at) / 1000)
      if (late > 1 && rest && rest !== restBefore && !rest.ready && !rest.paused) useUI.getState().addRest(-late)
    },
    next: idx => { if (!useStore.getState().S.active?.editingWorkoutId) focusUnit(idx) },
    restSkip: () => (useUI.getState().skipRest || useUI.getState().stopRest)(),
    autoStop: () => useUI.getState().stopAuto?.(), timer: () => useUI.getState().timer,
    restAdd: sec => useUI.getState().addRest(sec), addSet: idx => liveMoreRef.current.addSet(idx),
    pause: on => { if (on !== isPaused(useStore.getState().S.active)) liveMoreRef.current.togglePause() },
    finish: () => liveMoreRef.current.finish(), adjust: (idx, i, field, v) => liveMoreRef.current.adjust(idx, i, field, v),
  }), [])
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
  const scrollToUnit = (el, glide) => {
    if (!el || typeof el.scrollIntoView !== 'function') return
    const hdrH = hdrRef.current?.offsetHeight
    if (hdrH) listRef.current?.style.setProperty('--whdr-h', hdrH + 'px')
    const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView(glide && !still ? { block: 'start', behavior: 'smooth' } : { block: 'start' })
  }
  const pickChip = chip => {
    if (listMode) {
      setVisibleExercise(chip.unit[0])
      if (collapsed.has(chip.key)) setUnitOpen(chip.key, true)
      const go = () => scrollToUnit(listRef.current?.querySelector(`.wl-unit[data-unit-key="${chip.key}"]`), true)
      if (window.requestAnimationFrame) window.requestAnimationFrame(go); else window.setTimeout(go, 0)
      return
    }
    if (chip.unit.includes(cur)) return
    focusUnit(chip.unit[0])
  }
  const sessionMap = wc.muscleMap ? <SessionMapButton entries={A.entries} body={S.body} /> : null
  const chipRow = wc.exerciseChips && A.entries.length > 0 ? <div className="wchips-row"><WorkoutChips entries={A.entries} cur={listMode ? visibleExercise : cur} onPick={pickChip} />{sessionMap}</div> : null
  const tabbed = useRef(false)
  const onKey = useRef(null)
  const showCurrent = () => { if (!listMode) return; const scroll = () => scrollToUnit(listRef.current?.querySelector('.wl-unit.cur')); if (window.requestAnimationFrame) window.requestAnimationFrame(scroll); else window.setTimeout(scroll, 0) }
  const tickNext = () => {
    const work = useUI.getState().work
    if (work) { if (Date.now() - (work.endsAt - work.total * 1000) >= HOLD_KEY_GRACE_MS) useUI.getState().finishWorkEarly(); return true }
    const fresh = useStore.getState().S.active
    const next = nextOpenSet(fresh?.entries, fresh?.cur)
    if (!next) return true
    if (!next.current) { focusUnit(next.idx); showCurrent(); return true }
    if (!next.side && modeAt(next.idx) === 'time') startTimed(next.idx, next.i); else checkedToggle(next.idx, next.i, next.side)
    return true
  }
  onKey.current = event => {
    if (useUI.getState().sheets.length) return false
    const action = workoutKeyAction(event, { tabbed: tabbed.current, rtl: document.documentElement.dir === 'rtl' })
    if (!action) return false
    event.preventDefault()
    if (action !== 'tick') { navigateUnit(action === 'next' ? 1 : -1); showCurrent(); return true }
    return tickNext()
  }
  useEffect(() => {
    let spaceTaken = false
    const down = event => { if (event.key === 'Tab') { tabbed.current = true; return }; const taken = onKey.current?.(event) === true; if (event.key === ' ') spaceTaken = taken }
    const up = event => { if (event.key === ' ' && spaceTaken) { spaceTaken = false; event.preventDefault() } }
    const pointer = () => { tabbed.current = false }
    document.addEventListener('keydown', down); document.addEventListener('keyup', up); document.addEventListener('pointerdown', pointer, true)
    return () => { document.removeEventListener('keydown', down); document.removeEventListener('keyup', up); document.removeEventListener('pointerdown', pointer, true) }
  }, [])
  useEffect(() => {
    if (!useStore.getState().user || editing || useStore.getState().tourSandbox) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = setUnitsTotal(A2.entries)
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active, name: A2.name, exIdx: ui + 1, exTotal: u.length, setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start }) }).catch(() => {})
    }
    let sent = null
    const live = () => { sent = null; ping(true) }
    const leave = reason => { if (sent === 'closed' || sent === reason) return; sent = reason; beacon('/api/activity', { active: false, reason }) }
    const onVisibility = () => { if (document.visibilityState === 'hidden') leave('hidden'); else if (sent && !stopped) live() }
    const onHide = () => leave('closed')
    const onShow = e => { if (e.persisted && sent && !stopped) live() }
    live()
    const iv = setInterval(() => { if (!stopped) live() }, 20000)
    document.addEventListener('visibilitychange', onVisibility); window.addEventListener('pagehide', onHide); window.addEventListener('pageshow', onShow)
    return () => { stopped = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onHide); window.removeEventListener('pageshow', onShow); beacon('/api/activity', { active: false, reason: 'navigated' }); api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false, reason: 'navigated' }) }).catch(() => {}) }
  }, [])
  const setUnitOpen = (key, open) => setOpened(prev => { const next = new Set(prev); if (open) next.add(key); else next.delete(key); return next })
  const bindExRef = (entry, el) => { if (el) exRefs.current.set(entry.id, el); else exRefs.current.delete(entry.id) }
  const bindSetRef = (entry, setIdx, el) => { const key = entry.id + ':' + setIdx; if (el) setRefs.current.set(key, el); else setRefs.current.delete(key) }
  const blockProps = idx => ({
    editing, onToggle: (i, side) => checkedToggle(idx, i, side), onToggleSide: (i, side) => checkedToggle(idx, i, side),
    onField: (i, k, v) => setField(idx, i, k, v), onAddSet: () => addSet(idx), onRemoveSetAt: i => deleteSet(idx, i), onCopySetAt: i => copySet(idx, i),
    onStartTimed: i => startTimed(idx, i), onProgressionSettings: () => openProgressionSettings(idx), onRest: () => openExerciseRest(idx),
    onSwap: () => swapActiveWorkoutExercise(idx), onRemoveExercise: () => confirmRemoveExercise(idx), busy: working,
  })
  const onPairPrev = cur > 0 ? () => pairAt(cur - 1, cur) : null
  const onPairNext = cur < A.entries.length - 1 ? () => pairAt(cur, cur + 1) : null
  return <WorkoutScrollAnchor enabled={collapseOn} collapsed={[...collapsed].join(',')}>
    <div className={'whdr' + (listMode ? ' stick' : '')} ref={hdrRef}>
    <SeasonDeco spot="workout-hdr" workout />
    <div className="hdr whdr-bar">
      {editing ? <button className="iconbtn" aria-label={t('Close editor')} title={t('Close editor')} onClick={() => exitWorkoutEdit()}><Icon name="xmark" /></button> : <button className="iconbtn" aria-label={t('Minimize')} title={t('Minimize')} onClick={() => nav('/home')}><Icon name="chevronDown" /></button>}
      <div className="whdr-mid">
        <h1 className="whdr-screen-title">{t('Workout')}</h1>
        <div className="whdr-name">{A.name}</div>
        <div className="sub">
          {(A.backfill || editing) ? fmtDate(A.d, true) : <>{paused && <span className="whdr-paused">{t('Paused')} </span>}<Elapsed start={A.start} pausedAt={A.pausedAt} /></>}
          · {t('{0} sets', done + '/' + total)} · {t('Auto-save')}
          {!(A.backfill || editing) && isOn(S, 'health') && <LiveHeartRate />}
        </div>
        {gymShown && (gymSwitchable ? <button type="button" className="whdr-gym" onClick={openGymMenu} aria-label={t('Gym: {0}', gymShown)}><Icon name="house" />{gymShown}</button> : <span className="whdr-gym"><Icon name="house" />{gymShown}</span>)}</div>
      {!chipRow && sessionMap}
      <button className="iconbtn whdr-options" data-tour="workout-more" aria-label={t('Workout options')} title={t('Workout options')} onClick={openViewMenu}><Icon name="more" /><span>{t('Workout options')}</span></button>
      <button className="btn ghost pill whdr-finish" data-tour="finish" aria-label={editing ? t('Save changes') : undefined} onClick={() => (editing ? finishWorkout() : finishWorkoutSheet({ onDiscard: discardWorkout }))}>{editing ? t('Save') : t('Finish')}</button>
    </div>
    {weighable ? <div className="wprog-row"><div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div><span className="wvol" data-session-volume>{fmtVol(vol, S.unit)}</span></div> : <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>}
    {listMode && chipRow}
    </div>
    {paused && <div className="wpause" role="status"><span className="wpause-i" aria-hidden="true"><Icon name="pause" /></span><div className="wpause-m"><div className="wpause-t">{t('Workout paused')}</div><div className="small muted">{t('The clock and the rest wait for you.')}</div></div><Button variant="primary" size="sm" icon="play" onClick={togglePause} style={{ width: 'auto', flex: 'none' }}>{t('Resume')}</Button></div>}
    <LiveCard />
    {editing && <p className="muted small">{t('Editing a saved workout. Date and duration stay unchanged.')}</p>}
    {A.backfill && <div className="muted small" style={{ marginBottom: 8 }}>{t('Logging a past workout, so no rest timers.')}</div>}
    {A.entries.length ? (listMode ? (
      <div className="workout-list" data-testid="workout-list" ref={listRef}>
        {units.map((u, ui) => {
          const multi = u.length > 1
          const isCur = u.includes(cur)
          const isCollapsed = collapsed.has(u.join('-'))
          const reopened = collapseOn && !isCur && !isCollapsed && opened.has(u.join('-')) && u.every(idx => A.entries[idx]?.sets.every(s => s.done))
          return <section key={u.join('-')} className={'wl-unit' + (isCur ? ' cur' : '')} data-exidx={u[0]} data-unit-key={u.join('-')}>
            <div className="wl-hd">
              <span className="muted small">{multi ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length)}</span>
              <span className="row" style={{ gap: 6 }}>
                {reopened && <button className="chip" aria-expanded="true" aria-controls={'workout-unit-' + u.join('-')} onClick={() => setUnitOpen(u.join('-'), false)}>{t('Fold away')}</button>}
                {isCur ? <span className="tag acc">{t('Current')}</span> : <button className="chip" onClick={() => focusUnit(u[0])}>{t('Set current')}</button>}
              </span>
            </div>
            <div id={'workout-unit-' + u.join('-')}>
            {!isCollapsed && <CircuitCard unit={u} />}
            {isCollapsed ? <button type="button" className="wl-summary" aria-expanded="false" title={t('Show the sets')} onClick={() => setUnitOpen(u.join('-'), true)}>{u.map(idx => <span key={idx} className="row between" style={{ gap: 8 }}><span className={exerciseNameClass(exOr(A.entries[idx].id))} style={{ fontWeight: 600 }}>{exerciseNameFor(exOr(A.entries[idx].id))}</span><span className="tag acc nocap"><Icon name="check" />{t('{0} sets', A.entries[idx].sets.length)}</span></span>)}</button> : multi ? (
              <div className="ss-card"><div className="ss-hd" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 5 }}><Icon name="link" />{ssTitle(u)}</span><Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(u[0])}>{t('Unpair')}</Button></div>{u.map((idx, k) => { const entry = A.entries[idx]; return <div key={idx} ref={el => bindExRef(entry, el)} className="ss-ex" data-exidx={idx}>{k > 0 && <div className="ss-amp">+</div>}<ExerciseBlock entryIdx={idx} compact dense={dense} onSetRowRef={(setIdx, el) => bindSetRef(entry, setIdx, el)} {...blockProps(idx)} /></div> })}</div>
            ) : <ExerciseBlock entryIdx={u[0]} dense={dense} listed onPairPrev={u[0] > 0 ? () => pairAt(u[0] - 1, u[0]) : null} onPairNext={u[0] < A.entries.length - 1 ? () => pairAt(u[0], u[0] + 1) : null} {...blockProps(u[0])} />}
            </div>
          </section>
        })}
      </div>
    ) : <>
      <div className="wk-position">{isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      {chipRow}
      <CircuitCard unit={unit} />
      <SwipeCards index={unitIdx} count={units.length} revision={A} timerKey={timerKey} workKey={workKey} onNavigate={navigateUnit} renderPreview={direction => {
        const adjacent = units[stepUnitIndex(A.entries, units, unitIdx, direction, skipDone)] || []
        if (!adjacent.length) return null
        return adjacent.length > 1 ? <div className="ss-card"><div className="ss-hd" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 5 }}><Icon name="link" />{ssTitle(adjacent)}</span><Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(adjacent[0])}>{t('Unpair')}</Button></div>{adjacent.map((idx, k) => <div key={idx} className="ss-ex" data-exidx={idx}>{k > 0 && <div className="ss-amp">+</div>}<ExerciseBlock entryIdx={idx} compact {...blockProps(idx)} /></div>)}</div> : <ExerciseBlock entryIdx={adjacent[0]} onPairPrev={adjacent[0] > 0 ? () => pairAt(adjacent[0] - 1, adjacent[0]) : null} onPairNext={adjacent[0] < A.entries.length - 1 ? () => pairAt(adjacent[0], adjacent[0] + 1) : null} {...blockProps(adjacent[0])} />
      }}>
      {focusMode ? <FocusView entryIdx={cur} unit={unit} onSelectEntry={focusUnit} onAdvanceUnit={advanceFocusUnit} pointerEpoch={focusPointerEpoch.current} onPairPrev={onPairPrev} onPairNext={onPairNext} onUnpair={() => unpairAt(cur)} {...blockProps(cur)} /> : isSuperset ? <div className="ss-card"><div className="ss-hd" style={{ justifyContent: 'space-between' }}><span className="row" style={{ gap: 5 }}><Icon name="link" />{ssTitle(unit)}</span><Button size="xs" variant="ghost" icon="link" title={t('Unpair')} onClick={() => unpairAt(cur)}>{t('Unpair')}</Button></div>{unit.map((idx, k) => { const entry = A.entries[idx]; return <div key={idx} ref={el => bindExRef(entry, el)} className="ss-ex" data-exidx={idx}>{k > 0 && <div className="ss-amp">+</div>}<ExerciseBlock entryIdx={idx} compact onSetRowRef={(setIdx, el) => bindSetRef(entry, setIdx, el)} {...blockProps(idx)} /></div> })}</div> : <ExerciseBlock entryIdx={cur} onPairPrev={onPairPrev} onPairNext={onPairNext} {...blockProps(cur)} />}
      </SwipeCards>
    </>) : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout. Add your first exercise and off you go.')}</div>}
    <div style={{ height: 12 }} />
    {!listMode && unitIdx >= 0 && unitIdx < units.length - 1 && (() => {
      const nx = units[unitIdx + 1]
      const n = nx.reduce((a, j) => a + (A.entries[j]?.sets.filter(x => !isWarmupRow(x)).length || 0), 0)
      return <button type="button" className="upnext" onClick={() => navigateUnit(1)}><span className="upnext-m"><span className="upnext-k">{t('Up next')}</span><span className="upnext-t">{nx.map(j => exerciseNameText(exOr(A.entries[j].id))).join(' + ')} · {tn('{0} set', '{0} sets', n)}</span></span><Icon name="chevronRight" className="upnext-c" /></button>
    })()}
    {!listMode && <div className="row"><Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => navigateUnit(-1)}>{t('Prev')}</Button><Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => navigateUnit(1)}>{t('Next')}</Button></div>}
    {!listMode && <div style={{ height: 10 }} />}
    {wc.exerciseButtons && listMode && A.entries.length > 0 && <div className="muted small" style={{ marginBottom: 6 }}>{t('Move, swap and remove below act on the exercise marked {0}.', t('Current'))}</div>}
    <div className="sect-b wk-end">
      <button type="button" className="lrow tap wk-end-row acc" onClick={addExercise}><Icon name="plusCircle" className="wk-end-i" /><span className="lrow-m"><span className="lrow-t">{t('Add exercise')}</span></span></button>
      <button type="button" className={'lrow tap wk-end-row' + (A.note ? ' has-note' : '')} onClick={openSessionNote}><Icon name="note" className="wk-end-i" /><span className="lrow-m"><span className="lrow-t">{A.note ? t('Edit session note') : t('Add session note')}</span>{A.note && <span className="lrow-s wk-end-note">{A.note}</span>}</span><Icon name="chevronRight" className="lrow-c" /></button>
    </div>
    {wc.exerciseButtons && A.entries.length > 0 && <><div style={{ height: 6 }} /><div className="row"><Button size="sm" icon="chevronUp" aria-label={t('Move up')} disabled={working || !canMoveActiveWorkoutUnit(A, cur, -1)} onClick={() => moveCurrentUnit(-1)}>{t('Move up')}</Button><Button size="sm" trailingIcon="chevronDown" aria-label={t('Move down')} disabled={working || !canMoveActiveWorkoutUnit(A, cur, 1)} onClick={() => moveCurrentUnit(1)}>{t('Move down')}</Button></div><div style={{ height: 6 }} /><div style={{ display: 'flex', justifyContent: 'center' }}><Button size="sm" icon="swap" aria-label={t('Swap exercise')} disabled={working} onClick={() => swapActiveWorkoutExercise(cur)}>{t('Swap exercise')}</Button></div><div style={{ height: 6 }} /><div style={{ display: 'flex', justifyContent: 'center' }}><Button size="sm" icon="minus" style={{ color: 'var(--red)' }} disabled={working} onClick={() => confirmRemoveExercise(cur)}>{t('Remove exercise')}</Button></div></>}
    <div style={{ height: 16 }} />
    {(() => { const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length; const allDone = A.entries.length > 0 && exDone === A.entries.length; return (editing || !allDone || !primaryAction) ? <button className={(allDone ? 'btn primary' : 'btn ghost dim') + ' wk-finish'} onClick={() => editing ? finishWorkout() : finishWorkoutSheet({ onDiscard: discardWorkout })}>{editing ? t('Save changes') : allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}</button> : null })()}
    {primaryAction && <div className="wk-primary-dock"><button type="button" className="btn primary wk-primary-action" data-action={primaryAction.kind} onClick={primaryAction.onClick}>{primaryAction.label}</button></div>}
    <div className="workout-end-spacer" />
  </WorkoutScrollAnchor>
}

const circuitAutoOpened = new Set()
export const HINT_DELAY_MS = 600
export const HINT_QUIET_MS = 2500
let lastTouchAt = 0
if (typeof document !== 'undefined') document.addEventListener('pointerdown', () => { lastTouchAt = Date.now() }, true)
export function _resetHintQuiet() { lastTouchAt = 0 }

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
