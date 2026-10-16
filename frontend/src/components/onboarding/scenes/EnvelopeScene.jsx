import { useId } from 'react'
import { t } from '../../../lib/i18n.js'
import { at } from '../../../lib/onboarding/art.js'
import SceneStage from '../SceneStage.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 0 Invite: the invitation is your Home (round 2 §2·0). An envelope; the letter rising out of it is
// a mini Home: a calorie ring, three macro lines and the week's dots. Never anyone's real data.
// The thread is born here: a dot at the floor's centre draws outward both ways.
const DOTS = [0, 1, 2, 3, 4, 5, 6]
const LIT = [0, 2, 4]

export default function EnvelopeScene() {
  const clip = useId()
  return (
    <SceneStage drawKey="invite" viewBox="0 0 320 176"
      label={t('An envelope opens. Inside is a preview of your Home: a calorie ring, your macros and your week')}>
      <defs><clipPath id={clip}><rect x="0" y="0" width="320" height="160" /></clipPath></defs>
      <ThreadFloor y={160} birth />
      <path className="il" d="M64 104 L160 56 L256 104" {...at(1)} />
      <path className="il-mute" d="M64 104 V160 M256 104 V160" {...at(2)} />
      <g clipPath={`url(#${clip})`}>
        <g className="ob-inv-letter">
          <rect className="il il-occ" x="80" y="24" width="160" height="128" rx="8" />
          <circle className="il il-d il-mute" cx="108" cy="52" r="14" />
          <circle className="il-acc ob-inv-arc" cx="108" cy="52" r="14" pathLength="1" strokeDasharray=".72 1" transform="rotate(-90 108 52)" />
          {[46, 54, 62].map(y => <path key={y} className="il-mute il-d" d={`M132 ${y} H224`} />)}
          {[60, 48, 36].map((l, i) => <path key={l} className="il il-d ob-inv-mac" d={`M132 ${46 + 8 * i} h${l}`} {...at(15 + i)} />)}
          {DOTS.map(i => <circle key={i} className="il il-d il-mute" cx={96 + 20 * i} cy="92" r="3" />)}
          {LIT.map((d, i) => <circle key={d} className="il-dot ob-inv-dot" cx={96 + 20 * d} cy="92" r="3" style={{ '--i': i }} />)}
        </g>
      </g>
      <path className="il il-occ" d="M64 108 L160 140 L256 108 V154 a6 6 0 0 1-6 6 H70 a6 6 0 0 1-6-6Z" {...at(3)} />
    </SceneStage>
  )
}
