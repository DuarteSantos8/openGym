// The exercise library's two filters, each in a sheet of tiles like Hevy's: pick one or several,
// then "Show results (N)" with the count the choice would leave, or clear them. The page itself
// only carries two small buttons (views/Library.jsx), not a wall of chips.
//
// The sheet keeps its own picks until it is applied, so backing out with a tap outside changes
// nothing. `counts` is how many exercises each tile would list (with the search and the other
// filter already applied): a tile with none is dimmed, not removed, so the sheet always has the same
// tiles in the same places.
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import { MUSCLE_GROUPS, BACK_MUSCLES, EQUIP_GROUPS } from '../lib/exercise-filters.js'
import BodyMap from './BodyMap.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Spelled out as t() literals, one per group: the strings check (check-source-strings.mjs) only
// sees a literal written inside a t() call, and a name parked in a table would stay English.
export const equipLabel = id => ({
  none: t('No equipment'), barbell: t('Barbell'), dumbbell: t('Dumbbell'), kettlebell: t('Kettlebell'), machine: t('Machine'),
  cable: t('Cable'), band: t('Band'), plate: t('Plate'), suspension: t('Suspension'), other: t('Other'),
}[id] || id)
// The same for the two titles of the muscle sheet.
const muscleGroupTitle = title => ({ 'Upper body': t('Upper body'), 'Lower body': t('Lower body'), Other: t('Other') }[title] || title)

const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id])

function Footer({ sel, count, onClear, onShow }) {
  return <div className="fs-foot">
    <Button className="fs-clear" onClick={onClear}>{t('Clear filters')}</Button>
    <Button variant="primary" className="fs-show" onClick={onShow}>{t('Show results ({0})', count(sel))}</Button>
  </div>
}

// A muscle's tile: the body from the side it is seen from, that muscle lit.
function MuscleTile({ id, on, empty, onClick, body }) {
  const cardio = id === 'cardio'
  return <button type="button" className={'fs-tile' + (on ? ' on' : '') + (empty ? ' zero' : '')} aria-pressed={on} onClick={onClick}>
    <span className={'fs-ico fs-fig ' + (BACK_MUSCLES.has(id) ? 'back' : 'front')} aria-hidden="true">
      {cardio ? <Icon name="figureRun" /> : <BodyMap className="bm-mini" load={{ [id]: 1 }} body={body} />}
    </span>
    <span className="fs-name">{t(cardio ? 'cardio' : MUSCLE_NAME[id])}</span>
  </button>
}

export function MuscleFilterSheet({ selected, counts, count, body, onApply, close }) {
  const [sel, setSel] = useState(selected)
  const apply = v => { onApply(v); close() }
  return <>
    <h3 className="fs-title">{t('Muscle group')}</h3>
    {MUSCLE_GROUPS.map(g => <div key={g.title}>
      <h4 className="sec fs-sec">{muscleGroupTitle(g.title)}</h4>
      <div className="fs-grid">{g.ids.map(id => <MuscleTile key={id} id={id} on={sel.includes(id)} empty={!counts[id]} body={body} onClick={() => setSel(toggle(sel, id))} />)}</div>
    </div>)}
    <Footer sel={sel} count={count} onClear={() => apply([])} onShow={() => apply(sel)} />
  </>
}

export function EquipFilterSheet({ selected, counts, count, onApply, close }) {
  const [sel, setSel] = useState(selected)
  const apply = v => { onApply(v); close() }
  return <>
    <h3 className="fs-title">{t('Equipment')}</h3>
    <div className="fs-grid">{EQUIP_GROUPS.map(g => {
      const on = sel.includes(g.id)
      return <button key={g.id} type="button" className={'fs-tile' + (on ? ' on' : '') + (counts[g.id] ? '' : ' zero')} aria-pressed={on} onClick={() => setSel(toggle(sel, g.id))}>
        <span className="fs-ico" aria-hidden="true"><Icon name={g.icon} /></span>
        <span className="fs-name">{equipLabel(g.id)}</span>
      </button>
    })}</div>
    <Footer sel={sel} count={count} onClear={() => apply([])} onShow={() => apply(sel)} />
  </>
}

export const openMuscleFilter = opts => useUI.getState().openSheet(close => <MuscleFilterSheet {...opts} close={close} />)
export const openEquipFilter = opts => useUI.getState().openSheet(close => <EquipFilterSheet {...opts} close={close} />)
