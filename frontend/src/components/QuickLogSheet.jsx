// History → "Type a workout": a session written the way it sits in a notes app, one exercise per
// line ("Bench press 60x8, 60x8, 62.5x6"). lib/quick-log.js reads the lines and lib/log-workout.js
// saves them, the same path as the MCP server's log_workout, so a typed workout gets its PR badges
// and lands on its day like any other. Each line shows the exercise and the sets it was read as,
// and nothing is saved until every line reads cleanly.
import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { todayISO, fmtNum, exerciseNameText, exCount } from '../lib/format.js'
import { fmtSec } from '../lib/history.js'
import { exOr } from '../lib/exercises.js'
import { speedUnitOf } from '../lib/speed.js'
import { parseQuickLog, quickLogInput, pickKey, QUICK_LOG_MAX } from '../lib/quick-log.js'
import { buildLoggedWorkout, appendLoggedWorkout, findDuplicate } from '../lib/log-workout.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { exercisePicker } from '../sheets.jsx'
import DateField from './DateField.jsx'
import { Button, Row } from './ui.jsx'

const PROBLEM = {
  match: () => t('No exercise found for this name.'),
  sets: () => t('No sets found. Write them like 60x8, 60x8.'),
  reps: () => t('How many reps? Write them like 60x8.'),
  cardio: () => t('Cardio is logged in minutes, like 20 min or 20 min 3 km.'),
  mixed: () => t('Use either reps or a time on one exercise, not both.'),
  limit: () => t('Check the numbers on this line.'),
}

// "60 × 8 · 60 × 8 · 62.5 × 6 kg", "45 s × 3", "20 min · 3 km": what a line was read as.
function setsText(sets, S) {
  if (!sets?.length) return ''
  if (sets[0].minutes != null) {
    const dist = speedUnitOf(S) === 'mph' ? 'mi' : 'km'
    return sets.map(s => t('{0} min', s.minutes) + (s.distance != null ? ' · ' + fmtNum(s.distance) + ' ' + dist : '')).join(' · ')
  }
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const loaded = sets.some(s => s.weight > 0)
  const one = s => (s.seconds != null ? fmtSec(s.seconds) : (s.weight > 0 ? fmtNum(s.weight) + ' × ' : '× ') + s.reps)
  return sets.map(one).join(' · ') + (loaded ? ' ' + unit : '')
}

export function QuickLog({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [text, setText] = useState('')
  const [date, setDate] = useState(todayISO())
  const [picks, setPicks] = useState({})
  const [limits, setLimits] = useState(null)
  const areaRef = useRef(null)
  const onFocus = useSheetKeyboard(areaRef)
  // Reading every line against the library on each key is the search's work, not the typing's.
  const typed = useDeferredValue(text)
  const q = useMemo(() => quickLogInput(S, parseQuickLog(typed), { date, name: t('Freestyle'), picks }), [S, typed, date, picks])
  const exOf = id => (S.customEx || []).find(c => c?.id === id) || exOr(id)
  const nameOf = id => exerciseNameText(exOf(id))
  const pick = (label, id) => { setPicks(p => ({ ...p, [pickKey(label)]: id })); setLimits(null) }
  const change = (r) => {
    const picker = exercisePicker(ex => { picker.close(); pick(r.label, ex.id) }, { title: r.label, like: r.id || undefined })
  }
  const setCount = q.input.exercises.reduce((n, e) => n + e.sets.length, 0)
  const fresh = text === typed

  const save = () => {
    const st = useStore.getState().S
    if (st.active) { toast(t('Finish the current workout first.')); return }
    const now = Date.now()
    const ready = quickLogInput(st, parseQuickLog(text), { date, name: t('Freestyle'), picks })
    if (!ready.ready) return
    const built = buildLoggedWorkout(st, ready.input, { now })
    // Beyond what a set can hold (over 2,000 kg, a 7-hour plank): the line it came from says so.
    if (built.problems) {
      setLimits(new Set(built.problems.map(p => Number(/^exercises\[(\d+)\]/.exec(p.field || '')?.[1])).filter(Number.isInteger)))
      return
    }
    if (findDuplicate(st, built.workout)) { toast(t('That workout is already in your history.')); return }
    update(s => { appendLoggedWorkout(s, built, { now }) })
    close()
    toast(t('Workout saved'))
  }

  return <>
    <h3>{t('Type a workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('One exercise per line, the way you would write it in your notes. Check what each line was read as, then save.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <DateField compact value={date} max={todayISO()} onChange={setDate} label={t('Date')} /></Row>
    <div style={{ height: 8 }} />
    <textarea ref={areaRef} className="input" rows={5} maxLength={QUICK_LOG_MAX} value={text} data-quick-log
      aria-label={t('Type a workout')} autoCapitalize="sentences" autoCorrect="off" spellCheck={false}
      placeholder={[t('Bench press 60x8, 60x8, 62.5x6'), t('Squat 100kg 5x5'), t('Plank 3x60s')].join('\n')}
      onFocus={onFocus} onChange={e => { setText(e.target.value); setLimits(null) }} />
    {q.rows.length > 0 && <div className="sect-b" style={{ marginTop: 12 }} data-quick-log-rows>
      {q.rows.map((r, i) => {
        const problem = limits?.has(i) ? 'limit' : r.problem
        const extra = [r.unread.length ? t('Not read: {0}', r.unread.join(' ')) : null].filter(Boolean)
        return <div key={i} data-quick-log-row={problem || 'ok'}>
          <Row icon={problem ? 'warning' : 'checkCircle'} iconTint={problem ? 'var(--orange)' : 'var(--green)'}
            title={r.id ? nameOf(r.id) : r.label}
            subtitle={[problem ? PROBLEM[problem]() : setsText(r.sets, S), r.id && pickKey(r.label) !== pickKey(nameOf(r.id)) ? r.label : null, ...extra].filter(Boolean).join(' · ')}
            accessory="chevron" onClick={() => change(r)} />
          {r.problem === 'match' && r.options.length > 0 && <div className="chips" style={{ flexWrap: 'wrap', margin: '4px 0 8px' }}>
            {r.options.map(id => <button key={id} type="button" className="chip nocap" onClick={() => pick(r.label, id)}>{nameOf(id)}</button>)}
          </div>}
        </div>
      })}
    </div>}
    <div style={{ height: 16 }} />
    <Button variant="primary" icon="check" onClick={save} disabled={!fresh || !q.ready || !!limits?.size}>
      {q.ready ? t('Save') + ' · ' + exCount(q.input.exercises.length) + ' · ' + tn('{0} set', '{0} sets', setCount) : t('Save')}
    </Button>
  </>
}

/** Open the sheet; a workout in progress is finished first, as for a past one. */
export function quickLogSheet() {
  if (useStore.getState().S.active) { useUI.getState().toast(t('Finish the current workout first.')); return }
  useUI.getState().openSheet(close => <QuickLog close={close} />)
}
