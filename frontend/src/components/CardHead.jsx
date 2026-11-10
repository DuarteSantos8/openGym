import { useId } from 'react'
import Icon from './Icon.jsx'

// One header for every card on Home (redesign 1.4.5, P2). Home used to show five header styles on
// one screen: Recovery a tinted square and a 13px line, Challenges an eyebrow over a 16/600 title,
// Check-in two equal lines, Body weight a grey 13px label, the streak a 22px headline. Now each
// card asks its question the same way:
//
//   [icon]  eyebrow          13px, secondary grey (.lbl2): what kind of card this is, or when
//           Title            17/600: the card's one answer
//           subtitle         13-15px, secondary grey (optional)
//                    [action]  at most one trailing control (×, a chevron, Log)
//
// `icon` is a glyph name drawn in the app's tinted square (`tint`, default the accent), or `glyph`
// any node drawn bare (the streak's flame). `toggle` makes the icon, text and a chevron one button
// that folds the card (Challenges). The heading is a div, not an h2: the cards are peers on a
// scrolling page and the screen's one heading is the page title.
//
// `open` makes the card open something (the recap's sheet, the streak's calendar, Check in) without
// the card itself being a button (card dismiss pass, 1.4.4). The text becomes the card's one primary
// button, named by the title and described by the eyebrow and subtitle, and its ::after stretches
// over the whole card (index.css .tap-host / .tap-main). The trailing control is a sibling layered
// above it, never inside it: a tap on the × only puts the card away, the card's press scale answers
// only the primary, and a screen reader meets two plain buttons instead of a button in a button.
// The card that uses it carries `tap-host`. open = { onClick, haspopup }.
export default function CardHead({ icon, tint, glyph, eyebrow, title, sub, action, toggle, open, className = '', titleProps }) {
  const id = useId()
  const hasEyebrow = eyebrow != null && eyebrow !== false, hasSub = sub != null && sub !== false
  const lead = glyph ? <span className="card-head-g" aria-hidden="true">{glyph}</span>
    : icon ? <span className="lrow-i" style={tint ? { background: tint } : undefined} aria-hidden="true"><Icon name={icon} /></span>
      : null
  const text = <span className="card-head-t">
    {hasEyebrow && <span className="lbl2" id={id + 'e'}>{eyebrow}</span>}
    <span className="card-head-title" id={id + 't'} {...titleProps}>{title}</span>
    {hasSub && <span className="card-head-sub" id={id + 's'}>{sub}</span>}
  </span>
  return <div className={'card-head' + (className ? ' ' + className : '')}>
    {toggle
      ? <button type="button" className="card-head-main card-head-toggle" aria-expanded={toggle.expanded} onClick={toggle.onToggle}>
        {lead}{text}<Icon name={toggle.expanded ? 'chevronUp' : 'chevronDown'} className="chev" />
      </button>
      : open
        ? <button type="button" className="card-head-main tap-main" onClick={open.onClick} aria-haspopup={open.haspopup}
          aria-labelledby={titleProps?.id || id + 't'}
          aria-describedby={[hasEyebrow && id + 'e', hasSub && id + 's'].filter(Boolean).join(' ') || undefined}>{lead}{text}</button>
        : <span className="card-head-main">{lead}{text}</span>}
    {action}
  </div>
}
