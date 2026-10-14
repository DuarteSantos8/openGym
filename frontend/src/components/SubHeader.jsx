import { t } from '../lib/i18n.js'
import { back } from '../lib/use-tab-nav.js'
import Icon from './Icon.jsx'

// The one header of every page that is not a tab's root: back · title · the page's own action.
// Back is one step down the tab's stack, or to the page's parent when it was opened cold (a link,
// a reload) and has nothing under it — the back that works where an iOS home-screen app's swipe
// does not.
// `children` stand in for the title where the page's title is itself a control (the routine
// editor's name field).
export default function SubHeader({ title, sub, action, children }) {
  return (
    <div className="hdr sub-hdr">
      <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="sub-hdr-t">{children || <><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</>}</div>
      {action && <div className="hdr-actions">{action}</div>}
    </div>
  )
}
