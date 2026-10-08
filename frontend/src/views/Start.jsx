// Start = the dedicated workout launch point.
//
// Home shows a small shortcut to today's session; everything about choosing and
// starting a workout lives here: today's planned session, approximate-duration
// presets, an optional weigh-in, then the start. Other routines, freestyle and
// the exercise browser sit below as secondary doors.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, lastBW } from '../lib/history.js'
import { todayISO, exCount, DAYN, fmtNum, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { bwSheet, beginWorkout, beginSubsetWorkout, starterPlanSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'

// Presets, not a slider: four fixed approximate lengths. Snapping a stored value
// (from the old slider) to the nearest preset keeps the label and the persisted
// preference in agreement.
export const START_PRESETS = [15, 25, 35, 45]
const snapPreset = v => START_PRESETS.reduce((best, p) => Math.abs(p - (v ?? 35)) < Math.abs(best - (v ?? 35)) ? p : best, START_PRESETS[2])

// Shorter presets train the routine's first exercises, in order, and stop early;
// the full preset trains it all. Each step up adds training wherever the routine
// is long enough to tell them apart (15→3, 25→4, 35→all-but-one, 45→all), so the
// choices are never two labels for the same session. Only meaningful for a
// single-routine day — a combined day is already the long version.
export const presetExerciseCount = (routine, minutes) => {
  if (!routine) return 0
  const n = (routine.ex || []).length
  if (minutes <= 15) return Math.min(3, n)
  if (minutes <= 25) return Math.min(4, n)
  if (minutes <= 35) return n <= 5 ? n : n - 1
  return n
}

export default function Start() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [minutes, setMinutes] = useState(() => snapPreset(S.workoutLength))
  const pick = v => { setMinutes(v); update(s => { s.workoutLength = v }) }

  const todayIso = todayISO()
  const todayRoutines = effectiveRoutines(S, todayIso)
  const routineIds = effectiveRoutineIds(S, todayIso)
  const routine = todayRoutines[0] || null
  const single = todayRoutines.length === 1
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  const todayOvr = S.dayPlan[todayIso] !== undefined
  const editingSaved = !!S.active?.editingWorkoutId
  const next = !S.active && !todayRoutines.length ? nextTrainingDay(S, todayIso) : null
  const bw = lastBW(S)
  const idSet = new Set(routineIds)
  const others = (S.routines || []).filter(r => !idSet.has(r.id))

  // The weigh-in stays optional and secondary: a session carries the last logged
  // weight (or none), and starting never interrupts with the sheet. Logging or
  // updating beforehand is what the weigh-in card below is for.
  const sessionBW = () => (S.weighIn === false ? null : (lastBW(S)?.w ?? null))
  const beginFull = ids => beginWorkout(ids, sessionBW())
  const begin = () => {
    if (!routine) { beginFull(routineIds); return }
    const count = single ? presetExerciseCount(routine, minutes) : routine.ex.length
    if (!single || routineIds.length !== 1 || count >= routine.ex.length) beginFull(routineIds)
    else beginSubsetWorkout(routine.id, routine.ex.slice(0, count).map(e => e.id), sessionBW())
  }

  // A running session resumes — starting something new here would overwrite it.
  if (S.active) return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start')}</h1><div className="sub">{t('A session is already running')}</div></div></div>
    <div className="card">
      <div className="lbl2">{editingSaved ? t('Editing saved workout') : t('In progress')}</div>
      <div className="ttl" style={{ margin: '2px 0 12px' }}>{S.active.name}</div>
      <Button variant="primary" icon={editingSaved ? 'pencil' : 'play'} onClick={() => nav('/workout')}>
        {editingSaved ? t('Open editor') : t('Resume workout')}
      </Button>
    </div>
  </div>

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Start')}</h1><div className="sub">{t(DAYN[new Date().getDay()])}{todayRoutines.length ? ' — ' + t('today is {0}', todayName) : ' — ' + t('rest day, anything counts')}</div></div>
    </div>

    {!S.routines.length && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('No plan yet')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made starter plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {!!todayRoutines.length && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <div className="lbl2">{t("Today's workout")}{todayOvr ? ' · ' + t('rescheduled') : ''}</div>
      <div className="row" style={{ gap: 9, margin: '4px 0 4px', alignItems: 'center' }}>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(routine.emoji)} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="big">{todayName}</div>
          <div className="muted small">{exCount(todayRoutines.reduce((n, r) => n + (r.ex || []).length, 0))}</div>
        </div>
      </div>

      {single ? <>
        <div className="lbl2" style={{ marginTop: 12, marginBottom: 6 }}>{t('How long do you have?')}</div>
        <Segmented
          value={minutes}
          onChange={pick}
          options={START_PRESETS.map(p => ({ value: p, label: t('{0} min', p) }))}
        />
        <div className="small muted" style={{ marginTop: 8 }}>
          {t('{0} exercises · about {1} min', presetExerciseCount(routine, minutes), minutes)}
        </div>
      </> : <div className="small muted" style={{ marginTop: 8 }}>{t('Combined session — the whole plan for today.')}</div>}

      <div style={{ height: 12 }} />
      <Button variant="primary" icon="play" onClick={begin}>{t('Start {0}', todayName)}</Button>
    </div>}

    {!todayRoutines.length && !!S.routines.length && <div className="card">
      <div className="lbl2">{t('Rest day')}</div>
      <div className="big" style={{ margin: '2px 0 4px' }}>{t('Recovery')}</div>
      <div className="muted small" style={{ marginBottom: 12 }}>
        {next ? t('Next: {0}, {1}', t(DAYN[next.weekday]), next.routine.name) : t('No sessions planned — pick anything below.')}
      </div>
    </div>}

    {!!S.routines.length && <div className="card">
      <div className="lbl2" style={{ marginBottom: 2 }}>{t('Optional weigh-in')}</div>
      <div className="row between" style={{ alignItems: 'center' }}>
        <div className="small muted">{bw ? t('{0} {1} · {2}', fmtNum(bw.w), S.unit, fmtDate(bw.d, true)) : t('Not weighed in yet')}</div>
        <Button size="sm" icon="plus" onClick={() => bwSheet()}>{bw ? t('Update') : t('Log weight')}</Button>
      </div>
      <div className="small dim" style={{ marginTop: 6 }}>{t('Carried into the session automatically — updating is optional.')}</div>
    </div>}

    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" {...tappable(() => beginWorkout([r.id], sessionBW()))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount((r.ex || []).length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}

    {!!S.routines.length && <>
      <div style={{ height: 14 }} />
      <Button icon="shuffle" onClick={() => beginWorkout([], sessionBW())}>{t('Freestyle workout (pick as you go)')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" icon="list" onClick={() => nav('/library')}>{t('Browse exercises')}</Button>
    </>}
  </div>
}
