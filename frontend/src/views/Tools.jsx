import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { countedS } from '../lib/counted-log.js'
import { exOr } from '../lib/exercises.js'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import { Segmented, Stepper, TextField } from '../components/ui.jsx'
import { exercisePicker } from '../sheets.jsx'
import { best1RM, formulaOf } from '../lib/onerm.js'
import { lastBW, modeOf } from '../lib/history.js'
import { dropGrid } from '../lib/plates.js'
import { currentDbLoad } from '../lib/dumbbells.js'
import { sexOf } from '../lib/strength-level.js'
import { lengthUnitOf } from '../lib/measurements.js'
import { distUnitOf, distLabel } from '../lib/distance.js'
import {
  LB_PER_KG, CM_PER_IN, percentTable, rpeLoad, dots, wilks, ipfGl, bmi, bmiBand, ffmi, navyBodyFat,
  pace, timeAt, RACES, fmtClock, parseClock,
} from '../lib/calculators.js'

// Tools (gm-tools, 1.4.5): the calculators people open another app for, filled in from what is
// already logged (lib/calculators.js holds the formulas and their sources). Nothing typed here is
// saved except your height, which nothing else in the app knows and every body formula needs.
// Stats → More → Tools.

// The big three for a powerlifting total, by catalogue id (as lib/strength-level.js grades them).
const TOTAL_LIFTS = { squat: ['0043', '3593'], bench: ['0025'], deadlift: ['0032', '0117'] }
const MI_KM = 1.609344

const BMI_LABEL = { under: 'Underweight', normal: 'Healthy range', over: 'Overweight', obese: 'Obese' }

