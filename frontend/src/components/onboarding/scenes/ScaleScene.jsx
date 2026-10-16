import { useId } from 'react'
import { at } from '../../../lib/onboarding/art.js'
import { KG_LB } from '../../../lib/onboarding/units.js'
import { cx } from '../../../lib/ui-kit.js'
import SceneStage from '../SceneStage.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 3d Weight: a bathroom scale from above, a tape behind a fixed accent needle (round 2 §2·3). One
// tape path for 35-250 kg at 4 units a kilo; the numbers sit on HTML strips under the window (one
// strip is 1000 tape units, so a label's place is a plain %), kilos or pounds by the unit chip.
let TAPE = ''
for (let kg = 35; kg <= 250; kg++) TAPE += `M${4 * kg} 44v${kg % 5 ? 8 : 14}`
const KG_LABELS = [], LB_LABELS = []
for (let kg = 40; kg <= 250; kg += 10) KG_LABELS.push({ v: kg, at: (0.4 * kg).toFixed(2) })
for (let lb = 80; lb <= 540; lb += 20) LB_LABELS.push({ v: lb, at: ((0.4 * lb) / KG_LB).toFixed(2) })

export default function ScaleScene({ kg, unit, live, after }) {
  const clip = useId()
  const k = kg ?? 70
  const tape = { '--x': (160 - 4 * k).toFixed(1) + 'px' }
  const strip = { '--x': ((32 - 4 * k) / 10).toFixed(2) }
  const set = kg != null
  return (
    <SceneStage drawKey="weight" viewBox="0 0 320 144" className={cx(live && 'ob-live')} end={560} after={after}
      overlay={<div className="ob-sl-box" aria-hidden="true">
        {[['kg', KG_LABELS], ['lb', LB_LABELS]].map(([u, labels]) => (
          <div key={u} className={cx('ob-sl-strip', unit !== u && 'ob-off')} style={strip}>
            {labels.map(l => <span key={l.v} style={{ '--at': l.at }}>{l.v}</span>)}
          </div>
        ))}
      </div>}>
      <defs><clipPath id={clip}><rect x="128" y="44" width="64" height="24" rx="6" /></clipPath></defs>
      <ThreadFloor y={128} />
      <rect className="il il-occ" x="96" y="32" width="128" height="96" rx="24" {...at(1)} />
      <rect className={cx('il-lit ob-fadeable', !set && 'ob-off')} x="128" y="44" width="64" height="24" rx="6" />
      <g clipPath={`url(#${clip})`}><g className="ob-stape" style={tape}><path className="il il-d" d={TAPE} data-late="" /></g></g>
      <rect className="il il-d" x="128" y="44" width="64" height="24" rx="6" {...at(2)} />
      <path className={cx('il-acc ob-fadeable', !set && 'ob-off')} d="M160 42 V70" {...at(3)} />
    </SceneStage>
  )
}
