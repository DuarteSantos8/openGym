// Log a past workout → "Type it out instead": a session written the way it sits in a notes app,
// one exercise per line ("Bench press 60x8, 60x8, 62.5x6"). lib/typed-workout.js reads the lines,
// lib/log-workout.js files the workout (the MCP log_workout path), so a typed session gets its
// limits, PR badges, duplicate check and backfill like any other. Each line shows the exercise and
// sets it was read as while you type; a line that cannot be read says why, a tap on a line picks
// another exercise for that name, and nothing is saved until every line reads.
//
// The sheet opener lives in sheets.jsx (typedWorkoutSheet), which hands in the exercise picker,
// so this file does not import the big sheets module back.
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { todayISO, fmtNum, exerciseNameText } from '../lib/format.js'
import { fmtSec, EFFORT } from '../lib/history.js'
import { exOr } from '../lib/exercises.js'
import { speedUnitOf } from '../lib/speed.js'
import { nameKey } from '../lib/import-choices.js'
import { readTypedWorkout, typedWorkoutInput, TYPED_MAX_CHARS } from '../lib/typed-workout.js'
import { buildLoggedWorkout, appendLoggedWorkout, findDuplicate } from '../lib/log-workout.js'
import { MAX_DURATION_MIN, endsInFuture } from '../lib/workout-date.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import DateField from './DateField.jsx'
import { Button, Row, Stepper } from './ui.jsx'

const PROBLEM = {
  name: () => t('Start the line with the exercise, then the sets.'),
  match: () => t('No exercise by that name. Tap to pick one.'),
  unread: r => t('Lost me at {0}. Try 60x8 or 3x10.', r.unread.join(' ')),
  sets: () => t('Which sets? Like 60x8, 60x8 or 3x10.'),
  reps: () => t('How many reps? Like 60x8.'),
  time: () => t('How long? Cardio goes in minutes, like 20 min.'),
  cardio: () => t('Cardio is minutes and distance, like 20 min 3 km.'),
  mixed: () => t('Reps or time on one exercise, not both.'),
  limit: () => t('That’s more than a workout holds. Check the numbers.'),
}

const effortOf = s => (s.rir != null ? ` · ${EFFORT.rir.hd} ${fmtNum(s.rir)}` : s.rpe != null ? ` · ${EFFORT.rpe.hd} ${fmtNum(s.rpe)}` : '')

// What a line was read as, the same sets in a row said once: "2 × 8 reps · 60 kg, 6 reps · 62.5 kg",
// "3 × 1:00", "20 min · 3 km".
export function typedSetsText(row, S) {
  const sets = row?.sets || []
  if (!sets.length) return ''
  if (row.mode === 'cardio') {
    const dist = speedUnitOf(S) === 'mph' ? 'mi' : 'km'
    return sets.map(s => t('{0} min', s.minutes) + (s.distance != null ? ' · ' + fmtNum(s.distance) + ' ' + dist : '') + effortOf(s)).join(', ')
  }
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const one = s => (s.seconds != null ? fmtSec(s.seconds) : tn('{0} rep', '{0} reps', s.reps))
    + (s.weight > 0 ? ' · ' + fmtNum(s.weight) + ' ' + unit : s.bw ? ' · ' + t('Bodyweight') : '') + effortOf(s)
  const runs = []
  for (const s of sets) {
    const text = one(s)
    if (runs.length && runs[runs.length - 1].text === text) runs[runs.length - 1].n++
    else runs.push({ text, n: 1 })
  }
  return runs.map(r => (r.n > 1 ? r.n + ' × ' : '') + r.text).join(', ')
}

