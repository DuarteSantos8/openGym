import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { glanceOf } from '../lib/live-glance.js'
import { buildLiveActivity } from '../lib/live-activity.js'
import { liveHeartRate, onLiveHeartRate } from '../lib/phone-workout.js'
import { GlanceStrip, stripContent } from './LiveGlance.jsx'

export { hideBroken } from './LiveGlance.jsx'

// The live widget's strip on the workout screen (Settings > Workout > Live widget > "Show a strip
// in the workout", off by default). The screen already shows the exercise, its sets, the clock and
// the rest, so the strip only adds what it does not: the exercise after this one, and the heart
// rate, its zone and the calories when those are switched on.

function useLiveHeart (on) {
  const [hr, setHr] = useState(() => liveHeartRate())
  useEffect(() => {
    if (!on) return undefined
    const off = onLiveHeartRate(() => setHr(liveHeartRate()))
    const iv = setInterval(() => { if (!document.hidden) setHr(liveHeartRate()) }, 15000)
    return () => { off(); clearInterval(iv) }
  }, [on])
  return hr
}

export default function LiveCard () {
  const S = useStore(s => s.S)
  const timer = useUI(s => s.timer)
  const G = useMemo(() => glanceOf(S), [S.liveWidget, S.liveLayout])
  const live = useLiveHeart(G.card)
  const A = S.active
  if (!G.card || !A || A.backfill || A.editingWorkoutId) return null
  let payload = null
  try { payload = buildLiveActivity(S, timer, {}, { live, now: Date.now() }) } catch { payload = null }
  if (!stripContent(payload)) return null
  return <section className="card gl-card" aria-label={t('Live widget')}><GlanceStrip live={payload} /></section>
}
