import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX, imgSrc, figureOf } from '../lib/exercises.js'
import { TILES, ACTIONS, layoutOf } from '../lib/live-layout.js'
import { setValues, sessionValues, heartSource } from '../lib/live-tiles.js'
import { upcomingSets, liveActionEvent, runLiveAction } from '../lib/live-activity.js'
import { adjustFor } from '../lib/live-adjust.js'
import { liveHeartRate, onLiveHeartRate } from '../lib/phone-workout.js'
import { isPaused } from '../lib/workout-pause.js'

// A still that is not there (a web build without the media) leaves no broken-picture icon behind.
export const hideBroken = e => { e.currentTarget.style.visibility = 'hidden' }

// The live widget on the workout screen (Settings > Workout > Live widget): the tiles and buttons
// picked for "In the app", as many as you like, wrapping in a four-column grid. Its buttons run
// through the same events as the Lock Screen's (lib/live-activity.js runLiveAction), so a tap here
// and one there can never log a set twice.

const clockText = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')

function useLiveHeart () {
  const [hr, setHr] = useState(() => liveHeartRate())
  useEffect(() => {
    const off = onLiveHeartRate(() => setHr(liveHeartRate()))
    const iv = setInterval(() => { if (!document.hidden) setHr(liveHeartRate()) }, 15000)
    return () => { off(); clearInterval(iv) }
  }, [])
  return hr
}

function useClock (on) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    const iv = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 15000)
    return () => clearInterval(iv)
  }, [on])
  return now
}

/** The tile texts of `tiles` for the set shown in `S.active` (shared with the builder's preview). */
export function tileTexts (S, tiles, { live = null, now = Date.now() } = {}) {
  const A = S?.active
  const cur = A ? upcomingSets(S)[0] : null
  const keys = tiles.map(x => x.k)
  const set = cur ? setValues(S, A, cur.entryIdx, cur.setIdx, keys) : {}
  const ses = sessionValues(S, A, keys, { live, now })
  const ex = cur ? EXIDX[A.entries[cur.entryIdx]?.id] : null
  return { ...set, ...ses, _still: ex?.img ? imgSrc(ex, figureOf(S)) : null, _hs: heartSource(A, live) }
}

/** One tile: its label and what it says now. `null` when it has nothing to say. */
export function LiveTile ({ k, s, text, A, timer, now, showStill = true }) {
  const d = TILES[k]
  if (!d) return null
  let value = text[k]
  if (k === 'rest') {
    if (!timer || timer.kind === 'switch') return null
    value = clockText(timer.ready ? 0 : Math.max(0, Math.round(timer.left || 0)))
  } else if (k === 'elapsed') {
    if (!A?.start) return null
    value = <Elapsed start={A.start} pausedAt={A.pausedAt} />
  } else if (k === 'clock') {
    value = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (k === 'progress') {
    let done = 0, total = 0
    for (const e of A?.entries || []) for (const x of e?.sets || []) { total++; if (x?.done) done++ }
    return <div className="lw-tile lw-l lw-progress" role="img" aria-label={t('{0} sets', `${done}/${total}`)}>
      <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>
    </div>
  } else if (k === 'still') {
    if (!showStill || !text._still) return null
    return <div className={'lw-tile lw-still lw-' + s}><img src={text._still} alt="" width="180" height="180" loading="lazy" onError={hideBroken} decoding="async" /></div>
  }
  if (value == null || value === '') return null
  const label = d.labelArgs ? null : t(d.label)
  const own = k === 'ex' || k === 'setOf' || k === 'target'
  return <div className={'lw-tile lw-' + s + (own ? ' lw-own' : '') + (k === 'rest' && timer?.ready ? ' lw-go' : '')}>
    {!own && <span className="lw-label">{k === 'hr' && <Icon name={text._hs === 'watch' ? 'watch' : 'heart'} />} {label}</span>}
    <span className="lw-value">{value}</span>
  </div>
}

/** The buttons, as the workout screen shows them: one primary (Log set), the rest quiet. */
export function LiveActions ({ acts, S, timer, onAct, preview = false }) {
  if (!acts.length) return null
  const A = S?.active
  // − and + say where they go ("82.5 kg"), the effort button where it stands ("RIR 2").
  const cur = A ? upcomingSets(S)[0] : null
  const adj = cur ? adjustFor(S, A, cur.entryIdx, cur.setIdx, ['w', 'r', 'e'], 1) : {}
  const stepText = k => {
    const f = { wDown: 'w', wUp: 'w', rDown: 'r', rUp: 'r', effort: 'e' }[k]
    const a = f && adj[f]
    if (!a) return null
    if (f === 'e') return a.t[a.i]
    const j = a.i + (/Down$/.test(k) ? -1 : 1)
    return j >= 0 && j < a.t.length ? a.t[j] + (f === 'r' ? ' ×' : '') : null
  }
  return <div className="lw-acts">
    {acts.map(k => {
      const d = ACTIONS[k]
      if (!d) return null
      const ev = preview ? {} : liveActionEvent(k, S, { timer })
      const label = k === 'pause' && isPaused(A) ? t('Resume') : t(d.label)
      const step = stepText(k)
      return <button key={k} type="button" className={'btn sm lw-act' + (k === 'log' ? ' primary' : '')}
        disabled={!ev} aria-label={step && k !== 'effort' ? label + ', ' + step : label} title={label} onClick={() => onAct?.(k)}>
        {k !== 'effort' && <Icon name={k === 'pause' && isPaused(A) ? 'play' : d.icon} />}
        <span>{k === 'restAdd' ? label : step || label}</span>
      </button>
    })}
  </div>
}

/** The in-app card. Nothing at all while "In the app" has no tiles and no buttons. */
export default function LiveCard () {
  const S = useStore(s => s.S)
  const timer = useUI(s => s.timer)
  const L = useMemo(() => layoutOf(S), [S.liveLayout])
  const app = L.app
  const live = useLiveHeart()
  const now = useClock(app.t.some(x => x.k === 'clock' || x.k === 'kcal'))
  const A = S.active
  if (!A || A.backfill || A.editingWorkoutId || (!app.t.length && !app.a.length)) return null
  const text = tileTexts(S, app.t, { live, now })
  const showStill = S.gifSize !== 'off'
  const act = k => { runLiveAction(k, () => useStore.getState(), { timer: useUI.getState().timer }) }
  return <section className="card lw-card" aria-label={t('Live widget')}>
    {app.t.length > 0 && <div className="lw-grid">
      {app.t.map(x => <LiveTile key={x.k} k={x.k} s={x.s} text={text} A={A} timer={timer} now={now} showStill={showStill} />)}
    </div>}
    <LiveActions acts={app.a} S={S} timer={timer} onAct={act} />
  </section>
}
