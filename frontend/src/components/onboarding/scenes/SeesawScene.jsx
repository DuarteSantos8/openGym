import { at, rrPath } from '../../../lib/onboarding/art.js'
import { cx } from '../../../lib/ui-kit.js'
import SceneStage from '../SceneStage.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 2 Goal: the energy seesaw (round 2 §2·2). Food on one side, training on the other; the goal tips
// it. A pure function of the goal on screen (the pressed card previews it). The plank carries the
// data: solid in the accent, dashed and muted for "not sure yet", muted with nothing picked.
const SEESAW = {
  none: { r: 0, m: 0, plank: 'mute' },
  lose: { r: 6, m: 0.55, plank: 'acc' },
  keep: { r: 0, m: 0.8, plank: 'acc' },
  build: { r: -6, m: 1.15, plank: 'acc' },
  unsure: { r: 0, m: 0.8, plank: 'dash' },
}
const PLATES = rrPath(214, 80, 8, 24, 3) + rrPath(242, 80, 8, 24, 3)
const OUTER_PLATES = rrPath(206, 84, 6, 16, 3) + rrPath(252, 84, 6, 16, 3)

export default function SeesawScene({ goal }) {
  const k = SEESAW[goal || 'none']
  return (
    <SceneStage drawKey="goal" viewBox="0 0 320 144" end={700}>
      <ThreadFloor y={128} />
      <path className="il il-occ" d="M148 128 L160 104 L172 128Z" {...at(1)} />
      <g className="ob-ss-g" style={{ '--r': k.r + 'deg' }}>
        <path className="il-lit ob-ss-mound" style={{ '--m': k.m }} d="M64 80 C72 60 104 60 112 80Z" />
        <path className="il" d="M60 80 H116 M60 80 a28 22 0 0 0 56 0" {...at(2)} />
        <path className="il il-d" d="M80 103 H96" {...at(3)} />
        <path className="il" d="M206 92 H258" {...at(4)} />
        <path className="il il-occ" d={PLATES} {...at(5)} />
        <path className={cx('il il-occ ob-ss-part', goal !== 'build' && 'ob-off')} d={OUTER_PLATES} />
        <path className={cx('il-mute ob-ss-part', k.plank !== 'mute' && 'ob-off')} d="M40 104 H280" />
        <path className={cx('il-mute ob-ss-part', k.plank !== 'dash' && 'ob-off')} strokeDasharray="6 6" d="M40 104 H280" />
        <path className={cx('il-acc ob-ss-part', k.plank !== 'acc' && 'ob-off')} d="M40 104 H280" {...at(6)} />
      </g>
    </SceneStage>
  )
}
