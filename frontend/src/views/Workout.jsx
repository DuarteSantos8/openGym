import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { api, beacon, clearGymOverride } from '../lib/api'
import { navigate } from '../lib/router'
import { tn, t } from '../lib/i18n'
import { showError, showInfo } from '../lib/app-toast'
import { toKg, convert, convertDb, fmtNum, fmtVol, fmtVolPlain, fmtDate, fmtTime, lbToKg, kgToLb } from '../lib/format'
import { exName, exNameText, exNameClass, exDbLoad, exOr, exerciseSeed, isBodyweight, isAssisted, isCarried, isHidden, isCustom, displayReps, stepsDisplay, loadUnit, usesDb, exView, typeOf, groupOf, musclesOf, setsUnitsFor, noteOf, EX_TYPES } from '../lib/exercises'
import { startRest, stopRest, restSecFor, transitionRestFor, restAfterSet, restOnRecheck, restKindAfter, SWITCH_SIDES_SEC, restWheelValue, REST_MAX } from '../lib/rest'
import { createSideSet, toggleSide, setSideField, isSideSet } from '../lib/side-sets'
import { getConfig, warmupRamp, buildWorkSets, isWarmupRow, warmupSet, setProgressHighWater } from '../lib/sets'
import { showProgression, lastEntryFor, lastRowFor, suggestedWeight, nextPrescription, noteFor, PR, entryRecords, loadFactor, e1rm, formulaOf, formulaUses, estimate1RM, e1rmReps, bestsFor, chainOf, entryIsChain, sameExercise, stripBrands, compareExercises } from '../lib/progression'
import { suggestedHold, MAX_TREND_SETS } from '../lib/holds'
import { sessionHistory, lastSessionOf, pastSessions, historyBefore, workoutSessionIndex } from '../lib/history'
import { gymLabel, routineGymIds, resolveGyms } from '../lib/gyms'
import { makePlan } from '../lib/routine'
import { Card, Button, Icon, Pick, Stepper, Empty, Modal, PRArt, SheetFrame } from '../components/ui'
import { NumberField, RepsInput, WarmupBadge } from '../components/inputs'
import { SessionMapButton, SessionChainCard } from '../components/MuscleMap'
import { ExercisePickerSheet } from '../components/ExercisePicker'
import { swapExerciseSheet, exerciseSettingsSheet, exConfigSheet, workoutSettingsSheet, noteSheet, durationSheet, confirmSheet, finishWorkoutSheet, exerciseNameClass, exerciseNameFor, exerciseNameText } from '../components/sheets'
import { BWV } from '../lib/bodyweight'
import { runWorkoutTour } from '../lib/tour'
import { DumbbellPicker } from '../components/DumbbellPicker'
import { supersetUnits, unitOf, nextUnfinishedUnit, setsDoneActive, totalUnits, supersetFlowStep, canMoveActiveWorkoutUnit, moveActiveWorkoutUnit } from '../lib/supersets'
import { isPaused, canPause, pauseWorkout, resumeWorkout } from '../lib/pause'
import { addRoutineToSessionSheet } from '../lib/session-combine'
import { isGymExercise, gymExercises, isGymExerciseName, gymExerciseMeta, gymMeta, exerciseMeta } from '../lib/exercise-meta'
import { demoMode } from '../lib/demo-data'
import { Workout, SetLog, PersonalRecord, Exercise, PlannedSet, TrackableName, Sides } from '../api/db/models'
import { saveSession, discardSession, sessionEnd, removeActiveExercise, removeActiveSet, copyActiveSet, deleteActiveSet, addActiveSet, markActiveSetsDone } from '../lib/finish-workout'
import { hasWeightInput } from '../lib/weight-input'
import { buildPlannedEntry, nextTargets } from '../lib/planned-workout'
import { isDb, dbLoad, totalLoad, shownWeight, ownExerciseRest, ownSetRest, pyramidRestFor, warmupRestSecFor, sideRestFor } from '../lib/workout-load'
import { renameExercise, mergeExercise } from '../lib/exercise-admin'
import { oddValues } from '../lib/typo-check'
import { sessionNoProg, toggleSessionNoProg, toggleNoProg, setExerciseNoProg, builtOutOfProgression, noProgCounts, exerciseKeptOut, INHERIT, YES, NO, exerciseHistoryName, linkedHistoryIds } from '../lib/no-prog'
import { isOn, workoutConfig, chainRestFor, chainRestAfterSet, chainRestOnRecheck, cardsWrapSetNotes, cardsRememberDisplay, LAYOUT_LABEL, isListLayout, listRemembersUnit } from '../lib/workout-config'
import { WorkoutChips, chipLabel, chipIndex } from '../components/WorkoutChips'
import { FocusView } from '../components/WorkoutFocus'
import { CircuitCard } from '../components/CircuitPlayer'
import { restSnapshot, exerciseRestKey, rememberRest, REST_MEMORY_MAX } from '../lib/rest-memory'
import { trackMistake, trackStart, trackSetting, trackView, workoutIdOf, sessionSnapshot } from '../lib/events'
import { workoutKeyAction, nextOpenSet, stepUnitIndex, skipDoneUnits } from '../lib/workout-keys'
import { HOLD_KEY_GRACE_MS } from '../lib/workout-hold-keys'
import { plannedConfigOf, applyExerciseConfig, removeExercisePrescription } from '../lib/workout-prescription'
import { autoHoldsFor, nextAutoHold, forecastHolds } from '../lib/auto-holds'
import { recordSoundOn, recordVibrateOn } from '../lib/set-records'
import { bindWatchActions } from '../lib/watch-sync'
import { watchTickRest, applyRestStep, restAtFor } from '../lib/watch-rest'
import { bindLiveActions } from '../lib/live-activity'
import { bindWidgetActions } from '../lib/widget-logger'
import { setStamp } from '../lib/set-timestamp'
import { liveRecordsOn } from '../lib/live-records'
import { pickBestExerciseImage, setOriginalExerciseImage, stripOriginalExerciseImage } from '../lib/exercise-image'
import { restAfterAllSets, sessionNoRest, sessionRestSec, setSessionRest } from '../lib/session-rest'
import { swapExercise, replaceActiveExercise } from '../lib/swap-exercise'
import { listRestSkipTarget } from '../lib/list-rest-skip'
import { markExerciseOpened } from '../lib/exercise-opened'
import { readDraft, saveDraft, clearDraft, DRAFT_NAME, DRAFT_NOTE } from '../lib/workout-draft'
import { LocalMedia } from '../components/LocalMedia'
import { addWorkoutToHistory, editWorkoutInHistory } from '../lib/workout-history-write'
import { exitWorkoutEdit, editSession, editHistoryWorkout } from '../lib/workout-edit'
import { syncDraftSettings } from '../lib/workout-settings-sync'
import { doFinishWorkout, finishWorkoutNow, validateWorkoutInput } from '../lib/finish-workout'
import { unlock, beep, stopSounds, vibrate } from '../lib/sound'
import { cues } from '../lib/voice-cues'
import { SeasonDeco, seasonActive } from '../components/Seasonal'
import { savePlacement, repeatLastDay } from '../lib/save-placement'
import { savedFrom, savedAtDay, savedFromRoutine } from '../lib/saved-from'
import { plannedSets } from '../lib/planned-sets'
import { isToday, sameDay, relativeDay } from '../lib/days'
import { LiveHeartRate } from '../components/LiveHeartRate'
import { LiveCard } from '../components/LiveCard'
import { SwipeCards } from '../components/SwipeCards'
import { pauseBarPosition, useViewportScrollRestored, afterScrollRestore } from '../lib/viewport-guard'
import { unitFor, showLb, loadFactorFor, bestWeightForEntry, entryDbLoad } from '../lib/load-display'
import { inEx, nameIn } from '../lib/a11y'
import { unitForExercise, unitLabel } from '../lib/exercise-units'
import { formatRest } from '../lib/rest-label'
import { scrollHeader } from '../lib/scroll-header'
import { startPlannedWorkout, resumeSavedWorkout } from '../lib/start-workout'
import { formatSet, setNumberAt, setSpanAt } from '../lib/set-label'
import { otherDayCount, confirmAnotherDay, confirmFutureDay } from '../lib/other-day'
import { fmtLogDate, fmtLogName, fmtLogSet } from '../lib/fmt-log'
import { listCollapsed, collapseable, collapseDecision } from '../lib/workout-collapse'
import { workoutVideoURL, listWorkoutVideos, removeWorkoutVideo, WORKOUT_VIDEO_MAX_BYTES, WORKOUT_VIDEO_TOO_LARGE, WORKOUT_VIDEO_TYPES, WORKOUT_VIDEO_BAD_TYPE } from '../lib/workout-videos'
import { exerciseGraphSheet, exportWorkoutSheet, removeWorkoutSheet } from './History'
import './Workout.css'

const kgLb = (v, unit) => Math.round(convert(v, 'kg', unit) * 10) / 10
const exIsDb = id => isGymExercise(id) && isDb(gymExerciseMeta(id))

