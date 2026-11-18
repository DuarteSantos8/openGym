import { useEffect, useMemo, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import { curveVersion, exerciseCurve, exerciseHeart, heartLatest, heartPoints, parseFormat, setCurve } from '../lib/heart-history.js'
import { heartStepText } from '../lib/heart-steps.js'
import { workoutSamples } from '../lib/health-sync.js'
import { syncKeyOf } from '../lib/workout-date.js'
import { DEFAULT_HR_MAX, ZONE_FLOOR, ZONES, hrMaxOf } from '../lib/live-tiles.js'
import LineChart from './LineChart.jsx'
import { Segmented } from './ui.jsx'

// How many sessions can lie over each other, and how many are on at first.
const OVERLAY_MAX = 6
const OVERLAY_ON = 3
// One colour per session, the newest first.
const COLORS = ['var(--label)', 'var(--blue)', 'var(--orange)', 'var(--green)', 'var(--pink)', 'var(--teal)']

// 1:05 for 65 seconds.
const secClock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const formatLabel = (key, unit) => {
  const f = parseFormat(key)
  if (!f) return key
  if (f.mode === 'time') return secClock(f.sec)
  return f.w ? `${f.r} × ${fmtNum(f.w)} ${unit}` : `${f.r} ${t('reps')}`
}

/**
 * Which sessions the heart tab lays over each other, shared by the tab and the sessions listed
 * under it (a card in the list picks or drops its session): the format compared, its sessions
 * newest first, and the ones picked in the order they were (their colours follow it), the last
 * few at first.
 */
export function useHeartPick(workouts, exId) {
  const heart = useMemo(() => exerciseHeart(workouts, exId), [workouts, exId])
  const [format, setFormatRaw] = useState(null)
  const key = heart.formats.some(f => f.key === format) ? format : heart.formats[0]?.key
  // A window of time to compare within (days, 0 for all), as Stats has.
  const [range, setRangeRaw] = useState(0)
  const sessions = useMemo(() => {
    const from = range ? Date.now() - range * 86400000 : 0
    return key ? heart.sessions(key).filter(s => !from || s.at >= from) : []
  }, [heart, key, range])
  const [picked, setPicked] = useState(null)
  const chosen = (picked || sessions.slice(0, OVERLAY_ON).map(s => s.id)).filter(id => sessions.some(s => s.id === id))
  return {
    heart, key, sessions, chosen, range,
    setFormat: f => { setFormatRaw(f); setPicked(null) },
    setRange: d => { setRangeRaw(d); setPicked(null) },
    can: id => sessions.some(s => s.id === id),
    toggle: id => setPicked(chosen.includes(id) ? chosen.filter(x => x !== id) : chosen.length < OVERLAY_MAX ? [...chosen, id] : chosen),
    colorOf: id => (chosen.includes(id) ? COLORS[chosen.indexOf(id) % COLORS.length] : null),
  }
}

/**
 * The props that make a session's card in the list pick or drop it on the heart tab: a toggle,
 * marked with its colour on the side while picked. `style` is the card's own, kept.
 */
export function pickProps(pick, id, style = {}) {
  const color = pick.colorOf(id)
  const go = () => pick.toggle(id)
  return {
    role: 'button', tabIndex: 0, 'aria-pressed': !!color, 'data-pick': '',
    onClick: go, onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } },
    style: { ...style, cursor: 'pointer', boxShadow: color ? `inset 4px 0 0 ${color}` : undefined },
  }
}