export default function Tools() {
  const nav = useNavigate()
  const S = countedS(useStore(s => s.S))
  const update = useStore(s => s.update)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const toKg = v => (unit === 'lb' ? v / LB_PER_KG : v)
  const lenUnit = lengthUnitOf(S)
  const toCm = v => (lenUnit === 'in' ? v * CM_PER_IN : v)
  const fromCm = v => (lenUnit === 'in' ? Math.round(v / CM_PER_IN * 10) / 10 : Math.round(v * 10) / 10)
  const formula = formulaOf(S)

  // Lifts with an estimated 1RM, most logged first: the chips of the % table.
  const lifts = useMemo(() => {
    const count = new Map()
    for (const w of S.workouts || []) for (const e of w.entries || []) {
      if (modeOf({ ...(e.target || {}), id: e.id }) === 'reps') count.set(e.id, (count.get(e.id) || 0) + 1)
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
      .map(id => ({ id, best: best1RM(S, id, formula, currentDbLoad(S, id)) })).filter(x => x.best?.est > 0).slice(0, 6)
  }, [S.workouts, formula]) // eslint-disable-line react-hooks/exhaustive-deps

  const bwEntry = lastBW(S)
  const bwNow = Number(bwEntry?.w) > 0 ? Math.round(Number(bwEntry.w) * 10) / 10 : null
  const latest = key => { for (let i = (S.measurements || []).length - 1; i >= 0; i--) { const v = Number(S.measurements[i]?.[key]); if (v > 0) return v } return null }

  return <>
    <ScreenHeader hard title={t('Tools')} sub={t('Calculators, already filled in from your log.')}
      left={<button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>} />
    <PercentCard S={S} lifts={lifts} unit={unit} formula={formula} />
    <RpeCard S={S} lifts={lifts} unit={unit} />
    <ScoresCard S={S} unit={unit} toKg={toKg} bwNow={bwNow} formula={formula} />
    <BodyCard S={S} update={update} unit={unit} toKg={toKg} bwNow={bwNow} lenUnit={lenUnit} toCm={toCm} fromCm={fromCm}
      neck={latest('neck')} waist={latest('waist')} hips={latest('hips')} bodyFat={latest('bodyFat')} />
    <PaceCard S={S} />
    <div className="small dim tools-foot">{t('Estimates, not a lab. Good for planning, not for arguing.')}</div>
  </>
}

function LiftChips({ lifts, value, onPick, onOther }) {
  return <div className="chips tools-chips">
    {lifts.map(l => <button key={l.id} type="button" className={'chip nocap' + (value === l.id ? ' on' : '')} aria-pressed={value === l.id} onClick={() => onPick(l.id)}>
      <span className={exerciseNameClass(exOr(l.id))}>{exerciseNameFor(exOr(l.id))}</span></button>)}
    <button type="button" className="chip add" onClick={onOther}><Icon name="magnifier" />{t('Other')}</button>
  </div>
}

// Which lift a card works from, and its 1RM: from the log until you type your own.
function useLift(S, lifts) {
  const [id, setId] = useState(lifts[0]?.id || null)
  const [typed, setTyped] = useState(null)
  const best = useMemo(() => (id ? best1RM(S, id, formulaOf(S), currentDbLoad(S, id)) : null), [S.workouts, id]) // eslint-disable-line react-hooks/exhaustive-deps
  const oneRm = typed ?? (best?.est || 100)
  const pick = next => { setId(next); setTyped(null) }
  const other = () => { const p = exercisePicker(ex => { pick(ex.id); p.close() }, { title: t('Pick a lift') }) }
  const grid = dropGrid(S, id ? { id } : {})
  return { id, best, oneRm, setOneRm: setTyped, pick, other, grid, typed: typed != null }
}

function PercentCard({ S, lifts, unit, formula }) {
  const L = useLift(S, lifts)
  const rows = percentTable(L.oneRm, { grid: L.grid, formula })
  return <section className="card tools-card" aria-labelledby="tools-pct">
    <h2 id="tools-pct" className="tools-h"><Icon name="calculator" />{t('% of your 1RM')}</h2>
    <LiftChips lifts={lifts} value={L.id} onPick={L.pick} onOther={L.other} />
    <div className="row cfgrow" style={{ marginBottom: 6 }}>
      <Stepper label={t('1RM ({0})', unit)} value={Math.round(L.oneRm * 10) / 10} step={unit === 'lb' ? 5 : 2.5} onChange={L.setOneRm} />
    </div>
    <div className="small dim" style={{ marginBottom: 8 }}>{L.best && !L.typed
      ? t('Your best estimate, from {0} × {1}.', fmtNum(L.best.w) + ' ' + unit, L.best.r)
      : t('Rounded down to what your plates can load.')}</div>
    <table className="reptable tools-table">
      <thead><tr><th scope="col">%</th><th scope="col">{t('Load')}</th><th scope="col">{t('About')}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.pct}>
        <th scope="row">{r.pct}%</th>
        <td><b>{fmtNum(r.w)} {unit}</b></td>
        <td className="dim">{r.reps == null ? t('12+ reps') : tn('{0} rep', '{0} reps', r.reps)}</td>
      </tr>)}</tbody>
    </table>
  </section>
}

function RpeCard({ S, lifts, unit }) {
  const L = useLift(S, lifts)
  const [reps, setReps] = useState(5)
  const [rpe, setRpe] = useState(8)
  const res = rpeLoad(L.oneRm, reps, rpe, L.grid)
  return <section className="card tools-card" aria-labelledby="tools-rpe">
    <h2 id="tools-rpe" className="tools-h"><Icon name="gauge" />{t('Load for reps at an RPE')}</h2>
    <LiftChips lifts={lifts} value={L.id} onPick={L.pick} onOther={L.other} />
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('1RM ({0})', unit)} value={Math.round(L.oneRm * 10) / 10} step={unit === 'lb' ? 5 : 2.5} onChange={L.setOneRm} />
      <Stepper label={t('Reps')} value={reps} step={1} min={1} max={12} decimal={false} onChange={setReps} />
      <Stepper label={t('RPE')} value={rpe} step={0.5} min={6} max={10} onChange={setRpe} />
    </div>
    <div className="tools-result" aria-live="polite">
      <span className="tools-big">{res ? fmtNum(res.w) + ' ' + unit : '–'}</span>
      <span className="small dim">{res ? t('{0}% of your 1RM (RTS chart)', fmtNum(res.pct)) : t('Off the chart. Try fewer reps or a higher RPE.')}</span>
    </div>
  </section>
}

