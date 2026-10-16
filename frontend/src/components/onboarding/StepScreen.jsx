import { useEffect, useRef } from 'react'
import { cx } from '../../lib/ui-kit.js'

// One onboarding screen's frame. A screen fills the slots; the frame owns the order and the
// spacing (the header block, the stage, the caption, the controls, the footer), as <Page> does for
// the app's pages, so no screen chooses its own (onboarding-guards.test.jsx). The title takes focus
// on arrival, so a screen reader starts each step at its question.
//
//   title, sub, titleId   the question; `fixedHeader` holds it at two title and two subtitle lines
//                         (rule (b): the goal-to-weight run's floors then share one y)
//   lead                  what stands above the question (the inviter's initial)
//   headerExtra           a control that belongs to the question ("Why we ask")
//   stage                 the scene card
//   caption               the scene's caption, a polite live region (undefined: none)
//   footer                the call to action, pinned over what scrolls
//   center                the passkey result: everything centred, its mark as the stage
export default function StepScreen({ title, sub, titleId, fixedHeader = false, lead, headerExtra, stage, caption, footer, center = false, onTap, noNav = false, children }) {
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  const head = <>
    <h1 ref={heading} id={titleId} className={center ? 'ob-pass-t' : 'ob-ttl'} tabIndex={-1}>{title}</h1>
    {sub != null && <p className={center ? 'ob-pass-s' : 'ob-sub'}>{sub}</p>}
  </>
  if (center) {
    // onTap: a tap anywhere moves on early (it moves on by itself as well, so keys lose nothing).
    return <section className="ob-screen nonav" aria-labelledby={titleId} onClick={onTap}>
      <div className="ob-center" role="status" aria-live="polite">{stage}{head}{children}</div>
    </section>
  }
  return (
    <section className={cx('ob-screen', noNav && 'nonav')} aria-labelledby={titleId}>
      <div className="ob-body">
        <div className={cx('ob-hd', fixedHeader && 'fixed')}>{lead}{head}{headerExtra}</div>
        {stage && <div className="ob-stage">{stage}</div>}
        {caption !== undefined && <p className="ob-cap" aria-live="polite">{caption}</p>}
        {children && <div className="ob-controls">{children}</div>}
      </div>
      {footer && <div className="ob-foot">{footer}</div>}
    </section>
  )
}