// An exercise's heart rate in its history sheet: the sets of one format compared session after
// session (lib/heart-history.js), then the picked sessions laid over each other on the zones.
// Each session's curve is the one kept with the workout (lib/heart-history.js packCurve), or the
// phone's health hub read then; a session with neither has its sets' own readings, set after set.
export default function ExerciseHeart ({ workouts = [], exId, unit = '', pick }) {
  const S = useStore(s => s.S)
  const hrMax = hrMaxOf(S) || DEFAULT_HR_MAX
  const { heart, key, sessions, chosen, colorOf, setFormat, range, setRange } = pick
  const [measure, setMeasure] = useState('avg')
  const shown = chosen.map(id => sessions.find(s => s.id === id))

  // Each picked session's readings: { [workout id]: { ver, data } } (lib/health-sync.js
  // workoutSamples), read again when its kept curve or its times change (a sync brought the curve).
  const [samples, setSamples] = useState({})
  const verOf = w => `${w?.start}:${w?.end}:${curveVersion(w?.hrc)}`
  const wanted = chosen.map(id => id + '@' + verOf(workouts.find(x => x && syncKeyOf(x) === id))).join(',')
  useEffect(() => {
    if (!chosen.length) return
    let open = true
    Promise.all(shown.map(async s => {
      const w = workouts.find(x => x && syncKeyOf(x) === s.id)
      if (!w?.start || !w?.end) return null
      const ver = verOf(w)
      const had = samples[s.id]
      return [s.id, had && had.ver === ver ? had : { ver, data: await workoutSamples(w, S) }]
    })).then(rows => { if (open) setSamples(was => ({ ...was, ...Object.fromEntries(rows.filter(Boolean)) })) })
    return () => { open = false }
  }, [wanted])

  if (!key) return null
  const curves = shown.map(s => {
    const w = workouts.find(x => x && syncKeyOf(x) === s.id)
    const color = colorOf(s.id)
    const got = samples[s.id]?.ver === verOf(w) ? samples[s.id].data : null
    const fine = w && got?.length ? exerciseCurve(w, exId, got, hrMax, key) : null
    return { s, color, fine, sets: w ? setCurve(w, exId, key) : [] }
  })
  // Every shown session has the hub's curve: lay them out in time; otherwise set after set.
  const timed = curves.length > 0 && curves.every(c => c.fine)
  const measures = [
    { key: 'avg', label: t('Average bpm'), color: 'var(--red)' },
    { key: 'max', label: t('Max'), color: 'var(--orange)' },
    { key: 'rest', label: t('Rest'), color: 'var(--indigo)' },
  ]
  const pickedMeasure = measures.find(m => m.key === measure)
  const latest = heartLatest(sessions, measure)
  return <div className="exercise-heart">
    {heart.formats.length > 1 && <div className="chips" style={{ marginBottom: 8 }}>
      {heart.formats.map(f => <button key={f.key} type="button" className={'chip nocap' + (f.key === key ? ' on' : '')} aria-pressed={f.key === key}
        onClick={() => setFormat(f.key)}>{formatLabel(f.key, unit)}</button>)}
    </div>}
    <Segmented className="seg-range" of={t('Heart rate')} value={range} onChange={setRange}
      options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
    <div className="heart-tiles" style={{ marginTop: 8 }}>
      {measures.map(m => {
        // All three from the same session, the last one: a tile never shows an older day's number.
        const v = sessions[0]?.[m.key]
        return <button key={m.key} type="button" aria-pressed={m.key === measure} onClick={() => setMeasure(m.key)}
          style={m.key === measure ? { '--tile-color': m.color } : undefined}>
          <b>{v != null ? v : '–'}</b><span>{m.label}</span>
        </button>
      })}
    </div>
    <div className="chart" style={{ marginTop: 8 }}>
      {latest.value != null && <div className="heart-latest">
        <span>{t('Last session')}</span>
        <b>{latest.value} {t('bpm')}</b>
        {latest.delta ? <em>{latest.delta > 0 ? '+' : '−'}{Math.abs(latest.delta)}</em> : null}
      </div>}
      <LineChart points={heartPoints(sessions, measure)} h={120} unit={t('bpm')} color={pickedMeasure.color} />
    </div>
    {sessions.length > 0 && <>
      <div style={{ height: 10 }} />
      {curves.length > 0 && <Overlay curves={curves} timed={timed} max={hrMax} />}
      <div className="small" style={{ marginTop: 6 }}>
        {curves.map(c => <div key={c.s.id} className="row between exercise-heart-legend">
          <span className="row" style={{ gap: 6 }}><span className="exercise-heart-dot" style={{ background: c.color }} />{fmtDate(c.s.d, true)}</span>
          <span className="muted">{timed ? heartStepText(c.fine.stats) : t('Average {0} · Max {1} bpm', c.s.avg, c.s.max)}</span>
        </div>)}
      </div>
    </>}
  </div>
}

const W = 340
const H = 136
const GUTTER = 30
// A zone's lower edge as a share of the maximum (zone 1 from the floor, each 10 % more).
const floorOf = z => ZONE_FLOOR + (z - 1) / (ZONES * 2)

// The sessions' curves over each other on the five zones, in time from the start of the exercise
// or set after set. Unlike the session's card (components/HeartGraph.jsx) the scale is the curves'
// own, a little beyond their lowest and highest reading, so sessions a few beats apart still read
// apart; the zones stay where they are on that scale.
function Overlay ({ curves, timed, max }) {
  const values = curves.flatMap(c => (timed ? c.fine.points.map(p => p.hr) : c.sets.map(p => p.hr)))
  const lo = Math.max(30, Math.min(...values) - 8)
  const hi = Math.max(lo + 20, Math.max(...values) + 6)
  const y = bpm => H - (Math.min(hi, Math.max(lo, bpm)) - lo) / (hi - lo) * H
  const span = timed ? Math.max(1, ...curves.map(c => c.fine.span)) : Math.max(1, ...curves.map(c => c.sets.length))
  const x = v => GUTTER + 4 + (timed ? v / span : span > 1 ? (v - 1) / (span - 1) : 0.5) * (W - GUTTER - 12)
  const ticks = timed ? [0, span / 2, span] : Array.from({ length: span }, (_, i) => i + 1)
  const zones = Array.from({ length: ZONES }, (_, i) => {
    const z = i + 1
    const from = z === 1 ? 0 : floorOf(z) * max, to = z === ZONES ? Infinity : floorOf(z + 1) * max
    return { z, from, to }
  }).filter(b => b.to > lo && b.from < hi)
  return <svg className="heart-graph" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={t('Heart rate')} direction="ltr">
    {zones.map(b => {
      const top = y(Math.min(hi, b.to)), bottom = y(Math.max(lo, b.from))
      return <g key={b.z}>
        <rect x={GUTTER} y={top + 1} width={W - GUTTER} height={Math.max(0, bottom - top - 2)} rx="4" fill={`var(--z${b.z})`} opacity={0.3} />
        {b.from > lo && <text x={GUTTER - 6} y={bottom + 3.5} textAnchor="end" className="heart-graph-z">{Math.round(b.from)}</text>}
      </g>
    })}
    {ticks.map((v, i) => <text key={v} x={x(v)} y={H + 11} textAnchor={!timed ? 'middle' : i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} className="heart-graph-z">{timed ? secClock(Math.round(v / 1000)) : v}</text>)}
    {[...curves].reverse().map(c => {
      const pts = timed ? c.fine.points.map(p => [x(p.t), y(p.hr)]) : c.sets.map(p => [x(p.x), y(p.hr)])
      if (!pts.length) return null
      return <g key={c.s.id}>
        {pts.length > 1 && <polyline points={pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')} fill="none" stroke={c.color}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        {!timed && pts.map(([a, b], i) => <circle key={i} cx={a} cy={b} r="3" fill={c.color} />)}
      </g>
    })}
  </svg>
}
