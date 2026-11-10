import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { liveHeartRate, onLiveHeartRate } from '../lib/phone-workout.js'

// " · ♥ 128" in the workout header while the iPhone's own workout session (#818) has a fresh
// reading from AirPods that measure it. Nothing at all without one: on the web, on Android, with an
// Apple Watch doing the measuring (the watch shows its own), or with the buds back in their case.
export default function LiveHeartRate() {
  const [hr, setHr] = useState(() => liveHeartRate())
  useEffect(() => {
    const off = onLiveHeartRate(() => setHr(liveHeartRate()))
    // A reading over a minute old goes away even when no new one comes (AirPods taken out).
    const iv = setInterval(() => { if (!document.hidden) setHr(liveHeartRate()) }, 15000)
    return () => { off(); clearInterval(iv) }
  }, [])
  if (!hr) return null
  return <> · <span className="live-hr" aria-label={t('Heart rate') + ' ' + hr.bpm}>♥ {hr.bpm}</span></>
}
