// The Garmin insight cards (views/Garmin.jsx): body battery through a day, what each routine costs,
// sleep against lifts, running economy, training load, and the partners' shared week. Each is one
// card, or null when its helper (lib/garmin-insights.js) has nothing yet. Plain English: ours.
import { useState } from 'react'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { fmtDuration, fmtClock, READY_TITLE } from '../lib/garmin.js'
import { bbCurve, sessionCost, sleepVsStrength, runEfficiency, trainingLoad } from '../lib/garmin-insights.js'
import { BarRow } from './StatBars.jsx'
import { GHead, CountUp, useScrub, ScrubTip, ScrubMark } from './GarminFx.jsx'

const W = 340, P = { l: 26, r: 8, t: 18, b: 18 }
const n0 = v => fmtNum(Math.round(v))
const sgn = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v).toFixed(d)
const KIND = { gym: 'var(--acc)', activity: 'var(--indigo)' }

export function BodyBatteryCard({ g, S }) {
  const today = todayISO()
  const days = (g?.days || []).filter(d => d.bb15?.length).map(d => d.date).sort().slice(-7)
  const [pick, setPick] = useState(null)
  const day = days.includes(pick) ? pick : days.includes(today) ? today : days[days.length - 1]
  const c = days.length ? bbCurve(g, day, S.workouts) : null
  const h = 150
  const X = m => P.l + (m / 1440) * (W - P.l - P.r)
  const { i: at, bind } = useScrub(c ? c.points.map(p => X(p.m)) : [], W)
  if (!c) return null
  const Y = v => P.t + (1 - v / 100) * (h - P.t - P.b)
  const line = c.points.map(p => `${X(p.m).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const first = c.points[0], last = c.points[c.points.length - 1]
  const area = `${X(first.m).toFixed(1)},${Y(0)} ${line} ${X(last.m).toFixed(1)},${Y(0)}`
  return <div className="card">
    <GHead label="Body battery through the day" info="bb" />
    <div className="g-days">
      {[...days].reverse().map(d => <button type="button" key={d} className={'chip' + (d === day ? ' on' : '')} aria-pressed={d === day} onClick={() => setPick(d)}>{d === today ? 'Today' : fmtDate(d)}</button>)}
    </div>
    <div {...bind}><svg key={day} viewBox={`0 0 ${W} ${h}`} width="100%" role="img" aria-label={`Body battery on ${fmtDate(day)}, ${Math.round(first.y)} at the start and ${Math.round(last.y)} at the end`}>
      {[0, 50, 100].map(v => <text key={v} x={P.l - 4} y={Y(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{v}</text>)}
      {c.marks.map((k, i) => <g key={i} className="g-fade">
        <rect x={X(k.from)} y={P.t} width={Math.max(2, X(k.to) - X(k.from))} height={h - P.t - P.b} fill={KIND[k.kind]} opacity="0.18" />
        <text x={X(k.from)} y={P.t - 5} fontSize="9.5" fill="var(--label-2)">{k.label.length > 14 ? k.label.slice(0, 13) + '…' : k.label}</text>
      </g>)}
      <polygon className="g-fade" points={area} fill="var(--acc)" opacity="0.12" />
      <polyline className="g-draw" pathLength="1" points={line} fill="none" stroke="var(--acc)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {[0, 6, 12, 18, 24].map(hr => <text key={hr} x={X(hr * 60)} y={h - 4} textAnchor={hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle'} fontSize="9.5" fill="var(--label-2)">{String(hr).padStart(2, '0')}:00</text>)}
      <ScrubMark x={at != null ? X(c.points[at].m) : null} y={at != null ? Y(c.points[at].y) : null} top={P.t} bottom={h - P.b} />
    </svg>
    <ScrubTip x={at != null ? X(c.points[at].m) : null} W={W}>{at != null && <><b>{Math.round(c.points[at].y)}</b> at {c.points[at].m >= 1440 ? "24:00" : fmtClock(c.points[at].m)}</>}</ScrubTip>
    </div>
    {c.marks.length > 0 && <div className="small" style={{ marginTop: 8, lineHeight: 1.6 }}>
      {c.marks.map((k, i) => <div key={i}>
        <span style={{ color: KIND[k.kind] }}>● </span>{k.label} <span className="muted">{fmtClock(k.from)} to {fmtClock(k.to)}{k.cost != null ? `, ${sgn(k.cost)}` : ''}</span>
      </div>)}
    </div>}
  </div>
}

export function SessionCostCard({ g, S }) {
  const rows = sessionCost(g, S.workouts, S.routines)
  if (!rows.length) return null
  return <div className="card">
    <GHead label="What each routine costs you" info="cost" />
    {rows.map(r => <div key={r.rid} style={{ marginTop: 10 }}>
      <div><b>{r.name}</b> <span className="muted small">{r.n} sessions</span></div>
      <div className="small" style={{ lineHeight: 1.6 }}>
        {r.bb != null && <div>{sgn(Math.round(r.bb))} battery</div>}
        {r.hrvNext != null && <div>HRV {sgn(Math.round(r.hrvNext * 100))}% next morning</div>}
        {r.rhrNext != null && <div>Resting heart rate {sgn(Math.round(r.rhrNext))} bpm next morning</div>}
      </div>
    </div>)}
  </div>
}

export function SleepStrengthCard({ g, S }) {
  const r = sleepVsStrength(S, g)
  if (!r) return null
  const rows = [['After a good night', r.good, 'acc'], ['After a short or poor night', r.poor, 'neutral']]
  const top = Math.max(...rows.map(x => Math.abs(x[1].pct)), 1)
  return <div className="card">
    <GHead label="Sleep and your lifts" info="sleeplift" />
    <div style={{ marginTop: 8 }}>
      {rows.map(([label, x, tone]) => <BarRow key={label} label={label} tone={tone} fill={Math.abs(x.pct) / top} value={`${sgn(x.pct, 1)}% · ${x.n} sessions`} />)}
    </div>
    <div className="small" style={{ marginTop: 8 }}>
      {r.good.pct > r.poor.pct ? `You lift ${(r.good.pct - r.poor.pct).toFixed(1)}% more after a good night` : 'Sleep has not shown in your lifts yet'}
    </div>
  </div>
}

export function RunEfficiencyCard({ g }) {
  const r = runEfficiency(g)
  const pts = r?.points || []
  const X = i => P.l + 6 + (i / Math.max(1, pts.length - 1)) * (W - P.l - P.r - 6)
  const { i: at, bind } = useScrub(pts.map((_, i) => X(i)), W)
  if (!r) return null
  const h = 140
  const ys = pts.map(p => p.y)
  let lo = Math.min(...ys), hi = Math.max(...ys)
  const pad = (hi - lo) * 0.1 || 0.1
  lo -= pad; hi += pad
  const Y = v => 8 + (1 - (v - lo) / (hi - lo)) * (h - 8 - P.b)
  const lastP = pts[pts.length - 1]
  const c = r.change
  const sel = at != null ? pts[at] : null
  return <div className="card">
    <GHead label="Running economy" info="run" />
    <div className="big"><CountUp value={lastP.y} fmt={v => v.toFixed(2)} /> <span className="muted small">m per heartbeat</span></div>
    <div {...bind}><svg viewBox={`0 0 ${W} ${h}`} width="100%" role="img" aria-label={`Metres per heartbeat over ${pts.length} runs, latest ${lastP.y.toFixed(2)}`}>
      <polyline className="g-draw" pathLength="1" points={pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')} fill="none" stroke="var(--acc)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <circle className="g-pop-in" cx={X(pts.length - 1)} cy={Y(lastP.y)} r="4" fill="var(--acc)" />
      <ScrubMark x={sel && X(at)} y={sel && Y(sel.y)} top={8} bottom={h - P.b} />
      {[hi - pad, lo + pad].map(v => <text key={v} x={P.l - 4} y={Y(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{v.toFixed(1)}</text>)}
      <text x={P.l} y={h - 4} fontSize="9.5" fill="var(--label-2)">{fmtDate(pts[0].d)}</text>
      <text x={W - P.r} y={h - 4} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtDate(lastP.d)}</text>
    </svg>
    <ScrubTip x={sel && X(at)} W={W}>{sel && <><b>{sel.y.toFixed(2)} m</b> per beat, {fmtDate(sel.d)}</>}</ScrubTip>
    </div>
    <div className="small">
      {c == null ? 'Needs 6 runs with heart rate'
        : c >= 0 ? `${c}% more distance per heartbeat than at the start: fitter`
        : `${Math.abs(c)}% less distance per heartbeat than at the start: not as fit`}
    </div>
  </div>
}

export function TrainingLoadCard({ g, S }) {
  const t = trainingLoad(g, S.workouts, todayISO(), 8)
  const n = t.weeks.length, slot0 = (W - P.l - P.r) / Math.max(1, n)
  const { i: at, bind } = useScrub(t.weeks.map((_, i) => P.l + (i + 0.5) * slot0), W)
  if (!t.weeks.some(w => w.garmin || w.gym)) return null
  const h = 130
  const mg = Math.max(...t.weeks.map(w => w.garmin), 1), mv = Math.max(...t.weeks.map(w => w.gym), 1)
  const slot = (W - P.l - P.r) / n, bw = slot * 0.36
  const base = h - P.b, ph = base - 8
  const ratio = t.ratio
  return <div className="card">
    <GHead label="Training load, 8 weeks" info="load" />
    <div {...bind}><svg viewBox={`0 0 ${W} ${h}`} width="100%" role="img" aria-label="Weekly watch load and gym volume for the last 8 weeks">
      {t.weeks.map((w, i) => {
        const x = P.l + i * slot + slot * 0.1, a = w.garmin / mg * ph, b = w.gym / mv * ph
        return <g key={w.from} className={at != null && at !== i ? 'g-dim' : undefined} style={{ '--k': i }}>
          <rect className="g-grow" x={x} y={base - a} width={bw} height={a} rx="2" fill="var(--orange)" />
          <rect className="g-grow" x={x + bw + 1} y={base - b} width={bw} height={b} rx="2" fill="var(--indigo)" />
        </g>
      })}
      <line x1={P.l} x2={W - P.r} y1={base} y2={base} stroke="var(--label-2)" opacity="0.3" />
      <text x={P.l} y={h - 4} fontSize="9.5" fill="var(--label-2)">{fmtDate(t.weeks[0].from)}</text>
      <text x={W - P.r} y={h - 4} textAnchor="end" fontSize="9.5" fill="var(--label-2)">{fmtDate(t.weeks[n - 1].from)}</text>
    </svg>
    <ScrubTip x={at != null ? P.l + (at + 0.5) * slot : null} W={W}>{at != null && <>Week of {fmtDate(t.weeks[at].from)}: <b>{n0(t.weeks[at].garmin)}</b> load, <b>{n0(t.weeks[at].gym)}</b> kg</>}</ScrubTip>
    </div>
    <div className="small muted" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      <span><span style={{ color: 'var(--orange)' }}>■ </span>Watch load</span>
      <span><span style={{ color: 'var(--indigo)' }}>■ </span>Gym volume (kg lifted)</span>
    </div>
    <div className="small" style={{ marginTop: 8 }}>
      Last 7 days {n0(t.acute)}, usual {n0(t.chronic)}{ratio != null && `. ${ratio > 1.5 ? 'Load jumped: injury risk goes up above 1.5' : ratio < 0.8 ? 'Lighter than usual: fine for a deload' : 'Steady'}`}
    </div>
  </div>
}

export function PartnerCard({ g }) {
  const ps = g?.partners || []
  if (!ps.length) return null
  return <div className="card">
    <GHead label="Shared with you" info="partners" />
    {ps.map(p => {
      const bits = [
        p.ready && (p.ready === 'sick' ? 'May be fighting something' : READY_TITLE[p.ready]),
        p.sleepSec != null && `Slept ${fmtDuration(p.sleepSec)}${p.sleepScore != null ? `, score ${Math.round(p.sleepScore)}` : ''}`,
        p.steps != null && `${n0(p.steps)} steps today`,
        p.bb != null && `Body battery ${Math.round(p.bb)}`,
      ].filter(Boolean)
      return <div key={p.uid} style={{ marginTop: 10 }}>
        <b>{p.name}</b>
        {bits.length > 0 && <div className="small muted">{bits.join(' · ')}</div>}
      </div>
    })}
  </div>
}

export function TeamCard({ g }) {
  const prefs = g?.prefs || {}, kind = prefs.teamKind || 'steps', im = kind === 'im'
  const goal = prefs.teamGoal || (im ? 300 : 140000)
  const to = todayISO(), d = new Date(to + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 6)
  const from = d.toISOString().slice(0, 10)
  const week = (g?.days || []).filter(x => x.date >= from && x.date <= to)
  const mine = week.reduce((s, x) => s + (im ? (x.imMod || 0) + 2 * (x.imVig || 0) : x.steps || 0), 0)
  const people = [{ key: 'me', name: 'You', v: mine }]
  for (const p of g?.partners || []) { const v = im ? p.weekIm : p.weekSteps; if (v != null) people.push({ key: p.uid, name: p.name, v }) }
  if (people.length < 2) return null
  const total = people.reduce((s, p) => s + p.v, 0), unit = im ? 'minutes' : 'steps'
  return <div className="card">
    <GHead label="Together this week" info="team" />
    <div style={{ marginTop: 8 }}>
      {people.map(p => <BarRow key={p.key} label={p.name} tone="acc" fill={p.v / goal} value={n0(p.v)} />)}
      <BarRow label="Total" tone={total >= goal ? 'in' : 'neutral'} fill={total / goal} value={`${n0(total)} / ${n0(goal)} ${unit}`} />
    </div>
  </div>
}
