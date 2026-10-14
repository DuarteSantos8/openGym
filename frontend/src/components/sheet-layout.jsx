import { Children, Fragment } from 'react'
import { t } from '../lib/i18n.js'
import { cx, oneOf, STEPS } from '../lib/ui-kit.js'
import Icon from './Icon.jsx'
import { Spacer } from './layout.jsx'

// The top and bottom of a sheet, as the sheets build them by hand today. For sheets in their own
// files: the ones in sheets.jsx move onto these when it is split.

// The sheet's title. With `onClose` or `action` it shares a row with them, the close button an
// xmark; `sub` is the muted line under it.
export function SheetHeader({ title, sub, onClose, action }) {
  const close = onClose && <button className="iconbtn" aria-label={t('Cancel')} onClick={onClose}><Icon name="xmark" /></button>
  const subLine = sub != null && <div className="muted small mb-5">{sub}</div>
  if (!close && !action) return <>
    <h3 className={sub != null ? 'mb-1' : undefined}>{title}</h3>
    {subLine}
  </>
  return <>
    <div className={cx('row between', sub != null ? 'mb-1' : 'mb-7')}>
      <h3 className="m-0">{title}</h3>
      {close && action ? <div className="row g-4">{action}{close}</div> : action || close}
    </div>
    {subLine}
  </>
}

// The sheet's buttons, under a 14px spacer and `gap` steps apart (default 4, 8px): the
// spacer-and-button run every sheet ends with.
export function SheetActions({ gap = 4, children }) {
  oneOf('SheetActions', 'gap', gap, STEPS)
  return <>
    <Spacer size={7} />
    {Children.toArray(children).map((child, i) => <Fragment key={i}>
      {i > 0 && <Spacer size={gap} />}
      {child}
    </Fragment>)}
  </>
}
