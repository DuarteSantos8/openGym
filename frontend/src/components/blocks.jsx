import { isValidElement } from 'react'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { cx, oneOf } from '../lib/ui-kit.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Content blocks. Each emits the exact classes and elements the pages build by hand today
// (.card, .item, .tiles, .big, .empty, h4.sec, .tag, .chips), so index.css stays the one source
// of their look and the tests that find them by class keep working. blocks.test.jsx holds each
// one to the hand-built markup it replaces. A prop value with no class throws in development.

const INKS = ['danger', 'warn', 'orange', 'acc', 'ok']

// A card. With `action`, the title shares a row with it, as the hand-built `row between` header
// did; an action with no title sits at the row's end. tone: a ring in the tone's colour.
export function Card({ title, action, tone, as: El = 'div', className, children, ...rest }) {
  oneOf('Card', 'tone', tone, ['danger', 'accent', 'orange'])
  const head = title != null
    ? (action ? <div className="row between"><h2 className="m-0">{title}</h2>{action}</div> : <h2>{title}</h2>)
    : action && <div className="row jc-end">{action}</div>
  return <El className={cx('card', tone && 'card-' + tone, className)} {...rest}>
    {head}
    {children}
  </El>
}

const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary'])
const interactive = node => {
  if (Array.isArray(node)) return node.some(interactive)
  if (!isValidElement(node)) return false
  const { type, props } = node
  if (typeof type === 'string' && INTERACTIVE.has(type)) return true
  if (props.onClick || props.onChange || props.href) return true
  return interactive(props.children)
}

// A floating list row: lead (a thumb or an icon), the title over its subtitle, then what trails
// it. `onClick` makes the whole row a keyboard-reachable role=button; such a row must hold no
// button, link or field of its own (a control inside a button is unreachable for a screen reader),
// and in development it warns when it does. A row that holds a control of its own takes `onOpen`
// instead: the title and subtitle become one real button (.item-open, RoutineEdit.jsx's exercise
// name), so the text block opens the row and the control beside it stays reachable. `openProps`
// (aria-busy, aria-disabled, a label) go on that button, which keeps its role and focus.
export function ItemRow({ lead, title, subtitle, trailing, chevron = false, onClick, onOpen, openProps, className, titleClassName, subtitleClassName, ...rest }) {
  if (import.meta.env.DEV && onClick && onOpen) throw new Error('ItemRow: onClick (the row) or onOpen (its text), not both')
  if (import.meta.env.DEV && onClick && interactive([lead, title, subtitle, trailing])) {
    console.warn('ItemRow: a tappable row (role=button) holds an interactive child. Give the row no onClick and make the child the control, or move the control out of the row.')
  }
  return <div className={cx('item', className)} {...tappable(onClick)} {...rest}>
    {lead}
    {onOpen
      ? <button type="button" className="grow item-open" onClick={onOpen} {...openProps}>
        <span className={cx('tt', titleClassName)}>{title}</span>
        {subtitle != null && <span className={cx('ss', subtitleClassName)}>{subtitle}</span>}
      </button>
      : <div className="grow">
        <div className={cx('tt', titleClassName)}>{title}</div>
        {subtitle != null && <div className={cx('ss', subtitleClassName)}>{subtitle}</div>}
      </div>}
    {trailing}
    {chevron && <Icon name="chevronRight" className="chev" />}
  </div>
}

export function Tiles({ className, children }) {
  return <div className={cx('tiles', className)}>{children}</div>
}