// One picker for the whole workout: Tap to load on a set, the bar-weight stepper in an exercise's
// settings, and Configure all open this same sheet. Its dumbbells/kettlebells/plates tabs and
// favourite pairs live in components/DumbbellPicker.jsx.
export function openDumbbellPicker(idx, opts = {}) {
  const { onDone, ...rest } = opts
  const { S } = useStore.getState()
  const e = S.active?.entries[idx]
  if (!e) return
  const ex = exOr(e.id)
  if (!exIsDb(e.id)) { showError(t('This exercise does not use dumbbells or kettlebells.')); return }
  // Never derive the shown pair from an object another render can replace (#716): the tab, weight
  // and handedness are captured once, and the sheet writes back only to this same set.
  const sets = e.sets
  const first = sets.find(x => !x.done) || sets[0] || {}
  const handed = isSideSet(first) ? 'perHand' : gymExerciseMeta(e.id).hands === 1 ? 'one' : 'pair'
  const w = first.sides?.L?.w ?? first.w ?? 0
  const unit = unitFor(S, e.id)
  const kg = toKg(w, unit)
  useUI.getState().openSheet(close => (
    <DumbbellPicker
      {...rest}
      initialKg={kg} unit={unit} handed={handed}
      settings={S} ex={ex}
      onDone={val => {
        if (onDone) { onDone(val, kg, handed); close?.(); return }
        useStore.getState().update(s => {
          const en = s.active?.entries[idx]
          if (!en) return
          en.sets.forEach(row => { if (!row.done) {
            if (isSideSet(row)) { row.sides.L.w = kgLb(val, unit); row.sides.R.w = kgLb(val, unit) }
            else row.w = kgLb(val, unit)
          } })
        })
        close?.()
      }}
    />
  ), { title: t('Load dumbbells') })
}

// Last performance line, and the progression suggestion underneath it. `live` also reads sets
// already logged in this session, so after a warm-up the suggestion moves off it rather than
// repeating the weight you just did. A prescribed plan never gets overwritten by that last set.
export function LastLine({ exId, sets = [], rid, planned, noProg = false, hideEffort = false, onOpenHistory, target, unit: unitProp, hideHistory = false, onHistory, large = false }) {
  const S = useStore(s => s.S)
  const ex = exOr(exId)
  const mode = typeOf(ex)
  const unit = unitProp || unitFor(S, exId)
  const cfg = getConfig(S, ex)
  const view = exView(S, exId)
  const history = sessionHistory(view)
  const last = lastEntryFor(history, exId, rid)
  const all = pastSessions(history, exId)
  const sid = ex?.kind === 'gym' ? ex.key : exId
  const stem = ex?.kind === 'custom' ? 'custom:' + exId : sid
  const dayLast = S.exerciseDays?.[stem]
  const setDays = last ? S.workouts.filter(w => w.exercises?.some(e => sameExercise(e, last))).map(w => w.d) : []
  const lastDay = last ? (setDays.includes(last.d) ? last.d : setDays[0] || last.d) : null
  const lastTime = lastTimeFor(S, ex, { history, rid })
  const goHistory = () => onOpenHistory ? onOpenHistory(ex, lastTime) : useUI.getState().setExerciseSheet?.(ex, { tab: 'history', session: lastTime || undefined })
  const sugg = noProg ? null : suggestedWeight(ex, S, { rid, sets, planned, target })
  const suggHold = noProg ? null : suggestedHold(ex, S, { rid, planned })
  const db = isDb(ex)
  const body = isBodyweight(ex) && mode !== 'cardio'
  const carried = isCarried(ex)
  const assisted = isAssisted(ex)
  const assistedOut = assisted && ex.assistedDisplay !== 'load'
  const showW = hasWeightInput(ex)
  const perHand = db && gymExerciseMeta(exId).hands === 1
  const count = all.length
  const effScale = hideEffort ? null : (S.effort === 'rir' ? 'rir' : S.effort === 'rpe' ? 'rpe' : null)
  const fmtLastSet = s => formatSet(s, mode, unit, { db, perHand, body, assisted: assistedOut, carried, bw: S.bw, effort: effScale, steps: stepsDisplay(S), translate: t, shortEffort: true })
  // What the exercise would count at if progression were left on: a plan, or the suggestion
  // from last time. Shown next to the switch when it is off, so turning it back on needs no
guessing. Freestyle exercises count only when they opt into a rule of their own (#441): with no
  // rule and no plan the suggestion is the exercise's starting values, not something a routine
  // would move, so there is nothing to show.
  const countsIfOn = noProg ? (suggHold || sugg) : null
  const suggW = sugg?.w != null ? fmtNum(shownWeight(S, exId, sugg.w)) + ' ' + unit : null
  const openCount = () => useUI.getState().openSheet(close => (
    <div>
      <h3>{t('Counted sessions')}</h3>
      <p className="muted small">{t('Every session of {0} in your history.', exerciseNameText(ex))}</p>
      <div className="list" style={{ marginTop: 10 }}>
        {all.map((w, i) => <div key={w.d + '-' + i} className="item" onClick={() => { close?.(); goHistory() }}>
          <div className="grow"><div className="tt">{fmtDate(w.d, true)}</div>
            <div className="sub">{w.sets?.filter(s => s.done).length || 0} {t('sets')}</div></div>
          <Icon name="chevronRight" />
        </div>)}
      </div>
    </div>
  ), { title: t('Counted sessions') })
  return <div className={'lastline' + (large ? ' large' : '')}>
    {!hideHistory && (last
      ? <button type="button" className="lastline-last" onClick={goHistory}>
        <span className="lastline-label">{t('Last')}</span>
        <span className="lastline-body">
          <span className="lastline-when">{lastDay ? relativeDay(lastDay, t) : fmtDate(last.d, true)}</span>
          <span className="lastline-sets">{(last.sets || []).filter(s => !isWarmupRow(s)).map((s, i) => <span key={i}>{fmtLastSet(s)}</span>)}</span>
        </span>
        <Icon name="chevronRight" className="lastline-c" />
      </button>
      : <div className="lastline-last lastline-none"><span className="lastline-label">{t('Last')}</span><span className="muted">{t('First time logging this exercise')}</span></div>)}
    {onHistory && <div className="row" style={{ marginTop: 8 }}>
      <Button size="sm" variant="ghost" icon="history" onClick={onHistory}>{count > 0 ? t('{0} sessions', count) : t('History')}</Button>
    </div>}
    {suggHold ? <div className="sugg">
      <div className="sugg-main"><Icon name="clock" />{t('Try {0}', suggHold.sec + 's')}<span className="sugg-how">{suggHold.how}</span></div>
      <div className="sugg-note">{suggHold.note}</div>
    </div> : null}
    {sugg ? <div className="sugg">
      <div className="sugg-main">
        <Icon name="trendUp" />
        {t('Try {0}', suggW)} · {sugg.r} {t('reps')}
        {sugg.note && <span className="sugg-how">{sugg.note}</span>}
      </div>
      {sugg.pr && <PR pr={sugg.pr} />}
      {mode === 'reps' && showW && !body && !carried && suggW && <div className="row" style={{ marginTop: 8 }}>
        <Button size="sm" icon="check" onClick={() => {
          // The one-tap apply records the suggested weight in this session's display unit. Sets
          // carry the athlete-facing unit; history converts back to kg on save.
          useStore.getState().update(s => {
            const en = s.active?.entries.find(e => e.id === exId)
            if (!en) return
            en.sets.forEach(row => { if (!row.done) {
              if (isSideSet(row)) { row.sides.L.w = suggW; row.sides.R.w = suggW }
              else row.w = sugg.w
            } })
          })
        }}>{t('Apply to remaining sets')}</Button>
      </div>}
    </div> : null}
    {countsIfOn && <div className="muted small" style={{ marginTop: 6 }}>
      {t('Count this exercise again and it targets {0}.', countsIfOn.sec != null
        ? countsIfOn.sec + 's'
        : fmtNum(shownWeight(S, exId, countsIfOn.w)) + ' ' + unit + ' × ' + countsIfOn.r)}
    </div>}
  </div>
}

function lastTimeFor(S, ex, { history = sessionHistory(exView(S, ex?.id)), rid } = {}) {
  if (!ex) return null
  const id = ex.id ?? exOr(ex).id
  const ids = new Set([id, ...linkedHistoryIds(S, ex)])
  for (const w of history) {
    for (const e of w.exercises || []) if (ids.has(e.id) && (!rid || e.rid === rid)) return w
  }
  return null
}

export function PR({ pr }) {
  const isNew = pr === 'new'
  const text = isNew ? t('New PR!') : t('Could beat your PR')
  return <div className="pr" role={isNew ? 'status' : undefined}>
    <PRArt size={isNew ? 40 : 28} className="pr-art" />
    <span className="pr-text">{text}</span>
  </div>
}

// The current routine this session came from, or the exercise's own freestyle rule, drives the
// next-weight suggestion. An exercise linked to several routines still uses the routine of the
// workout being logged, not whichever link happens to be found first.
export function routineForExercise(S, entry) {
  if (entry?.rid) return S.routines.find(r => r.id === entry.rid)
  if (!S.active || !entry) return undefined
  const row = S.active.entries.find(e => e === entry || e.id === entry.id && e.rid === entry.rid)
  return S.routines.find(r => r.id === row?.rid)
}

function fmtReps(r) { return r == null ? '—' : r }
function fmtSec(sec) { return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` }
function fmtRest(sec) { return formatRest(sec, t) }

function Elapsed({ start, pausedAt }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => tick(x => x + 1), 1000)
    return () => clearInterval(iv)
  }, [])
  const end = pausedAt || Date.now()
  const s = Math.max(0, Math.floor((end - start) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return <span>{h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`}</span>
}

