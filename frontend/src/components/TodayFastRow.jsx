import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { fmtDur } from '../lib/format.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { leftMs, progressOf } from '../lib/nutrition/fasting.js'
import { useFasting, useFastingOn, useNow } from '../lib/nutrition/use-fasting.js'
import Icon from './Icon.jsx'

// The running fast, on Home's Today card (ia-proposal §2): time fasted and how long is left. Not
// there when fasting is off or nothing is running; tapping opens the Fasting page.
export default function TodayFastRow() {
  const nav = useNavigate()
  const on = useFastingOn()
  const active = useFasting(s => s.active)
  const now = useNow(!!active)

  useEffect(() => { if (on) useFasting.getState().load() }, [on])

  if (!on || !active) return null
  const p = progressOf(active, now)
  return <div className="today-fast" {...tappable(() => nav('/food/fasting'))}>
    <span className="lrow-i tint-purple"><Icon name="timer" /></span>
    <div className="grow">
      <div className="ttl">{t('Fasting for {0}', fmtDur(p.elapsedMs))}</div>
      <div className="ss">{p.reached ? t('Goal reached') : t('{0} to go', fmtDur(leftMs(p.remainingMs)))}</div>
    </div>
    <Icon name="chevronRight" className="chev" />
  </div>
}
