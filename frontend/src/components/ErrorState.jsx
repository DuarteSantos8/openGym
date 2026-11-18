import Icon from './Icon.jsx'

// Something failed to load. Says what, and offers one retry when there is something to retry.
// The icon plus the words carry the state, not colour. Callers pass translated strings.
export default function ErrorState({ title, text, retryLabel, onRetry, className = '' }) {
  return <div role="alert" className={'empty empty-state err-state' + (className ? ' ' + className : '')}>
    <div className="ico"><Icon name="warning" /></div>
    {title && <div className="empty-t">{title}</div>}
    {text && <div className="empty-x">{text}</div>}
    {onRetry && retryLabel && <div className="empty-acts"><button type="button" className="btn" onClick={onRetry}>{retryLabel}</button></div>}
  </div>
}
