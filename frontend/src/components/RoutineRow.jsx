import Icon from './Icon.jsx'
import RoutineTile from './RoutineTile.jsx'
import MiniBodyMap from './MiniBodyMap.jsx'
import SwipeRow from './SwipeRow.jsx'
import { t } from '../lib/i18n.js'
import { said } from '../lib/a11y-name.js'
import { colorOf } from '../lib/routine-colors.js'
import { isFavRoutine } from '../lib/routine-favs.js'
import { tappable } from '../lib/use-sheet-keyboard.js'

/** The "…" on a routine row, a folder row and the current plan block: it opens that one's menu. */
export function MoreButton({ name, onClick }) {
  return <button type="button" className="plan-more" aria-label={t('More for {0}', said(name))}
    onClick={e => { e.stopPropagation(); onClick() }}><Icon name="more" /></button>
}

/** What RoutineRow's `drag` prop takes, from a useLongPressDrag: the row's handlers, whether it is the
 *  lifted one, and how far it rides (`ride` px above or below the finger). */
export const dragOf = (d, id, ride) => ({ props: d.rowProps(id), lifted: d.lifted === id, dy: (d.drag?.dy ?? 0) + ride, held: d.held })

/** One routine on Plan: colour tile, name (a gold star when starred), `sub`, muscle maps, "…".
 *  `swipe` is the props of the SwipeRow around it (Settings → Swipe actions), or falsy.
 *  `edit` ({ checked, onToggle, handle, style, grip }) is Plan's Edit: a check circle and a grip in place
 *  of the swipe and the "…"; a tap on the row selects it. */
export default function RoutineRow({ r, sub, body, onOpen, onMenu, swipe, edit, drag }) {
  const name = <div className="grow"><div className="tt">{isFavRoutine(r) && <Icon name="starFill" className="fav-star" />}{r.name}</div><div className="ss">{sub}</div></div>
  // Edit: the row is no button (it holds the grip, which a screen reader would lose inside one). The
  // check circle is the stretched primary (.tap-main), so a tap anywhere on the row ticks it.
  if (edit) return <div className={'item plan-routine tap-host' + (edit.checked ? ' is-selected' : '')} data-reorder-row="" style={edit.style}>
    <button type="button" role="checkbox" aria-checked={!!edit.checked} className="plan-check tap-main" aria-label={t('Select {0}', said(r.name))}
      onClick={edit.onToggle}><span><Icon name="check" /></span></button>
    <RoutineTile r={r} />
    {name}
    <MiniBodyMap routines={[r]} tint={colorOf(r)} body={body} />
    {edit.grip && <button type="button" className="plan-grip" aria-label={t('Move {0}', said(r.name))} title={t('Drag to reorder')} {...edit.handle}><Icon name="grip" /></button>}
  </div>
  const row = <div className="item plan-routine" {...tappable(onOpen)}>
    <RoutineTile r={r} />
    {name}
    <MiniBodyMap routines={[r]} tint={colorOf(r)} body={body} />
    <MoreButton name={r.name} onClick={onMenu} />
  </div>
  const out = swipe ? <SwipeRow className="swrow-item" canSwipe={drag ? () => !drag.held() : undefined} {...swipe}>{row}</SwipeRow> : row
  if (!drag) return out
  // The wrapper keeps the old slot (a dashed outline while lifted); the inner one rides the finger.
  return <div className={'drag-row' + (drag.lifted ? ' is-lifted' : '')} data-name={r.name} {...drag.props}>
    <div className="drag-in" style={drag.lifted ? { '--dy': drag.dy + 'px' } : undefined}>{out}</div>
  </div>
}
