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
export default function CardHead({ icon, tint, glyph, eyebrow, title, sub, action, toggle, className = '', titleProps }) {
  const lead = glyph ? <span className="card-head-g" aria-hidden="true">{glyph}</span>
    : icon ? <span className="lrow-i" style={tint ? { background: tint } : undefined} aria-hidden="true"><Icon name={icon} /></span>
      : null
  const text = <span className="card-head-t">
    {eyebrow != null && eyebrow !== false && <span className="lbl2">{eyebrow}</span>}
    <span className="card-head-title" {...titleProps}>{title}</span>
    {sub != null && sub !== false && <span className="card-head-sub">{sub}</span>}
  </span>
  return <div className={'card-head' + (className ? ' ' + className : '')}>
    {toggle
      ? <button type="button" className="card-head-main card-head-toggle" aria-expanded={toggle.expanded} onClick={toggle.onToggle}>
        {lead}{text}<Icon name={toggle.expanded ? 'chevronUp' : 'chevronDown'} className="chev" />
      </button>
      : <span className="card-head-main">{lead}{text}</span>}
    {action}
  </div>
}