export function EffortDots({ row, editing, onPick }) {
  const S = useStore(s => s.S)
  const scale = S.effort === 'rir' ? 'rir' : S.effort === 'rpe' ? 'rpe' : null
  if (!scale) return null
  const field = scale === 'rir' ? 'rir' : 'rpe'
  const value = row[field]
  const open = () => {
    if (!editing) return
    const values = scale === 'rir' ? [0, 1, 2, 3, 4, 5] : [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]
    useUI.getState().openSheet(close => <SheetFrame title={scale === 'rir' ? t('Reps in reserve') : t('Rating of perceived exertion')}>
      <div className="list">
        {values.map(v => <button type="button" key={v} className={'item tap' + (value === v ? ' on' : '')} onClick={() => { onPick(v); close?.() }}>
          <span className="grow">{scale === 'rir' ? t('{0} RIR', v) : t('RPE {0}', v)}</span>
          {value === v && <Icon name="check" />}
        </button>)}
        <button type="button" className="item tap" onClick={() => { onPick(null); close?.() }}>{t('Clear')}</button>
      </div>
    </SheetFrame>, { title: scale === 'rir' ? t('Reps in reserve') : t('Rating of perceived exertion') })
  }
  return <button type="button" className={'effort' + (value != null ? ' on' : '')} onClick={open} disabled={!editing}
    aria-label={scale === 'rir' ? t('Reps in reserve') : t('Rating of perceived exertion')}>
    {value != null ? (scale === 'rir' ? `${value} RIR` : `${value} RPE`) : (scale === 'rir' ? 'RIR' : 'RPE')}
  </button>
}

export function SetRow({ entryIdx, setIdx, row, mode, unit, onToggle, onChange, onDelete, onCopy, onMenu, editing, showWeight = true, lastSet, compact = false, dense = false, onOpenPicker, hideEffort = false, exId, onStartHold, holding = false, holdingSet = false, listMode = false, setLabel, plannedSet = false, nextTarget = false, rowRef, hideReps = false, carried = false }) {
  const S = useStore(s => s.S)
  const [open, setOpen] = useState(false)
  const db = exId ? isDb(exOr(exId)) : false
  const assisted = exId ? isAssisted(exId) : false
  // Assisted is machine assistance unless the exercise explicitly says it is a band.
  const assistedLabel = exId && exOr(exId).assist === 'band' ? t('Band assistance') : t('Assisted')
  const ex = exId ? exOr(exId) : null
  const body = ex ? isBodyweight(ex) && mode !== 'cardio' : false
  const perHand = db && exId && gymExerciseMeta(exId).hands === 1
  const sides = isSideSet(row)
  const sideDone = side => !!row.sides?.[side]?.done
  const field = (k, v) => onChange(k, v)
  const w = row.w ?? ''
  const r = row.r ?? ''
  const done = !!row.done
  const warm = isWarmupRow(row)
  const canCheck = !editing || true
  const weightInput = showWeight && mode !== 'cardio' && !body && !carried
  const openPicker = () => onOpenPicker?.()
  const repField = <NumberField value={r} onChange={v => field('r', v)} min={0} max={999} step={1} disabled={done || editing === false} label={t('Reps')} />
  const secondsField = <NumberField value={row.sec ?? ''} onChange={v => field('sec', v)} min={0} max={36000} step={1} disabled={done || editing === false} label={t('Seconds')} />
  const copy = () => onCopy?.()
  const menu = () => onMenu?.()
  return <div ref={rowRef} className={'setrow' + (done ? ' done' : '') + (warm ? ' warm' : '') + (compact ? ' compact' : '') + (dense ? ' dense' : '') + (holdingSet ? ' holding' : '') + (nextTarget ? ' next-target' : '')} data-setidx={setIdx}>
    <div className="setrow-top">
      <button type="button" className={'setcheck' + (done ? ' on' : '')} onClick={onToggle} aria-label={done ? t('Uncheck set') : t('Log set')} aria-pressed={done}>
        <Icon name={done ? 'check' : 'circle'} />
      </button>
      <div className="setrow-num">
        <span className="setrow-label">{setLabel || t('Set {0}', setIdx + 1)}</span>
        {warm && <WarmupBadge />}
        {plannedSet && !done && <span className="setrow-plan">{t('Plan')}</span>}
      </div>
      <div className="setrow-last">{lastSet ? formatSet(lastSet, mode, unit, { db, perHand, body, assisted, carried, bw: S.bw, effort: hideEffort ? null : S.effort, steps: stepsDisplay(S), translate: t, shortEffort: true }) : <span className="muted">—</span>}</div>
      <button type="button" className="iconbtn setrow-more" aria-label={t('Set options')} title={t('Set options')} onClick={menu}><Icon name="more" /></button>
    </div>
    <div className="setrow-inputs">
      {weightInput && <div className="setrow-field">
        <NumberField value={w} onChange={v => field('w', v)} min={0} max={2000} step={loadFactor(S, exId)} disabled={done || editing === false} label={unit} />
        {db && <button type="button" className="setrow-load" onClick={openPicker}>{t('Tap to load')}</button>}
      </div>}
      {body && showWeight && mode !== 'cardio' && <div className="setrow-field">
        <NumberField value={row.added ?? ''} onChange={v => field('added', v)} min={-500} max={500} step={loadFactor(S, exId)} disabled={done || editing === false} label={assisted ? t('Assist') : t('Added')} />
      </div>}
      {mode === 'time' ? secondsField : !hideReps && repField}
      {mode === 'cardio' && <>
        <NumberField value={row.distance ?? ''} onChange={v => field('distance', v)} min={0} max={10000} step={0.1} disabled={done || editing === false} label={t('Distance')} />
        <NumberField value={row.sec ?? ''} onChange={v => field('sec', v)} min={0} max={36000} step={1} disabled={done || editing === false} label={t('Seconds')} />
      </>}
      {sides && <div className="setrow-sides">
        {['L', 'R'].map(side => <button type="button" key={side} className={'sidecheck' + (sideDone(side) ? ' on' : '')} onClick={() => onToggle(side)} aria-pressed={sideDone(side)}>
          {side === 'L' ? t('Left') : t('Right')}
        </button>)}
      </div>}
      {!hideEffort && <EffortDots row={row} editing={editing !== false} onPick={v => { field(S.effort === 'rir' ? 'rir' : 'rpe', v); field(S.effort === 'rir' ? 'rpe' : 'rir', null) }} />}
      {mode === 'time' && !done && !editing && <button type="button" className="iconbtn setrow-play" onClick={onStartHold} aria-label={holding ? t('Holding') : t('Start')} title={holding ? t('Holding') : t('Start')} disabled={holding}><Icon name="play" /></button>}
    </div>
    {row.note && <div className="setrow-note"><Icon name="note" />{row.note}</div>}
  </div>
}

