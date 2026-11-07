import { useRef } from 'react'
import { useHeaderScroll } from '../lib/useHeaderScroll.js'

// A screen's title row. Everywhere but the iPhone app it is the old large-title `.hdr`, as the
// screens always drew it. On the iPhone (Liquid Glass G3) the buttons move up into a native-style
// nav row that stays put, the page's one h1 stays in the content, and as it scrolls under the
// soft edge a small title fades into the nav row (lib/useHeaderScroll.js). `left` and `right` are
// the screen's own buttons; `wide` is the Library's layout, a row of text buttons that stays in
// the content (beside the title, or under it on the iPhone) and a count line.
export default function ScreenHeader({ title, sub, left, right, deco, className = '', wide = false, hard = false }) {
  const ios = document.documentElement.dataset.platform === 'ios'
  const gh = useRef(null), lt = useRef(null)
  useHeaderScroll(gh, lt)
  const cls = 'hdr' + (className && ' ' + className)
  if (!ios) {
    return <div className={cls}>{deco}{left}
      <div style={left ? { flex: 1, marginInlineStart: 12 } : undefined}><h1>{title}</h1>{!wide && sub && <div className="sub">{sub}</div>}</div>
      {right}{wide && sub && <div className="sub lib-count">{sub}</div>}</div>
  }
  return <>
    <div className={'gh' + (hard ? ' hard' : '')} ref={gh}>
      <div className="edge" aria-hidden="true" /><div className="edge-b" aria-hidden="true" />
      <div className="nav">
        <div className="grp">{left}</div>
        <div className="grp">{!wide && right}</div>
        <div className="inl" aria-hidden="true"><b>{title}</b></div>
      </div>
    </div>
    <div className={cls}>{deco}<div><h1 data-lt ref={lt}>{title}</h1>{sub && <div className="sub">{sub}</div>}</div></div>
    {wide && right}
  </>
}