export function TypedWorkout({ initial, close, pickExercise }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const [date, setDate] = useState(initial?.date || iso(yesterday))
  const [time, setTime] = useState(initial?.time || '18:00')
  const [dur, setDur] = useState(initial?.dur || 60)
  const [text, setText] = useState('')
  const [picks, setPicks] = useState({})
  const areaRef = useRef(null)
  const onFocus = useSheetKeyboard(areaRef)
  const today = todayISO()
  // Each line goes through the library search: the deferred copy keeps typing at full speed.
  const typed = useDeferredValue(text)
  const read = useMemo(() => typedWorkoutInput(S, readTypedWorkout(typed), { picks }), [S, typed, picks])
  const nameOf = id => exerciseNameText(exOr(id))
  const pick = (name, id) => setPicks(p => ({ ...p, [nameKey(name)]: id }))
  const change = r => {
    if (!r.name || !pickExercise) return
    pickExercise(ex => pick(r.name, ex.id), { title: r.name, like: r.id || undefined })
  }
  const waiting = read.rows.filter(r => r.problem).length
  const badDur = !(dur >= 1) || dur > MAX_DURATION_MIN

  const save = () => {
    const st = useStore.getState().S
    if (st.active) { toast(t('Finish the current workout first.')); return }
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    if (badDur) { toast(t('Enter how long it took (at least 1 minute).')); return }
    if (endsInFuture(date, time, dur)) { toast(t('That’s still in the future. Try an earlier start.')); return }
    // Read again from the text itself, not the deferred copy, against the profile as it is now.
    const now = Date.now()
    const q = typedWorkoutInput(st, readTypedWorkout(text), { picks })
    if (!q.ready) return
    const built = buildLoggedWorkout(st, { ...q.input, date, start: time, durationMin: Math.round(dur), name: t('Freestyle') }, { now })
    if (built.problems) {
      const long = built.problems.some(p => p.field === 'durationMin')
      toast(long ? t('The timed sets alone run longer than that. Make the duration longer.') : t('That’s more than a workout holds. Check the numbers.'))
      return
    }
    if (findDuplicate(st, built.workout)) { toast(t('That workout is already in your history.')); return }
    update(s => { appendLoggedWorkout(s, built, { now }) })
    close()
    toast(t('Workout saved'))
  }

  return <>
    <h3>{t('Type a workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('One exercise per line, the way you’d jot it in your notes. Nothing is saved until every line reads.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <DateField compact value={date} max={today} onChange={setDate} label={t('Date')} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={e => setTime(e.target.value)} /></Row>
    <Stepper label={t('Duration')} unit={t('min')} value={dur} step={5} min={0} decimal={false} invalid={badDur} onChange={v => setDur(Math.round(v))} />
    <div style={{ height: 12 }} />
    <textarea ref={areaRef} className="input" rows={5} maxLength={TYPED_MAX_CHARS} value={text} data-typed-workout
      aria-label={t('Type a workout')} autoCapitalize="sentences" autoCorrect="off" spellCheck={false}
      placeholder={[t('Bench press 60x8, 60x8, 62.5x6'), t('Squat 100kg 5x5'), t('Plank 3x60s')].join('\n')}
      onFocus={onFocus} onChange={e => setText(e.target.value)} />
    {read.rows.length > 0 && <div className="sect-b" style={{ marginTop: 12 }} aria-live="polite" data-typed-rows>
      {read.rows.map((r, i) => {
        const subtitle = [r.problem ? PROBLEM[r.problem](r) : typedSetsText(r, S), !r.problem && r.note ? t('Note: {0}', r.note) : null].filter(Boolean).join(' · ')
        return <div key={i} data-typed-row={r.problem || 'ok'}>
          <Row icon={r.problem ? 'warning' : 'checkCircle'} iconTint={r.problem ? 'var(--orange)' : 'var(--green)'}
            title={r.id ? nameOf(r.id) : (r.name || r.line)} subtitle={subtitle}
            accessory={r.name ? 'chevron' : 'none'} onClick={r.name ? () => change(r) : undefined} />
          {!r.id && r.options.length > 0 && <div className="chips" style={{ flexWrap: 'wrap', overflow: 'visible', touchAction: 'auto', margin: '4px 0 8px' }}>
            {r.options.map(id => <button key={id} type="button" className="chip nocap" onClick={() => pick(r.name, id)}>{nameOf(id)}</button>)}
          </div>}
        </div>
      })}
    </div>}
    {waiting > 0 && <div className="small" style={{ color: 'var(--orange)', marginTop: 8 }}>{tn('{0} line still needs a look.', '{0} lines still need a look.', waiting)}</div>}
    <div style={{ height: 16 }} />
    <Button variant="primary" icon="check" onClick={save} disabled={text !== typed || !read.ready}>{t('Save workout')}</Button>
  </>
}
