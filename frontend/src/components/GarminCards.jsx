// Garmin data where the rest of the app already looks: the workout detail sheet (the watch's
// recording of that session) and Stats (the week, gym and everything else together). Both stay
// empty until the account connects Garmin (views/Garmin.jsx). Plain English: ours, not upstream's.
import { fmtNum, todayISO } from '../lib/format.js'
import { matchWorkout, weekSummary, fmtDuration, activityType } from '../lib/garmin.js'
import { useGarmin } from './useGarmin.js'
import { BarRow } from './StatBars.jsx'

const n0 = v => fmtNum(Math.round(v))

/** In a saved workout: what the watch recorded during it. */
export function GarminWorkoutCard({ w }) {
  const a = matchWorkout(useGarmin(), w)
  if (!a) return null
  const zones = a.zones || []
  const total = zones.reduce((s, x) => s + x, 0)
  const facts = [
    a.kcal && `${n0(a.kcal)} kcal`,
    a.hr && `avg ${Math.round(a.hr)} bpm`,
    a.maxHr && `max ${Math.round(a.maxHr)} bpm`,
    a.te && `training effect ${a.te.toFixed(1)}`,
    a.bb && `body battery ${a.bb > 0 ? '+' : ''}${a.bb}`,
  ].filter(Boolean)
  return <div style={{ margin: '4px 0 14px' }}>
    <div className="small muted" style={{ marginBottom: 4 }}>Garmin · {a.name || activityType(a.type)}</div>
    <div className="small">{facts.join(' · ')}</div>
    {total > 0 && <div style={{ marginTop: 8 }}>
      {zones.map((sec, i) => <BarRow key={i} label={`Zone ${i + 1}`} value={sec ? fmtDuration(sec) : '–'} fill={sec / Math.max(...zones)} tone={i >= 3 ? 'acc' : 'neutral'} />)}
    </div>}
  </div>
}

const delta = (now, before, unit, fmt = n0) => (now != null && before != null && Math.round(now) !== Math.round(before)
  ? ` (${now > before ? '+' : '−'}${fmt(Math.abs(now - before))}${unit} on the week before)` : '')

/** In Stats: the last seven days, the gym and the watch together. */
export function GarminWeekCard({ S }) {
  const g = useGarmin()
  if (!g?.connected) return null
  const s = weekSummary(g, S.workouts, todayISO())
  const im = s.im ?? 0
  return <div className="card">
    <h2>Last 7 days</h2>
    <div className="tiles" style={{ marginBottom: 8 }}>
      <div className="tile"><div className="l">Gym sessions</div><div className="v">{s.gym}</div></div>
      <div className="tile"><div className="l">Other activities</div><div className="v">{s.other}</div>
        {s.other > 0 && <div className="muted small">{s.km >= 0.1 ? `${s.km.toFixed(1)} km · ` : ''}{n0(s.otherKcal)} kcal</div>}</div>
    </div>
    {s.im != null && <BarRow label="Intensity minutes" value={`${n0(im)} / 150`} fill={im / 150} tone={im >= 150 ? 'in' : 'acc'} />}
    <div className="small" style={{ marginTop: 10, lineHeight: 1.6 }}>
      {s.sleep != null && <div>Sleep {fmtDuration(s.sleep)} a night<span className="muted">{delta(s.sleep / 60, s.sleepPrev != null ? s.sleepPrev / 60 : null, ' min')}</span></div>}
      {s.hrv != null && <div>HRV {n0(s.hrv)} ms<span className="muted">{delta(s.hrv, s.hrvPrev, ' ms')}</span></div>}
      {s.rhr != null && <div>Resting heart rate {n0(s.rhr)} bpm<span className="muted">{delta(s.rhr, s.rhrPrev, ' bpm')}</span></div>}
      {s.steps != null && <div>{n0(s.steps)} steps a day</div>}
    </div>
  </div>
}
