// The circuit player (lib/circuit.js, store/useCircuit.js): the whole screen for one clock. The
// timer as large as the phone allows, the station you are on with its animation, what comes
// next, and three buttons a sweaty thumb can find: Pause, Done, Skip. Opened from the circuit's
// card in the workout; it can be closed and opened again while the clock keeps running.
import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useCircuit } from '../store/useCircuit.js'
import { t, tn } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameText, fmtNum } from '../lib/format.js'
import { viewRow, exUnitOf } from '../lib/ex-unit.js'
import { runStep, stepEndsAt, leftOf, nextWorkAfter, stationNow, stationSuggestions, compareResult, previousResult, plannedLength, stepAt, cleanCircuit, nextProgram } from '../lib/circuit.js'
import { circuitLine, roundLabel, resultLine, compareLine, fmtClock } from '../lib/circuit-copy.js'
import { useWakeLock } from '../lib/wakelock.js'
import { setOverlayBack } from '../lib/back.js'
import { circuitUnitAt } from '../store/useCircuit.js'
import { stationsOf } from '../lib/circuit.js'
import { modeOf, fmtMetres } from '../lib/history.js'
import Media, { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const nameOf = id => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : String(id ?? ''))

/** "12 reps · 20 kg", "0:30", "2 min": what one round of a station asks for. */
function targetLine(S, st, now) {
  if (!st) return ''
  const s = now || st
  if (st.mode === 'time') return st.sec > 0 ? fmtClock(st.sec) : ''
  if (st.mode === 'cardio') return ''
  const parts = [st.mode === 'distance' ? fmtMetres(st.m) : tn('{0} rep', '{0} reps', s.reps)].filter(Boolean)
  if (s.w > 0) parts.push(`${fmtNum(viewRow(S, st.id, { w: s.w }).w)} ${exUnitOf(S, st.id)}`)
  return parts.join(' · ')
}

// The ring: a full circle is the step, the arc what is left of it. Updated with the clock.
function Ring({ frac, phase }) {
  const R = 46, C = 2 * Math.PI * R
  return <svg className="cp-ring" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r={R} className="cp-ring-bg" />
    {frac != null && <circle cx="50" cy="50" r={R} className={'cp-ring-fg ' + phase}
      strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(1, frac)))} />}
  </svg>
}

function useNow(running) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(id)
  }, [running])
  return running ? now : Date.now()
}

function VoiceToggle() {
  const on = useStore(s => s.S.spokenCues === true)
  return <button type="button" className="iconbtn cp-voice" aria-pressed={on} aria-label={t('Spoken cues')} title={t('Spoken cues')}
    onClick={() => useStore.getState().update(s => { s.spokenCues = !on })}>
    <Icon name="speaker" />{!on && <span className="cp-voice-off" aria-hidden="true" />}
  </button>
}

function Ready({ S, close }) {
  const pending = useCircuit(s => s.pending)
  const A = S.active
  const g = circuitUnitAt(A, pending?.idx)
  if (!g) return null
  const stations = stationsOf(A.entries, g.unit, cfg => modeOf(cfg))
  const cfg = { ...g.cfg, roundRest: g.roundRest }
  const len = plannedLength(cfg, stations)
  const last = previousResult(S.workouts, { mode: g.cfg.mode, ids: stations.map(s => s.id) })
  return <div className="cp-body cp-ready">
    <div className="cp-top">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      <span className="cp-top-t">{circuitLine(g.cfg)}</span>
      <VoiceToggle />
    </div>
    <h2 className="cp-ready-h">{t('Ready when you are')}</h2>
    {len != null && <p className="cp-ready-s">{t('{0} on the clock, get ready included', fmtClock(len + 10))}</p>}
    {last && <p className="cp-ready-s">{t('Last time: {0}', resultLine(last))}</p>}
    <ol className="cp-stations">{stations.map((st, m) => <li key={m} className="cp-st">
      <Thumb ex={EXIDX[st.id] || { id: st.id, n: st.id }} />
      <span className="cp-st-m"><span className="cp-st-n">{nameOf(st.id)}</span>
        <span className="cp-st-s">{st.mode === 'time' && ['intervals', 'emom'].includes(g.cfg.mode) ? '' : targetLine(S, st)}</span></span>
    </li>)}</ol>
    <div className="cp-ready-go">
      <Button variant="primary" icon="play" onClick={() => useCircuit.getState().start()}>{t('Start the clock')}</Button>
    </div>
  </div>
}

function Ask({ S, run, m }) {
  const st = run.stations[m]
  const [reps, setReps] = useState(0)
  return <div className="cp-body cp-ask">
    <h2 className="cp-ready-h">{t('Time!')}</h2>
    <p className="cp-ready-s">{t('How many reps of {0} did you get in?', nameOf(st?.id))}</p>
    <div className="cp-ask-n" aria-live="polite">{reps}</div>
    <div className="cp-ask-row">
      <button type="button" className="cp-round-btn" aria-label={t('Fewer reps')} onClick={() => setReps(r => Math.max(0, r - 1))}><Icon name="minus" /></button>
      <button type="button" className="cp-round-btn" aria-label={t('More reps')} onClick={() => setReps(r => Math.min(999, r + 1))}><Icon name="plus" /></button>
    </div>
    <Button variant="primary" onClick={() => useCircuit.getState().finish(reps)}>{t('Save')}</Button>
  </div>
}

