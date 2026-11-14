// One number with its label, unit and (optionally) how it changed. A labelled group, or a button
// when it opens something. The change is always spelled out in `deltaText`, which must carry the
// direction itself (a signed number such as "+0.4" or "\u22120.4"); the arrow is decoration only.
// Callers pass already-translated strings. Docs: docs/superpowers/plans/EP-02-tasks.md.
export default function MetricCard({ label, value, unit, delta, deltaText, deltaColor, hideLabel, onClick, className = '', children }) {
  const has = value != null && value !== ''
  const name = [label + ':', has ? String(value) : '–', has && unit ? unit : '', deltaText || ''].filter(Boolean).join(' ')
  const inner = <>
    <span className={hideLabel ? 'metric-l vh' : 'metric-l'}>{label}</span>
    <span className="metric-row">
      <span className="metric-v">{has ? value : '–'}</span>
      {has && unit && <span className="metric-u">{unit}</span>}
      {deltaText && <span dir="ltr" className={'metric-d' + (delta > 0 ? ' up' : delta < 0 ? ' down' : '')} style={deltaColor ? { color: deltaColor } : undefined}>{delta ? <span aria-hidden="true">{delta > 0 ? '↑' : '↓'} </span> : null}{deltaText}</span>}
    </span>
    {children}
  </>
  const cls = 'metric' + (onClick ? ' tap' : '') + (className ? ' ' + className : '')
  return onClick
    ? <button type="button" className={cls} onClick={onClick}>{inner}</button>
    : <div role="group" aria-label={name} className={cls}>{inner}</div>
}
