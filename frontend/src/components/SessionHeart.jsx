import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { heartCurve } from '../lib/heart-rate.js'
import { workoutSamples } from '../lib/health-sync.js'
import { curveVersion } from '../lib/heart-history.js'
import { isOn } from '../lib/modules.js'
import { hrMaxOf, DEFAULT_HR_MAX } from '../lib/live-tiles.js'
import { exerciseSpans, heartByExercise, heartStepText } from '../lib/heart-steps.js'
import HeartGraph from './HeartGraph.jsx'

// A finished session's heart rate on the zones: the curve kept with the workout (lib/heart-history.js
// packCurve, so the web app has it too), or the phone's health hub read then and kept. None: no card.
export default function SessionHeart ({ w, nameOf = e => e?.id }) {
  const S = useStore(s => s.S)
  const [curve, setCurve] = useState(null)
  const [samples, setSamples] = useState(null)
  useEffect(() => {
    let open = true
    workoutSamples(w, S).then(r => { if (open) { setSamples(r); setCurve(heartCurve(r, w.start, w.end)) } }, () => {})
    return () => { open = false }
  // Read again when the kept curve really changes (a sync copies it, the same) or Health is switched.
  }, [w.start, w.end, curveVersion(w.hrc), isOn(S, 'health')])
  if (!curve) return null
  const max = hrMaxOf(S) || DEFAULT_HR_MAX
  const steps = heartByExercise(w, samples, max)
  return (
    <div className="session-heart">
      <div className="row between small">
        <span className="muted">{t('Heart rate')}</span>
        <span>{t('Average {0} · Max {1} bpm', curve.avg, curve.max)}</span>
      </div>
      <HeartGraph samples={curve.points} max={max} span={w.end - w.start}
        bands={exerciseSpans(w).map(s => [s.from - w.start, s.to - w.start])} />
      {steps.length > 0 && <div className="session-heart-steps small">
        {steps.map(x => <div key={x.unit} className="row between">
          <span className="grow tt">{x.members.map(i => nameOf(w.entries[i])).join(' + ')}</span>
          <span className="muted">{heartStepText(x)}</span>
        </div>)}
      </div>}
    </div>
  )
}