// One tile: its label over its value. size: 'sm' | 'xs' below the 26px default; tone colours the
// value with its .ink-* class. `pressed` (a tile that picks one of several) says which is picked
// to a screen reader; leave it out for a tile that is not a toggle.
export function StatTile({ label, icon, value, unit, size, tone, onClick, pressed, className }) {
  oneOf('StatTile', 'size', size, ['sm', 'xs'])
  oneOf('StatTile', 'tone', tone, INKS)
  return <div className={cx('tile', onClick && 'tappable', className)} {...tappable(onClick)} aria-pressed={onClick ? pressed : undefined}>
    <div className="l">{icon && <Icon name={icon} />}{label}</div>
    <div className={cx('v', size && 'v-' + size, tone && 'ink-' + tone)}>{value}{unit != null && <> <span className="muted stat-unit">{unit}</span></>}</div>
  </div>
}

// The big number and its muted unit. size: 'sm' (22px) below the 30px default.
export function Stat({ value, unit, size }) {
  oneOf('Stat', 'size', size, ['sm'])
  return <div className={cx('big', size && 'big-' + size)}>{value}{unit != null && <> <span className="muted stat-unit">{unit}</span></>}</div>
}

// What a list says when it has nothing in it. With a title, the text sits under it in its own block.
// `art` (a LineArt scene) leads it in place of `icon`; `action` ({ label, onClick, icon }) is its one
// filled pill and `secondary` a plain one beside it. With none of those three, the markup is the
// one this block always had.
export function EmptyState({ icon, art, title, action, secondary, className, children }) {
  return <div className={cx('empty', (art || action || secondary) && 'empty-x', className)}>
    {art ? <div className="ico empty-art">{art}</div> : icon && <div className="ico"><Icon name={icon} /></div>}
    {title != null
      ? <><strong>{title}</strong>{children != null && <div>{children}</div>}</>
      : children}
    {(action || secondary) && <div className="empty-acts">
      {action && <Button variant="primary" shape="pill" icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
      {secondary && <Button shape="pill" icon={secondary.icon} onClick={secondary.onClick}>{secondary.label}</Button>}
    </div>}
  </div>
}

// One quiet line with its icon, centred: a status in place of rows (paused, offline, an error).
export function InlineNote({ icon, className, children, ...rest }) {
  return <p className={cx('inote', className)} {...rest}>{icon && <Icon name={icon} />}<span>{children}</span></p>
}

// A grey block standing in for content still loading, at its size: `w` and `h` in px (a number)
// or any length, `r` its radius. It says nothing to a screen reader; whatever holds it announces
// the loading once (role=status).
const len = v => (typeof v === 'number' ? v + 'px' : v)
export function Skeleton({ w = '100%', h = 12, r = 4, className }) {
  return <span className={cx('skel', className)} aria-hidden="true" style={{ '--skel-w': len(w), '--skel-h': len(h), '--skel-r': len(r) }} />
}

// A key on the keyboard, as a hint ("⌘ K", "esc"): 20px tall, never a control.
export function Kbd({ className, children }) {
  return <kbd className={cx('kbd', className)}>{children}</kbd>
}

export function SectionTitle({ as: El = 'h4', className, children }) {
  return <El className={cx('sec', className)}>{children}</El>
}

// tone: 'acc' | 'dim'. `nocap` keeps the text as written (tags capitalise by default).
export function Tag({ tone, icon, nocap = false, className, children }) {
  oneOf('Tag', 'tone', tone, ['acc', 'dim'])
  return <span className={cx('tag', tone, nocap && 'nocap', className)}>{icon && <Icon name={icon} />}{children}</span>
}

// size="lg": the 36px chip of a destination strip (the search's shortcuts), with a leading `icon`.
export function Chip({ on = false, nocap = false, size, icon, onClick, className, children, ...rest }) {
  oneOf('Chip', 'size', size, ['lg'])
  return <button type="button" className={cx('chip', nocap && 'nocap', on && 'on', size && 'chip-' + size, className)} onClick={onClick} {...rest}>
    {icon && <Icon name={icon} />}{children}
  </button>
}

// The horizontal chip strip. `ref` reaches the strip, for useRevealActiveChip.
export function ChipRow({ ref, className, children, ...rest }) {
  return <div ref={ref} className={cx('chips', className)} {...rest}>{children}</div>
}
