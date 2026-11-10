// Home: today's readiness from Garmin, one tap from the Garmin screen. Shows only once the
// account has connected a key (views/Garmin.jsx); nothing at all on a server without Garmin.
import { useNavigate } from 'react-router-dom'
import { todayISO } from '../lib/format.js'
import { dayOf, readiness, READY_TITLE, fmtDuration, fmtClock } from '../lib/garmin.js'
import { homeItems, isShown } from '../lib/garmin-layout.js'
import { sleepTarget } from '../lib/garmin-insights.js'
import { useGarmin } from './useGarmin.js'
import CardHead from './CardHead.jsx'
import Icon from './Icon.jsx'

export default function GarminHomeCard() {
  const nav = useNavigate()
  const g = useGarmin()
  if (!g?.connected || !isShown(g.prefs, 'place-home')) return null
  const today = todayISO()
  const d = dayOf(g, today)
  const ready = readiness(g, today)
  // What this account picked for the line (Garmin settings), in the settings' order.
  const need = sleepTarget(g, today, g.prefs?.sleepMin)
  const item = {
    bb: d?.bbMax != null && `Body battery ${d.bbNow ?? d.bbMax}`,
    sleep: d?.sleepSec && `slept ${fmtDuration(d.sleepSec)}`,
    hrv: d?.hrvStatus && `HRV ${d.hrvStatus.toLowerCase()}`,
    steps: d?.steps != null && `${d.steps.toLocaleString()} steps`,
    rhr: d?.restHr != null && `resting ${d.restHr} bpm`,
    stress: d?.stress >= 0 && `stress ${d.stress}`,
    need: need.bedFrom != null && `bed ${fmtClock(need.bedFrom)} to ${fmtClock(need.bedTo ?? need.bedFrom)}`,
  }
  const sub = d ? homeItems(g.prefs).map(k => item[k]).filter(Boolean).join(' · ') : 'Nothing from your watch yet today'
  return <div className="card tap-host">
    <CardHead icon="watch" tint="var(--indigo)" eyebrow="Garmin" title={ready?.sick ? 'Your body may be fighting something' : ready ? READY_TITLE[ready.level] : 'Your watch data'}
      sub={sub || null} open={{ onClick: () => nav('/garmin') }} action={<Icon name="chevronRight" className="chev" />} />
  </div>
}