function Result({ S, run, result, close }) {
  const [applied, setApplied] = useState(false)
  const update = useStore(s => s.update)
  const A = S.active
  const last = previousResult(S.workouts, result)
  const cmp = compareLine(compareResult(result, last))
  const sugg = A ? stationSuggestions(run, A.entries) : []
  const apply = () => {
    update(s => {
      const rid = s.active?.entries?.[run.unit[0]]?.rid || s.active?.routineId || (s.active?.routineIds || [])[0]
      const r = (s.routines || []).find(x => x.id === rid)
      if (!r) return
      for (const x of sugg) {
        const slot = r.ex.find(e => e.id === x.id && e.sg === run.sg) || r.ex.find(e => e.id === x.id)
        if (slot) slot[x.field] = x.to
      }
    })
    setApplied(true)
  }
  const hasRoutine = !!(A?.entries?.[run.unit[0]]?.rid || A?.routineId || A?.routineIds?.length)
  // A run/walk session that moves the ladder up says so here; the routine itself moves when the
  // workout is saved (lib/circuit.js applyProgramAdvances), and stays put if it is discarded.
  const from = run.cfg?.program === 'runwalk' ? cleanCircuit(run.cfg) : null
  const up = from && hasRoutine ? nextProgram(run.cfg, result) : null
  const nextLevel = up && up.level > from.level ? up.level : null
  return <div className="cp-body cp-result">
    <div className="cp-top">
      <span />
      <span className="cp-top-t">{circuitLine(run.cfg)}</span>
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
    </div>
    <div className="cp-result-ico" aria-hidden="true"><Icon name="checkCircle" /></div>
    <h2 className="cp-ready-h">{result.ended === 'stopped' ? t('Stopped. What you did is saved.') : t('Done and dusted')}</h2>
    <div className="cp-score">{resultLine(result)}</div>
    {cmp && <p className="cp-ready-s">{cmp}</p>}
    {nextLevel && <p className="cp-ready-s cp-level-up" data-level-up={nextLevel}><Icon name="figureRun" /> {t('Level {0} next time', nextLevel)}</p>}
    {result.roundTimes.length > 1 && <ol className="cp-rounds">{result.roundTimes.map((s, r) => <li key={r}>
      <span>{t('Round {0}', r + 1)}</span><span className="cp-num">{fmtClock(s)}</span></li>)}</ol>}
    {sugg.length > 0 && hasRoutine && <div className="cp-next">
      <h3 className="cp-next-h">{t('Next time')}</h3>
      <ul className="cp-next-l">{sugg.map(x => <li key={x.idx}><span>{nameOf(x.id)}</span>
        <span className="cp-num">{x.field === 'sec' ? `${fmtClock(x.from)} → ${fmtClock(x.to)}` : `${x.from} → ${x.to}`}</span></li>)}</ul>
      {applied ? <p className="cp-ready-s"><Icon name="check" /> {t('Routine updated')}</p>
        : <Button variant="tinted" onClick={apply}>{t('Use these next time')}</Button>}
    </div>}
    <Button variant="primary" onClick={close}>{t('Back to the workout')}</Button>
  </div>
}

