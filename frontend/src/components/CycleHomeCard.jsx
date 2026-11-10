// Home: where you are in the cycle, one tap from the Cycle screen. Shows only with the Cycle
// module on and only on a server that has cycle tracking.
import { useNavigate } from 'react-router-dom'
import { todayISO, fmtDate } from '../lib/format.js'
import { PHASES, forecast, phaseOn } from '../lib/cycle.js'
import { useCycle } from './useCycle.js'
import CardHead from './CardHead.jsx'
import Icon from './Icon.jsx'

export default function CycleHomeCard() {
  const nav = useNavigate()
  const c = useCycle()
  if (!c) return null
  const ph = phaseOn(c.days, todayISO()), next = forecast(c.days)[0]
  return <div className="card tap-host">
    <CardHead icon="moon" tint="var(--pink)" eyebrow="Cycle" title={ph ? `${PHASES[ph.phase].label}, day ${ph.day}` : 'Start tracking your cycle'}
      sub={ph && next && ph.late === 0 ? `Next period expected ${fmtDate(next.start)}` : ph ? null : 'Log the first day of your last period'}
      open={{ onClick: () => nav('/cycle') }} action={<Icon name="chevronRight" className="chev" />} />
  </div>
}
