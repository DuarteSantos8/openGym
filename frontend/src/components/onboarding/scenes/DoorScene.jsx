import { at } from '../../../lib/onboarding/art.js'
import { cx } from '../../../lib/ui-kit.js'
import SceneStage from '../SceneStage.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 3c Height: a door frame with a height mark on its jamb (round 2 §2·3): 0-220 cm on y 128 → 20
// (.49 a cm), a tick every 10 cm and a long one every 50. The mark moves by transform only; `live`
// while the ruler is dragged, so it follows at 120ms instead of 420.
const MINOR = [], MAJOR = []
for (let cm = 0; cm <= 220; cm += 10) (cm % 50 === 0 ? MAJOR : MINOR).push(`M116 ${(128 - 0.49 * cm).toFixed(1)}h${cm % 50 === 0 ? 10 : 6}`)

export default function DoorScene({ cm, live, after }) {
  const set = cm != null
  const lift = set ? { '--y': (128 - 0.49 * cm).toFixed(1) + 'px' } : undefined
  const fill = set ? { '--s': Math.min(1, (0.49 * cm) / 108).toFixed(3) } : undefined
  return (
    <SceneStage drawKey="height" viewBox="0 0 320 144" className={cx(live && 'ob-live')} after={after}>
      <ThreadFloor y={128} />
      <rect className={cx('il-lit ob-hcol', !set && 'ob-off')} style={fill} x="117" y="20" width="58" height="108" />
      <path className="il" d="M112 128 V24 a4 4 0 0 1 4-4 H204 a4 4 0 0 1 4 4 V128" {...at(1)} />
      <path className="il il-d il-mute" d={MINOR.join('')} {...at(2)} />
      <path className="il il-d" d={MAJOR.join('')} {...at(3)} />
      <path className={cx('il-acc ob-hmark', !set && 'ob-off')} style={lift} d="M116 0 H176" />
    </SceneStage>
  )
}
