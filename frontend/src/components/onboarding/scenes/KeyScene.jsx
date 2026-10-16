import { useRef } from 'react'
import { t } from '../../../lib/i18n.js'
import { at } from '../../../lib/onboarding/art.js'
import { useThreadAnchor } from '../../../lib/onboarding/use-thread-anchor.js'
import { cx } from '../../../lib/ui-kit.js'
import SceneStage from '../SceneStage.jsx'

// 1 Name: your key on your friend's key ring (round 2 §2·1). The bow fills in with your initial once
// there is a name; one tooth per letter (at most six). The teeth are decoration: nothing says the
// passkey comes from the name. The thread arrives as the key's shaft (the blade).
const TEETH = [0, 1, 2, 3, 4, 5]
const depth = ch => [4, 8, 12][ch.charCodeAt(0) % 3]
// The initials over the bows, in % of the 320×112 canvas: the friend's at (68.1, 75), yours at (104, 56).
const FRIEND_AT = { '--x': 21.28, '--y': 66.96 }
const YOURS_AT = { '--x': 32.5, '--y': 50 }

export default function KeyScene({ name, inviter }) {
  const shaft = useRef(null)
  useThreadAnchor(shaft, 'blade')
  const v = name.trim()
  const letters = v.replace(/\s+/g, '').slice(0, 6)
  const initial = v ? v[0].toUpperCase() : ''
  const friend = inviter ? inviter.trim()[0]?.toUpperCase() : ''
  return (
    <SceneStage drawKey="name" viewBox="0 0 320 112" className="ob-kst" end={600}
      label={friend ? t('Your key hangs on {0}’s key ring', inviter) : t('Your key on a key ring')}
      overlay={<>
        {friend && <span className="ob-ov ob-k-a ob-k-andrei" style={FRIEND_AT}>{friend}</span>}
        <span className="ob-ov ob-k-i" style={YOURS_AT}>{initial}</span>
      </>}>
      <circle className="il" cx="56" cy="56" r="12" {...at(0)} />
      {friend && <g className="ob-k-andrei ob-k-part"><g transform="rotate(30 56 68)">
        <circle className="il il-mute" cx="70" cy="68" r="14" {...at(1)} />
        <path className="il il-mute" d="M84 68 H132" {...at(2)} />
      </g></g>}
      <path className="il il-d" d="M68 56 H84" {...at(3)} />
      <circle className={cx('il-mute ob-k-part', initial && 'ob-off')} cx="104" cy="56" r="20" strokeDasharray="4 4" data-late="" />
      <path ref={shaft} className="il" d="M124 56 H248" {...at(4)} />
      <path className="il il-d" d="M200 64 H248" {...at(5)} />
      {TEETH.map(i => {
        const ch = letters[i]
        const d = ch ? depth(ch) : 4
        return <path key={i} className="il ob-k-tooth" d={`M${200 + 8 * i} 64 v${d} h8 v-${d}`} style={{ '--s': ch ? 1 : 0 }} />
      })}
      <circle className={cx('il-acc il-lit ob-k-part', !initial && 'ob-off')} cx="104" cy="56" r="20" />
    </SceneStage>
  )
}
