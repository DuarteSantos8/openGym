import { useEffect, useRef } from 'react'
import { at } from '../../../lib/onboarding/art.js'
import { reducedMotion } from '../../../lib/reduced-motion.js'
import { cx } from '../../../lib/ui-kit.js'
import SceneStage from '../SceneStage.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 5 Plan: one plan card, three states (round 2 §2·5). Nothing chosen: a dashed card. A ready-made
// plan: the card solid, one row per training day (four at most), drawn in 60ms apart. The AI
// coach: a speech bubble draws round the card, three dots light once, then the rows. Not now: the
// rows retract and an accent + appears. ViewBox 320×136 (floor inset 16, rule (a)).
const ROW_LEN = [60, 44, 52, 40]
const EASE_IO = 'cubic-bezier(.65,0,.35,1)'
const full = s => s === 'starter' || s === 'coach'
// A state part that draws when its state arrives (a dash of the whole length, offset by script),
// not with the scene: no draw-in order of its own.
const STROKE = { pathLength: 1, strokeDasharray: 1, 'data-state': '' }

function draw(el, delay, duration) {
  el?.animate?.([{ strokeDashoffset: 1, opacity: 0 }, { strokeDashoffset: 0, opacity: 1 }],
    { duration, delay, easing: EASE_IO, fill: 'backwards' })
}

export default function PlanScene({ state, days }) {
  const root = useRef(null)
  const before = useRef(state)
  const rows = Math.min(4, days || 0)
  // The change from one state to the next is what moves: a scene arriving at a state is still.
  useEffect(() => {
    const prev = before.current
    before.current = state
    const g = root.current
    if (!g || prev === state || reducedMotion()) return
    const at0 = state === 'coach' ? 600 : 0
    if (full(state) && !full(prev)) g.querySelectorAll('.ob-pr-ln').forEach((p, i) => draw(p, at0 + i * 60, 320))
    if (state === 'coach') {
      g.querySelectorAll('.ob-pb > *').forEach(p => draw(p, 0, 480))
      g.querySelectorAll('.ob-pdot').forEach((d, i) => d.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 480 + i * 120, easing: 'linear', fill: 'backwards' }))
    }
    if (state === 'none') draw(g.querySelector('.ob-pplus'), 0, 320)
  }, [state])
  return (
    <SceneStage drawKey="plan" viewBox="0 0 320 136">
      <ThreadFloor y={120} />
      <g ref={root}>
        <g className={cx('ob-pb ob-fadeable', state !== 'coach' && 'ob-off')}>
          <rect className="il-acc" x="88" y="6" width="144" height="110" rx="16" {...STROKE} />
          <path className="il-acc" d="M112 116 l-6 4 l18 -4" {...STROKE} />
        </g>
        <rect className={cx('il-mute ob-fadeable', full(state) && 'ob-off')} x="104" y="16" width="112" height="96" rx="8" strokeDasharray="6 6" data-late="" />
        <rect className={cx('il il-occ ob-fadeable', !full(state) && 'ob-off')} x="104" y="16" width="112" height="96" rx="8" {...at(1)} />
        {Array.from({ length: rows }, (_, i) => {
          const y = 36 + 18 * i
          return (
            <g key={i} className={cx('ob-pr', !full(state) && 'ob-off')}>
              <path className="il-acc" d={`M114 ${y} h12 M116 ${y - 4} v8 M124 ${y - 4} v8`} />
              <path className="il il-d ob-pr-ln" d={`M136 ${y} h${ROW_LEN[i]}`} {...STROKE} />
            </g>
          )
        })}
        {[148, 160, 172].map(x => <circle key={x} className={cx('il-dot ob-pdot ob-fadeable', state !== 'coach' && 'ob-off')} cx={x} cy="102" r="2.5" />)}
        <path className={cx('il-acc ob-pplus ob-fadeable', state !== 'none' && 'ob-off')} d="M160 56 v16 M152 64 h16" {...STROKE} />
      </g>
    </SceneStage>
  )
}
