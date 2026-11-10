// Home: today's readiness from Garmin, one tap from the Garmin screen. Shows only once the
// account has connected a key (views/Garmin.jsx); nothing at all on a server without Garmin.
import { useNavigate } from 'react-router-dom'
import { todayISO } from '../lib/format.js'
import { dayOf, readiness, READY_TITLE, fmtDuration } from '../lib/garmin.js'
import { useGarmin } from './useGarmin.js'
import CardHead from './CardHead.jsx'
import Icon from './Icon.jsx'

export default function GarminHomeCard() {
  const nav = useNavigate()
  const g = useGarmin()
  if (!g?.connected) return null
  const today = todayISO()
  const d = dayOf(g, today)
  const ready = readiness(g, today)
  const sub = d ? [d.bbMax != null && `Body battery ${d.bbNow ?? d.bbMax}`, d.sleepSec && `slept ${fmtDuration(d.sleepSec)}`,
    d.hrvStatus && `HRV ${d.hrvStatus.toLowerCase()}`].filter(Boolean).join(' · ') : 'Nothing from your watch yet today'
  return <div className="card tap-host">
    <CardHead icon="watch" tint="var(--indigo)" eyebrow="Garmin" title={ready?.sick ? 'Your body may be fighting something' : ready ? READY_TITLE[ready.level] : 'Your watch data'}
      sub={sub || null} open={{ onClick: () => nav('/garmin') }} action={<Icon name="chevronRight" className="chev" />} />
  </div>
}