function SexPicker({ value, onChange }) {
  return <Segmented className="seg-inline tools-sex" value={value} onChange={onChange}
    options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} />
}

function ScoresCard({ S, unit, toKg, bwNow, formula }) {
  const fromLog = useMemo(() => {
    let total = 0
    for (const ids of Object.values(TOTAL_LIFTS)) {
      const best = Math.max(0, ...ids.map(id => best1RM(S, id, formula)?.est || 0))
      if (!(best > 0)) return null
      total += best
    }
    return Math.round(total * 2) / 2
  }, [S.workouts, formula]) // eslint-disable-line react-hooks/exhaustive-deps
  const [total, setTotal] = useState(null)
  const [bw, setBw] = useState(null)
  const [sex, setSex] = useState(sexOf(S) || 'male')
  const tot = total ?? fromLog ?? 0
  const body = bw ?? bwNow ?? 0
  const kgT = toKg(tot), kgB = toKg(body)
  const scores = [
    { id: 'dots', label: 'DOTS', v: dots(kgT, kgB, sex) },
    { id: 'wilks', label: 'Wilks', v: wilks(kgT, kgB, sex) },
    { id: 'gl', label: 'IPF GL', v: ipfGl(kgT, kgB, sex) },
  ]
  return <section className="card tools-card" aria-labelledby="tools-scores">
    <h2 id="tools-scores" className="tools-h"><Icon name="trophy" />{t('Strength scores')}</h2>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Total ({0})', unit)} value={tot} step={unit === 'lb' ? 5 : 2.5} onChange={setTotal} />
      <Stepper label={t('Body weight ({0})', unit)} value={body} step={0.5} onChange={setBw} />
    </div>
    <SexPicker value={sex} onChange={setSex} />
    <div className="small dim" style={{ margin: '6px 0 10px' }}>{fromLog != null && total == null
      ? t('Squat, bench and deadlift from your best estimated 1RMs.')
      : t('Your squat, bench and deadlift added up.')}</div>
    <div className="tiles tools-tiles">
      {scores.map(s => <div key={s.id} className="tile"><div className="l">{s.label}</div><div className="v v-sm">{s.v == null ? '–' : fmtNum(Math.round(s.v * 10) / 10)}</div></div>)}
    </div>
  </section>
}