function Running({ S, run, close }) {
  const now = useNow(run.paused == null && !run.ended)
  const step = runStep(run)
  const c = useCircuit.getState()
  if (!step) return null
  const end = stepEndsAt(run)
  const left = leftOf(run, now)
  const st = stationNow(run, step.m)
  const base = run.stations[step.m]
  const emomDone = step.emom && run.split
  const phase = step.k === 'prep' ? 'prep' : step.k === 'rest' || emomDone ? 'rest' : 'work'
  const showRest = phase !== 'work'
  // The station on now; in a rest or get ready, the one coming.
  const upNext = nextWorkAfter(run.cfg, run.stations, run.i)
  // In a rest (an EMOM interval you finished counts as one) the screen is about what comes next.
  const ahead = showRest
  const focus = ahead ? upNext || step : step
  const focusSt = stationNow(run, focus.m)
  const ex = EXIDX[focusSt?.id]
  const after = ahead ? (upNext ? nextWorkAfter(run.cfg, run.stations, stepIndexOf(run, upNext)) : null) : upNext
  const total = step.sec
  const frac = end != null && total ? (end - (run.paused ?? now)) / (total * 1000) : run.capEndsAt ? (run.capEndsAt - (run.paused ?? now)) / (run.cfg.cap * 1000) : null
  const word = phase === 'prep' ? t('Get ready') : phase === 'rest' ? (step.warm ? t('Warm-up walk') : t('Rest')) : t('Work')
  // An AMRAP's open station shows the cap, which is the clock that matters; a circuit's open
  // station counts up, so you see how long you have been at it.
  const capLeft = run.capEndsAt ? leftOf({ ...run, i: -1 }, now) : null
  const clock = end != null ? fmtClock(left) : capLeft != null ? fmtClock(capLeft) : fmtClock(Math.floor(((run.paused ?? now) - run.at) / 1000))
  const repsStation = !ahead && step.k === 'work' && base?.mode === 'reps'
  const doneLabel = step.k === 'work' ? (emomDone ? t('Next now') : t('Done')) : t('Go now')
  return <div className={'cp-body cp-run is-' + phase}>
    <div className="cp-top">
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="chevronDown" /></button>
      <span className="cp-top-t">{roundLabel(run.cfg, step.k === 'work' ? step : focus.k === 'work' ? focus : step, run.stations.length)}</span>
      <VoiceToggle />
    </div>
    <div className="cp-clock" role="timer" aria-live="off">
      <Ring frac={frac} phase={phase} />
      <div className="cp-clock-in">
        <span className="cp-word">{run.paused != null ? t('Paused') : word}</span>
        <span className="cp-time cp-num">{clock}</span>
        {capLeft != null && end != null && <span className="cp-cap">{t('{0} left on the clock', fmtClock(capLeft))}</span>}
      </div>
    </div>
    {/* A screen reader hears the step change, not every second. */}
    <span className="vh" aria-live="polite">{word} {nameOf(focusSt?.id)}</span>
    <section className="cp-station" aria-label={showRest ? t('Up next') : nameOf(focusSt?.id)}>
      {showRest && <span className="cp-kicker">{t('Up next')}</span>}
      {ex && <div className="cp-media"><Media ex={ex} compact /></div>}
      <h2 className="cp-name">{nameOf(focusSt?.id)}</h2>
      {repsStation ? <div className="cp-reps">
        <button type="button" className="cp-round-btn" aria-label={t('Fewer reps')} onClick={() => c.adjust(step.m, { reps: (st.reps || 0) - 1 })}><Icon name="minus" /></button>
        <span className="cp-target">{targetLine(S, base, st)}</span>
        <button type="button" className="cp-round-btn" aria-label={t('More reps')} onClick={() => c.adjust(step.m, { reps: (st.reps || 0) + 1 })}><Icon name="plus" /></button>
      </div> : <span className="cp-target">{focus.k === 'work' && focus.sec != null && focusSt?.mode !== 'reps' ? fmtClock(focus.sec) : targetLine(S, run.stations[focus.m], focusSt)}</span>}
      {emomDone && <span className="cp-cap">{t('Nice. The rest of the minute is yours.')}</span>}
    </section>
    {after && <div className="cp-after"><span className="cp-kicker">{t('Then')}</span><span>{nameOf(run.stations[after.m]?.id)}</span></div>}
    <div className="cp-ctrl">
      {run.paused != null
        ? <button type="button" className="cp-side" onClick={() => c.resume()}><Icon name="play" /><span>{t('Resume')}</span></button>
        : <button type="button" className="cp-side" onClick={() => c.pause()}><Icon name="pause" /><span>{t('Pause')}</span></button>}
      <button type="button" className="cp-main" disabled={run.paused != null} onClick={() => c.done()}>
        <Icon name={step.k === 'work' && !emomDone ? 'check' : 'skipForward'} /><span>{doneLabel}</span></button>
      <button type="button" className="cp-side" disabled={run.paused != null} onClick={() => c.skip()}><Icon name="skipForward" /><span>{t('Skip')}</span></button>
    </div>
    <button type="button" className="cp-stop" onClick={() => c.stop()}>{t('Stop the clock')}</button>
  </div>
}

// The index of a step, by walking from the current one (cheap: the next few only).
function stepIndexOf(run, s) {
  for (let i = run.i; i < run.i + 4 + run.stations.length * 3; i++) {
    const x = stepAt(run.cfg, run.stations, i)
    if (!x) return run.i
    if (x.k === s.k && x.m === s.m && x.r === s.r) return i
  }
  return run.i
}

export default function CircuitPlayer() {
  const open = useCircuit(s => s.open)
  const run = useCircuit(s => s.run)
  const ask = useCircuit(s => s.ask)
  const result = useCircuit(s => s.result)
  const S = useStore(s => s.S)
  const close = () => useCircuit.getState().close()
  const box = useRef(null)
  const running = !!run && !run.ended && run.paused == null
  // The screen stays on while the clock runs in front of you.
  useWakeLock(open && running)
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    // Android's back closes the player (the clock keeps running), as Escape does.
    setOverlayBack(() => { close(); return true })
    box.current?.focus?.()
    return () => { window.removeEventListener('keydown', onKey); setOverlayBack(null) }
  }, [open])
  if (!open || !S?.active && !result) return null
  return <div ref={box} className="cp-screen" role="dialog" aria-modal="true" aria-label={t('Circuit timer')} tabIndex={-1}>
    {ask && run ? <Ask S={S} run={run} m={ask.m} />
      : result && run ? <Result S={S} run={run} result={result} close={close} />
      : run && !run.ended ? <Running S={S} run={run} close={close} />
      : <Ready S={S} close={close} />}
  </div>
}
