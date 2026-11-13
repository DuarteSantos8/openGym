// "How hard was it?" on the finish summary: the whole workout's effort, 1 to 10, as Apple Fitness
// asks for it (lib/workout-effort.js). Only on an iPhone that can give a workout its effort in
// Apple Health (iOS 18) and is writing there, and only while Settings asks for it; set
// automatically, the score it worked out is shown already picked, and a tap still changes it.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { effortModeOf, effortWord, cleanEffort, setWorkoutEffort } from '../lib/workout-effort.js'
import { effortSupport, askEffort } from '../lib/health-sync.js'
import { stampWorkout } from '../lib/sync-merge.js'
import { watchAsksEffort } from '../lib/watch-sync.js'

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
// Apple Fitness's four words (lib/workout-effort.js EFFORT_LEVELS), each a t() of its own.
const WORDS = { Easy: () => t('Easy'), Moderate: () => t('Moderate'), Hard: () => t('Hard'), 'All out': () => t('All out') }
const colorOf = n => (n <= 3 ? 'var(--green)' : n <= 6 ? 'var(--yellow)' : n <= 8 ? 'var(--orange)' : 'var(--red)')

/** Whether this phone asks for, or shows, a workout's effort: iOS 18 with Apple Health on. */
export function useEffortAvailable() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let gone = false
    effortSupport().then(s => { if (!gone) setOk(s.supported && s.on) }).catch(() => {})
    return () => { gone = true }
  }, [])
  return ok
}

export function WorkoutEffortPicker({ wid }) {
  const S = useStore(s => s.S)
  const available = useEffortAvailable()
  const mode = effortModeOf(S)
  const w = (S.workouts || []).find(x => x && x.id === wid)
  if (!available || mode === 'never' || !w) return null
  // Asked on the Apple Watch that saved the workout: answered there, linked there.
  if (mode === 'ask' && w.effortBy !== 'phone' && watchAsksEffort(wid)) return null
  const value = cleanEffort(w.effort)
  const pick = n => {
    const next = n === value ? null : n
    useStore.getState().update(s => { setWorkoutEffort(s, wid, next, 'phone', stampWorkout) })
    if (next != null) askEffort(() => useStore.getState().S).catch(() => {})
  }
  const word = value == null ? null : WORDS[effortWord(value)]()
  return <div style={{ textAlign: 'start', marginBottom: 14 }} data-workout-effort>
    <h4 className="sec">{t('How hard was it?')}</h4>
    <div role="radiogroup" aria-label={t('Workout effort')}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(10, minmax(0, 1fr))', gap: 4 }}>
      {SCORES.map(n => {
        const on = n === value
        const c = colorOf(n)
        return <button key={n} type="button" role="radio" aria-checked={on} data-effort={n}
          onClick={() => pick(n)}
          style={{
            minHeight: 40, padding: 0, borderRadius: 10, border: 'none', font: 'inherit', fontWeight: 600,
            fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
            color: on ? 'var(--bg)' : c,
            background: on ? c : `color-mix(in srgb, ${c} 16%, var(--surface-2))`,
          }}>{n}</button>
      })}
    </div>
    <div className="small dim" style={{ marginTop: 6 }}>
      {word
        ? (w.effortBy === 'auto' ? t('{0}, set from your sets. Tap to change it.', word) : t('{0}. Goes to Apple Health with the workout.', word))
        : t('Easy 1 to 3, moderate 4 to 6, hard 7 and 8, all out 9 and 10.')}
    </div>
  </div>
}
