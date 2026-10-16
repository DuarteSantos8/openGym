import { useEffect, useRef } from 'react'
import { t } from '../../../lib/i18n.js'
import { at, rrPath } from '../../../lib/onboarding/art.js'
import { reducedMotion } from '../../../lib/reduced-motion.js'
import { cx } from '../../../lib/ui-kit.js'
import SceneStage from '../SceneStage.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 4 Training: a light touch (round 2 §2·4). Seven day tiles, Monday first; a suggested day lights
// and a dumbbell draws inside it, 40ms apart. Plates per side by experience (new 1, returning 2,
// regular 3). 0 days: the tiles fade to .4 and the scene says "Just tracking food".
const PLATE_OFF = { 1: [8], 2: [6, 10], 3: [4, 8, 12] }
const PLATES = { new: 1, returning: 2, regular: 3 }
function dumbbell(cx, cy, n) {
  let d = `M${cx - 10} ${cy}h20`
  for (const o of PLATE_OFF[n]) d += rrPath(cx - o - 2, cy - 6, 4, 12, 2) + rrPath(cx + o - 2, cy - 6, 4, 12, 2)
  return d
}
const TILES = [0, 1, 2, 3, 4, 5, 6].map(i => rrPath(16 + 42 * i, 16, 32, 40, 8)).join('')

/** lit: the Monday-first indexes (0-6) of the suggested days. letters: the seven day initials. */
export default function WeekScene({ days, lit, letters, experience }) {
  const plates = PLATES[experience] || 1
  const tiles = useRef(null)
  const before = useRef(lit)
  // A day that lights now draws its dumbbell in, 40ms after the one before.
  useEffect(() => {
    const was = before.current
    before.current = lit
    if (reducedMotion() || !tiles.current) return
    let k = 0
    for (const i of lit) {
      if (was.includes(i)) continue
      const g = tiles.current.querySelector(`[data-day="${i}"]`)
      const delay = 40 * k++
      g?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'backwards' })
    }
  }, [lit])
  return (
    <SceneStage drawKey="training" viewBox="0 0 320 96"
      overlay={<>
        <div className={cx('ob-tw-l', days === 0 && 'ob-dim')} aria-hidden="true">
          {letters.map((l, i) => <span key={i} style={{ '--x': (((16 + 42 * i + 16) / 320) * 100).toFixed(2) }}>{l}</span>)}
        </div>
        <span className={cx('ob-tw-cap', days === 0 && 'on')} aria-hidden="true">{t('Just tracking food')}</span>
      </>}>
      <ThreadFloor y={80} />
      <g ref={tiles} className={cx('ob-fadeable', days === 0 && 'ob-dim')}>
        <path className="il il-d il-mute" d={TILES} {...at(1)} />
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <g key={i} data-day={i} className={cx('ob-fadeable', !lit.includes(i) && 'ob-off')}>
            <rect className="il il-lit" x={16 + 42 * i} y="16" width="32" height="40" rx="8" />
            <path className="il-acc" d={dumbbell(32 + 42 * i, 36, plates)} />
          </g>
        ))}
      </g>
    </SceneStage>
  )
}
