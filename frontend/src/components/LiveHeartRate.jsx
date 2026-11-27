import Glyph from './Glyph.jsx'
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { liveHeartRate, onLiveHeartRate } from '../lib/phone-workout.js'
import { lastHeart, watchCurve } from '../lib/session-heart.js'
import { showHeartView, useSessionHeart } from './HeartBand.jsx'

// " · ♥ 128" in the workout header while there is a fresh reading: from AirPods through the iPhone's
// own workout session (#818), or from the Apple Watch (lib/session-heart.js) once its band under the
// progress bar is folded away (components/HeartBand.jsx); a tap then brings the band back. Nothing at
// all without a reading: on the web, on Android, or with the buds back in their case.
export default function LiveHeartRate({ wid, curve = true }) {
  const [hr, setHr] = useState(() => liveHeartRate())
  const { heart, view } = useSessionHeart()
  const [, setNow] = useState(0)
  useEffect(() => {
    const off = onLiveHeartRate(() => setHr(liveHeartRate()))
    // A reading over a minute old goes away even when no new one comes (AirPods taken out).
    const iv = setInterval(() => { if (!document.hidden) { setHr(liveHeartRate()); setNow(Date.now()) } }, 15000)
    return () => { off(); clearInterval(iv) }
  }, [])
  // The curve switched off (Settings → Workout) leaves the watch's reading to the watch.
  // Folded into the header, the band comes back with a tap as long as the workout has a curve,
  // the number only while the last reading is fresh.
  const folded = curve && view === 'pill' && watchCurve(heart, wid)
  const watch = curve && watchCurve(heart, wid) ? lastHeart(heart) : null
  if (folded) {
    return <> · <button type="button" className="live-hr" aria-label={t('Heart rate') + (watch ? ' ' + watch.bpm : '') + ', ' + t('Show more')}
      onClick={() => showHeartView('line')}><Glyph icon="heart" emoji="❤️" />{watch ? ' ' + watch.bpm : ''}</button></>
  }
  if (!hr || watch) return null
  return <> · <span className="live-hr" aria-label={t('Heart rate') + ' ' + hr.bpm}><Glyph icon="heart" emoji="❤️" /> {hr.bpm}</span></>
}
