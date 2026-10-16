import { useEffect, useRef, useState } from 'react'
import { at } from '../../../lib/onboarding/art.js'
import { reducedMotion } from '../../../lib/reduced-motion.js'
import { cx } from '../../../lib/ui-kit.js'
import SceneStage from '../SceneStage.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 3b Born: a tear-off calendar (round 2 §2·3). The year in HTML, never the age; the band lights once
// there is a year. On a change the old page tears off (up 6, tilt -4, fade, 220ms), one at a time
// while the wheel spins.
export default function CalendarScene({ year, after }) {
  const [page, setPage] = useState(null)
  const shown = useRef(year)
  useEffect(() => {
    const old = shown.current
    shown.current = year
    if (old == null || year == null || old === year || reducedMotion()) return undefined
    setPage(p => p ?? { year: old, id: Date.now() })
    const timer = setTimeout(() => setPage(null), 220)
    return () => clearTimeout(timer)
  }, [year])
  return (
    <SceneStage drawKey="born" viewBox="0 0 320 144" end={560} after={after}
      overlay={<div className="ob-cal-yr">
        <span className="ob-cal-v">{year ?? ''}</span>
        {page && <span key={page.id} className="ob-cal-pg" aria-hidden="true">{page.year}</span>}
      </div>}>
      <ThreadFloor y={128} />
      <path className="il il-d il-mute" d="M208 56 V120" {...at(1)} />
      <path className="il il-d il-mute" d="M204 48 V124" {...at(2)} />
      <rect className="il il-occ" x="120" y="40" width="80" height="88" rx="8" {...at(3)} />
      <path className={cx('il-lit ob-fadeable', year == null && 'ob-off')} d="M120 60 V48 a8 8 0 0 1 8-8 H192 a8 8 0 0 1 8 8 V60 Z" data-late="" />
      <path className="il" d="M120 60 H200" {...at(4)} />
      <path className="il" d="M140 34 v12 M180 34 v12" {...at(5)} />
    </SceneStage>
  )
}
