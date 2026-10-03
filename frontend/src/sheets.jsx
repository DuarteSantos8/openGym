import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB, EXIDX, BODYPARTS, isCardio, isBodyweightEq, allExercises, equipmentOf, smOf, searchExercises, exOr, isAssisted, betterWeight, beatsWeight } from './lib/exercises.js'
import { activeProfile, exAvailable, ALL_EQUIPMENT, newProfile } from './lib/equipment.js'
import { fmtDate, fmtNum, capWords, fmtVol, fmtDur, durPart, todayISO, isoOf, uid, exCount, routineCount, DAYN, DAYS, weekOrder, weekStartOf, weekDayOffset, MONTHS_LONG, ACCENTS, weightDecimals, fmtDateRange, fmtPlate, exerciseNameText, setsWorkCount } from './lib/format.js'
import { lastEntryFor, bestWeightFor, bestWeightForEntry, effectiveRoutineIds, workoutVolume, setsDone, setsDoneActive, setUnitsTotal, lastBW, supersetUnits, unitOf, setLabel, defaultConfig, cleanupSg, modeOf, effortOf, EFFORT, capEffort, stepEffort, isBw, isPerSide, sideReps, workSetsDone, NOTE_MAX, volumeOf, workoutDay, sessionSections, MAX_PLANNED_WARMUPS } from './lib/history.js'
import { usesBar, defaultBarWeight, hasBarOverride, isNoBar } from './lib/bar.js'
import { PLATE_SIZES, pairsOf, ownsPlates, withPlatePairs, withStandardPlates, withLoadKind, loadKindFor, baseWeightFor, dropGrid } from './lib/plates.js'
import { toScale, rirOf, EFFORT_PRESETS, effortColor } from './lib/effort.js'
import { beep, vibrate } from './lib/sound.js'
import { t, dateLocale, instrFor, exerciseNameFor, exerciseNameClass, getLang, INSTR_LANGS } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { buildStarterPlan, starterPlanDays, starterPlanOptions } from './lib/starter.js'
import Media, { Thumb } from './components/Media.jsx'
import CustomMediaField from './components/CustomMediaField.jsx'
import WorkoutMediaSection, { workoutMediaCount } from './components/WorkoutMedia.jsx'
import { mediaOf, normalizeMediaRef, cleanUrl, workoutMediaOf } from './lib/media-refs.js'
import { syncMedia } from './lib/media-sync.js'
import LineChart from './components/LineChart.jsx'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import { Button, Slider, Switch, Segmented, SelectRow, Row, TextField, NumberField, MultiSelectRow } from './components/ui.jsx'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from './lib/glyphs.js'
import BodyMap from './components/BodyMap.jsx'
import MuscleExplorer from './components/MuscleExplorer.jsx'
import { exerciseMuscleSnapshot, loadOfWorkouts, MUSCLES, MUSCLE_NAME, normalizeMuscleGroups, hasExplicitMuscleMetadata, inMuscleOrder } from './lib/muscles.js'
import { parseImport, mergeImport } from './lib/import-csv.js'
import { importHevyData, HevyApiError, HEVY_DEV_SETTINGS, mergeHevyRoutines } from './lib/import-hevy.js'
import { buildPlanBundle, parsePlan, mergePlan, printPlan, planPrintHTML } from './lib/plan-share.js'
import { estimate1RM, best1RM, is1RMRecord, REP_CAP } from './lib/onerm.js'
import { exerciseHistory } from './lib/exercise-history.js'
import { normalizeRepRange } from './lib/rep-range.js'
import { MOBILE, shareExport, printHtml } from './lib/mobile.js'
import { buildCompletedSession, recordsOf, workLoadOf } from './lib/finish-session.js'
import { speedUnitOf, toSpeed, fromSpeed } from './lib/speed.js'
import { isWarmupRow, hasCompletedWork } from './lib/workout-model.js'
import { saveSessionAsRoutine } from './lib/session-routines.js'
import { sessionNoProg } from './lib/session-noprog.js'
import { nextUnfinishedUnit } from './lib/supersetFlow.js'
import { swapActiveExercise } from './lib/active-exercise-swap.js'
import { useSheetKeyboard, useRevealActiveChip, tappable } from './lib/use-sheet-keyboard.js'
import { isFav, toggleFav, sortFavouritesFirst } from './lib/favourites.js'
import { buildSessionExposures, missingOneRms, occurrenceFor } from './lib/session-start.js'
import { buildCombinedExposures, deriveSessionName } from './lib/session-merge.js'
import { entriesForExposures, planSummary } from './lib/session-ui-adapter.js'
import { reconcileSessionHistory, editCompletedSession, editChangesNothing, editLeftEmpty, editedRecord } from './lib/session-edit.js'
import { workoutsOn, backfillStart, backfillEnd, completeBackfill, historyAsOf, sessionHistory } from './lib/backfill.js'
import { legacyEntriesOf, appendOneRm, canonicalJSON, cardioParameters, defaultPlanRule, planWarmupRows, supports, validatePlanRule, validateWarmup, warmupMaxCount, warmupSteps } from './lib/prescription/index.js'
import RuleEditor, { Disclosure, PRESET_LABEL } from './components/RuleEditor.jsx'
import { auditFields, badgeFor } from './views/history-outcome.js'
import { findingText } from './lib/progression-copy.js'
import { moveWorkout, sameWorkout, startTimeOf, durationMinOf, setWorkoutDuration, rebuildPrHistory } from './lib/workout-date.js'
import { stampWorkout } from './lib/sync-merge.js'
import { weeklyWeights } from './lib/bodyweight.js'
import { workoutText } from './lib/workout-text.js'
import { copyText } from './lib/clipboard.js'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const updateActive = (...a) => useStore.getState().updateActive(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, onCancel, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); onCancel && onCancel() }}>{cancelText || t('Cancel')}</Button>
  </div>
}
// "1 workouts and 1 weigh-ins" read wrong: a count of one takes the singular, per noun. Four
// whole sentences rather than two spliced counts, so every language keeps its own word order.
export function addDeviceDataMessage(workouts, weighIns) {
  const one = n => Number(n) === 1
  return one(workouts)
    ? one(weighIns)
      ? t('{0} workout and {1} weigh-in were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
      : t('{0} workout and {1} weigh-ins were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
    : one(weighIns)
      ? t('{0} workouts and {1} weigh-in were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
      : t('{0} workouts and {1} weigh-ins were logged on this device while signed out. Add them to your profile, or keep the profile exactly as it is on the server.', workouts, weighIns)
}
// Sign-in found workouts on this device that the profile does not have (logged while signed
// out). The profile is the truth — settings and plan come from the server either way — the
// question is only whether these entries are added to it or dropped. Resolves true to add.
export function askAddDeviceData(extras) {
  return new Promise(resolve => confirmSheet({
    title: t('Add this device\'s workouts to your profile?'),
    message: addDeviceDataMessage(extras.workouts, extras.bodyweight),
    confirmText: t('Add them'), cancelText: t('Keep profile as is'),
    onConfirm: () => resolve(true), onCancel: () => resolve(false), locked: true
  }))
}
/* ============================ menu sheet ============================ */
// A list of actions, one per row, closing on tap. This is where the workout screen parks
// everything that is not a set you are about to log: the point of a single "more" button is
// that the ten things you do once a session stop competing with the two you do every set.
// items: [{ icon, label, sub, onClick, danger, disabled, on }] — `on` draws a check for toggles.
// A title is shown as written: most are sentences ("Convert to lb?", "Set 2"), which a default
// title-casing turned into "Convert To Lb?". An exercise name passes exerciseNameClass as
// titleClass, which title-cases the lower-case packs and leaves a cased one alone.
function MenuSheet({ title, titleClass = '', subtitle, items, close }) {
  return <>
    {title && <h3 className={titleClass || undefined} style={{ marginBottom: subtitle ? 2 : 10 }}>{title}</h3>}
    {subtitle && <div className="muted small" style={{ marginBottom: 10 }}>{subtitle}</div>}
    <div className="list menu-list">
      {items.filter(Boolean).map((it, i) => <div key={i}
        className={'item menu-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '')}
        aria-disabled={it.disabled || undefined}
        {...tappable(it.disabled ? null : () => { close(); it.onClick && it.onClick() })}>
        {it.icon && <span className="lrow-i"><Icon name={it.icon} /></span>}
        <div className="grow"><div className="tt">{it.label}</div>{it.sub && <div className="ss">{it.sub}</div>}</div>
        {it.on != null && <span className={'menu-on' + (it.on ? ' is-on' : '')}><Icon name="check" /></span>}
      </div>)}
    </div>
  </>
}
export function menuSheet(opts) {
  ui().openSheet(close => <MenuSheet {...opts} close={close} />)
}

// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center', ...(opts.locked ? { locked: true } : {}) })
}

/* ============================ starter plan ============================ */
// Plan names and blurbs live here, not in lib/starter.js: check-source-strings.mjs only finds
// string literals written inside a t() call, so copy parked in the catalog and passed in as a
// variable is invisible to it — it would quietly stay English in every language.
const PLAN_COPY = {
  ppl: () => ({ name: t('Push / Pull / Legs'), about: t('Push, pull and legs each get their own day.') }),
  'upper-lower': () => ({ name: t('Upper / Lower'), about: t('Upper body twice, lower body twice.') }),
  'full-body': () => ({ name: t('Full Body'), about: t('Three sessions, the whole body each time.') }),
  '5x5': () => ({ name: t('5×5'), about: t('Five sets of five on the main barbell lifts.') })
}

// Adds the plan's routines and puts them on its weekdays. Existing routines are never touched
// and only the weekdays the plan asks for are reassigned; an id with no plan behind it changes
// nothing at all. planId is deliberately required — a default invites `onClick={loadStarterPlan}`,
// which hands the click event in as the plan and silently loads nothing.
export function loadStarterPlan(planId) {
  const plan = buildStarterPlan(planId, S().unit)
  if (!plan) return false
  update(st => {
    st.routines.push(...plan.routines)
    plan.schedule.forEach(({ day, routineId }) => { st.week[day] = [routineId] })
  })
  toast(t('{0} loaded', PLAN_COPY[planId]().name))
  return true
}

// Intl joins the days the way each language does it — "and" vs "und", "、" in Chinese.
const dayList = days => new Intl.ListFormat(dateLocale()).format(days.map(d => t(DAYN[d])))

function StarterPlanChooser({ close }) {
  const week = useStore(s => s.S.week)
  const routines = useStore(s => s.S.routines)
  const choose = (id, name) => {
    const days = starterPlanDays(id)
    close()
    // A confirmation is only worth showing when one of those days is actually occupied — by a
    // routine that still exists, not by a stale id the Plan already shows as "Rest".
    const taken = day => [].concat(week[day] || []).some(id => routines.some(r => r.id === id))
    if (!days.some(taken)) { loadStarterPlan(id); return }
    confirmSheet({
      title: t('Load {0}?', name),
      message: t('The new plan will be scheduled on {0}. Existing routines are kept — only those days of the weekly plan change.', dayList(days)),
      confirmText: t('Load plan'),
      onConfirm: () => loadStarterPlan(id)
    })
  }
  return <>
    <h3>{t('Choose starter plan')}</h3>
    <div className="list">
      {starterPlanOptions().map(({ id, days }) => {
        const { name, about } = PLAN_COPY[id]()
        return <div key={id} className="item" {...tappable(() => choose(id, name))}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
          <div className="grow"><div className="tt">{name}</div><div className="ss">{t('{0} days per week', days)} · {about}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}
    </div>
  </>
}

export const starterPlanSheet = () => ui().openSheet(close => <StarterPlanChooser close={close} />)

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons, and typing straight into the read-out, cover
// exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  const onType = v => setValue(v)

  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label={t('Decrease by {0}', fmtNum(0.1))}><Icon name="minus" /></button>
      <label className="bw-read">
        <NumberField fit value={value} onChange={onType} aria-label={t('Weight ({0})', unit)} enterKeyHint="done"
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <span className="u"> {unit}</span>
      </label>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label={t('Increase by {0}', fmtNum(0.1))}><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, close }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState(bw ? bw.w : 70)
  const save = () => {
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  return <>
    {/* This sheet opens `locked` — swipe/backdrop/Escape/Android-back all no-op on it (see
        Modals.jsx) so an accidental tap on "Start" can't be walked back by reflex the way
        every other sheet in the app can. The two buttons below already cover leaving it
        deliberately; this is the same close a normal sheet gets everywhere else, just
        opted back in explicitly instead of by omission. Plain close() — no onDone, no
        nav — so it's a true no-op: the screen underneath is exactly where you left it. */}
    {required
      ? <div className="row between" style={{ marginBottom: 14 }}>
          <h3 style={{ marginBottom: 0 }}>{t('Quick check-in')}</h3>
          <button className="iconbtn" aria-label={t('Cancel')} onClick={() => close()}><Icon name="xmark" /></button>
        </div>
      : <h3>{t('Log body weight')}</h3>}
    <div className="muted small">{required ? t('Slide or tap to set your weight — tracked before every workout so your curve stays honest.') : t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { close(); onDone && onDone(null) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="reset" onClick={() => { close(); nav('/workout') }}>{t('Choose a different workout')}</Button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <WeighInRow key={b.d} b={b} unit={unit} />)}
      </div>
      {st.bodyweight.length > recent.length && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
      </div>}
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: !!opts.required })
  return h
}

// One weigh-in with its delete button, in the log sheet's recent three and in the full list.
// The full list asks first (`confirm`): it is months of history scrolled through on a phone, and a
// stray tap on one of its trash buttons took a past weigh-in with nothing to bring it back. The log
// sheet's three are the ones just typed, where taking back a typo in one tap is the point.
function WeighInRow({ b, unit, confirm = false }) {
  const delEntry = () => update(s => { s.bodyweight = s.bodyweight.filter(x => x.d !== b.d) })
  const ask = () => confirmSheet({
    title: t('Delete weigh-in?'), message: `${fmtDate(b.d, true)} · ${fmtNum(b.w)} ${unit}`,
    confirmText: t('Delete'), danger: true, onConfirm: delEntry,
  })
  return <div className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
    <span className="small muted">{fmtDate(b.d, true)}</span>
    <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={confirm ? ask : delEntry} aria-label={t('Delete weigh-in')}><Icon name="trash" /></button></span>
  </div>
}

/* ============================ weigh-ins ============================ */
// Every weigh-in, week by week (Discord 'Weight'): each week under its mean and how far that
// moved from the week before, the numbers behind the curve on the card. The chart plots the
// weekly means, since the swing from one morning to the next is what makes a single weigh-in
// hard to read. The weeks start on the profile's first day of the week.
function WeighIns() {
  const st = useStore(s => s.S)
  const ws = weekStartOf(st)
  const weeks = useMemo(() => weeklyWeights(st.bodyweight, ws), [st.bodyweight, ws])
  const points = useMemo(() => [...weeks].reverse()
    .map(w => ({ t: new Date(w.key + 'T12:00:00').getTime(), y: Math.round(w.avg * 100) / 100, d: w.key })), [weeks])
  const n = weeks.reduce((sum, w) => sum + w.n, 0)
  if (!n) return <>
    <h3>{t('Weigh-ins')}</h3>
    <div className="empty"><div className="ico"><Icon name="scale" /></div>{t('No entries yet — log your weight to start the curve.')}</div>
  </>
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Weigh-ins')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t(n === 1 ? '{0} weigh-in' : '{0} weigh-ins', n)}</div>
    <div className="chart"><LineChart points={points} h={140} unit={st.unit} goal={st.targetW} /></div>
    <div className="small dim" style={{ marginTop: 6 }}>{t('Weekly average')}</div>
    {weeks.map(w => {
      // Only a change the display can show: at one decimal, 0.02 kg is "0", and an arrow over a
      // zero says something moved when, as far as the screen goes, nothing did.
      const moved = w.delta != null && fmtNum(Math.abs(w.delta)) !== fmtNum(0)
      return <div key={w.key} data-week={w.key}>
        <div className="row between" style={{ margin: '16px 2px 4px', gap: 8 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t('Week of {0}', fmtDate(w.key))}</span>
          <span className="small row" style={{ gap: 8 }}>
            {moved && <span className="row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(w.delta, w.avg) }}>
              <Icon name={w.delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />{fmtNum(Math.abs(w.delta))}
            </span>}
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>{t('Average {0}', fmtNum(w.avg) + ' ' + st.unit)}</span>
          </span>
        </div>
        <div className="list" style={{ gap: 0 }}>{w.entries.map(b => <WeighInRow key={b.d} b={b} unit={st.unit} confirm />)}</div>
      </div>
    })}
  </>
}
export const weighInsSheet = () => ui().openSheet(close => <WeighIns close={close} />)

/* ============================ import from another app ============================ */
// Shows what a parsed export would actually do before anything is written. An import is
// the one action where "just try it" is expensive — it's someone's entire training
// history — so the numbers, the unit conversion and the exercises we couldn't recognise
// are all on screen before the confirm button.
function ImportSummary({ parsed, close }) {
  const st = useStore(s => s.S)
  const isBW = parsed.kind === 'bodyweight'
  const have = isBW
    ? parsed.bodyweight.filter(b => st.bodyweight.some(x => x.d === b.d)).length
    : parsed.workouts.filter(w => st.workouts.some(x => x.d === w.d)).length
  const fresh = (isBW ? parsed.bodyweight.length : parsed.workouts.length) - have

  const doImport = () => {
    let res
    update(s => { res = mergeImport(s, parsed) })
    close()
    toast(isBW
      ? t('{0} weigh-ins imported', res.added)
      : t('{0} workouts imported', res.added))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import history')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {fmtDateRange(parsed.from, parsed.to, true)}
    </div>

    <div className="tiles" style={{ textAlign: 'start' }}>
      {isBW ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : <>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.sets}</div></div>
        <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.matched}</div></div>
        <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.created}</div></div>
      </>}
    </div>

    {parsed.mixedUnits ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file mixes kg and lb — each set is converted to {0}.', st.unit)}
    </div> : parsed.converted ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1} — weights will be converted.', parsed.fileUnit, st.unit)}
    </div> : null}
    {!isBW && !parsed.fileUnit && !parsed.mixedUnits && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('The file does not say which unit it uses — numbers are imported as they are.')}
    </div>}
    {have > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    {/* The file rated its sets. Say so: the column is off by default, so the ratings would
        otherwise arrive invisibly and look like they had been dropped. */}
    {!isBW && (parsed.rirSets + parsed.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t(effortOf(st) === 'none'
        ? '{0} sets bring an {1} with them — switch on Effort per set in Settings to see it.'
        : '{0} sets bring an {1} with them.',
      parsed.rirSets || parsed.rpeSets, parsed.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {!isBW && parsed.unmatchedNames.length > 0 && <>
      <h4 className="sec">{t('Not in the library — added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {parsed.unmatchedNames.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {parsed.unmatchedNames.length > 12 && <span className="mchip">+{parsed.unmatchedNames.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Read a CSV/XML export, then show what it would do. */
export function importFromApp(file, onDone) {
  const rd = new FileReader()
  rd.onload = () => {
    let parsed
    try { parsed = parseImport(String(rd.result), { unit: S().unit }) }
    catch (e) { toast(t('Could not read that file')); return }
    if (parsed.error === 'empty') { toast(t('That file is empty')); return }
    if (parsed.error) { toast(t("That file's columns aren't recognised — see the docs for supported apps.")); return }
    if (parsed.kind === 'bodyweight' ? !parsed.bodyweight.length : !parsed.workouts.length) {
      toast(t('Nothing to import from that file')); return
    }
    ui().openSheet(close => <ImportSummary parsed={parsed} close={close} />)
    onDone && onDone()
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsText(file)
}

/* ============================ import from Hevy API ============================ */
// The key lives in React state for this sheet only — dismissed with the sheet, never
// written to the store / localStorage / the server. After a successful fetch the user
// picks workouts and/or weigh-ins before anything is merged.

export function importFromHevy() {
  ui().openSheet(close => <HevyImportSheet close={close} />)
}

function hevyProgressLabel(p) {
  if (!p) return t('Fetching from Hevy…')
  if (p.stage === 'templates') return t('Fetching exercises… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'workouts') return t('Fetching workouts… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'routines') return t('Fetching routines… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'body') return t('Fetching weigh-ins… ({0}/{1})', p.page, p.pageCount)
  if (p.stage === 'parse') return t('Matching exercises…')
  return t('Fetching from Hevy…')
}

function HevyImportSheet({ close }) {
  const st = useStore(s => s.S)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [payload, setPayload] = useState(null) // { workouts, routines, bodyweight }
  const [wantWorkouts, setWantWorkouts] = useState(true)
  const [wantRoutines, setWantRoutines] = useState(true)
  const [wantBody, setWantBody] = useState(true)
  const keyRef = useRef(null)

  // Drop the key from memory when the sheet goes away (unmount or successful import).
  useEffect(() => () => { setApiKey('') }, [])

  const wipeKey = () => { setApiKey(''); if (keyRef.current) keyRef.current.value = '' }

  const fetchAccount = async () => {
    const key = apiKey.trim()
    if (!key) { toast(t('Paste your Hevy API key first')); return }
    setBusy(true)
    setProgress({ stage: 'templates', page: 1, pageCount: 1 })
    setPayload(null)
    try {
      const data = await importHevyData(key, { unit: st.unit, onProgress: setProgress })
      wipeKey()
      const empty = !data.workouts.workouts.length && !data.routines.routines.length && !data.bodyweight.bodyweight.length
      if (empty) {
        toast(t('Nothing to import from Hevy'))
        return
      }
      setWantWorkouts(!!data.workouts.workouts.length)
      setWantRoutines(!!data.routines.routines.length)
      setWantBody(!!data.bodyweight.bodyweight.length)
      setPayload(data)
    } catch (e) {
      if (e instanceof HevyApiError && e.message === 'auth') toast(t('That Hevy API key was refused'))
      else if (e instanceof HevyApiError && e.message === 'rate-limit') toast(t('Hevy is rate-limiting requests — wait a minute and try again'))
      else if (e instanceof HevyApiError && e.message === 'empty') toast(t('Paste your Hevy API key first'))
      else toast(t('Could not reach Hevy — check the key and try again'))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const doImport = () => {
    if (!payload) return
    const parts = []
    let addedW = 0, addedR = 0, addedB = 0
    update(s => {
      if (wantWorkouts && payload.workouts.workouts.length) {
        const res = mergeImport(s, payload.workouts)
        addedW = res.added
        parts.push(t('{0} workouts imported', res.added))
      }
      if (wantRoutines && payload.routines.routines.length) {
        const res = mergeHevyRoutines(s, payload.routines)
        addedR = res.added
        parts.push(t('{0} routines imported', res.added))
      }
      if (wantBody && payload.bodyweight.bodyweight.length) {
        const res = mergeImport(s, payload.bodyweight)
        addedB = res.added
        parts.push(t('{0} weigh-ins imported', res.added))
      }
    })
    close()
    if (!addedW && !addedR && !addedB) toast(t('Nothing new to import'))
    else toast(parts.join(' · '))
  }

  if (!payload) {
    return <>
      <h3>{t('Import from Hevy')}</h3>
      <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
        {t('Pull your history with a Hevy Pro API key. The key is only used for this import and is not saved.')}
      </div>
      <label className="small dim" style={{ display: 'block', marginBottom: 6 }}>{t('Hevy API key')}</label>
      <TextField
        ref={keyRef}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        value={apiKey}
        disabled={busy}
        onChange={e => setApiKey(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !busy) fetchAccount() }}
      />
      <div className="small" style={{ margin: '10px 0 16px', lineHeight: 1.45 }}>
        <a href={HEVY_DEV_SETTINGS} target="_blank" rel="noopener noreferrer">{t('Get your API key')}</a>
        <span className="dim"> — {t('Hevy → Settings → Developer')}</span>
      </div>
      {busy && <div className="small dim" style={{ marginBottom: 12 }}>{hevyProgressLabel(progress)}</div>}
      <Button variant="primary" onClick={fetchAccount} disabled={busy || !apiKey.trim()}>
        {busy ? t('Fetching from Hevy…') : t('Fetch from Hevy')}
      </Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close} disabled={busy}>{t('Cancel')}</Button>
    </>
  }

  const w = payload.workouts
  const r = payload.routines
  const b = payload.bodyweight
  const haveW = w.workouts.filter(x => st.workouts.some(y => y.d === x.d)).length
  const freshW = w.workouts.length - haveW
  const haveB = b.bodyweight.filter(x => st.bodyweight.some(y => y.d === x.d)).length
  const freshB = b.bodyweight.length - haveB
  // Routines are always added as new copies (same as plan import).
  const freshR = r.routines.length
  const canImport = (wantWorkouts && freshW > 0) || (wantRoutines && freshR > 0) || (wantBody && freshB > 0)
  const unmatched = [...new Set([
    ...(wantWorkouts ? w.unmatchedNames : []),
    ...(wantRoutines ? r.unmatchedNames : []),
  ])].sort()

  return <>
    <h3>{t('Import from Hevy')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {w.from && (w.from === w.to ? fmtDate(w.from, true) : fmtDate(w.from, true) + ' – ' + fmtDate(w.to, true))}
      {!w.from && b.from && (b.from === b.to ? fmtDate(b.from, true) : fmtDate(b.from, true) + ' – ' + fmtDate(b.to, true))}
    </div>

    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{w.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{r.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{w.matched + r.matched}</div></div>
      <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{w.created + r.created}</div></div>
    </div>

    {w.workouts.length > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', gap: 12 }}>
      <div>
        <div className="tt" style={{ fontSize: 15 }}>{t('Import workouts')}</div>
        <div className="small dim">{t('{0} new · {1} days already here', freshW, haveW)}</div>
      </div>
      <Switch checked={wantWorkouts} onChange={setWantWorkouts} />
    </div>}
    {r.routines.length > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', gap: 12 }}>
      <div>
        <div className="tt" style={{ fontSize: 15 }}>{t('Import routines')}</div>
        <div className="small dim">{t('{0} routines · {1} exercises — added as new plans', freshR, r.exerciseCount)}</div>
      </div>
      <Switch checked={wantRoutines} onChange={setWantRoutines} />
    </div>}
    {b.bodyweight.length > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', gap: 12, marginBottom: 8 }}>
      <div>
        <div className="tt" style={{ fontSize: 15 }}>{t('Import weigh-ins')}</div>
        <div className="small dim">{t('{0} new · {1} days already here', freshB, haveB)}</div>
      </div>
      <Switch checked={wantBody} onChange={setWantBody} />
    </div>}
    {!b.bodyweight.length && <div style={{ borderBottom: '1px solid var(--sep)', marginBottom: 8 }} />}

    {(w.converted || r.converted) && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('Hevy stores weights in kg — they will be converted to {0}.', st.unit)}
    </div>}
    {wantWorkouts && (w.rirSets + w.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t(effortOf(st) === 'none'
        ? '{0} sets bring an {1} with them — switch on Effort per set in Settings to see it.'
        : '{0} sets bring an {1} with them.',
      w.rirSets || w.rpeSets, w.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {unmatched.length > 0 && <>
      <h4 className="sec">{t('Not in the library — added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {unmatched.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {unmatched.length > 12 && <span className="mchip">+{unmatched.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!canImport}>
      {canImport ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { setPayload(null); wipeKey() }}>{t('Back')}</Button>
  </>
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ plate loading ============================ */
// One editor for every place an exercise's loading shows up (exercise detail, exercise config,
// mid-workout sheet). Three things, all per exercise and display-only (lib/plates.js):
//   • how the weight is loaded — per side of a bar, one stack, or not plate-loaded at all
//     (S.loadKind; absent = derived from the equipment, so most exercises never store it);
//   • the base weight before any plate goes on — the bar (S.barWeights, profile unit, lib/bar.js;
//     stepping down to 0 clears the override and falls back to the bar type's default), or a
//     sled's / machine's own weight for anything else;
//   • "No bar" for a bar exercise: an explicit 0 (issue #138 — a counterbalanced Smith machine),
//     so the whole total is plates. Distinct from the stepper's 0, which means "default".
// `cfg` is the routine/session config the caller has (its `bodyweight` flag turns a dumbbell
// exercise into "added weight", i.e. a single stack) — the default kind is derived from the
// same thing the workout screen derives it from, so what the editor shows as chosen is what
// the rows do. Without one, the equipment alone decides.
const LOAD_KIND_LABEL = { pairs: () => t('Per side'), single: () => t('Single stack'), none: () => t('Off') }
function BarWeightEditor({ ex, cfg, extra }) {
  const st = useStore(s => s.S)
  const bar = usesBar(ex)
  const ctx = { ...(cfg || {}), id: ex.id }
  const kind = loadKindFor(st, ctx)
  const explicit = hasBarOverride(st, ex.id)
  const noBar = bar && isNoBar(st, ex.id)
  const def = defaultBarWeight(ex.eq, st.unit)
  const base = baseWeightFor(st, ex)
  // Picking what the equipment already implies puts the exercise back on it (a stamped null,
  // lib/plates.js), so a later change of the equipment's own default still reaches it.
  const setKind = k => update(s => {
    s.loadKind = withLoadKind(s.loadKind, ex.id, k === loadKindFor(null, ctx) ? null : k)
  })
  const setBar = v => update(s => {
    s.barWeights = s.barWeights || {}
    const n = Math.max(0, Math.round((v || 0) * 100) / 100)
    if (n > 0) s.barWeights[ex.id] = n; else delete s.barWeights[ex.id]
  })
  // "No bar" is a stored 0, which is a different thing from no entry at all: a counterbalanced
  // Smith carriage weighs nothing in your hands, so the plate math and the drop-set steps must
  // start from what you logged (issue #138). Clearing it goes back to the bar type's default.
  const setNoBar = on => update(s => {
    s.barWeights = s.barWeights || {}
    if (on) s.barWeights[ex.id] = 0; else delete s.barWeights[ex.id]
  })
  return <>
    <Segmented className="seg-inline" value={kind} onChange={setKind}
      options={[{ value: 'pairs', label: t('Per side') }, { value: 'single', label: t('Single stack') }, { value: 'none', label: t('Off') }]} />
    <div className="small dim" style={{ margin: '8px 0 12px' }}>
      {kind === 'pairs' ? t('Plates split over both sides of a bar.')
        : kind === 'single' ? t('One stack — a belt, a landmine, a plate-loaded machine, a sled.')
          : t('No plate line under the sets.')}
    </div>
    {kind !== 'none' && <>
      {bar && <div className="list menu-list" style={{ marginBottom: 6 }}>
        <Row icon="barbell" title={t('No bar')} subtitle={t('The weight you log is all plates.')}>
          <Switch checked={noBar} onChange={setNoBar} />
        </Row>
      </div>}
      {!noBar && <div className="row cfgrow" style={{ marginBottom: 6 }}>
        <Stepper label={bar ? t('Bar ({0})', st.unit) : t('Base weight ({0})', st.unit)} value={base} step={2.5} onChange={setBar} />
      </div>}
      <div className="small dim" style={{ marginBottom: 18 }}>
        {noBar ? t('Plates are counted from 0 — turn this off for the default ({0}).', fmtNum(def) + ' ' + st.unit)
          : bar ? (explicit ? t('Set to 0 to go back to the default ({0}).', fmtNum(def) + ' ' + st.unit) : t('Default for this bar type.'))
            : t('The machine or sled itself, before any plate goes on. 0 if it is all plates.')}
        {extra ? ' ' + extra : ''}
      </div>
    </>}
  </>
}

// Mid-workout sheet behind the ⋯ menu's "Plate loading" — same values, same editor.
function BarWeightSheet({ exId, cfg, close }) {
  const ex = exOr(exId)
  return <>
    <h3>{t('Plate loading')}</h3>
    <div className={`muted small ${exerciseNameClass(ex)}`} style={{ marginBottom: 12 }}>{exerciseNameFor(ex)}</div>
    <BarWeightEditor ex={ex} cfg={cfg} extra={t('Applies to this exercise everywhere, not just this plan.')} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const barWeightSheet = (exId, cfg) => ui().openSheet(close => <BarWeightSheet exId={exId} cfg={cfg} close={close} />)

// The plates you own, as pairs per size, for the profile's unit (Settings → Equipment → Plates).
// The first edit copies the standard set into S.plates[unit] and changes one count in it, so the
// list you see is always the list the set rows load from. "Back to the standard set" empties the
// unit's list again. Both are stamped (lib/plates.js), so the last change wins a sync.
function PlateInventorySheet({ close }) {
  const st = useStore(s => s.S)
  const unit = st.unit === 'lb' ? 'lb' : 'kg'
  const own = ownsPlates(st)
  const setPairs = (w, n) => update(s => { s.plates = withPlatePairs(s, w, n) })
  const reset = () => update(s => { s.plates = withStandardPlates(s) })
  return <>
    <h3>{t('Plates')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Pairs of each size you own. Every set row loads from this list, so a home gym with one pair of 45s is never told to use two.')}
    </div>
    {PLATE_SIZES[unit].map(w => (
      <div className="row cfgrow" key={w} style={{ marginBottom: 6 }}>
        <Stepper label={fmtPlate(w) + ' ' + unit} value={pairsOf(st, w)} step={1} decimal={false} unit={t('pairs')} onChange={n => setPairs(w, n)} />
      </div>
    ))}
    <div className="small dim" style={{ margin: '4px 0 14px' }}>
      {own ? t('Your own list for {0}.', unit) : t('The standard set, plenty of each — change any count to make it yours.')}
    </div>
    {own && <Button onClick={reset} style={{ marginBottom: 8 }}>{t('Back to the standard set')}</Button>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const plateInventorySheet = () => ui().openSheet(close => <PlateInventorySheet close={close} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const [w, setW] = useState(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r)
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '—' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps — beyond that an estimate is guesswork.', REP_CAP)
      : t('Epley formula — a calculation from one set, not a tested max.')}</div>
  </>
}

function ExerciseDetail({ ex, close }) {
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id)
  const fav = isFav(st, ex.id)
  const flipFav = () => {
    let on = false
    update(s => { on = toggleFav(s, ex.id) })
    toast(on ? t('Added to favourites') : t('Removed from favourites'))
  }
  return <>
    <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
      <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
      <button className={'iconbtn fav-btn' + (fav ? ' on' : '')} aria-pressed={fav}
        aria-label={fav ? t('Remove from favourites') : t('Add to favourites')} onClick={flipFav}>
        <Icon name={fav ? 'starFill' : 'star'} />
      </button>
    </div>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      <span className="tag acc">{t(ex.bp)}</span>
      {ex.bp === 'cardio' ? <span className="tag"><Icon name="target" />{t(MUSCLE_NAME['cardiovascular system'])}</span> : (ex.primaries?.length ? ex.primaries : (ex.tg ? [ex.tg] : [])).map((s, i) => <span key={i} className="tag"><Icon name="target" />{t(MUSCLE_NAME[s]  || s)}</span>)}
      <span className="tag"><Icon name="dumbbell" />{t(ex.eq)}</span>
      {(ex.secondaries?.length ? ex.secondaries : smOf(ex)).slice(0, 3).map((s, i) => <span key={i} className="tag">{t(MUSCLE_NAME[s] || s)}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent" style={{ whiteSpace: 'nowrap' }}>{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target, speedUnitOf(st))).join(', ')}` : ''}</div>}
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>
    {last && <Button icon="history" style={{ marginTop: 4 }} onClick={() => exerciseHistorySheet(ex.id)}>{t('History')}</Button>}
    {ex.custom && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div>}
    {modeOf({ id: ex.id }) === 'reps' && <>
      <h4 className="sec">{t('Plate loading')}</h4>
      <BarWeightEditor ex={ex} extra={t('You still log the total weight — this only feeds the plate line under each set.')} />
    </>}
    {/* No one-rep max on an assistance machine: the load is the help you were given, so the
        calculator would answer "your 1RM is 23 kg" about a number that gets smaller as you get
        stronger (issue #232). Cardio has none for the same kind of reason. */}
    {!isCardio(ex) && !isAssisted(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{!INSTR_LANGS.includes(getLang()) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
export const exerciseDetailSheet = ex => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} />)

/* ============================ exercise history ============================ */
// What you did on this exercise before, reachable mid-workout (issue #43): the curve first,
// then the last sessions set by set, so the question "what did I do last month" is answered
// without leaving the workout for Stats. Derived once per log change — the sheet re-renders on
// every store tick while a session runs, and LineChart drops its hover whenever `points`
// changes identity, so a series rebuilt per render would lose the tooltip under your finger.
function ExerciseHistory({ exId }) {
  const st = useStore(s => s.S)
  const ex = exOr(exId)
  const h = useMemo(() => exerciseHistory(st, exId), [st.workouts, exId])
  const [curve, setCurve] = useState('top')
  const onE1 = curve === 'e1rm' && h.e1rmPoints.length > 0
  const unit = h.metric === 'weight' ? st.unit : h.metric === 'reps' ? t('reps') : h.metric === 'sec' ? 's' : t('min')
  const e1Best = useMemo(() => Math.max(0, ...h.e1rmPoints.map(p => p.y)), [h])
  if (!h.total) return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No sessions logged yet')}</div>
  </>
  const tail = s => [
    s.volume > 0 && t('Volume') + ' ' + fmtVol(s.volume, st.unit),
    s.e1rm != null && t('Est. 1RM') + ' ' + fmtNum(s.e1rm) + ' ' + st.unit,
  ].filter(Boolean).join(' · ')
  return <>
    <h3 className={exerciseNameClass(ex)} style={{ marginBottom: 2 }}>{exerciseNameFor(ex)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Exercise history')} · {t(h.total === 1 ? '{0} session' : '{0} sessions', h.total)}</div>
    {/* Only reps work with a load produces an estimate, so the toggle is absent for the rest. */}
    {h.e1rmPoints.length > 0 && h.metric === 'weight' && <Segmented className="seg-range" value={curve} onChange={setCurve}
      options={[{ value: 'top', label: t('Top set') }, { value: 'e1rm', label: t('Est. 1RM') }]} />}
    <div className="chart" style={{ marginTop: 8 }}>
      <LineChart points={onE1 ? h.e1rmPoints : h.points} h={140} unit={onE1 ? st.unit : unit} color="var(--blue)" />
    </div>
    <div className="small row" style={{ margin: '6px 0 4px', gap: 5 }}>
      <Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />
      {t('Best:')} <b className="accent">{fmtNum(onE1 ? e1Best : h.best)} {onE1 ? st.unit : unit}</b>
    </div>
    <h4 className="sec">{h.sessions.length < h.total ? t('Last {0} sessions', h.sessions.length) : t('Sessions')}</h4>
    <div className="list">
      {h.sessions.map(s => <div key={s.id} className="item" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tt">{fmtDate(s.d, true)} {s.pr && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{s.sets.map(x => setLabel(exId, x, s.target, speedUnitOf(st))).join('  ·  ')}</div>
          {tail(s) && <div className="small dim" style={{ marginTop: 3 }}>{tail(s)}</div>}
        </div>
        {s.value != null && s.value > 0 && <b className="accent nocap" style={{ whiteSpace: 'nowrap' }}>{fmtNum(s.value)} {unit}</b>}
      </div>)}
    </div>
  </>
}
export const exerciseHistorySheet = exId => ui().openSheet(close => <ExerciseHistory exId={exId} close={close} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', exerciseNameText(ex), r ? r.name : t('routine')))
      if (isNew && r) nav('/plan/r/' + r.id)
    }, null, isNew ? null : st.routines.find(x => x.id === rid))
  }
  return <>
    <h3 className={exerciseNameClass(ex)}>{t('Add “{0}”', exerciseNameFor(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine — sets, reps & weight come next.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" {...tappable(() => pick(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => (e.exerciseId ?? e.id) === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" {...tappable(() => pick('_new'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)

/* ============================ custom exercises (issue #11) ============================ */
// Name + body part is all it takes — the exercise then behaves like any built-in one
// (planning, logging, PRs, stats). A photo, GIF or video of your own, and a link to a video or
// guide, are optional (components/CustomMediaField.jsx): the state keeps a small reference to the
// file, never the file itself, and the link is cleaned on save and again whenever it is opened.
function CustomExForm({ existing, prefill, onDone, close }) {
  const nameRef = useRef(null)
  const onNameFocus = useSheetKeyboard(nameRef)
  const [n, setN] = useState(existing ? existing.n : (prefill || ''))
  const [bp, setBp] = useState(existing ? existing.bp : '')
  const [eq, setEq] = useState(existing ? (existing.eq || '') : '')
  const [desc, setDesc] = useState(existing ? (existing.desc || '') : '')
  const [media, setMedia] = useState(() => mediaOf(existing))
  // Whether this form changed the media at all. An edit that did not touch it writes back what the
  // exercise had, byte for byte: a ref from a newer version of the app (a codec or type this one
  // does not know) reads as nothing here, and re-normalizing it on a rename would delete it on
  // every device.
  const [mediaTouched, setMediaTouched] = useState(false)
  const [url, setUrl] = useState(existing && typeof existing.url === 'string' ? existing.url : '')
  const onMedia = patch => {
    if ('media' in patch) { setMedia(patch.media); setMediaTouched(true) }
    if ('url' in patch) setUrl(patch.url)
  }
  const [primaries, setPrimaries] = useState(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...existing.primaries]
    if (existing?.bp === 'cardio') return ['cardiovascular system']
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.length ? [norm[0]] : []
  })
  const [secondaries, setSecondaries] = useState(() => {
    if (existing && Array.isArray(existing.primaries) && existing.primaries.length) return [...(existing.secondaries || [])]
    const norm = hasExplicitMuscleMetadata(existing || {}) ? normalizeMuscleGroups(existing || {}) : []
    return norm.slice(1)
  })
  // Every primary chip this sheet saw a tap on, in that order. `primaries` alone cannot say what the
  // user reached for first: an existing exercise seeds it in the map's order, because that is how the
  // muscles are stored. The taps are the only record of the user's own order, and they decide the
  // target when the one the exercise had is un-ticked.
  const [primaryTaps, setPrimaryTaps] = useState([])
  const togglePrimary = value => {
    setPrimaryTaps(current => [...current, value])
    setPrimaries(current => current.includes(value) ? current.filter(m => m !== value) : [...current, value])
  }
  const toggleSecondary = value => setSecondaries(current => current.includes(value) ? current.filter(m => m !== value) : [...current, value])
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    if (!eq) { toast(t('Pick equipment')); return }
    const dup = allExercises(S()).find(e => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    const d = desc.trim().slice(0, 1000)
    // An empty field removes the link; anything else has to be a web address.
    const link = url.trim() ? cleanUrl(url) : null
    if (url.trim() && !link) { toast(t('That link is not a web address')); return }
    const keepMedia = !!existing && !mediaTouched
    const ref = keepMedia ? null : normalizeMediaRef(media)
    // Stored in the map's order, not the order the chips were tapped in — the tags on the exercise
    // used to shuffle with every edit.
    const prim = bp === 'cardio' ? ['cardiovascular system'] : inMuscleOrder(primaries)
    const sm = inMuscleOrder(secondaries.filter(m => !prim.includes(m)))
    const groups = [...prim, ...sm]
    // The one-word target (the library row, the picker, the Muscles view) is not the sorted list's
    // head — a hip thrust with Traps as an extra primary is not a Traps exercise. It is the primary
    // tapped first, and an edit keeps the exercise's target as long as that muscle is still a primary.
    // Once that muscle is gone the next answer is the first one tapped here that survived — a tap that
    // only turned a chip off says nothing and is skipped with it. The sorted list is the last resort,
    // for the user who drops the target and adds nothing in its place.
    const tg = (existing && prim.includes(existing.tg)) ? existing.tg : (primaryTaps.find(m => prim.includes(m)) || prim[0] || '')
    let id = existing && existing.id
    const extra = c => {
      if (!keepMedia) { if (ref) c.media = ref; else delete c.media }
      if (link) c.url = link; else delete c.url
    }
    if (existing) update(s => { const c = (s.customEx || []).find(x => x.id === id); if (c) {
      c.n = name; c.bp = bp; c.desc = d; c.tg = tg; c.sm = sm; c.muscleGroups = groups; c.primaries = prim; c.secondaries = sm; c.eq = eq
      extra(c)
    } })
    else {
      id = 'c' + uid()
      update(s => { const c = { id, n: name, bp, desc: d, tg, sm, muscleGroups: groups, primaries: prim, secondaries: sm, eq, custom: true }; extra(c); (s.customEx = s.customEx || []).push(c) })
    }
    // The file goes to the server now rather than after the state's own debounce: another device
    // that sees the reference first shows a tile until it arrives.
    if (ref) syncMedia({ force: true })
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(EXIDX[id])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part — it behaves like any other exercise.')}</div>
    <input ref={nameRef} className="input" placeholder={t('Exercise name')} value={n} onFocus={onNameFocus} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    <div className="chips" style={{ margin: '12px 0' }}>
      {ALL_EQUIPMENT.map(k => (<button key={k} className={'chip' + (eq === k ? ' on' : '')} onClick={() => setEq(k)}>{t(k)}</button>))}
    </div>
    {bp && <>
      {bp !== 'cardio' && <MultiSelectRow title={t('Primary muscle groups')} sheetTitle={t('Primary muscle groups')}
        values={primaries}
        options={MUSCLES.map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))}
        onToggle={togglePrimary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
      }
      <MultiSelectRow title={t('Additional muscle groups')} sheetTitle={t('Additional muscle groups')}
        values={secondaries}
        options={MUSCLES.filter(m => !primaries.includes(m)).map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))}
        onToggle={toggleSecondary} noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
    </>}
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} placeholder={t('Description (optional) — setup, cues, anything you want to remember')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <CustomMediaField media={media} url={url} onChange={onMedia} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
export const customExSheet = (existing, onDone, prefill) => ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)

export function deleteCustomEx(ex, afterDelete) {
  if (useStore.getState().A?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        // Keep display and muscle metadata in history before the custom catalogue row disappears.
        const snapshot = exerciseMuscleSnapshot(ex)
        s.workouts.forEach(w => (w.exposures || []).forEach(exposure => {
          if (exposure.exerciseId !== ex.id) return
          exposure.exerciseNameSnapshot = ex.n
          if (!exposure.muscleSnapshot || !Object.keys(exposure.muscleSnapshot).length) exposure.muscleSnapshot = snapshot
        }))
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => (e.exerciseId ?? e.id) !== ex.id); cleanupSg(r.ex) })
        delete s.exWeights[ex.id]
        s.favEx = (s.favEx || []).filter(id => id !== ex.id)
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { const id = e.exerciseId ?? e.id; u[id] = (u[id] || 0) + 1 }))
  st.workouts.forEach(w => (w.exposures || []).forEach(exposure => { u[exposure.exerciseId] = (u[exposure.exerciseId] || 0) + 1 }))
  return u
}
function ExercisePicker({ onPick, title, close }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')          // '' = all, '★' = chosen, '☆' = favourites, else a body part
  const [eq, setEq] = useState('')          // '' = any equipment
  const [showAll, setShowAll] = useState(false)
  const [shown, setShown] = useState(50)
  const [byMuscle, setByMuscle] = useState(false)
  const searchRef = useRef(null)
  const bpStrip = useRef(null), eqStrip = useRef(null)
  const onSearchFocus = useSheetKeyboard(searchRef)
  const all = allExercises(st)
  const profile = activeProfile(st)
  const inScope = e => bp === '★' ? usage[e.id] : bp === '☆' ? isFav(st, e.id) : (!bp || e.bp === bp)
  let base = searchExercises(all.filter(inScope), q)
  if (bp === '★') base = [...base].sort((a, b) => (usage[b.id] - usage[a.id]) || exerciseNameFor(a).localeCompare(exerciseNameFor(b)))
  const eqFiltered = (profile && !showAll) ? base.filter(e => exAvailable(st, e)) : base
  const eqOpts = equipmentOf(eqFiltered)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
  const f = sortFavouritesFirst(eqOn ? eqFiltered.filter(e => e.eq === eqOn) : eqFiltered, st)
  const chosenCount = Object.keys(usage).length
  const favCount = (st.favEx || []).length
  const special = bp === '★' || bp === '☆'
  // The Library's live result count (GitLab !31), for the same reason: how many are left.
  const narrowed = !!(q.trim() || bp || eqOn)
  useRevealActiveChip(bpStrip, bp)
  useRevealActiveChip(eqStrip, eqOn)
  if (byMuscle) return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{title || t('Add exercise')}</h3>
      <Button size="sm" variant="ghost" onClick={() => setByMuscle(false)}>{t('All')}</Button>
    </div>
    <MuscleExplorer onPick={onPick} />
  </>

  return <>
    <div className="row between" style={{ marginBottom: 10 }}><h3>{title || t('Add exercise')}</h3>
      <Button size="sm" variant="tinted" icon="target" onClick={() => setByMuscle(true)}>{t('By muscle')}</Button>
    </div>
    {/* .picker-search is what index.css keys the keyboard-aware sheet layout on: the sheet
        lifts above the keys and the search stays put while the list scrolls under it. */}
    <div className="picker-search"><div className={'search' + (narrowed ? ' has-count' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input ref={searchRef} className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onFocus={onSearchFocus} onChange={e => { setQ(e.target.value); setShown(50) }} />
      {narrowed && <span className="search-count" role="status" aria-label={exCount(f.length)}>{fmtNum(f.length)}</span>}</div></div>
    {profile && <div className="small dim row" style={{ margin: '8px 0 2px', gap: 6, alignItems: 'center' }}>
      <Icon name="dumbbell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setShowAll(v => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    {/* Changing muscle group keeps the equipment filter: if it still has exercises under the new
        group the filter stays applied, and if not the eqOn fallback above drops it for this view
        without forgetting the choice (issue #71). The favourites/chosen chips still clear it —
        those are cross-body-part views where a stale equipment filter would be confusing. */}
    <div className="chips" ref={bpStrip} style={{ margin: eqOpts.length > 1 ? '10px 0 6px' : '10px 0' }}>
      {favCount > 0 && <button className={'chip' + (bp === '☆' ? ' on' : '')} onClick={() => { setBp('☆'); setEq(''); setShown(50) }}><Icon name="starFill" className="fav-star" />{t('Favourites')} ({favCount})</button>}
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(50) }}><Icon name="starFill" style={{ fontSize: 12, display: 'inline-block', marginInlineEnd: 4, verticalAlign: '-1px' }} />{t('Chosen')} ({chosenCount})</button>}
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(50) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(50) }}>{t(b)}</button>)}
    </div>
    {eqOpts.length > 1 && <div className="chips" ref={eqStrip} style={{ marginBottom: 10 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(50) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    <div className="list">
      {!special && <div className="item" {...tappable(() => customExSheet(null, ex => onPick(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, and a photo or video if you like')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(e => <div key={e.id} className="item" {...tappable(() => onPick(e))}>
        <Thumb ex={e} /><div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(st, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</div><div className="ss capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</div></div>
        {/* Accent tag = already in a routine/log ("Chosen"); the yellow star by the name = favourite. */}
        {usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}
        {/* A "+" glyph reads as "add this now" — it used to just open the same detail sheet as
            tapping the row, so it added nothing until you'd scrolled past the sets/reps config
            and found the real button. Now it does what it looks like: adds with the default
            config right away. Tapping the row itself still opens the detail/config sheet, for
            when you want to set sets/reps before adding. */}
        <button className="iconbtn chev" aria-label={t('Add “{0}”', exerciseNameFor(e))} style={{ padding: 8, margin: -8 }}
          onClick={ev => { ev.stopPropagation(); onPick(e, true) }}><Icon name="plus" /></button>
      </div>)}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing chosen yet — add exercises and they’ll show up here.')}</div>}
      {f.length === 0 && bp === '☆' && <div className="empty">{t('No favourites here — tap the star on an exercise to add it.')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
  </>
}
// `title` names what the pick is for when it is not an add — the routine editor's Replace (#110).
export const exercisePicker = (onPick, { title } = {}) => ui().openSheet(close => <ExercisePicker onPick={onPick} title={title} close={close} />)

/** Start a safe swap for one exact active-workout occurrence. */
export function swapActiveWorkoutExercise(index) {
  const active = useStore.getState().A
  const selected = active?.entries?.[index]
  if (!selected?.exposureId) return
  const activeId = active.id
  const exposureId = selected.exposureId
  const slotRoutine = selected.rid ? S().routines.find(r => r.id === selected.rid) : null

  // The "+" on a picker row commits with the default config, exactly as it does in the add
  // flows; tapping the row still opens the config sheet first.
  // Worded for the session, not the routine: a swap changes today's workout only.
  const picker = exercisePicker((ex, quick) => {
    if (!quick) { exConfigSheet(ex, null, cfg => swapTo(ex, cfg), null, slotRoutine, null, null, t('Use in this workout')); return }
    const target = defaultConfig(ex.id)
    swapTo(ex, slotRoutine ? quickOccurrence(ex, slotRoutine) : occurrenceFor(ex.id, target, { id: uid(), unit: S().unit }))
  }, { title: t('Swap exercise') })
  function swapTo(ex, occurrence) {
    // The picker is a chooser here, not a stack you keep adding from: one swap, then back to
    // the workout. (The add flow deliberately leaves it open.)
    picker.close()
    const currentActive = useStore.getState().A
    const current = currentActive?.entries?.[index]
    if (currentActive?.id !== activeId || current?.exposureId !== exposureId) return
    // A swap is an in-place substitution — routine identity is unchanged, so the replacement
    // keeps the slot's own `rid` and reads its prescription from that routine (not a
    // session-wide one). A slot with no `rid` is freestyle.
    const freestyle = !slotRoutine
    let exposure = null
    update(st => {
      exposure = buildSessionExposures(st, { ...(slotRoutine || { id: 'freestyle' }), ex: [occurrence] }, {
        now: Date.now(), newId: uid, unit: st.unit
      })[0]
    })
    if (!exposure) return
    if (freestyle) delete exposure.routineId
    const replacement = {
      exposure,
      entry: entriesForExposures([exposure], S().prescriptions)[0],
    }

    const apply = options => {
      // A timed callback closes over entry/set indexes. Invalidate it, and the current rest,
      // before the selected occurrence can be replaced or a new entry shifts those indexes.
      ui().stopWork()
      ui().stopRest()
      updateActive(A => { swapActiveExercise(A, index, replacement, options) })
    }
    const logged = (current.sets || []).some(set => set.done === true)
    if (!logged) { apply(); return }

    if (current.sg) {
      ui().openSheet(close => <>
        <h3>{t('Swap exercise?')}</h3>
        <div className="muted small" style={{ marginBottom: 12 }}>
          {t('Logged sets stay with the original exercise. Choose where the replacement belongs.')}
        </div>
        <Button variant="primary" onClick={() => { close(); apply({ loggedConfirmed: true, groupDisposition: 'keep' }) }}>
          {t('Keep replacement in this group')}
        </Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" onClick={() => { close(); apply({ loggedConfirmed: true, groupDisposition: 'detach' }) }}>
          {t('Insert after this group')}
        </Button>
      </>)
      return
    }

    confirmSheet({
      title: t('Swap exercise?'),
      message: t('Logged sets stay with the original exercise. The replacement will be inserted afterward.'),
      confirmText: t('Continue'),
      onConfirm: () => apply({ loggedConfirmed: true })
    })
  }
}

/* ============================ equipment profiles ============================ */
// Create or edit one profile ("Home", "Gym", ...): a name plus a checklist of what you have.
function EquipmentProfileSheet({ profile, close }) {
  const update = useStore(s => s.update)
  const nameRef = useRef(null)
  const [checked, setChecked] = useState(new Set(profile?.equipment || []))
  const toggle = k => setChecked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const save = () => {
    const name = (nameRef.current.value || '').trim()
    if (!name) { return }
    update(s => {
      s.equipProfiles = s.equipProfiles || []
      const equipment = [...checked]
      if (profile) {
        const p = s.equipProfiles.find(x => x.id === profile.id)
        if (p) { p.name = name; p.equipment = equipment }
      } else {
        const p = newProfile(name); p.equipment = equipment
        s.equipProfiles.push(p)
        if (!s.activeEquipId) s.activeEquipId = p.id
      }
    })
    close()
  }
  return <>
    <h3>{profile ? t('Edit profile') : t('New equipment profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Name it after where you train — e.g. "Home" or "Gym" — then check what you have there.')}
    </div>
    <TextField ref={nameRef} defaultValue={profile?.name || ''} placeholder={t('Profile name')} maxLength={40} />
    <div style={{ height: 12 }} />
    <div className="chips">
      {ALL_EQUIPMENT.map(k => (
        <button key={k} className={'chip' + (checked.has(k) ? ' on' : '')} onClick={() => toggle(k)}>{t(k)}</button>
      ))}
    </div>
    <div className="dim small" style={{ marginTop: 10 }}>
      {t('Body-weight exercises are always available, in every profile.')}
    </div>
    <div style={{ height: 14 }} /><Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const equipmentProfileSheet = profile => ui().openSheet(close => <EquipmentProfileSheet profile={profile} close={close} />)

/* ============================ exercise config ============================ */
// One occurrence's PlanRule, edited with RuleEditor. The engine validates it; every edit to an
// existing rule is a new revision (which is what reopens a completed track).
const cloneJSON = v => JSON.parse(JSON.stringify(v))

/** A fresh occurrence's rule: a bodyweight ladder for bodyweight moves, manual for cardio, else linear. */
export function defaultRuleFor(ex, routine, unit) {
  const preset = isCardio(ex.id) ? 'manual' : isBodyweightEq(ex.id) ? 'bodyweight_ladder' : 'linear'
  return defaultPlanRule(preset, { id: uid(), exerciseId: ex.id, routineId: routine?.id ?? null, unit })
}

// The cardio sheet's numbers, read back off a rule that already holds them.
const cardioOf = rule => (rule?.parameters.durationSeconds
  ? { sets: rule.parameters.sets.min, min: rule.parameters.durationSeconds.min / 60, speed: rule.parameters.speed ?? 8 } : null)

export function occurrenceSummary(occ) {
  const r = occ?.rule
  if (!r) return t('Needs setup')
  const p = r.parameters
  const span = x => (x.min === x.max ? `${x.min}` : `${x.min}–${x.max}`)
  const upTo = v => (p.loadTo ? `–${fmtNum(v(p.loadTo))}` : '')
  const load = p.load.mode === 'absolute' ? ` @ ${fmtNum(p.load.value)}${upTo(l => l.value)} ${p.load.unit}`
    : p.load.mode === 'percent_1rm' ? ` @ ${fmtNum(p.load.percent)}${upTo(l => l.percent)}% 1RM` : ''
  return `${t(PRESET_LABEL[r.preset])} — ${span(p.sets)} × ${p.durationSeconds ? span(p.durationSeconds) + 's' : span(p.reps)}${load}`
}

/** "+" quick add: a genuine occurrence with the default rule, no sheet. */
export function quickOccurrence(ex, routine) {
  const rule = defaultRuleFor(ex, routine, S().unit)
  return { occurrenceId: rule.id, exerciseId: ex.id, rule }
}

// ponytail: always an estimate from the rule's start load; showing today's exact rows needs a
// prescription the editor does not generate. Upgrade: generate one here if users ask.
function warmupPreview(warmup, eq, rule) {
  if (!validateWarmup(warmup, weightDecimals())) return t('Check the warm-up steps')
  // The engine ramps to the first work row: a pyramid's lightest set; a 5/3/1 row needs the
  // training max, which the editor does not resolve, so it shows percentages only.
  const start = rule.parameters.load
  const first = (rule.special?.offsets?.[0]?.percentOfAnchor ?? 100) / 100
  const rows = rule.preset !== 'five_three_one' && start?.mode === 'absolute' && start.value > 0
    ? planWarmupRows({ rows: [{ load: { value: start.value * first, unit: start.unit } }], warmup, eq, rounding: rule.rounding })
    : null
  if (rows) {
    const est = t('Estimate: {0}', rows.map(r => `${fmtNum(r.load.value)} × ${r.reps}`).join(', ') || '—')
    const want = warmupSteps(warmup, eq).length
    return rows.length < want ? `${est} · ${t('{0} of {1} sets: the load is too low for the full ramp', rows.length, want)}` : est
  }
  return warmupSteps(warmup, eq).map(s => `${fmtNum(s.percent)}% × ${s.reps}`).join(', ')
}

// The drop-set and rest-pause fields take what is typed and are held to their minimums once left
// (Stepper `min`). A sheet saved from a field still being typed in is held to them here: an
// emptied weight drop would otherwise plan drops at the same weight.
const intensifierToSave = x => (x.type === 'dropset'
  ? { ...x, count: Math.max(1, Math.round(x.count) || 0), pct: Math.max(5, Number(x.pct) || 0) }
  : x.type === 'restpause'
    ? { ...x, totalReps: Math.max(1, Math.round(x.totalReps) || 0), restSec: Math.max(5, Number(x.restSec) || 0) }
    : x)

function ExConfig({ ex, existing, onSave, onDelete, onReplace, close, routine, saveLabel }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  const [occurrenceId] = useState(() => existing?.occurrenceId || uid())
  const [rule, setRule] = useState(() => {
    const initial = existing?.rule ? cloneJSON(existing.rule) : defaultRuleFor(ex, routine, st.unit)
    if (existing?.restFromProfile) initial.parameters.restSeconds = st.restSec
    return initial
  })
  const [note, setNote] = useState(() => existing?.note || '')
  const speedUnit = speedUnitOf(st)
  // The load of an assistance machine is the help given: the rule steps it down (issue #232).
  const assisted = typeof existing?.assisted === 'boolean' ? existing.assisted : isAssisted(ex.id)
  const [cardioCfg, setCardioCfg] = useState(() => existing?.cardio || cardioOf(existing?.rule) || { sets: 4, min: 20, speed: 8 })
  const [intensifierRaw, setIntensifier] = useState(() => existing?.intensifier || null)
  const [warmupRaw, setWarmup] = useState(() => existing?.warmup || { mode: 'off' })
  const [sideRaw, setSide] = useState(() => existing?.side === true)
  // Bodyweight follows the catalogue unless the occurrence says otherwise (issues #31/#32/#33).
  const [bw, setBw] = useState(() => !cardio && isBw({ ...(existing || {}), id: ex.id }))
  // What the rule cannot use (timed, unloaded, or a preset that shapes its own rows) is hidden
  // and not saved; the choice comes back if the rule does.
  const can = supports(rule)
  const warmup = can.warmup ? warmupRaw : { mode: 'off' }
  const intensifier = intensifierRaw && can[intensifierRaw.type] ? intensifierRaw : null
  // Per side counts reps, so a timed hold has none (issues #31/#60).
  const side = sideRaw && !cardio && !rule.parameters.durationSeconds
  const valid = cardio || (validatePlanRule(rule).ok && validateWarmup(warmup, weightDecimals()))

  const save = () => {
    if (!valid) return
    close()
    const before = existing?.rule
    // A cardio interval is the rule's duration and speed: the engine builds the session rows from it.
    const cardioPlan = cardio ? {
      sets: Math.max(1, Math.round(cardioCfg.sets) || 1),
      min: Math.max(1, Math.round(cardioCfg.min) || 20),
      speed: Math.max(0, cardioCfg.speed || 8),
    } : null
    const planned = cardio ? { ...rule, parameters: { ...rule.parameters, ...cardioParameters(cardioPlan) } } : rule
    // Any edit is an explicit plan edit: a new revision, which is what reopens a completed track.
    const revision = before && canonicalJSON(before) !== canonicalJSON(planned) ? before.revision + 1 : planned.revision
    const trimmedNote = (note || '').trim().slice(0, 500)
    // A saved config replaces the occurrence, so what this sheet does not edit rides along: a
    // machine marked (not) assisted, a ramp's own rest, an exercise kept out of progression.
    const kept = Object.fromEntries(['assisted', 'warmupRestSec', 'excludeFromProgression'].filter(key => existing?.[key] != null).map(key => [key, existing[key]]))
    onSave({
      ...kept,
      occurrenceId, exerciseId: ex.id, rule: { ...planned, revision },
      ...(existing?.restFromProfile && planned.parameters.restSeconds === st.restSec ? { restFromProfile: true } : {}),
      ...(cardio ? { mode: 'cardio', cardio: cardioPlan } : {}),
      ...(!cardio && warmup.mode !== 'off' ? { warmup } : {}),
      ...(!cardio && intensifier?.type ? { intensifier: intensifierToSave(intensifier) } : {}),
      ...(side ? { side: true } : {}),
      ...(!cardio && bw !== isBodyweightEq(ex.id) ? { bodyweight: bw } : {}),
      ...(trimmedNote ? { note: trimmedNote } : {}),
    })
  }

  return <>
    <h3 className="capitalize">{exerciseNameFor(ex)}</h3>
    <Media ex={ex} minimizable />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px', alignItems: 'center' }}>
      <span className="tag">{t(ex.eq)}</span><span className="dim" aria-hidden="true">·</span>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t(MUSCLE_NAME[ex.tg] || ex.tg || ex.bp)}</span>
      {!cardio && (ex.secondaries?.length ? ex.secondaries : smOf(ex)).slice(0, 3)
        .map((s, i) => <span key={i} className="tag dim">{t(MUSCLE_NAME[s] || s)}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}

    {cardio ? <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Intervals')} value={cardioCfg.sets} step={1} decimal={false} onChange={v => setCardioCfg(x => ({ ...x, sets: v }))} />
      <Stepper label={t('Minutes')} value={cardioCfg.min} step={1} decimal={false} onChange={v => setCardioCfg(x => ({ ...x, min: v }))} />
      {/* Typed and stepped in the profile's unit, kept in km/h (lib/speed.js). */}
      <Stepper label={speedUnit === 'mph' ? t('Speed (mph)') : t('Speed (km/h)')} value={toSpeed(cardioCfg.speed, speedUnit)} step={0.5}
        onChange={v => setCardioCfg(x => ({ ...x, speed: fromSpeed(v, speedUnit) }))} />
    </div> : <RuleEditor rule={rule} unit={st.unit} effort={effortOf(st) !== 'none'} assisted={assisted} onChange={setRule} />}

    {!cardio && <>
      <h4 className="sec">{t('Advanced options')}</h4>
      {/* How the movement is loaded and counted (issues #31/#32/#33, #60). */}
      <div className="sect-b" style={{ marginBottom: 14 }}>
        <Row icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
          subtitle={bw ? (rule.parameters.durationSeconds ? t('No weight to enter — just time the hold.') : t('No weight to enter — just log the reps.')) : t('Ask for a weight on every set.')}>
          {/* On, the rule drops its starting load when its preset can run without one; a preset
              that steps the load keeps it, and the sets log it as added weight. */}
          <Switch checked={bw} onChange={v => {
            setBw(v)
            const unloaded = { ...rule, parameters: { ...rule.parameters, load: { mode: 'empty' } } }
            if (v && validatePlanRule(unloaded).ok) setRule(unloaded)
          }} />
        </Row>
        {!rule.parameters.durationSeconds && <Row icon="shuffle" iconTint="var(--blue)" title={t('Reps per side')}
          subtitle={side ? t('You still log the total: {0} is {1} per side.', rule.parameters.reps.max, fmtNum(sideReps(rule.parameters.reps.max))) : t('For lunges, single-arm rows and the like.')}>
          {/* Turning it on rounds the reps up to even: half of an odd total is a rep one side does not get. */}
          <Switch checked={side} onChange={v => {
            setSide(v)
            const even = n => Math.ceil(n / 2) * 2
            if (v) setRule(r => ({ ...r, parameters: { ...r.parameters, reps: { min: even(r.parameters.reps.min), max: even(r.parameters.reps.max) } } }))
          }} />
        </Row>}
      </div>
      {(rule.parameters.load.mode !== 'empty' || rule.preset === 'five_three_one') && rule.rounding.mode !== 'allowed_values' && <Disclosure title={t('Plate step')} value={`${rule.rounding.step ?? ''} ${st.unit}`}>
        <Segmented value={rule.rounding.mode} onChange={mode => setRule(r => ({ ...r, rounding: { ...r.rounding, mode } }))}
          options={[{ value: 'nearest', label: t('Nearest') }, { value: 'up', label: t('Up') }, { value: 'down', label: t('Down') }]} />
        <div className="row cfgrow" style={{ marginTop: 8 }}>
          <Stepper value={rule.rounding.step} step={0.25} unit={st.unit} onChange={v => setRule(r => ({ ...r, rounding: { ...r.rounding, step: v } }))} />
        </div>
      </Disclosure>}
      {can.warmup && <Disclosure title={t('Warm-ups')} value={warmup.mode === 'off' ? t('Off') : warmup.mode === 'smart' ? t('Smart ramp') : t('Percentage template')}>
        <Segmented value={warmup.mode}
          onChange={mode => setWarmup(mode === 'smart' ? { mode, count: Math.min(3, warmupMaxCount(ex.eq)) }
            : mode === 'template' ? { mode, steps: [{ percent: 50, reps: 5 }, { percent: 75, reps: 3 }] }
            : { mode: 'off' })}
          options={[
            { value: 'off', label: t('Off') },
            { value: 'smart', label: t('Smart ramp') },
            { value: 'template', label: t('Percentage template') },
          ]} />
        {warmup.mode === 'smart' && <div className="row cfgrow" style={{ marginTop: 8 }}>
          <Stepper label={t('Warm-up sets')} value={warmup.count} step={1} decimal={false}
            onChange={v => setWarmup({ mode: 'smart', count: Math.max(1, Math.min(warmupMaxCount(ex.eq), Math.round(v) || 1)) })} />
        </div>}
        {warmup.mode === 'template' && <div style={{ marginTop: 8 }}>
          {warmup.steps.map((s, i) => <div key={i} className="row cfgrow" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
            <Stepper label={t('% of work weight')} unit="%" value={s.percent} step={5} decimal={false}
              onChange={v => setWarmup(w => ({ ...w, steps: w.steps.map((x, j) => (j === i ? { ...x, percent: Math.max(1, Math.min(100, v)) } : x)) }))} />
            <Stepper label={t('Reps')} value={s.reps} step={1} decimal={false}
              onChange={v => setWarmup(w => ({ ...w, steps: w.steps.map((x, j) => (j === i ? { ...x, reps: Math.max(1, Math.round(v)) } : x)) }))} />
            {warmup.steps.length > 1 && <Button variant="ghost" aria-label={t('Remove')} style={{ width: 'auto', flex: 'none', padding: '10px 12px' }}
              onClick={() => setWarmup(w => ({ ...w, steps: w.steps.filter((_, j) => j !== i) }))}>×</Button>}
          </div>)}
          {warmup.steps.length < 5 && <Button variant="ghost"
            onClick={() => setWarmup(w => ({ ...w, steps: [...w.steps, { ...w.steps.at(-1) }] }))}>{t('Add step')}</Button>}
        </div>}
        {warmup.mode !== 'off' && <div className="small dim" style={{ marginTop: 6, marginBottom: 18 }}>
          {warmupPreview(warmup, ex.eq, rule)}
        </div>}
      </Disclosure>}
      {(can.dropset || can.restpause) && <Disclosure title={t('Intensifier')} value={intensifier?.type === 'dropset' ? t('Drop-set') : intensifier?.type === 'restpause' ? t('Rest-pause') : t('None')}>
        <Segmented value={intensifier?.type || ''}
          onChange={v => setIntensifier(!v ? null : v === 'dropset'
            ? { type: 'dropset', count: 1, pct: 20 }
            : { type: 'restpause', totalReps: 8, restSec: st.restPauseSec || 15 })}
          options={[
            { value: '', label: t('None') },
            ...(can.dropset ? [{ value: 'dropset', label: t('Drop-set') }] : []),
            ...(can.restpause ? [{ value: 'restpause', label: t('Rest-pause') }] : []),
          ]} />
        {intensifier?.type === 'dropset' && <div className="row cfgrow" style={{ marginTop: 8, marginBottom: 8 }}>
          <Stepper label={t('Drops')} value={intensifier.count} step={1} min={1} max={5} decimal={false}
            onChange={v => setIntensifier(x => ({ ...x, count: v }))} />
          <Stepper label={t('Weight drop (%)')} value={intensifier.pct} step={5} min={5} max={90} decimal={false}
            onChange={v => setIntensifier(x => ({ ...x, pct: v }))} />
        </div>}
        {intensifier?.type === 'restpause' && <div className="row cfgrow" style={{ marginTop: 8, marginBottom: 8 }}>
          <Stepper label={t('Rest-pause reps')} value={intensifier.totalReps} step={1} min={1} max={100} decimal={false}
            onChange={v => setIntensifier(x => ({ ...x, totalReps: v }))} />
          <Stepper label={t('Rest (s)')} value={intensifier.restSec} step={5} min={5} max={120} decimal={false}
            onChange={v => setIntensifier(x => ({ ...x, restSec: v }))} />
        </div>}
      </Disclosure>}
      {/* How the weight is plate-loaded and what the bar weighs — per exercise, not per plan: it
          writes straight to S.barWeights / S.loadKind. */}
      {!rule.parameters.durationSeconds && <Disclosure title={t('Plate loading')} value={LOAD_KIND_LABEL[loadKindFor(st, { id: ex.id, bodyweight: bw })]()}>
        <BarWeightEditor ex={ex} cfg={{ bodyweight: bw }} extra={t('Applies to this exercise everywhere, not just this plan.')} />
      </Disclosure>}
    </>}

    <Disclosure title={t('Note')} value={note.trim() ? note.trim().slice(0, 24) : t('None')}>
      <textarea className="input" rows={3} maxLength={500}
        placeholder={t('Note (optional) — loading cues, "bar only then +1 plate/side each set", anything worth remembering here')}
        value={note} onChange={e => setNote(e.target.value)} />
    </Disclosure>
    <div style={{ height: 8 }} />
    <Button variant="primary" disabled={!valid} onClick={save}>{saveLabel || (existing ? t('Save') : t('Add to routine'))}</Button>
    {ex.custom && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {/* The routine editor's counterpart to a workout's Swap (#110): another exercise in this
        slot, with the slot's sets, reps, weight, rule and note kept (lib/routines.js). What was
        changed on this sheet and not saved is left behind, as closing it would. */}
    {onReplace && <><div style={{ height: 8 }} /><Button icon="shuffle" onClick={() => { close(); onReplace() }}>{t('Replace exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine, initial, onReplace, saveLabel) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} onSave={onSave} onDelete={onDelete} onReplace={onReplace} saveLabel={saveLabel} routine={routine} close={close} />)

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current, onPick) => {
  const cur = glyphOf(current)
  return ui().openSheet(close => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ effort quick picker (RIR / RPE) ============================ */
// Rating a set used to mean walking a +/- stepper up the scale — eleven taps to log "5 reps
// left". This is the one-tap replacement: a colour-coded button per preset, plus a free field
// for the value between two presets. Presets are stored in RIR internally; a profile that logs
// RPE sees the same buttons labelled on its own scale (toScale), coloured identically — the
// colour is the effort, not the number, so 0 RIR and 10 RPE are both the "went to failure" end.
function EffortPicker({ kind, value, onPick, close }) {
  // Local mirror so the ticked preset and the exact field track typing live.
  const [v, setV] = useState(value ?? null)
  // The exact field used to write through on every change, and onPick concludes the set (issue
  // #64): it ticks the set, beeps and starts the rest. Since stepEffort(kind, null, 1) returns
  // the band's minimum, one tap of + — or typing the `1` of `10` — was a committed rating, fired
  // under the sheet you were still typing into, and on the last set of the last exercise it
  // stacked workoutCompleteSheet on top of the picker. So typing moves the mirror only, and the
  // rating is written once, when the sheet goes away: Done, the backdrop, a swipe or Escape all
  // unmount this. A preset row still commits on the spot, which is what makes it one tap.
  const typed = useRef(value ?? null)
  const done = useRef(false)
  const set = nv => { typed.current = nv; setV(nv) }
  useEffect(() => () => {
    if (done.current) return
    if (typed.current !== (value ?? null)) onPick(typed.current)
  }, [])
  // `v` is in the profile's own scale (whatever sits on the set: s.rir or s.rpe). Compare in
  // RIR so the tick lands on the right preset on either scale, and so a typed RPE colours the
  // same as the RIR it equals.
  const curRir = rirOf(kind === 'rpe' ? { rpe: v } : { rir: v })
  const curColor = effortColor(curRir)
  const commit = nv => { done.current = true; close(); onPick(nv) }
  const pick = rir => commit(toScale(kind, rir))
  const hd = EFFORT[kind].hd
  // Same list the ⋯ menus use: a tinted square with the value where the icon goes, the sentence
  // as the row title, a tick on the current one. The exact field is the app's own stepper,
  // tinted like the logged cell in the set row, so the sheet and the row read as one thing.
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('How hard was that set?')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Tap how many reps you had left, or type an exact {0}.', hd)}</div>
    <div className="list menu-list effpick">
      {EFFORT_PRESETS.map(p => {
        const label = fmtNum(toScale(kind, p.rir)) + (p.tail ? '+' : '')
        const on = curRir != null && curRir === p.rir
        return <div key={p.rir} className={'item menu-item' + (on ? ' on' : '')} style={{ '--bc': p.color }}
          {...tappable(() => pick(p.rir))}>
          <span className="lrow-i effpick-n">{label}</span>
          <div className="grow"><div className="tt">{t(p.feel)}</div></div>
          <span className={'menu-on' + (on ? ' is-on' : '')}><Icon name="check" /></span>
        </div>
      })}
      <div className="item menu-item effpick-free">
        <div className="grow"><div className="tt">{t('Exact {0}', hd)}</div></div>
        <div className="stp effcell-stp"
          style={curColor ? { color: curColor, background: `color-mix(in srgb, ${curColor} 20%, var(--surface-2))` } : undefined}>
          <button aria-label={t('Decrease')} onClick={() => set(stepEffort(kind, v, -1))}><Icon name="minus" /></button>
          <span className="val"><NumberField decimal nullable value={v ?? ''} placeholder="–"
            onChange={nv => set(capEffort(kind, nv))} /></span>
          <button aria-label={t('Increase')} onClick={() => set(stepEffort(kind, v, 1))}><Icon name="plus" /></button>
        </div>
      </div>
    </div>
    {v != null && <>
      <div style={{ height: 10 }} />
      {/* Only after the exact field has moved the value off what is stored: the preset rows
          close themselves, so this row exists for the one path that does not. */}
      {v !== (value ?? null) && <Button icon="check" onClick={() => commit(v)}>{t('Done')}</Button>}
      <Button variant="ghost" className="dim" icon="xmark" onClick={() => commit(null)}>{t('Clear rating')}</Button>
    </>}
    <div style={{ height: 4 }} />
  </>
}
// kind is 'rir' | 'rpe'; value is the set's current rating on that scale (or null); onPick
// receives the new value on that same scale (null to clear). The caller stores it exactly as
// weight/reps are stored — a null drops the key rather than writing a zero.
export const effortPickerSheet = (kind, value, onPick) =>
  ui().openSheet(close => <EffortPicker kind={kind} value={value} onPick={onPick} close={close} />)

/* ============================ share / print / import a plan ============================ */
export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const hasRoutines = (st.routines || []).some(r => r.ex && r.ex.length)

  const exportFile = async () => {
    const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '')
    const json = JSON.stringify(bundle, null, 2)
    const name = 'opengym-plan-' + todayISO() + '.json'
    if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } close(); return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    close(); toast(t('Plan file saved — send it to a friend'))
  }
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try { const bundle = parsePlan(rd.result, st.unit || 'kg'); close(); planImportSheet(bundle) }
      catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="upload" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend imports into their own openGym — routines only, none of your workouts or weigh-ins.')}</div>
    <div style={{ height: 12 }} />
    <Button variant="tinted" icon="download" onClick={() => {
      close()
      // Web: the browser's print dialog (→ Save as PDF). Mobile: the OS print flow via the
      // native Print plugin — Android WebView has no window.print(). Same printable HTML both ways.
      if (MOBILE) printHtml(planPrintHTML(st, user?.name || ''), t('Weekly Training Plan')).catch(() => { /* dismissed */ })
      else printPlan(st, user?.name || '')
    }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean one-page-per-plan printout — no exercise ever splits across a page.')}</div>
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first — an empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = bundle => ui().openSheet(close => <PlanImport bundle={bundle} close={close} />)

function PlanImport({ bundle, close }) {
  const [schedule, setSchedule] = useState(false)
  const apply = () => {
    update(s => mergePlan(s, bundle, { schedule }))
    close()
    toast(t(bundle.routineCount === 1 ? 'Added {0} routine to your plan' : 'Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {routineCount(bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + t(bundle.scheduledDays === 1 ? 'scheduled on {0} day' : 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyNames = [].concat(st.week[wd] || []).map(id => st.routines.find(r => r.id === id)?.name).filter(Boolean)
  const hasOvr = st.dayPlan[iso] !== undefined
  // A weekday can hold several routines; the per-date override stays single-pick, so picking
  // one here collapses a combined day to it (docs/COMBINE_ROUTINES.md §8). The check marks
  // show everything currently planned for the day.
  const effIds = effectiveRoutineIds(st, iso)
  // A planned day in the past with nothing logged was missed — or trained and never logged,
  // like a run you forgot to start the app for (#284). Logging it opens "Log a past workout" on
  // that date with the day's routines picked, where the time and the duration can still change.
  const missed = iso < todayISO() && effIds.length > 0 && !workoutsOn(st, iso).length
  const logIt = () => { close(); logPastWorkoutSheet({ iso, routineIds: effIds }) }
  const set = v => {
    update(s => { if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v })
    close()
    toast(v === '' ? t('Back to weekly plan') : v === 'rest' ? t('{0} set to rest', fmtDate(iso)) : t('{0} planned for {1}', (st.routines.find(r => r.id === v) || {}).name, fmtDate(iso)))
  }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyNames.length ? deriveSessionName(weeklyNames) : t('Rest')}{hasOvr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    {missed && <div style={{ marginBottom: 14 }}><Button variant="primary" icon="checkCircle" onClick={logIt}>{t('Log this workout')}</Button></div>}
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" {...tappable(() => set(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {effIds.includes(r.id) && <Icon name="check" className="accent" />}</div>)}
      <div className="item" {...tappable(() => set('rest'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{effIds.length === 0 && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" {...tappable(() => set(''))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

function DayAssign({ day, close }) {
  const st = useStore(s => s.S)
  // A weekday holds a routine-id list; this single-pick sheet sets an empty day to exactly one
  // routine (or rest). The inline ＋ Add routine on the Plan screen is what appends to a
  // populated day.
  const cur = [].concat(st.week[day] || [])
  const set = v => { update(s => { if (v) s.week[day] = [v]; else delete s.week[day] }); close() }
  return <>
    <h3>{t(DAYN[day])}</h3>
    <div className="list">
      <div className="item" {...tappable(() => set(''))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div>{!cur.length && <Icon name="check" className="accent" />}</div>
      {st.routines.map(r => <div key={r.id} className="item" {...tappable(() => set(r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {cur.includes(r.id) && <Icon name="check" className="accent" />}</div>)}
    </div>
  </>
}
export const dayAssignSheet = day => ui().openSheet(close => <DayAssign day={day} close={close} />)

// ＋ Add routine on a populated weekday: single-pick, appends to the day's list. A routine
// already on that day is disabled; picking one closes the sheet.
function DayAddRoutine({ day, close }) {
  const st = useStore(s => s.S)
  const on = new Set([].concat(st.week[day] || []))
  const add = id => { update(s => { s.week[day] = [...[].concat(s.week[day] || []), id] }); close() }
  return <>
    <h3>{t('Add routine')}</h3>
    <div className="list">
      {st.routines.map(r => {
        const already = on.has(r.id)
        return <div key={r.id} className={'item' + (already ? ' disabled' : '')} aria-disabled={already || undefined}
          {...tappable(already ? null : () => add(r.id))}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
          {already ? <span className="tag">{t('already added')}</span> : <Icon name="chevronRight" className="chev" />}
        </div>
      })}
    </div>
  </>
}
export const dayAddRoutineSheet = day => ui().openSheet(close => <DayAddRoutine day={day} close={close} />)

/* ============================ workout detail ============================ */
const historyBadgeLabel = badge => ({ 'out-of-plan': t('Out of plan'), completed: t('Progression completed'), 'on-plan': t('On plan') })[badge] || ''

// Correcting when a saved session happened: typed in from another app, or logged on the wrong
// day. Only its place in history moves — the sets, the volume and the notes are the record, and
// the session keeps the length it had. The PR badges of the exercises it trained are worked out
// again, because "this was a record" is a claim about the sessions before it.
function WorkoutDateEdit({ w, onDone, close }) {
  const [date, setDate] = useState(w.d)
  const [time, setTime] = useState(startTimeOf(w))
  const today = todayISO()
  const save = () => {
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    // Nothing to do, and nothing to push: a no-op save and a workout deleted from another
    // sheet both just close.
    if (date === w.d && time === startTimeOf(w)) { close(); return }
    if (!(S().workouts || []).some(x => sameWorkout(x, w))) { close(); return }
    update(s => {
      const next = moveWorkout(s.workouts, w, date, time)
      if (next) s.workouts = next
    })
    close()
    onDone && onDone()
    toast(t('Workout moved'))
  }
  return <>
    <h3>{t('Change date & time')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('The session keeps its length. Personal records are worked out again from the new order.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={e => setDate(e.target.value)} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={e => setTime(e.target.value)} /></Row>
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const workoutDateSheet = (w, onDone) => ui().openSheet(close => <WorkoutDateEdit w={w} onDone={onDone} close={close} />)

// Correcting how long a saved session ran — mostly the workout nobody ended until they got home
// (Discord). The start stays, the end follows it; the sets, the order of history and the badges
// do not depend on the length and are left alone.
function WorkoutDurationEdit({ w, onDone, close }) {
  const [dur, setDur] = useState(durationMinOf(w))
  // A cleared field reads as 0, and saving that made the session one minute long without a word
  // (QA 1.3.9): it is refused with the reason under the field, and the saved length stays.
  const durInvalid = !(dur >= 1)
  const save = () => {
    if (durInvalid) { toast(t('Enter how long it took — at least 1 minute.')); return }
    let changed = false
    update(s => {
      const next = setWorkoutDuration(s.workouts, w, dur)   // at least a minute, however the field was left
      if (next) { s.workouts = next; changed = true }
    })
    close()
    if (!changed) return
    onDone && onDone()
    toast(t('Duration changed'))
  }
  return <>
    <h3>{t('Change duration')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Forgot to finish on time? Set how long the session really took. It keeps its start time and its sets.')}</div>
    {/* min 0, not 1: the stepper would put a cleared field back to 1 as it lost focus to Save. */}
    <Stepper label={t('Duration')} unit={t('min')} value={dur} step={5} min={0} decimal={false} invalid={durInvalid} onChange={v => setDur(Math.round(v))} />
    {durInvalid && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t('Enter how long it took — at least 1 minute.')}</div>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const workoutDurationSheet = (w, onDone) => ui().openSheet(close => <WorkoutDurationEdit w={w} onDone={onDone} close={close} />)

function WorkoutDetail({ w, close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const running = useStore(s => !!s.A)
  const update = useStore(s => s.update)
  // Read back the way the sheet shows it: work sets as v1 rows (a drop chain keeps its drops), the exposure beside them.
  const legacy = legacyEntriesOf(w, st.prescriptions)
  const entries = (w.exposures || []).map((exposure, i) => {
    const prescription = st.prescriptions?.[exposure.prescriptionId] || null
    const target = { mode: exposure.mode || 'reps', reps: prescription?.prefill.reps, sec: prescription?.prefill.durationSeconds }
    const work = (exposure.performance?.sets || []).filter(row => row.status === 'completed' && row.role !== 'warmup')
    const sets = legacy[i].sets.filter(s => s.done && !s.warmup)
    return { id: exposure.exerciseId, n: exposure.exerciseNameSnapshot || exposure.muscleSnapshot?.n, rid: exposure.routineId, ...(exposure.sg ? { sg: exposure.sg } : {}), note: exposure.performance?.note, notePin: exposure.performance?.notePin, target, sets, volume: volumeOf({ sets: work }), exposure, prescription }
  })
  // The session note is editable here rather than only at the finish sheet: what you want to
  // record about a session is often clearer once you have looked at what you actually did.
  const [note, setNote] = useState(w.note || '')
  // A note written here is an edit of the saved workout, stamped for the sync to keep it over an
  // older copy of the same workout (stampWorkout) — and only when it changed, since a stamp
  // outranks what another device wrote since.
  const saveNote = () => update(s => {
    const rec = s.workouts.find(x => sameWorkout(x, w))
    if (!rec) return
    const text = note.trim().slice(0, NOTE_MAX)
    if (text === (rec.note || '')) return
    if (text) rec.note = text; else delete rec.note
    stampWorkout(rec)
  })
  // onBlur alone loses the note: Escape, the Android back gesture and swipe-to-dismiss all
  // close the sheet without ever moving focus out of the textarea. Flush on unmount too. The
  // ref is what makes that work — a cleanup closes over the note from its own render, which
  // is the empty string this started with.
  const latest = useRef(note)
  latest.current = note
  const initial = useRef(w.note || '')
  useEffect(() => () => {
    const text = latest.current.trim().slice(0, NOTE_MAX)
    if (text === initial.current) return
    update(s => {
      const rec = s.workouts.find(x => sameWorkout(x, w))
      if (!rec || text === (rec.note || '')) return   // deleted from this very sheet, or already saved
      if (text) rec.note = text; else delete rec.note
      stampWorkout(rec)
    })
  }, [])
  const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))
  // Tapping an exercise opens its history (Discord 'Improvement ideas'): from one session to the
  // curve it sits on, which is the question a past workout raises most often.
  const entryRow = (e, i) => {
    const ex = EXIDX[e.id]
    const badge = badgeFor(e.exposure)
    return <div key={i} className="row wd-ex" style={{ alignItems: 'flex-start' }} {...tappable(() => exerciseHistorySheet(e.id))}>
      {ex && <Thumb ex={ex} />}
      <div className="grow"><div className={`tt ${exerciseNameClass(ex)}`} style={{ fontWeight: 600 }}>{nameOf(e)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>} {badge && <span className="tag">{historyBadgeLabel(badge)}</span>}</div>
        <div className="ss">{e.sets.filter(hasCompletedWork).map(s => setLabel(e.id, s, e.target, speedUnitOf(st))).join('  ·  ') || t('no sets')}</div>
        {e.prescription && <div className="small" style={{ marginTop: 7 }}>
          <div className="dim">{t('Planned')} {planSummary(e.prescription, fmtNum)} · {t('Rest {0} s', e.prescription.parameters.restSeconds)}</div>
          {badge === 'out-of-plan' && <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {auditFields(e.exposure).map(field => <span key={field} className="tag" style={{ color: 'var(--yellow)' }}>{findingText(e.exposure.audit.find(x => x.field === field))}</span>)}
          </div>}
          {e.exposure.sourceAudit?.derivedFromOutOfPlan && <div className="dim" style={{ marginTop: 3 }}>{t('Suggested from a session logged out of plan.')}</div>}
        </div>}
        {e.note && <div className="small dim" style={{ marginTop: 3 }}>
          {e.notePin && <Icon name="flag" style={{ fontSize: 12, marginInlineEnd: 4, verticalAlign: '-1px', color: 'var(--yellow)' }} />}{e.note}
        </div>}</div>
      <Icon name="chevronRight" className="chev" style={{ alignSelf: 'center' }} />
    </div>
  }
  // Exercises done as a superset stay together under a "Superset" label and one bar, the way the
  // routine editor shows them. Adjacent entries with the same tag, as in the workout itself.
  const entryRows = units => units.map(unit => {
    if (unit.length < 2) return entryRow(entries[unit[0]], unit[0])
    return <div key={'ss' + unit[0]} className="wd-ss">
      <div className="ss-label"><Icon name="link" />{t('Superset')}</div>
      {unit.map(i => entryRow(entries[i], i))}
    </div>
  })
  // Copied with the note as it stands in the box, which may not be saved yet.
  const copyAsText = async () => {
    const rec = { ...(st.workouts.find(x => sameWorkout(x, w)) || w), note: note.trim() }
    toast(await copyText(workoutText(rec, { unit: st.unit, nameOf, speedUnit: speedUnitOf(st), prescriptions: st.prescriptions })) ? t('Copied') : t('Could not copy'))
  }
  // A combined session's entries carry a `rid`; group them into per-routine sections in merge
  // order, with each section's supersets paired inside it (sessionSections, which "Copy as text"
  // reads the workout through too). A legacy single-routine workout (one routineIds, or no rid
  // anywhere) renders flat.
  const groups = sessionSections(entries)
  const grouped = groups.length > 1 || (groups[0] && groups[0].rid && (w.routineIds || []).length > 1)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {grouped ? groups.map(g => {
      const r = g.rid ? st.routines.find(x => x.id === g.rid) : null
      const items = g.items.map(i => entries[i])
      const setN = items.reduce((n, e) => n + e.sets.length, 0)
      const vol = items.reduce((n, e) => n + e.volume, 0)
      return <div key={g.rid || '__none'}>
        <div className="row between" style={{ margin: '2px 0 8px', paddingBottom: 6, borderBottom: '1px solid var(--sep)' }}>
          <div className="row" style={{ gap: 7, fontWeight: 600 }}>
            {r && <Icon name={glyphOf(r.emoji)} />}{r ? r.name : t('Freestyle')}
          </div>
          <div className="small dim">{t('{0} sets', setN)} · {fmtVol(vol, st.unit)}</div>
        </div>
        {entryRows(g.units)}
      </div>
    }) : entryRows(groups[0]?.units || [])}
    {/* Progress photos and form-check videos: added and removed right here, on the saved record. */}
    <WorkoutMediaSection w={w} />
    <div className="small muted" style={{ margin: '4px 0 6px' }}>{t('Session note')}</div>
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} onBlur={saveNote} />
    <div style={{ height: 14 }} />
    {running && <p className="small muted">{t('Finish the current workout first.')}</p>}
    {/* The editor starts from the record as it is, so a note typed here goes in first — the same
        flush the date row does, and the unmount hook then has nothing left to write over it. */}
    <Button icon="pencil" disabled={running} onClick={() => {
      saveNote()
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      try { openWorkoutEditor(w); close(); nav('/workout') }
      catch (error) { toast(t(error.message)) }
    }}>{t('Edit workout')}</Button>
    <div style={{ height: 8 }} />
    {/* The note lives in a textarea that only writes on blur, and moving the workout re-keys a
        legacy record — so flush it first and stop the unmount hook writing it a second time. */}
    <Button icon="calendar" style={{ marginBottom: 8 }} onClick={() => {
      saveNote()
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      workoutDateSheet(w, close)
    }}>{t('Change date & time')}</Button>
    <Button icon="timer" style={{ marginBottom: 8 }} onClick={() => {
      saveNote()
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      workoutDurationSheet(w, close)
    }}>{t('Change duration')}</Button>
    <Button icon="plus" onClick={() => confirmSheet({
      title: t('Save as routine?'),
      message: t('Create an independent routine from these exercise targets. Your workout history is kept.'),
      confirmText: t('Save'),
      onConfirm: () => {
        let id
        try { update(s => { id = saveSessionAsRoutine(s, w, w.name) }) }
        catch (e) { toast(t(e.message)); return }
        close()
        nav('/plan/r/' + id)
      }
    })}>{t('Save as routine')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="clipboard" onClick={copyAsText}>{t('Copy as text')}</Button>
    <div style={{ height: 10 }} />
    {/* Matched the way the edits above are, not by id: a workout from before ids has none, and
        filtering on `x.id !== undefined` took every other one of them with it. */}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.') + mediaGoesToo(S().workouts.find(x => sameWorkout(x, w))), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => !sameWorkout(x, w)); reconcileSessionHistory(s) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
// The sentence a workout's Delete adds when its photos and videos go with it — every file the
// record lists, shown or not. Empty when it has none.
function mediaGoesToo(rec) {
  const n = workoutMediaOf(rec, Infinity).length
  return n ? ' ' + t(n === 1 ? 'Its photo or video is deleted with it.' : 'Its {0} photos or videos are deleted with it.', n) : ''
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
function Calendar({ start, close }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  st.workouts.forEach(w => {
    const day = workoutDay(w)
    if (day) (byDay[day] = byDay[day] || []).push(w)
  })
  // Which column the 1st sits in, and therefore how many blanks come before it.
  const ws = weekStartOf(st)
  const startOffset = weekDayOffset(new Date(y, mo, 1).getDay(), ws)
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => workoutDay(w)?.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], planned = effectiveRoutineIds(st, iso).length > 0, ovr = st.dayPlan[iso] !== undefined
    const dotCls = ws ? 'done' : ovr && planned ? 'ovr' : planned ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet(c2 => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label={t('Previous month')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label={t('Next month')}><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${t(monthWs.length === 1 ? '{0} workout' : '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{weekOrder(ws).map(d => <div key={d} className="cal-h">{t(DAYS[d])}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = start => ui().openSheet(close => <Calendar start={start} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  const counts = (w.exposures || []).map(badgeFor).filter(Boolean).reduce((out, badge) => ({ ...out, [badge]: (out[badge] || 0) + 1 }), {})
  const summary = ['out-of-plan', 'completed'].filter(key => counts[key]).map(key => `${counts[key]} ${historyBadgeLabel(key)}`).join(' · ')
  const mediaN = workoutMediaCount(w)
  return <div className="item" {...tappable(onClick)}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), t('{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div>
      {summary && <div className="ss accent">{summary}</div>}</div>
    {mediaN > 0 && <span className="wrow-media" title={t(mediaN === 1 ? '{0} photo or video' : '{0} photos or videos', mediaN)} aria-label={t(mediaN === 1 ? '{0} photo or video' : '{0} photos or videos', mediaN)}><Icon name="image" />{mediaN}</span>}
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* ============================ workout lifecycle ============================ */
// `routineIds` accepts `string | string[] | null` — `[r.id]` for one routine,
// `effectiveRoutineIds(...)` for today's planned session, `[]` / null for explicit freestyle.
export function startFlow(routineIds) {
  // The weigh-in is a setting (Settings → During a workout, issue #137): off goes straight
  // into the session with no body weight on it, same as "Start without weighing in".
  if (S().weighIn === false) { beginWorkout(routineIds, null); return }
  bwSheet({ required: true, onDone: bw => beginWorkout(routineIds, bw) })
}
export function beginWorkout(routineIds, bw) {
  const routines = [].concat(routineIds ?? []).map(id => S().routines.find(r => r.id === id)).filter(Boolean)
  const missing = missingOneRms(S(), routines)
  if (!missing.length) { startSession(routineIds, bw); return }
  ui().openSheet(close => <OneRmPrompt exerciseIds={missing} close={close} onDone={() => startSession(routineIds, bw)} />, { kind: 'center', locked: true })
}

// Prompted once per generation, only for exercises planned as a % of a 1RM the profile lacks.
// Skipping is fine: those loads stay empty and manually fillable.
function OneRmPrompt({ exerciseIds, onDone, close }) {
  const unit = S().unit
  const [values, setValues] = useState({})
  const finish = save => {
    close()
    if (save) update(s => {
      const capturedAt = new Date().toISOString()
      for (const exerciseId of exerciseIds) {
        const value = Number(values[exerciseId])
        if (value > 0) s.oneRepMaxes = appendOneRm(s.oneRepMaxes, { id: uid(), exerciseId, value, unit, source: 'manual', capturedAt })
      }
    })
    onDone()
  }
  return <>
    <h3>{t('One-rep max needed')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('These exercises are planned as a % of your 1RM. Enter it for exact weights, or skip and fill the weights in yourself.')}</div>
    {exerciseIds.map(id => <div key={id} className="row between" style={{ marginBottom: 8 }}>
      <span className="capitalize">{exerciseNameFor(exOr(id))} ({unit})</span>
      <NumberField value={values[id] ?? ''} aria-label={t('1RM for {0}', exerciseNameFor(exOr(id)))} onChange={v => setValues(x => ({ ...x, [id]: v }))} />
    </div>)}
    <Button variant="primary" onClick={() => finish(true)}>{t('Save and start')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={() => finish(false)}>{t('Skip')}</Button>
  </>
}

function startSession(routineIds, bw) {
  const session = {
    id: uid(), d: todayISO(), start: Date.now(),
    routineIds: [],
    name: t('Freestyle'),
    bw: bw || null, cur: 0, status: 'in-progress', exposures: [], entries: [],
    // Snapshot the layout at start so the header ⋮ can change it for this session only —
    // changing the saved default (Settings → Workout view) mid-session leaves it alone.
    workoutView: S().workoutView || 'cards',
  }
  useStore.getState().update(s => {
    const out = buildCombinedExposures(s, routineIds, { now: session.start, newId: uid, unit: s.unit })
    session.routineIds = out.routineIds
    session.name = out.routines.length ? deriveSessionName(out.routines.map(r => r.name)) : t('Freestyle')
    session.exposures = out.exposures
    session.entries = entriesForExposures(out.exposures, s.prescriptions)
  })
  useStore.getState().setActive(session)
  useUI.getState().stopRest()
  nav('/workout')
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
    if (!(dur >= 1)) { toast(t('Enter how long it took — at least 1 minute.')); return }
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
    <Stepper label={t('Duration')} unit={t('min')} value={dur} step={5} min={0} decimal={false} invalid={!(dur >= 1)} onChange={v => setDur(Math.round(v))} />
    {!(dur >= 1) && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t('Enter how long it took — at least 1 minute.')}</div>}
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
        {n > 0 && <div className="small dim samed-media" style={{ marginTop: 4 }}>{t(n === 1 ? 'Its photo or video moves to the new workout.' : 'Its {0} photos or videos move to the new workout.', n)}</div>}
      </div>
    })}
    <button className="btn primary" onClick={onAdd}>{t('Add as second workout')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}
// History's button hands this its click event; only a day from the plan counts as `initial`.
export function logPastWorkoutSheet(initial) {
  if (useStore.getState().A) { toast(t('Finish the current workout first.')); return }
  const from = typeof initial?.iso === 'string' ? initial : null
  ui().openSheet(close => <LogPastWorkout initial={from} close={close} />)
}
// Backfill stays single-routine (the LogPastWorkout UI is one picker), but it emits the new
// shape: a one-element (or empty) routine list, per-entry rid, no top-level routineId.
function beginBackfill({ iso, time, durationMin, routineIds, replaceId }) {
  const session = {
    id: uid(), d: iso, start: backfillStart(iso, time),
    routineIds: [], name: t('Freestyle'), bw: null, cur: 0, status: 'in-progress', exposures: [], entries: [],
    backfill: { durationMin, replaceId: replaceId || null },
    // Same layout snapshot as a live session (see beginWorkout).
    workoutView: S().workoutView || 'cards',
  }
  useStore.getState().update(s => {
    // Prescribed from the history before that day, not from a session logged after it (#284).
    // The prescriptions it writes are still the profile's own.
    s.prescriptions ||= {}
    const past = historyAsOf(s, { d: iso, start: session.start, replaceId })
    const out = buildCombinedExposures(past, routineIds || [], { now: session.start, newId: uid, unit: s.unit })
    session.routineIds = out.routineIds
    session.name = out.routines.length ? deriveSessionName(out.routines.map(r => r.name)) : t('Freestyle')
    session.exposures = out.exposures
    session.entries = entriesForExposures(out.exposures, s.prescriptions)
  })
  useStore.getState().setActive(session)
  useUI.getState().stopRest()
  nav('/workout')
}

/* ============================ add a routine mid-session ============================ */
// The workout header ⋮ → Add routine. Single-pick: a routine already in the session, or one
// with no exercises, is shown disabled and tagged. Picking one appends its entries (each
// stamped with its `rid`), extends `A.routineIds`, and re-derives the session name.
// `A.cur` is left where it is — the appended block is reached by scrolling / Next.
function AddRoutineToSession({ close }) {
  const st = useStore(s => s.S)
  const active = useStore(s => s.A)
  if (!active) return null
  const inSession = new Set([].concat(active.routineIds || []))
  const add = r => {
    let exposures = []
    useStore.getState().update(s => { exposures = buildSessionExposures(s, r, { now: Date.now(), newId: uid, unit: s.unit }) })
    // A session kept out of progression as a whole (the header ⋮) keeps the routine's exercises out too.
    if (sessionNoProg(active)) exposures.forEach(x => { x.excludedFromProgression = true })
    const entries = entriesForExposures(exposures, S().prescriptions)
    updateActive(A => {
      const existing = A.entries || entriesForExposures(A.exposures, S().prescriptions)
      A.exposures.push(...exposures)
      A.entries = [...existing, ...entries]
      A.routineIds = [...[].concat(A.routineIds || []), r.id]
      if (!A.customName) {
        A.name = deriveSessionName(A.routineIds.map(id => st.routines.find(x => x.id === id)?.name).filter(Boolean))
      }
    })
    close()
    toast(t('{0} added — {1}', r.name, exCount(r.ex.length)))
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
  if (!useStore.getState().A) return
  ui().openSheet(close => <AddRoutineToSession close={close} />)
}

function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = useStore(s => s.A)
  // The workout can end underneath this sheet: finishing from the last exercise clears
  // `active`, and this re-renders before the sheet is torn down. Everything below is
  // read defensively and the sheet dismisses itself — reading A.entries straight took
  // the whole app down with it. Hooks still run unconditionally, so the bail-out has
  // to sit after every one of them.
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry && EXIDX[entry.id]
  // "Best" runs the other way on an assistance machine: the lightest setting is the record, and
  // a 0 means nothing logged rather than a new low (issue #232).
  const fold = (a, b) => (a > 0 && b > 0 ? betterWeight(entry.id, a, b) : Math.max(a, b))
  const doneW = entry ? entry.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w || 0).filter(w => w > 0) : []
  const maxSet = entry && doneW.length ? doneW.reduce((a, b) => betterWeight(entry.id, a, b)) : 0
  const prevBest = entry ? fold((st.exWeights[entry.id] || {}).w || 0, bestWeightFor(st, entry.id)) : 0
  const [v, setV] = useState(entry ? (fold(maxSet, prevBest) || entry.target.weight || 0) : 0)
  useEffect(() => { if (!entry) close() }, [!entry])

  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const nextUnit = unitDone ? nextUnfinishedUnit(A.entries, units, entryIdx) : null
  const workoutDone = unitDone && !nextUnit
  if (!entry || !ex) return null

  const commit = advance => {
    const n = Math.round((v || 0) * 10) / 10
    if (!isFinite(n) || n < 0) { toast(t('Enter a valid weight')); return }
    // topW belongs to the session (A); the remembered best belongs to the profile (S.exWeights)
    // — two separate writes, not one, now that they live in different stores.
    updateActive(A => { A.entries[entryIdx].topW = n })
    update(s => {
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: cur && cur.w > 0 && n > 0 ? betterWeight(entry.id, n, cur.w) : Math.max(n, cur ? cur.w : 0), d: todayISO() }
    })
    close()
    if (advance && unitDone) {
      if (workoutDone) workoutCompleteSheet()               // no unfinished unit → finish/continue prompt
      else updateActive(A => { A.cur = nextUnit[0] })
    } else toast(t('Tracked — next time starts at {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
  }
  return <>
    <h3 className={`row ${exerciseNameClass(ex)}`} style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('{0} done', exerciseNameFor(ex))}</h3>
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <Button variant="primary" trailingIcon={workoutDone ? null : 'chevronRight'} onClick={() => commit(true)}>{workoutDone ? t('Save') : t('Save & next exercise')}</Button>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => commit(false)}>{t('Just close')}</Button>
    </> : <Button variant="primary" onClick={() => commit(false)}>{t('Save weight')}</Button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

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
  const updateActive = useStore(s => s.updateActive)
  const A = useStore(s => s.A)
  // Correcting a saved workout touches that workout only, not the note every session shows.
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
    // Today's note belongs to the session (A); the standing note belongs to the profile
    // (S.exNotes) — two separate writes now that they live in different stores.
    updateActive(A => {
      const e = A.entries?.[entryIdx]
      if (e) {
        if (today) { e.note = today; if (pin) e.notePin = true; else delete e.notePin }
        else { delete e.note; delete e.notePin }
      }
    })
    if (!editing) update(s => {
      s.exNotes = s.exNotes || {}
      if (always) s.exNotes[entry.id] = always
      else delete s.exNotes[entry.id]
    })
    close()
  }

  return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('This session')}</div>
    <textarea ref={noteRef} className="input" rows={3} maxLength={NOTE_MAX} value={note}
      placeholder={t('How it went, what to change — kept with today’s workout.')}
      onFocus={onNoteFocus} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="sect-b">
      <Row icon="flag" iconTint="var(--yellow)" title={t('Show this next time')}
        subtitle={t('Brings it up again the next time you train this exercise.')}>
        <Switch checked={pin} onChange={setPin} disabled={!note.trim()} />
      </Row>
    </div>
    {!editing && <>
      <div style={{ height: 18 }} />
      <div className="small muted" style={{ marginBottom: 6 }}>{t('Always for this exercise')}</div>
      <textarea className="input" rows={2} maxLength={NOTE_MAX} value={standing}
        placeholder={t('Seat height, pin position, a form cue — shown every session.')}
        onChange={e => setStanding(e.target.value)} />
    </>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const exerciseNoteSheet = entryIdx => ui().openSheet(close => <ExerciseNote entryIdx={entryIdx} close={close} />)

/* The session note: how the whole workout went, as opposed to how one exercise went. It lives
   on the active session, so the finish reducer carries it onto the finished workout and it
   shows up again in history — where it stays editable. Written here rather than only after the
   fact because "notes you can write during a workout" is the point; a note you can only add
   once the session is filed is a different, smaller feature. */
function SessionNote({ close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const updateActive = useStore(s => s.updateActive)
  const A = useStore(s => s.A)
  const [note, setNote] = useState(A?.note || '')
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null

  const save = () => {
    const text = note.trim().slice(0, NOTE_MAX)
    updateActive(A => { if (text) A.note = text; else delete A.note })
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
  const updateActive = useStore(s => s.updateActive)
  const A = useStore(s => s.A)
  const [name, setName] = useState(A?.name || '')
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null

  const trimmed = name.trim().slice(0, 60)
  const canSave = trimmed.length > 0

  const save = () => {
    if (!canSave) return
    updateActive(A => {
      A.name = trimmed
      A.customName = true
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

/* Drop-set drops and rest-pause bursts are edited inline on the set row itself (Workout.jsx) —
   no sheet, no timer. A planned exercise (see the "Intensifier" config below) arrives with them
   already computed via applyIntensifierPlan; an unplanned straight set can still grow one live
   by tapping "+ Drop"/"+ Burst", which appends with the same suggested-next-value math. */

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Every exercise done — great work. Finish up, or keep going and add another exercise.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going — tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

function FinishSummary({ w, prs, e1prs = [], close }) {
  const st = useStore(s => s.S)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsWorkCount(setsDone(w), workSetsDone(st, w))}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '—'}</div></div>
    </div>
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'start', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} <span className={exerciseNameClass(EXIDX[id])}>{EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id}</span></div>)}
      {e1prs.map(p => <div key={p.id} className="small accent row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} <span className={exerciseNameClass(EXIDX[p.id])}>{EXIDX[p.id] ? exerciseNameFor(EXIDX[p.id]) : p.id}</span> · {fmtNum(p.est)} {st.unit}</div>)}
    </div>}
    <h4 className="sec" style={{ textAlign: 'start' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
    <div style={{ height: 14 }} />
    {/* The moment for a progress photo or the clip of a set: the workout is already saved, so
        what is added here goes straight onto its record. */}
    <div style={{ textAlign: 'start' }}><WorkoutMediaSection w={w} hint /></div>
    <Button variant="primary" onClick={() => { close(); nav('/home') }}>{t('Nice!')}</Button>
  </div>
}
// The editor (#143) works on a draft in A; lib/session-edit.js reads it as `state.active`.
const withActive = () => ({ ...S(), active: useStore.getState().A })

/** Opens the editor on a saved workout. Throws while a workout is running, or when it is gone. */
export function openWorkoutEditor(w) {
  useStore.getState().setActive(editCompletedSession(withActive(), w))
  useUI.getState().stopRest()
}

export function saveWorkoutEdits(onExit = () => nav('/history')) {
  // An edit that unticked or removed every set would save a workout with nothing in it, which
  // the history would still list and count as a training day. Deleting it is what that edit
  // means; Keep editing goes back to the sets.
  if (editLeftEmpty(useStore.getState().A)) {
    confirmSheet({
      title: t('Delete workout?'),
      message: t('No sets are left in this workout, so there is nothing to save. Delete it from your history?') + mediaGoesToo(editedRecord(withActive())),
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

export function exitWorkoutEdit(onExit = () => nav('/history')) {
  const leave = () => {
    useStore.getState().discardHistoryEdit()
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    onExit()
  }
  // Nothing to save: closing just closes, as it does for a workout only looked at.
  if (editChangesNothing(withActive())) { leave(); return }
  ui().openSheet(close => <>
    <h3>{t('Save workout changes?')}</h3>
    <p className="muted">{t('Save your edits to this workout, or keep the original record.')}</p>
    <Button variant="primary" onClick={() => { close(); saveWorkoutEdits(onExit) }}>{t('Save changes')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); leave() }}>{t("Don't save")}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Keep editing')}</Button>
  </>, { kind: 'center' })
}

export function finishWorkout() {
  const A = useStore.getState().A
  if (A?.editingWorkoutId) { saveWorkoutEdits(); return }
  if (!A) return
  const done = setsDoneActive(A)
  const total = setUnitsTotal(A.entries)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: doFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: t(total - done === 1 ? '{0} set still unchecked. Finish the workout now?' : '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: doFinishWorkout }); return }
  doFinishWorkout()
}
function doFinishWorkout() {
  const st = S()
  const A = useStore.getState().A
  if (!A) return
  const past = !!A.backfill
  const { session: w, oneRepMaxes, progression } = buildCompletedSession(A, st, {
    end: past ? backfillEnd(A) : Date.now(), newId: uid, unit: st.unit
  })
  const { prs, e1prs } = recordsOf(st, w, { backfill: past })
  if (prs.length) w.prs = prs
  let shown = w
  update(s => {
    if (past) {
      // Its start and end are in the past; the stamp says when it was logged, which is what a
      // merge after a reset elsewhere asks of it (lib/sync-merge.js sinceReset).
      stampWorkout(w)
      const replaced = A.backfill.replaceId ? s.workouts.find(x => x.id === A.backfill.replaceId) : null
      const touched = [...new Set([...(replaced?.exposures || []), ...w.exposures].map(x => x?.exerciseId).filter(id => id != null))]
      s.workouts = rebuildPrHistory(completeBackfill(s.workouts, A, w), touched, w)
      shown = s.workouts.find(x => x === w || (w.id != null && x.id === w.id)) || w
      prs.push(...[...(shown.prs || [])])
    } else {
      w.exposures.forEach(x => {
        const mx = workLoadOf(x)
        if (mx > 0 && beatsWeight(x.exerciseId, mx, (s.exWeights[x.exerciseId] || {}).w || 0)) s.exWeights[x.exerciseId] = { w: mx, d: w.d }
      })
      s.workouts.push(w)
    }
    for (const record of oneRepMaxes) s.oneRepMaxes = appendOneRm(s.oneRepMaxes, record)
    // A backfilled session is older than the live track state; merging its advance would
    // rewind (or double-count) progress a newer session already made.
    if (!past) s.progression = { ...(s.progression || {}), ...progression }
  })
  useStore.getState().clearActive()
  useStore.getState().autoBackupNow()
  useUI.getState().stopRest()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  ui().openSheet(close => <FinishSummary w={shown} prs={prs} e1prs={e1prs} close={close} />, { kind: 'center', locked: true })
}