export function ExerciseBlock({ entryIdx, compact = false, dense = false, listed = false, onPairPrev, onPairNext, onSetRowRef, ...props }) {
  const S = useStore(s => s.S)
  const ui = useUI()
  const A = S.active
  const e = A?.entries?.[entryIdx]
  if (!e) return null
  const ex = exOr(e.id)
  const mode = typeOf(ex)
  const unit = unitFor(S, e.id)
  const sets = e.sets || []
  const history = sessionHistory(exView(S, e.id))
  const last = lastEntryFor(history, e.id, e.rid)
  const lastSets = last?.sets || []
  const cfg = getConfig(S, ex)
  const db = isDb(ex)
  const body = isBodyweight(ex) && mode !== 'cardio'
  const carried = isCarried(ex)
  const assisted = isAssisted(ex)
  const routine = routineForExercise(S, e)
  const noProg = builtOutOfProgression(e, routine)
  const showW = hasWeightInput(ex)
  const chain = entryIsChain(e)
  const openMore = () => props.openMore?.(entryIdx)
  const openSettings = () => props.openSettings?.(entryIdx)
  const openRest = () => props.openRest?.(entryIdx)
  const openHistory = () => props.openHistory?.(entryIdx)
  const openGraph = () => props.openGraph?.(entryIdx)
  const openSwap = () => props.openSwap?.(entryIdx)
  const openNote = () => props.openNote?.(entryIdx)
  const addSet = () => props.addSet?.(entryIdx)
  const onToggle = (setIdx, side) => props.onToggle?.(entryIdx, setIdx, side)
  const onChange = (setIdx, k, v) => props.onChange?.(entryIdx, setIdx, k, v)
  const onDelete = setIdx => props.onDelete?.(entryIdx, setIdx)
  const onCopy = setIdx => props.onCopy?.(entryIdx, setIdx)
  const onMenu = setIdx => props.onSetMenu?.(entryIdx, setIdx)
  const onStartHold = setIdx => props.onStartHold?.(entryIdx, setIdx)
  const holding = props.holding
  const holdOwner = props.holdOwner
  const collapse = listCollapsed(A, entryIdx, props.collapsedUnits)
  const exNameText = exerciseNameText(ex)
  const exClass = exerciseNameClass(ex)
  const name = exerciseNameFor(ex)
  const planned = e.planned
  const targets = nextTargets(S, e, routine)
  const setRows = sets.map((row, i) => {
    const lastSet = lastSets[i] || lastSets[lastSets.length - 1]
    const nextTarget = !row.done && i === sets.findIndex(x => !x.done)
    const setLabel = setNumberAt(sets, i) != null ? t('Set {0}', setNumberAt(sets, i)) : t('Warm-up')
    return <SetRow key={row.id || i} entryIdx={entryIdx} setIdx={i} row={row} mode={mode} unit={unit}
      onToggle={side => onToggle(i, side)} onChange={(k, v) => onChange(i, k, v)}
      onDelete={() => onDelete(i)} onCopy={() => onCopy(i)} onMenu={() => onMenu(i)}
      editing={!A.editingWorkoutId} showWeight={showW} lastSet={lastSet} compact={compact} dense={dense}
      onOpenPicker={() => openDumbbellPicker(entryIdx)} exId={e.id} onStartHold={() => onStartHold(i)}
      holding={holding} holdingSet={holdOwner?.idx === entryIdx && holdOwner?.i === i}
      listMode={listed} setLabel={setLabel} plannedSet={!!planned} nextTarget={nextTarget}
      rowRef={el => onSetRowRef?.(i, el)} carried={carried} />
  })
  return <section className={'wk-ex' + (compact ? ' compact' : '') + (dense ? ' dense' : '') + (listed ? ' listed' : '')} data-exidx={entryIdx}>
    <div className="wk-ex-hd">
      <div className="wk-ex-title">
        <h2 className={exClass}>{name}</h2>
        <div className="wk-ex-sub">{t(EX_TYPES[mode] || mode)}{e.target?.restSec != null && ` · ${t('{0} rest', fmtRest(e.target.restSec))}`}{e.target?.restOff && ` · ${t('No rest timer')}`}</div>
      </div>
      <button type="button" className="iconbtn wk-ex-more" aria-label={inEx(t('More'))} title={t('Exercise options')} onClick={openMore}><Icon name="more" /><span>{t('More')}</span></button>
    </div>
    {e.note && <div className="exnote"><Icon name="note" />{e.note}</div>}
    {!listed && <LastLine exId={e.id} sets={sets} rid={e.rid} planned={planned} noProg={noProg} target={e.target} unit={unit} onOpenHistory={openHistory} />}
    {listed && <div className="wk-ex-last"><LastLine exId={e.id} sets={sets} rid={e.rid} planned={planned} noProg={noProg} target={e.target} unit={unit} onOpenHistory={openHistory} /></div>}
    <div className="wk-ex-sets">{setRows}</div>
    <div className="wk-ex-actions">
      <button type="button" onClick={openNote}><Icon name="note" /><span>{t('Note')}</span></button>
      {db && <button type="button" onClick={() => openDumbbellPicker(entryIdx)}><Icon name="dumbbell" /><span>{t('Plates')}</span></button>}
      <button type="button" onClick={openSwap}><Icon name="swap" /><span>{t('Swap')}</span></button>
      <button type="button" onClick={openMore}><Icon name="more" /><span>{t('More')}</span></button>
    </div>
    <button type="button" className="btn ghost wk-addset" onClick={addSet}><Icon name="plus" />{t('Add set')}</button>
    {(onPairPrev || onPairNext) && <div className="row wk-pair">
      {onPairPrev && <Button size="sm" variant="ghost" icon="link" onClick={onPairPrev}>{t('Pair with previous')}</Button>}
      {onPairNext && <Button size="sm" variant="ghost" icon="link" onClick={onPairNext}>{t('Pair with next')}</Button>}
    </div>}
  </section>
}

function StartChooser() {
  const S = useStore(s => s.S)
  const nav = navigate
  const routines = S.routines || []
  const startFree = () => {
    const st = useStore.getState()
    st.update(s => {
      s.S.active = { id: 'w' + Date.now().toString(36), name: t('Freestyle workout'), start: Date.now(), entries: [], cur: 0 }
    })
  }
  const startRoutine = r => startPlannedWorkout(r)
  return <div className="start-chooser">
    <div className="start-hero">
      <h1>{t('Workout')}</h1>
      <p className="muted">{t('Choose a plan or start freestyle.')}</p>
    </div>
    <button type="button" className="btn primary start-free" onClick={startFree}><Icon name="play" />{t('Start freestyle workout')}</button>
    <div className="sect-h">{t('Your plans')}</div>
    {routines.length ? <div className="list">
      {routines.map(r => <button type="button" className="item tap" key={r.id} onClick={() => startRoutine(r)}>
        <span className="item-ico"><Icon name="clipboard" /></span>
        <span className="grow"><span className="tt">{r.name}</span><span className="sub">{t('{0} exercises', r.exercises?.length || 0)}</span></span>
        <Icon name="chevronRight" />
      </button>)}
    </div> : <Empty icon="clipboard" title={t('No plans yet')} text={t('Create a plan first, or start freestyle.')} />}
    <div className="row" style={{ marginTop: 16 }}>
      <Button variant="ghost" icon="plus" onClick={() => nav('/plan')}>{t('Create plan')}</Button>
    </div>
  </div>
}

