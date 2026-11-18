import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { heartCurve } from '../lib/heart-rate.js'
import { currentSpanStart } from '../lib/heart-steps.js'
import { readWorkoutHeart } from '../lib/health-sync.js'
import { hrMaxOf, hrZone, DEFAULT_HR_MAX } from '../lib/live-tiles.js'
import { feedHeart, heartOrigin, heartView, lastHeart, onSessionHeart, sessionHeart, setHeartView, watchCurve } from '../lib/session-heart.js'
import Icon from './Icon.jsx'
import { Segmented } from './ui.jsx'
import HeartGraph from './HeartGraph.jsx'

/** The session's heart rate as it comes in (lib/session-heart.js), and the band's size. */
export function useSessionHeart() {
  const [heart, setHeart] = useState(sessionHeart)
  const [view, setView] = useState(heartView)
  useEffect(() => {
    const off = onSessionHeart(setHeart)
    const offView = onHeartView(setView)
    return () => { off(); offView() }
  }, [])
  return { heart, view }
}

// What the curve covers: the exercise in progress (from the end of the one before it, its rest
// included) or the whole workout. Kept for the page's life, the exercise by default.
let scopeNow = 'ex'

// The band and the header's ♥ both change the size: one place tells both.
const viewListeners = new Set()
const onHeartView = fn => { viewListeners.add(fn); return () => viewListeners.delete(fn) }
export function showHeartView(v) {
  setHeartView(v)
  for (const fn of viewListeners) fn(v)
}

// The Apple Watch's heart rate through the whole workout, under the progress bar. One line by default, so the exercise keeps the screen; a tap opens the whole
// curve, with a line where each set was ticked; the chevron folds it into the header's ♥, which
// brings it back. Nothing until the watch has sent a reading for this workout.
export default function HeartBand({ A }) {
  const S = useStore(s => s.S)
  const { heart, view } = useSessionHeart()
  const [now, setNow] = useState(Date.now)
  const [scope, setScope] = useState(scopeNow)
  const pickScope = v => { scopeNow = v; setScope(v) }
  useEffect(() => {
    const tick = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 5000)
    return () => clearInterval(tick)
  }, [])
  // What the page missed (asleep, or opened in the middle): read back from Apple Health, the watch's
  // readings only, so the AirPods' never step into its curve. Only for the workout still running
  // when the answer comes: a slow read never lands on the next one.
  useEffect(() => {
    if (!MOBILE || !A?.id || !A.start) return
    const fill = () => {
      if (document.visibilityState !== 'visible') return
      const wid = A.id
      readWorkoutHeart({ start: heartOrigin(A), end: Date.now() }, useStore.getState().S, { watch: true }).then(r => {
        if (useStore.getState().S?.active?.id === wid) feedHeart(wid, r)
      }, () => {})
    }
    fill()
    document.addEventListener('visibilitychange', fill)
    return () => document.removeEventListener('visibilitychange', fill)
  }, [A?.id, A?.start, A?.pausedMs])

  if (!watchCurve(heart, A?.id) || view === 'pill') return null
  const whole = heartOrigin(A)
  // The exercise's curve once it has a reading of its own; until then, the workout's.
  const exFrom = currentSpanStart(A, whole)
  const end = Math.max(now, heart.samples[heart.samples.length - 1][0])
  const exCurve = heartCurve(heart.samples, exFrom, end)
  const onEx = scope === 'ex' && !!exCurve
  const origin = onEx ? exFrom : whole
  const curve = onEx ? exCurve : heartCurve(heart.samples, whole, end)
  const last = lastHeart(heart, now)
  const max = hrMaxOf(S) || DEFAULT_HR_MAX
  const zone = last ? hrZone(last.bpm, S) || 0 : 0
  const zoneStyle = zone ? { background: `var(--z${zone})`, color: '#000' } : undefined
  const big = view === 'big'
  const marks = A.entries.flatMap(e => e.sets.filter(s => s.done && s.at > origin).map(s => s.at - origin))
  // What the button shows, then what it does: VoiceOver reads the reading, not only "Expand".
  const label = [t('Heart rate'), last && `${last.bpm} ${t('bpm')}`, zone > 0 && t('Zone {0}', zone),
    big && curve && t('Average {0} · Max {1} bpm', curve.avg, curve.max), big ? t('Collapse') : t('Expand')].filter(Boolean).join(', ')
  return (
    <div className={'hband' + (big ? ' big' : '')}>
      <button type="button" className="hband-main" aria-expanded={big} aria-label={label}
        onClick={() => showHeartView(big ? 'line' : 'big')}>
        <span className="hband-now">
          <span className="hband-heart" aria-hidden="true">♥</span>
          <b>{last ? last.bpm : '–'}</b><small>{t('bpm')}</small>
          {zone > 0 && <span className="hband-zone" style={zoneStyle}>{t('Zone {0}', zone)}</span>}
        </span>
        {big
          ? curve && <span className="hband-avg">{t('Average {0} · Max {1} bpm', curve.avg, curve.max)}</span>
          : curve && <Spark points={curve.points} />}
      </button>
      {!big && <button type="button" className="iconbtn hband-fold" aria-label={t('Show less')} title={t('Show less')}
        onClick={() => showHeartView('pill')}><Icon name="chevronUp" /></button>}
      {big && curve && <HeartGraph samples={curve.points} max={max} zone={zone} marks={marks} />}
      {big && exFrom > whole && <Segmented className="seg-inline hband-scope" value={scope} onChange={pickScope}
        options={[{ value: 'ex', label: t('Exercise') }, { value: 'all', label: t('Workout') }]} />}
    </div>
  )
}

// The line's little curve: its own scale, from the lowest reading to the highest, so the ups and
// downs read even on 20 px.
function Spark({ points }) {
  if (points.length < 2) return <span className="hband-spark" />
  const lo = Math.min(...points.map(p => p.hr)), hi = Math.max(...points.map(p => p.hr))
  const end = points[points.length - 1].t || 1
  const y = hr => 22 - (hr - lo) / Math.max(1, hi - lo) * 20
  return (
    <svg className="hband-spark" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points.map(p => `${(p.t / end * 200).toFixed(1)},${y(p.hr).toFixed(1)}`).join(' ')}
        fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
