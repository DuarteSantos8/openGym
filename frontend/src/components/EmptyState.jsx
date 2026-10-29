import Icon from './Icon.jsx'

// An empty list's place (redesign 1.4.5, P9): the sentence and the first action together, centred
// where the list will appear, in a quiet frame the size of a first row or two. Before, the history's
// "Log a past workout" sat above its empty message and the message floated in a screen of black.
// `children` are the actions (Buttons); the first one is the way in.
export default function EmptyState({ icon, title, text, children, className = '', tour }) {
  return <div className={'empty empty-state' + (className ? ' ' + className : '')} data-tour={tour}>
    {icon && <div className="ico"><Icon name={icon} /></div>}
    {title && <div className="empty-t">{title}</div>}
    {text && <div className="empty-x">{text}</div>}
    {children && <div className="empty-acts">{children}</div>}
  </div>
}