function BodyCard({ S, update, unit, toKg, bwNow, lenUnit, toCm, fromCm, neck, waist, hips, bodyFat }) {
  const [bw, setBw] = useState(null)
  const [sex, setSex] = useState(sexOf(S) || 'male')
  const heightCm = Number(S.heightCm) > 0 ? Number(S.heightCm) : null
  const [tape, setTape] = useState({})
  const [bf, setBf] = useState(null)
  const body = bw ?? bwNow ?? 0
  const h = heightCm || 0
  const n = tape.neck ?? neck ?? 0, w = tape.waist ?? waist ?? 0, hp = tape.hips ?? hips ?? 0
  const navy = navyBodyFat({ sex, heightCm: h, neckCm: n, waistCm: w, hipCm: hp })
  const fat = bf ?? bodyFat ?? navy ?? 0
  const b = bmi(toKg(body), h)
  // No body fat known, no FFMI: at 0 % it would read the whole body weight as lean.
  const f = fat > 0 ? ffmi(toKg(body), h, fat) : null
  const lean = f ? (unit === 'lb' ? f.lean * LB_PER_KG : f.lean) : null
  const step = lenUnit === 'in' ? 0.5 : 1
  const setLen = key => v => setTape(t0 => ({ ...t0, [key]: toCm(v) }))
  return <section className="card tools-card" aria-labelledby="tools-body">
    <h2 id="tools-body" className="tools-h"><Icon name="figureStrength" />{t('Body')}</h2>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Height ({0})', lenUnit)} value={h ? fromCm(h) : 0} step={step} onChange={v => update(s => { if (v > 0) s.heightCm = Math.round(toCm(v) * 10) / 10; else delete s.heightCm })} />
      <Stepper label={t('Body weight ({0})', unit)} value={body} step={0.5} onChange={setBw} />
    </div>
    {!h && <div className="small dim" style={{ marginBottom: 8 }}>{t('Add your height once and every body number below fills in. It stays on this profile.')}</div>}
    <div className="tiles tools-tiles">
      <div className="tile"><div className="l">BMI</div><div className="v v-sm">{b == null ? '–' : fmtNum(b)}</div>
        {b != null && <div className="small dim">{t(BMI_LABEL[bmiBand(b)])}</div>}</div>
      <div className="tile"><div className="l">FFMI</div><div className="v v-sm">{f ? fmtNum(f.normalized) : '–'}</div>
        {f ? <div className="small dim">{t('Lean mass {0}', fmtNum(Math.round(lean * 10) / 10) + ' ' + unit)}</div>
          : <div className="small dim">{t('Needs your body fat')}</div>}</div>
    </div>
    <h3 className="tools-sub">{t('Navy body fat')}</h3>
    <SexPicker value={sex} onChange={setSex} />
    <div className="row cfgrow" style={{ margin: '8px 0' }}>
      <Stepper label={t('Neck ({0})', lenUnit)} value={n ? fromCm(n) : 0} step={step} onChange={setLen('neck')} />
      <Stepper label={t('Waist ({0})', lenUnit)} value={w ? fromCm(w) : 0} step={step} onChange={setLen('waist')} />
      {sex === 'female' && <Stepper label={t('Hips ({0})', lenUnit)} value={hp ? fromCm(hp) : 0} step={step} onChange={setLen('hips')} />}
    </div>
    <div className="tools-result" aria-live="polite">
      <span className="tools-big">{navy == null ? '–' : fmtNum(navy) + ' %'}</span>
      <span className="small dim">{navy == null ? t('Needs your height, neck and waist (and hips for women).') : t('U.S. Navy tape method. Waist at the navel, neck below the larynx.')}</span>
    </div>
    <div className="row cfgrow" style={{ marginTop: 8 }}>
      <Stepper label={t('Body fat for FFMI (%)')} value={fat} step={0.5} max={60} onChange={setBf} />
    </div>
  </section>
}

function PaceCard({ S }) {
  const du = distUnitOf(S)
  const [dist, setDist] = useState(du === 'mi' ? 3.1 : 5)
  const [time, setTime] = useState('25:00')
  const sec = parseClock(time)
  const p = pace(dist, sec)
  const perKm = p ? (du === 'mi' ? p.secPer / MI_KM : p.secPer) : null
  return <section className="card tools-card" aria-labelledby="tools-pace">
    <h2 id="tools-pace" className="tools-h"><Icon name="figureRun" />{t('Pace')}</h2>
    <div className="row cfgrow" style={{ marginBottom: 8, alignItems: 'flex-end' }}>
      <Stepper label={t('Distance ({0})', distLabel(du))} value={dist} step={du === 'mi' ? 0.1 : 0.5} onChange={setDist} />
      <label className="tools-time"><span className="stp-l">{t('Time')}</span>
        <TextField inputMode="numeric" value={time} onChange={e => setTime(e.target.value)} placeholder="25:00" aria-invalid={sec == null} /></label>
    </div>
    <div className="tools-result" aria-live="polite">
      <span className="tools-big">{p ? fmtClock(p.secPer) + ' /' + distLabel(du) : '–'}</span>
      <span className="small dim">{p ? fmtNum(p.speed) + ' ' + (du === 'mi' ? 'mph' : 'km/h') : t('Type a time like 25:00 or 1:45:00.')}</span>
    </div>
    {perKm && <table className="reptable tools-table" style={{ marginTop: 8 }}>
      <tbody>{RACES.map(r => <tr key={r.id}><th scope="row">{t(RACE_NAME[r.id])}</th><td className="dim">{fmtClock(timeAt(r.km, perKm))}</td></tr>)}</tbody>
    </table>}
  </section>
}

const RACE_NAME = { '5k': '5K', '10k': '10K', half: 'Half marathon', marathon: 'Marathon' }
