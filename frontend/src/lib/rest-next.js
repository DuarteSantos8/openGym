// The set a rest is for, in one line for the notification at its end (QOL Q6): "Bench press,
// 80 kg × 8", "Plank, 45 s", "Treadmill, 20 min". The same next set the spoken cues and the
// watches name (lib/spoken-cues.js nextSetAfter), in the unit the exercise is shown in.
import { nextSetAfter } from './spoken-cues.js'
import { isWarmupRow, isSideSet } from './workout-model.js'
import { modeOf } from './history.js'
import { fmtNum, exerciseNameText } from './format.js'
import { t, tn } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { viewEntry, exUnitOf } from './ex-unit.js'

/** The next set after a rest started by entry `forIdx`, as a line, or '' when nothing is left. */
export function restNextLine(S, forIdx) {
  const next = nextSetAfter(S?.active, forIdx)
  if (!next) return ''
  const entry = S.active.entries[next.idx]
  const view = viewEntry(S, entry) || entry
  const s = view?.sets?.[next.i]
  if (!s) return ''
  const ex = EXIDX[entry.id]
  const name = (ex ? exerciseNameText(ex) : entry.n) || ''
  const unit = exUnitOf(S, entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const side = isSideSet(s) ? s.sides.L : null
  const w = Number(side ? side.w : s.w) || 0
  const r = Number(side ? side.r : s.r) || 0
  let what = ''
  if (mode === 'cardio') {
    const min = Number(s.min) || 0
    if (min > 0) what = t('{0} min', fmtNum(min))
  } else if (mode === 'time') {
    const sec = Number(s.sec ?? entry.target?.sec) || 0
    const hold = sec > 0 ? t('{0} s', sec) : ''
    what = [w > 0 ? `${fmtNum(w)} ${unit}` : '', hold].filter(Boolean).join(', ')
  } else if (r > 0) {
    what = w > 0 ? `${fmtNum(w)} ${unit} × ${r}` : tn('{0} rep', '{0} reps', r)
    if (side) what += ' ' + t('per side')
  }
  return [name, isWarmupRow(s) ? t('Warm-up') : '', what].filter(Boolean).join(', ')
}

/** The notification's title at the end of a rest: the next set when there is one. */
export const restOverTitle = line => (line ? t('Rest’s over: {0}', line) : t('Rest’s over. Next set!'))
