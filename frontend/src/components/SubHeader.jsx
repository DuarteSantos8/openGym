import { useRef } from 'react'
import { t } from '../lib/i18n.js'
import { back } from '../lib/use-tab-nav.js'
import { useTitleFit } from '../lib/text-fit.js'
import { actionCount, cx } from '../lib/ui-kit.js'
import Icon from './Icon.jsx'

// The one header of every page that is not a tab's root: back · the centred title · at most two
// actions of the page's own. The title takes two balanced lines at most, and a step smaller where
// a word of it would otherwise break (Упражнения beside a text button at 320px); `sub` sits
// centred under it. Back is one step down the tab's stack, or to the page's parent when it was
// opened cold (a link, a reload) and has nothing under it — the back that works where an iOS
// home-screen app's swipe does not.
// `children` stand in for the title where the page's title is itself a control (the routine
// editor's name field); it then fills the middle at full width, start-aligned.
// `onBack` replaces the tab's back for a page whose back is not a trip down the stack: a settings
// sub-page names its own parent, the Coach intake steps back through its questions.
// `sticky` pins it under the system bars.
export default function SubHeader({ title, sub, action, onBack, sticky = false, children }) {
  if (import.meta.env.DEV && actionCount(action) > 2) throw new Error('SubHeader: at most two actions')
  const h1 = useRef(null)
  const step = useTitleFit(h1, children ? null : title)
  return (
    <div className={cx('hdr sub-hdr', children && 'sub-hdr-field', sticky && 'sticky')}>
      <button type="button" className="iconbtn hdr-btn" onClick={onBack || back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="sub-hdr-t">{children || <><h1 ref={h1} className={step ? 'fit-' + step : undefined}>{title}</h1>{sub && <div className="sub">{sub}</div>}</>}</div>
      <div className="hdr-actions">{action}</div>
    </div>
  )
}