function ActiveWorkout() {
  const S = useStore(s => s.S)
  const ui = useUI()
  const A = S.active
  const nav = navigate
  const [menu, setMenu] = useState(null)
  const [setMenu, setSetMenu] = useState(null)
  const [working, setWorking] = useState(false)
  const listRef = useRef(null)
  const hdrRef = useRef(null)
  const collapsed = listCollapsed(A)
  const [opened, setOpened] = useState(() => new Set())
  const [visibleExercise, setVisibleExercise] = useState(A.cur || 0)
  const progressHighWater = useRef({})
  const exRefs = useRef(new Map())
  const setRefs = useRef(new Map())
  const focusPointerEpoch = useRef(0)
  const timerBlocking = useUI(s => !!(s.timer || s.work || s.countIn))
  const timerKey = ui.timer ? `${ui.timer.endsAt}-${ui.timer.total}` : ''
  const workKey = ui.work ? `${ui.work.endsAt}-${ui.work.total}` : ''
  const wc = workoutConfig(S)
  const workoutView = S.workoutView || 'cards'
  const listMode = isListLayout(workoutView)
  const focusMode = workoutView === 'focus'
  const dense = !!wc.dense
  const collapseOn = !!wc.collapseDone
  const skipDone = !!wc.skipDone
  const units = useMemo(() => supersetUnits(A.entries), [A.entries])
  const cur = Math.min(A.cur || 0, Math.max(0, A.entries.length - 1))
  const unitIdx = units.findIndex(u => u.includes(cur))
  const unit = units[unitIdx] || [cur]
  const isSuperset = unit.length > 1
  const done = setsDoneActive(A)
  const total = setUnitsTotal(A.entries)
  const paused = isPaused(A)
  const editing = !!A.editingWorkoutId
  const weighable = A.entries.some(e => hasWeightInput(exOr(e.id)))
  const vol = sessionVolume(A, S)
  const gymIds = routineGymIds(S.routines.find(r => r.id === A.rid))
  const gymNow = resolveGyms(S, A.gymId)
  const gymShown = gymNow ? gymLabel(gymNow) : null
  const gymSwitchable = gymIds.length > 1 || !A.rid
  const noProgSwitchable = A.entries.length > 0
  const update = useStore(s => s.update)
  const mutEntry = (idx, fn) => update(s => { const e = s.active?.entries?.[idx]; if (e) fn(e) }, true)
  const setField = (idx, i, field, v) => mutEntry(idx, e => { if (e.sets[i]) e.sets[i][field] = v })
  const modeAt = idx => typeOf(exOr(A.entries[idx]?.id))
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
  const pairAt = (a, b) => update(s => {
    if (!s.active) return
    const x = s.active.entries[a], y = s.active.entries[b]
    if (!x || !y) return
    const id = x.superset || y.superset || 'ss' + Date.now().toString(36)
    x.superset = id; y.superset = id
  })
  const unpairAt = idx => update(s => { const e = s.active?.entries?.[idx]; if (e) delete e.superset })
  const moveCurrentUnit = dir => update(s => { if (s.active) moveActiveWorkoutUnit(s.active, s.active.cur, dir) })
  const addSet = idx => update(s => { if (s.active) addActiveSet(s.active, idx) })
  const deleteSet = (idx, i) => update(s => { if (s.active) deleteActiveSet(s.active, idx, i) })
  const copySet = (idx, i) => update(s => { if (s.active) copyActiveSet(s.active, idx, i) })
  const markAllDone = () => update(s => { if (s.active) markActiveSetsDone(s.active) })
  const addExercise = () => ExercisePickerSheet({
    onPick: ex => {
      update(s => {
        if (!s.active) return
        const entry = buildPlannedEntry(sessionHistory(s), { id: ex.id, sets: 3, reps: 10 }, null, {})
        s.active.entries.push(entry)
        s.active.cur = s.active.entries.length - 1
      })
    }
  })
  const sessionNoteSheet = () => noteSheet({ title: t('Session note'), value: A.note || '', onDone: v => update(s => { if (s.active) s.active.note = v }) })
  const renameWorkoutSheet = () => noteSheet({ title: t('Rename workout'), value: A.name || '', onDone: v => update(s => { if (s.active && v.trim()) s.active.name = v.trim() }) })
  const togglePause = () => update(s => {
    if (!s.active) return
    if (isPaused(s.active)) resumeWorkout(s.active)
    else pauseWorkout(s.active)
  })
  const discardNow = () => discardSession()
  const discardWorkout = () => confirmSheet({
    title: t('Discard workout?'),
    message: t('This session and its logged sets will be deleted.'),
    confirmText: t('Discard'), danger: true, onConfirm: discardNow,
  })
  const finishWorkout = () => editing ? saveEditedWorkout() : finishWorkoutSheet({ onDiscard: discardWorkout })
  const saveEditedWorkout = async () => {
    setWorking(true)
    try {
      const bad = validateWorkoutInput(A, t)
      if (bad) { showError(bad); return }
      await editWorkoutInHistory(A)
      exitWorkoutEdit()
      showInfo(t('Workout updated'))
    } catch (e) { showError(e?.message || t('Could not save workout')) }
    finally { setWorking(false) }
  }
  const openLayoutMenu = () => menuSheet({
    title: t('Layout'),
    items: Object.entries(LAYOUT_LABEL).map(([key, label]) => ({ icon: 'layout', label: t(label), on: workoutView === key, onClick: () => update(s => { s.S.workoutView = key }) })),
  })
  const openGymMenu = () => menuSheet({
    title: t('Gym'),
    items: [{ icon: 'house', label: t('No gym'), on: !A.gymId, onClick: () => update(s => { if (s.active) delete s.active.gymId }) },
      ...gymIds.map(id => { const g = S.gyms?.find(x => x.id === id); return { icon: 'house', label: g?.name || t('My gym'), on: A.gymId === id, onClick: () => update(s => { if (s.active) s.active.gymId = id }) } })],
  })
  const openViewMenu = () => menuSheet({
    sections: [
      { items: [
        { icon: 'gear', accent: true, chevron: true, label: t('Workout settings'),
          sub: [S.restSec > 0 ? t('{0} rest', fmtRest(S.restSec)) : t('No rest timer'), S.sound ? t('Sound') : t('Silent')].join(' · '),
          onClick: workoutSettingsSheet },
      ] },
      { items: [
        canPause(A) && { icon: paused ? 'play' : 'pause', label: paused ? t('Resume workout') : t('Pause workout'),
          sub: paused ? undefined : t('The clock and the rest wait for you'), onClick: togglePause },
        A.backfill && A.entries.length > 0 && { icon: 'checkCircle', label: t('Mark all sets done'), onClick: markAllDone },
        { icon: 'plusCircle', label: t('Add exercise'), onClick: addExercise },
        { icon: 'note', label: A.note ? t('Edit session note') : t('Add session note'), onClick: sessionNoteSheet },
        { icon: 'layout', label: t('Layout'), sub: LAYOUT_LABEL[workoutView] || LAYOUT_LABEL.cards, onClick: openLayoutMenu },
      ] },
      { more: [{ items: [
        !editing && { icon: 'clipboard', label: t('Add routine'), sub: t('Bring another routine into this session'), onClick: addRoutineToSessionSheet },
        { icon: 'pencil', label: t('Rename workout'), onClick: renameWorkoutSheet },
        gymSwitchable && { icon: 'house', label: t('Gym'), sub: gymNow ? gymLabel(gymNow) : t('Pick a gym'), onClick: openGymMenu },
        noProgSwitchable && { icon: 'chartLineSlash', label: t('Don’t count for progression'), sub: t('Every exercise in this workout'), on: sessionNoProg(A), onClick: toggleSessionNoProg },
      ] }] },
    ],
  })
  const openExerciseRest = idx => {
    const state = useStore.getState().S
    const entry = state.active?.entries?.[idx]
    if (!entry) return
    const activeId = state.active.id
    const entryId = entry.id
    const own = ownExerciseRest(entry.target)
    const setRest = sec => update(s => {
      const e = s.active?.id === activeId ? s.active.entries?.[idx] : null
      if (!e || e.id !== entryId) return
      const { restSec: _sec, restOff: _off, ...target } = e.target || {}
      e.target = sec == null ? target : sec > 0 ? { ...target, restSec: sec } : { ...target, restOff: true }
    })
    menuSheet({
      title: t('Rest for this exercise'),
      items: [
        { icon: 'timer', label: t('Default ({0})', fmtRest(state.restSec)), on: own == null, onClick: () => setRest(null) },
        { icon: 'pause', label: t('No timer'), on: own === 0, onClick: () => setRest(0) },
        { icon: 'clock', label: t('Pick a time'), on: own > 0, onClick: () => durationSheet({
          title: t('Rest for this exercise'), value: restWheelValue(own, state.restSec), max: REST_MAX, off: t('No timer'),
          onDone: v => setRest(v > 0 ? v : 0),
        }) },
      ],
    })
  }
  const openProgressionSettings = idx => {
    const state = useStore.getState().S
    const entry = state.active?.entries?.[idx]
    if (!entry) return
    const activeId = state.active.id
    const entryId = entry.id
    const entryCount = state.active.entries.length
    const routine = state.routines.find(r => r.id === entry.rid)
    const opened = plannedConfigOf(entry)
    exConfigSheet(exOr(entryId), opened, cfg => {
      const current = useStore.getState().S
      if (current.active?.id !== activeId || current.active.entries?.length !== entryCount || current.active.entries?.[idx]?.id !== entryId) return
      update(s => {
        const activeEntry = s.active?.id === activeId ? s.active.entries?.[idx] : null
        if (!activeEntry || activeEntry.id !== entryId) return
        const full = { ...cfg, id: activeEntry.id }
        if ((cfg.weight || 0) === (opened.weight || 0) && activeEntry.planned?.weight != null) full.weight = activeEntry.planned.weight
        const activeRoutine = s.routines.find(r => r.id === activeEntry.rid)
        if (!(full.sets > 0)) full.sets = activeEntry.sets.filter(x => !isWarmupRow(x)).length || 1
        const built = buildPlannedEntry(sessionHistory(s), full, activeRoutine, { noProg: (!activeRoutine && !full.prog) || builtOutOfProgression(activeEntry, activeRoutine) })
        const fresh = built.sets
        const logged = x => x.done || x.sides?.L?.done || x.sides?.R?.done
        const doneWarm = activeEntry.sets.filter(x => logged(x) && isWarmupRow(x))
        const doneWork = activeEntry.sets.filter(x => logged(x) && !isWarmupRow(x))
        const freshWarm = fresh.filter(isWarmupRow)
        const freshWork = fresh.filter(x => !isWarmupRow(x))
        activeEntry.target = built.target
        activeEntry.plan = built.plan
        activeEntry.planned = built.planned
        if (built.carried) activeEntry.carried = true
        else delete activeEntry.carried
        activeEntry.sets = [...doneWarm, ...freshWarm.slice(doneWarm.length), ...doneWork, ...freshWork.slice(doneWork.length)]
      })
    }, null, routine, null, null, undefined, { freestyle: routine ? false : 'edit' })
  }
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
  let holdAt = null
  const startTimed = (idx, i, onFocusProgress, { startedAt = null } = {}) => {
    if (editing) return
    const e = A.entries[idx]
    unlock(S.sound)
    const plan = (!e.sets[i].done && e.sets[i].planSec) || e.sets[i].sec || 45
    const owner = { idx, i }
    const auto = autoHoldsFor(useStore.getState().S, e.target)
    useUI.getState().startWork(plan, exerciseNameText(exOr(e.id)), holdDone(owner, plan, onFocusProgress), { idx, i, id: e.id }, { startedAt, auto })
    holdAt = { owner, idx, i }
  }
  const holdDone = (owner, plan, onFocusProgress) => (elapsed, { abandoned = false, chimed = false, endedAt = null } = {}) => {
    const { idx } = owner
    const mine = holdAt?.owner === owner
    const i = mine ? holdAt.i : owner.i
    if (mine) holdAt = null
    if (abandoned) {
      mutEntry(idx, en => { if (en.sets[i].planSec == null && !en.sets[i].done) en.sets[i].planSec = plan; en.sets[i].sec = elapsed })
      return
    }
    mutEntry(idx, en => { en.sets[i].sec = elapsed; delete en.sets[i].planSec })
    const restBefore = useUI.getState().timer
    if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i, undefined, { quiet: chimed, onFocusProgress })
    const late = endedAt && Date.now() - endedAt > 1000 ? endedAt : null
    if (late) mutEntry(idx, en => { if (en.sets[i]?.done) en.sets[i].at = late })
    const rest = useUI.getState().timer
    if (rest && rest !== restBefore && !rest.ready && !rest.paused) { if (late) useUI.getState().backdateRest?.(late); return }
    useUI.getState().autoAfterHold?.(late || Date.now())
  }
  const timedAt = idx => {
    const live = useStore.getState().S.active
    const en = live?.entries?.[idx]
    return !!en && modeOf({ ...(en.target || {}), id: en.id }) === 'time'
  }
  const autoStartRef = useRef(null)
  autoStartRef.current = (owner, startedAt) => {
    const live = useStore.getState().S.active
    const en = live?.entries?.[owner.idx]
    if (!en || en.id !== owner.id || !en.sets?.[owner.i] || en.sets[owner.i].done || useUI.getState().work) return
    startTimed(owner.idx, owner.i, undefined, { startedAt })
  }
  useEffect(() => useUI.getState().bindAuto?.({
    peek: () => {
      const live = useStore.getState().S
      const next = nextAutoHold(live, timedAt)
      return next && { ...next, label: exerciseNameText(exOr(next.id)) }
    },
    focus: owner => { if (!owner.current) update(s => { if (s.active && s.active.entries?.[owner.idx]?.id === owner.id) s.active.cur = owner.idx }) },
    startHold: (owner, startedAt) => autoStartRef.current?.(owner, startedAt),
    forecast: owner => forecastHolds(useStore.getState().S, owner, { isTimed: timedAt, switchSec: SWITCH_SIDES_SEC }),
    stop: () => update(s => { if (s.active) s.active.autoHoldsOff = true }),
  }), [])
  const holdDoneRef = useRef(holdDone)
  holdDoneRef.current = holdDone
  useEffect(() => {
    useUI.getState().bindWork?.(wk => {
      const owner = { idx: wk.owner.idx, i: wk.owner.i }
      holdAt = { owner, idx: owner.idx, i: owner.i }
      return (...a) => holdDoneRef.current(owner, wk.total)(...a)
    })
  }, [])
  const cheerRecord = (idx, i) => {
    const st = useStore.getState().S
    const e = st.active?.entries?.[idx]
    if (!e || !liveRecordsOn(st) || modeAt(idx) !== 'reps') return
    const formula = formulaOf(st)
    const kinds = entryRecords(e, recordBaseline(sessionHistory(st), e.id, { as: entryDbLoad(e), formula }), formula)[i] || []
    if (!kinds.length) return
    vibrate([40, 60, 40, 60, 120])
    if (recordSoundOn(st)) { beep(st.sound, 1320, 0.1, 0.14); beep(st.sound, 1760, 0.22, 0.26) }
    cues.record()
  }
  const toggle = (idx, i, side, { quiet = false, onFocusProgress } = {}) => {
    if (typeof document !== 'undefined') { const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) a.blur?.() }
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
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
        if (e.sets.every(x => x.done)) {
          exJustDone = true
          e.topW = bestWeightForEntry(e) || null
        }
      }
    }, true)
    if (editing) return
    if (checked && !quiet) cheerRecord(idx, i)
    if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))
    if (side && !checked) {
      const sets = useStore.getState().S.active?.entries[idx]?.sets
      const row = sets?.[i]
      const other = side === 'L' ? 'R' : 'L'
      if (row?.sides?.[side]?.done && !row.sides[other]?.done) {
        const ownSec = ownSetRest(sets[setSpanAt(sets, i)[0]])
        const pause = sideRestFor(useStore.getState().S.active.entries[idx].target, { timed: false, ownSec })
        if (pause > 0) startRest(pause, idx, { kind: 'switch', forSet: i })
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
      let restAfter = ownRest ?? warmupRestSecFor(fresh.entries[idx], i, restSec, useStore.getState().S.warmupRestSec)
      if (ownRest == null && freshUnitDone && nextUnit) {
        const into = transitionRestFor(fresh.entries, freshUnit || [idx], useStore.getState().S.nextRestSec)
        if (into !== null) restAfter = into
      }
      if (!progress.isNew) {
        const rest = useUI.getState().timer
        if (restOnRecheck({ timerRunning: !!(rest && !rest.ready), unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) startRest(restAfter, idx, { forSet: i, rest: restKindAfter({ row: fresh.entries[idx].sets[i], unitDone: freshUnitDone, superset: (freshUnit?.length || 0) > 1 }) })
        return
      }
      if (collapseOn && freshUnitDone && nextUnit && freshUnit?.includes(fresh.cur)) {
        revealCur.current = true
        update(s => { if (s.active) s.active.cur = nextUnit[0] })
      }
      const rows = fresh.entries[idx].sets
      const sideOf = r => r && !isWarmupRow(r) ? r.side : null
      const partner = sideOf(rows[i]) === 'L' && sideOf(rows[i + 1]) === 'R' ? rows[i + 1]
        : sideOf(rows[i]) === 'R' && sideOf(rows[i - 1]) === 'L' ? rows[i - 1] : null
      if (m === 'time' && partner && !partner.done) {
        const pause = sideRestFor(fresh.entries[idx].target, { timed: true, restAfter, switchSec: SWITCH_SIDES_SEC })
        if (pause > 0) { startRest(pause, idx, { kind: 'switch', forSet: i }); return }
        if (fresh.entries[idx].target?.sideRestOff === true) { stopRest(); return }
      }
      if (freshUnitDone) stopRest()
      if (!freshUnit || freshUnit.length <= 1) {
        if (restAfterSet({ unitDone: freshUnitDone, lastUnit: freshWorkoutDone })) startRest(restAfter, idx, { forSet: i, rest: restKindAfter({ row: fresh.entries[idx].sets[i], unitDone: freshUnitDone }) })
        onFocusProgress?.({ unitDone: freshUnitDone })
        return
      }
      const step = supersetFlowStep(fresh.entries, freshUnit, idx)
      if (!step) { onFocusProgress?.({ unitDone: freshUnitDone }); return }
      if (step.unitDone) {
        if (nextUnit?.length) startRest(restAfter, idx, { forSet: i, rest: 'exercise' })
      } else {
        if (step.nextIdx != null) update(s => { if (s.active) s.active.cur = step.nextIdx })
        if (step.roundDone) startRest(restAfter, idx, { forSet: i, rest: 'superset' })
      }
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
    const odd = oddValues(row, bestsFor(st.workouts, e.id), {
      unit: st.unit, assisted: isAssisted(e.id), last: lastRowFor(last?.sets, e.sets, i, side),
    })
    if (!odd.length) return toggle(idx, i, side, opts)
    const kg = v => fmtNum(v) + ' ' + st.unit
    const say = ({ f, typed, ref, low }) => f === 'w'
      ? (low ? t('Weight: {0} is under a third of last time’s {1}.', kg(typed), kg(ref)) : t('Weight: {0} is more than twice your heaviest, {1}.', kg(typed), kg(ref)))
      : (low ? t('Reps: {0} is under a third of last time’s {1}.', typed, ref) : t('Reps: {0} is more than twice your most, {1}.', typed, ref))
    confirmSheet({
      title: t('Is that right?'),
      message: odd.map(say).join(' '),
      confirmText: t('Fix it'),
      cancelText: t('Log as typed'),
      onCancel: () => toggle(idx, i, side, opts),
    })
  }
  const allSetsDone = A.entries.length > 0 && A.entries.every(e => e.sets.length > 0 && e.sets.every(s => s.done))
  let primaryAction = null
  if (!editing && !timerBlocking && A.entries.length) {
    if (allSetsDone) {
      primaryAction = {
        kind: 'finish',
        label: t('Finish workout'),
        onClick: () => finishWorkoutSheet({ onDiscard: discardWorkout })
      }
    } else {
      let next = null
      for (const idx of unit) {
        const i = A.entries[idx]?.sets.findIndex(s => !s.done) ?? -1
        if (i >= 0) {
          next = { idx, i, row: A.entries[idx].sets[i] }
          break
        }
      }
      if (next) {
        const timedSet = modeAt(next.idx) === 'time'
        const side = !timedSet && next.row.sides
          ? (!next.row.sides.L?.done ? 'L' : 'R')
          : undefined
        primaryAction = {
          kind: timedSet ? 'start' : 'log',
          label: (timedSet ? t('Start') : t('Log set')) + ' ' + setNumberAt(A.entries[next.idx].sets, next.i),
          onClick: () => timedSet
            ? startTimed(next.idx, next.i)
            : checkedToggle(next.idx, next.i, side),
        }
      } else if (nextUnfinishedUnit(A.entries, units, cur)) {
        primaryAction = {
          kind: 'next',
          label: t('Next'),
          onClick: advanceFocusUnit
        }
      }
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
        watchRest()
        return
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
      if (!wasDone) {
        const before = useUI.getState().timer
        toggleRef.current(idx, i, oneSide || undefined)
        restFor(before, useUI.getState().timer)
      } else watchRest()
      if (at || hr) mutEntry(idx, en => { const set = en.sets[i]; if (!(oneSide ? set?.sides?.[oneSide]?.done : set?.done)) return; if (at) set.at = at; if (hr) set.hr = hr })
    },
    finish: opts => { if (!useStore.getState().S.active?.editingWorkoutId) finishWorkoutNow(opts) },
    discard: () => { if (!useStore.getState().S.active?.editingWorkoutId) discardNow() },
    idleKept: () => useUI.getState().toast(t('Your watch thought this workout was forgotten. It keeps going here.')),
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
    addSet,
    togglePause,
    finish: () => { if (!useStore.getState().S.active?.editingWorkoutId) finishWorkoutSheet({ onDiscard: discardWorkout }) },
    adjust: (idx, i, field, v) => {
      const st = useStore.getState().S
      const e = st.active?.entries?.[idx]
      const row = e?.sets?.[i]
      if (!row || row.done || row.sides) return false
      if (field === 'w') setField(idx, i, 'w', shownWeight(st, e.id, v))
      else if (field === 'r') setField(idx, i, 'r', Math.max(0, Math.round(v)))
      else if (field === 'e') {
        const sc = EFFORT[effortOf(st)]
        if (!sc) return false
        mutEntry(idx, en => { const x = en.sets[i]; if (!x) return; delete x.rir; delete x.rpe; if (v >= 0) x[sc.f] = v })
      } else return false
      return true
    },
  }
  useEffect(() => bindWidgetActions({
    setDone: (idx, i, { at }) => {
      const A = useStore.getState().S.active
      if (!A || A.editingWorkoutId || A.entries?.[idx]?.sets?.[i]?.done) return
      tickRowRef.current(idx, i, { quiet: true })
      if (at) mutEntry(idx, en => { const set = en.sets[i]; if (set?.done) set.at = at })
    },
  }), [])
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
    next: idx => update(s => { if (s.active && !s.active.editingWorkoutId && s.active.entries?.[idx]) s.active.cur = idx }),
    restSkip: () => (useUI.getState().skipRest || useUI.getState().stopRest)(),
    autoStop: () => useUI.getState().stopAuto?.(),
    timer: () => useUI.getState().timer,
    restAdd: sec => useUI.getState().addRest(sec),
    addSet: idx => liveMoreRef.current.addSet(idx),
    pause: on => { if (on !== isPaused(useStore.getState().S.active)) liveMoreRef.current.togglePause() },
    finish: () => liveMoreRef.current.finish(),
    adjust: (idx, i, field, v) => liveMoreRef.current.adjust(idx, i, field, v),
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
      if (window.requestAnimationFrame) window.requestAnimationFrame(go)
      else window.setTimeout(go, 0)
      return
    }
    if (chip.unit.includes(cur)) return
    update(s => { if (s.active) s.active.cur = chip.unit[0] })
  }
  const sessionMap = wc.muscleMap ? <SessionMapButton entries={A.entries} body={S.body} /> : null
  const chipRow = wc.exerciseChips && A.entries.length > 0
    ? <div className="wchips-row"><WorkoutChips entries={A.entries} cur={listMode ? visibleExercise : cur} onPick={pickChip} />{sessionMap}</div>
    : null
  const tabbed = useRef(false)
  const onKey = useRef(null)
  const showCurrent = () => {
    if (!listMode) return
    const scroll = () => scrollToUnit(listRef.current?.querySelector('.wl-unit.cur'))
    if (window.requestAnimationFrame) window.requestAnimationFrame(scroll)
    else window.setTimeout(scroll, 0)
  }
  const tickNext = () => {
    const work = useUI.getState().work
    if (work) {
      if (Date.now() - (work.endsAt - work.total * 1000) >= HOLD_KEY_GRACE_MS) useUI.getState().finishWorkEarly()
      return true
    }
    const fresh = useStore.getState().S.active
    const next = nextOpenSet(fresh?.entries, fresh?.cur)
    if (!next) return true
    if (!next.current) { focusUnit(next.idx); showCurrent(); return true }
    if (!next.side && modeAt(next.idx) === 'time') startTimed(next.idx, next.i)
    else checkedToggle(next.idx, next.i, next.side)
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
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
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
      beacon('/api/activity', { active: false, reason: 'navigated' })
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false, reason: 'navigated' }) }).catch(() => {})
    }
  }, [])
  const setUnitOpen = (key, open) => setOpened(prev => {
    const next = new Set(prev)
    if (open) next.add(key)
    else next.delete(key)
    return next
  })
  const bindExRef = (entry, el) => { if (el) exRefs.current.set(entry.id, el); else exRefs.current.delete(entry.id) }
  const bindSetRef = (entry, setIdx, el) => {
    const key = entry.id + ':' + setIdx
    if (el) setRefs.current.set(key, el)
    else setRefs.current.delete(key)
  }
  const openHistory = idx => {
    const e = A.entries[idx]
    if (e) useUI.getState().setExerciseSheet?.(exOr(e.id), { tab: 'history' })
  }
  const openGraph = idx => {
    const e = A.entries[idx]
    if (e) exerciseGraphSheet(exOr(e.id))
  }
  const openNote = idx => {
    const e = A.entries[idx]
    if (!e) return
    noteSheet({ title: t('Exercise note'), value: e.note || '', onDone: v => mutEntry(idx, en => { en.note = v }) })
  }
  const openSwap = idx => swapExerciseSheet(exOr(A.entries[idx]?.id), ex => {
    replaceActiveExercise(idx, ex)
  })
  const openSettings = idx => openProgressionSettings(idx)
  const openMore = idx => {
    const e = A.entries[idx]
    if (!e) return
    const ex = exOr(e.id)
    menuSheet({
      title: exerciseNameText(ex),
      sections: [
        { items: [
          { icon: 'history', label: t('History'), onClick: () => openHistory(idx) },
          { icon: 'chartLine', label: t('Progress graph'), onClick: () => openGraph(idx) },
          { icon: 'gear', label: t('Exercise settings'), onClick: () => openSettings(idx) },
          { icon: 'timer', label: t('Rest for this exercise'), onClick: () => openExerciseRest(idx) },
        ] },
        { items: [
          { icon: 'swap', label: t('Swap exercise'), onClick: () => openSwap(idx) },
          { icon: 'note', label: e.note ? t('Edit exercise note') : t('Add exercise note'), onClick: () => openNote(idx) },
          { icon: 'minus', label: t('Remove exercise'), danger: true, onClick: () => confirmRemoveExercise(idx) },
        ] },
      ],
    })
  }
  const openSetMenu = (idx, i) => {
    const e = A.entries[idx]
    const row = e?.sets?.[i]
    if (!row) return
    menuSheet({
      title: t('Set {0}', i + 1),
      items: [
        { icon: 'copy', label: t('Duplicate set'), onClick: () => copySet(idx, i) },
        { icon: 'timer', label: t('Rest after this set'), onClick: () => durationSheet({
          title: t('Rest after this set'), value: ownSetRest(row) ?? S.restSec, max: REST_MAX, off: t('No timer'),
          onDone: v => mutEntry(idx, en => { if (en.sets[i]) { if (v > 0) en.sets[i].restSec = v; else en.sets[i].restOff = true } })
        }) },
        { icon: 'note', label: row.note ? t('Edit set note') : t('Add set note'), onClick: () => noteSheet({ title: t('Set note'), value: row.note || '', onDone: v => mutEntry(idx, en => { if (en.sets[i]) en.sets[i].note = v }) }) },
        { icon: 'trash', label: t('Delete set'), danger: true, onClick: () => deleteSet(idx, i) },
      ],
    })
  }
  const blockProps = idx => ({
    openMore, openSettings, openRest: openExerciseRest, openHistory, openGraph, openSwap, openNote,
    addSet, onToggle: checkedToggle, onChange: setField, onDelete: deleteSet, onCopy: copySet, onSetMenu: openSetMenu,
    onStartHold: startTimed, holding: !!ui.work, holdOwner: ui.work?.owner, collapsedUnits: collapsed,
  })
  const onPairPrev = cur > 0 ? () => pairAt(cur - 1, cur) : null
  const onPairNext = cur < A.entries.length - 1 ? () => pairAt(cur, cur + 1) : null
  return <WorkoutScrollAnchor enabled={collapseOn} collapsed={[...collapsed].join(',')}>
    <div className={'whdr' + (listMode ? ' stick' : '')} ref={hdrRef}>
    <SeasonDeco spot="workout-hdr" workout />
    <div className="hdr whdr-bar">
      {editing
        ? <button className="iconbtn" aria-label={t('Close editor')} title={t('Close editor')} onClick={() => exitWorkoutEdit()}><Icon name="xmark" /></button>
        : <button className="iconbtn" aria-label={t('Minimize')} title={t('Minimize')} onClick={() => nav('/home')}><Icon name="chevronDown" /></button>}
      <div className="whdr-mid">
        <h1 className="whdr-screen-title">{t('Workout')}</h1>
        <div className="whdr-name">{A.name}</div>
        <div className="sub">
          {(A.backfill || editing) ? fmtDate(A.d, true) : <>{paused && <span className="whdr-paused">{t('Paused')} </span>}<Elapsed start={A.start} pausedAt={A.pausedAt} /></>}
          · {t('{0} sets', done + '/' + total)} · {t('Auto-save')}
          {!(A.backfill || editing) && isOn(S, 'health') && <LiveHeartRate />}
        </div>
        {gymShown && (gymSwitchable
        ? <button type="button" className="whdr-gym" onClick={openGymMenu} aria-label={t('Gym: {0}', gymShown)}><Icon name="house" />{gymShown}</button>
        : <span className="whdr-gym"><Icon name="house" />{gymShown}</span>)}</div>
      {!chipRow && sessionMap}
      <button className="iconbtn whdr-options" data-tour="workout-more" aria-label={t('Workout options')} title={t('Workout options')} onClick={openViewMenu}>
        <Icon name="more" /><span>{t('Workout options')}</span>
      </button>
      <button className="btn ghost pill whdr-finish" data-tour="finish" aria-label={editing ? t('Save changes') : undefined}
        onClick={() => (editing ? finishWorkout() : finishWorkoutSheet({ onDiscard: discardWorkout }))}>{editing ? t('Save') : t('Finish')}</button>
    </div>
    {weighable
      ? <div className="wprog-row"><div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>
        <span className="wvol" data-session-volume>{fmtVol(vol, S.unit)}</span></div>
      : <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>}
    {listMode && chipRow}
    </div>
    {paused && <div className="wpause" role="status">
      <span className="wpause-i" aria-hidden="true"><Icon name="pause" /></span>
      <div className="wpause-m"><div className="wpause-t">{t('Workout paused')}</div>
        <div className="small muted">{t('The clock and the rest wait for you.')}</div></div>
      <Button variant="primary" size="sm" icon="play" onClick={togglePause} style={{ width: 'auto', flex: 'none' }}>{t('Resume')}</Button>
    </div>}
    <LiveCard />
    {editing && <p className="muted small">{t('Editing a saved workout. Date and duration stay unchanged.')}</p>}
    {A.backfill && <div className="muted small" style={{ marginBottom: 8 }}>{t('Logging a past workout, so no rest timers.')}</div>}
    {sessionPin && <div className="exnote gym-pin wk-gym-pin" role="note"><Icon name="mapPin" style={{ fontSize: 'var(--fs-footnote)', marginInlineEnd: 5, verticalAlign: '-2px' }} />
      <b>{sessionPin.gym.name || t('My gym')}:</b> {sessionPin.text}</div>}
    {A.entries.length ? (listMode ? (
      <div className="workout-list" data-testid="workout-list" ref={listRef}>
        {units.map((u, ui) => {
          const multi = u.length > 1
          const isCur = u.includes(cur)
          const isCollapsed = collapsed.has(u.join('-'))
          const reopened = collapseOn && !isCur && !isCollapsed && opened.has(u.join('-')) && finished(u)
          return <section key={u.join('-')} className={'wl-unit' + (isCur ? ' cur' : '')} data-exidx={u[0]} data-unit-key={u.join('-')}>
            <div className="wl-hd">
              <span className="muted small">{multi ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length)}</span>
              <span className="row" style={{ gap: 6 }}>
                {reopened && <button className="chip" aria-expanded="true" aria-controls={'workout-unit-' + u.join('-')}
                  aria-label={nameIn(multi ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length), t('Fold away'))}
                  onClick={() => setUnitOpen(u.join('-'), false)}>{t('Fold away')}</button>}
                {isCur
                  ? <span className="tag acc">{t('Current')}</span>
                  : <button className="chip" aria-label={nameIn(multi ? t('Superset {0} / {1}', ui + 1, units.length) : t('Exercise {0} / {1}', ui + 1, units.length), t('Set current'))}
                    onClick={() => focusUnit(u[0])}>{t('Set current')}</button>}
              </span>
            </div>
            <div id={'workout-unit-' + u.join('-')}>
            {!isCollapsed && <CircuitCard unit={u} />}
            {isCollapsed ? <button type="button" className="wl-summary" aria-expanded="false" title={t('Show the sets')}
              onClick={() => setUnitOpen(u.join('-'), true)}>
              {u.map(idx => <span key={idx} className="row between" style={{ gap: 8 }}>
                <span className={exerciseNameClass(exOr(A.entries[idx].id))} style={{ fontWeight: 600 }}>{exerciseNameFor(exOr(A.entries[idx].id))}</span>
                <span className="tag acc nocap"><Icon name="check" />{t('{0} sets', A.entries[idx].sets.length)}</span>
              </span>)}
            </button> : multi ? (
              <div className="ss-card">
                <div className="ss-hd" style={{ justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 5 }}><Icon name="link" />{ssTitle(u)}</span>
                  <Button size="xs" variant="ghost" icon="link" title={t('Unpair')} aria-label={nameIn(t('Superset {0} / {1}', ui + 1, units.length), t('Unpair'))} onClick={() => unpairAt(u[0])}>{t('Unpair')}</Button>
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
              <ExerciseBlock entryIdx={u[0]} dense={dense} listed
                onPairPrev={u[0] > 0 ? () => pairAt(u[0] - 1, u[0]) : null}
                onPairNext={u[0] < A.entries.length - 1 ? () => pairAt(u[0], u[0] + 1) : null}
                {...blockProps(u[0])} />
            )}
            </div>
          </section>
        })}
      </div>
    ) : <>
      <div className="wk-position">
        {isSuperset
          ? t('Superset {0} / {1}', unitIdx + 1, units.length)
          : t('Exercise {0} / {1}', unitIdx + 1, units.length)}
      </div>
      {chipRow}
      <CircuitCard unit={unit} />
      <SwipeCards index={unitIdx} count={units.length} revision={A}
        timerKey={timerKey} workKey={workKey}
        onNavigate={navigateUnit} renderPreview={direction => {
          const adjacent = units[stepUnitIndex(A.entries, units, unitIdx, direction, skipDone)] || []
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
    {!listMode && unitIdx >= 0 && unitIdx < units.length - 1 && (() => {
      const nx = units[unitIdx + 1]
      const n = nx.reduce((a, j) => a + (A.entries[j]?.sets.filter(x => !isWarmupRow(x)).length || 0), 0)
      return <button type="button" className="upnext" onClick={() => navigateUnit(1)}>
        <span className="upnext-m"><span className="upnext-k">{t('Up next')}</span>
          <span className="upnext-t">{nx.map(j => exerciseNameText(exOr(A.entries[j].id))).join(' + ')} · {tn('{0} set', '{0} sets', n)}</span></span>
        <Icon name="chevronRight" className="upnext-c" />
      </button>
    })()}
    {!listMode && <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => navigateUnit(-1)}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => navigateUnit(1)}>{t('Next')}</Button>
    </div>}
    {!listMode && <div style={{ height: 10 }} />}
    {wc.exerciseButtons && listMode && A.entries.length > 0 && <div className="muted small" style={{ marginBottom: 6 }}>{t('Move, swap and remove below act on the exercise marked {0}.', t('Current'))}</div>}
    <div className="sect-b wk-end">
      <button type="button" className="lrow tap wk-end-row acc" onClick={addExercise}>
        <Icon name="plusCircle" className="wk-end-i" />
        <span className="lrow-m"><span className="lrow-t">{t('Add exercise')}</span></span>
      </button>
      <button type="button" className={'lrow tap wk-end-row' + (A.note ? ' has-note' : '')} onClick={sessionNoteSheet}>
        <Icon name="note" className="wk-end-i" />
        <span className="lrow-m">
          <span className="lrow-t">{A.note ? t('Edit session note') : t('Add session note')}</span>
          {A.note && <span className="lrow-s wk-end-note">{A.note}</span>}
        </span>
        <Icon name="chevronRight" className="lrow-c" />
      </button>
    </div>
    {wc.exerciseButtons && A.entries.length > 0 && <>
      <div style={{ height: 6 }} />
      <div className="row">
        <Button size="sm" icon="chevronUp" aria-label={t('Move up')}
          disabled={working || !canMoveActiveWorkoutUnit(A, cur, -1)} onClick={() => moveCurrentUnit(-1)}>{t('Move up')}</Button>
        <Button size="sm" trailingIcon="chevronDown" aria-label={t('Move down')}
          disabled={working || !canMoveActiveWorkoutUnit(A, cur, 1)} onClick={() => moveCurrentUnit(1)}>{t('Move down')}</Button>
      </div>
      <div style={{ height: 6 }} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Button size="sm" icon="swap" aria-label={t('Swap exercise')} disabled={working}
          onClick={() => swapExercise(cur)}>{t('Swap exercise')}</Button>
      </div>
      <div style={{ height: 6 }} />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Button size="sm" icon="minus" style={{ color: 'var(--red)' }} disabled={working} onClick={removeExerciseSheet}>{t('Remove exercise')}</Button>
      </div>
    </>}
    <div style={{ height: 16 }} />
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return (editing || !allDone || !primaryAction)
        ? <button className={(allDone ? 'btn primary' : 'btn ghost dim') + ' wk-finish'} onClick={finishWorkout}>
          {editing ? t('Save changes') : allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
        </button>
        : null
    })()}
    {primaryAction && <div className="wk-primary-dock">
      <button
        type="button"
        className="btn primary wk-primary-action"
        data-action={primaryAction.kind}
        onClick={primaryAction.onClick}>
        {primaryAction.label}
      </button>
    </div>}
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
