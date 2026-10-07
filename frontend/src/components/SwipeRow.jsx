import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { t } from '../lib/i18n.js'
import { useSwipeRow } from '../lib/use-swipe-row.js'
import Icon from './Icon.jsx'

// A set row you can swipe (v1.3.11): toward the start of the line deletes, toward the end copies.
// The gesture lives in lib/use-swipe-row.js; this draws it. Two panes sit behind the row, one per
// side, each growing with the swipe and holding a real button. While the row is shut they are
// zero wide (nothing shows through at the rounded corners, a lesson from QA 1.3.9,
// when Plan's older swipe-to-delete drew a red hairline there), and while a pane is not the one showing it is inert, hidden from screen readers and out
// of the tab order: a set row already has four to six tab stops, and the set-number menu is the
// keyboard's and the screen reader's way to the same two actions.
//
// The row keeps an opaque background, so a done row's tint moves with it rather than letting the
// panes show through. `data-swipe-ignore` keeps the Cards layout's own swipe (SwipeCards) off it:
// on a set row a sideways swipe is about the set, everywhere else on the card it still turns it.
//
// Plan's lists use it too (v1.3.11): a row without `onCopy` is delete-only, with no copy pane at
// all. `deleteLabel`/`copyLabel` and the icons name the action for the list it is in ("Remove"
// in a routine, "Duplicate" on a routine), and `className`, `style` and any data attributes land
// on the outer element, which is what a list's reorder measures and moves.
const SwipeRow = forwardRef(function SwipeRow({
  children, canDelete = true, onDelete, onCopy, onBlocked, onStart, canSwipe, closeKey, flash, peek,
  deleteLabel, copyLabel, deleteIcon = 'trash', copyIcon = 'copy', className, ...rest
}, ref) {
  const canCopy = typeof onCopy === 'function'
  const sw = useSwipeRow({
    canDelete, canCopy, canSwipe,
    onCommit: kind => (kind === 'delete' ? onDelete?.() : onCopy?.()),
    onBlocked, onStart, closeKey,
  })
  useImperativeHandle(ref, () => ({ peek: sw.peek }), [sw.peek])
  // A peek asked for by the owner (the first-use hint), once per new value.
  useEffect(() => { if (peek) sw.peek() }, [peek, sw.peek])
  // A copy or an undo lands with a short accent flash on the row it brought (`flash` changes).
  useEffect(() => {
    const el = sw.outerRef.current
    if (!flash || !el) return
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
    const tm = setTimeout(() => el.classList.remove('flash'), 600)
    return () => clearTimeout(tm)
  }, [flash, sw.outerRef])
  const shut = side => sw.openSide !== side
  return <div {...rest} ref={sw.outerRef} className={'swrow' + (className ? ' ' + className : '')} data-swipe-ignore="" {...sw.handlers}>
    {canCopy && <div ref={sw.cpRef} className="swpane cp" aria-hidden={shut('copy') || undefined} inert={shut('copy') ? true : undefined}>
      <button type="button" tabIndex={shut('copy') ? -1 : 0} onClick={sw.pressCopy}>
        {/* 'Copy set', not 'Copy': that key is the noun a copied routine is named with ("Kopie"). */}
        <span className="lab"><Icon name={copyIcon} /><b>{copyLabel ?? t('Copy set')}</b></span>
      </button>
    </div>}
    <div ref={sw.delRef} className={'swpane del' + (canDelete ? '' : ' dis')} aria-hidden={shut('delete') || undefined} inert={shut('delete') ? true : undefined}>
      <button type="button" tabIndex={shut('delete') ? -1 : 0} onClick={sw.pressDelete}>
        <span className="lab"><Icon name={deleteIcon} /><b>{deleteLabel ?? t('Delete')}</b></span>
      </button>
    </div>
    <div ref={sw.frontRef} className="swfront">{children}</div>
  </div>
})
export default SwipeRow
