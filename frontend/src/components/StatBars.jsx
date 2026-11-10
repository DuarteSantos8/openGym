// The one bar system of Stats (stats redesign). Stats had four bar styles, each with its own number
// format: thin bars with a %, range bars with a dark band, segmented strength bars and yellow RIR
// bars. Now every list of amounts is a BarRow and every share of a whole is one StackBar, both with
// the same track, the same 4px ends and one legend style (ChartLegend), so a reader learns the
// marks once.
//
//   BarRow    name | track (fill, optional target band, optional tick) | value
//   StackBar  one 100% bar split by 2px seams, its legend under it
//   ChartLegend  swatches that are the marks themselves, scaled down
//
// Pure presentation: the callers work the numbers out. Fractions are 0..1 of the row's scale.
import { tappable } from '../lib/use-sheet-keyboard.js'

const pct = f => (Math.max(0, Math.min(1, Number(f) || 0)) * 100).toFixed(2).replace(/\.?0+$/, '') + '%'

/**
 * One amount on a shared scale. `tone` colours the fill: 'neutral' (grey, the default for lists
 * that support the screen), 'acc' (the accent, the card's main series), or a status of a target
 * range: 'below' (grey, room left), 'in' (green ink), 'above' (orange ink). `band` draws the target
 * range as a pale span behind the fill, `tick` a 2px mark (a plan, a comparison). The value column
 * is right-aligned with tabular figures, so the numbers line up digit for digit.
 */
export function BarRow({ label, labelClass = '', value, fill = 0, band = null, tick = null, tone = 'neutral', onClick, ariaLabel, className = '', after = null, ...rest }) {
  const press = onClick ? tappable(onClick) : {}
  return <div className={'sbar-row ' + tone + (onClick ? ' tap' : '') + (className ? ' ' + className : '')}
    role={onClick ? 'button' : 'group'} aria-label={ariaLabel} {...press} {...rest}>
    <span className={'sbar-n' + (labelClass ? ' ' + labelClass : '')}>{label}</span>
    <span className="sbar-t" aria-hidden="true">
      {band && <span className="sbar-band" style={{ insetInlineStart: pct(band[0]), width: pct(Math.max(0, band[1] - band[0])) }} />}
      <span className="sbar-f" style={{ width: pct(fill) }} />
      {tick != null && <span className="sbar-tick" style={{ insetInlineStart: `calc(${pct(tick)} - 1px)` }} />}
    </span>
    <span className="sbar-v">{value}</span>
    {after}
  </div>
}

/**
 * A share of a whole as one bar: `parts` [{ key, label, n, share (0..1), color, opacity? }], in order
 * with a 2px surface seam between them; an empty part takes no room. The legend under it carries
 * each part's count and share, so nothing is read from colour alone or hidden in a tooltip.
 */
export function StackBar({ parts, ariaLabel, fmtValue = p => p.n }) {
  const shown = parts.filter(p => p.share > 0)
  return <div className="sstack">
    <div className="sstack-bar" role="img" aria-label={ariaLabel + ': ' + parts.map(p => p.label + ' ' + fmtValue(p)).join(', ')}>
      {shown.map(p => <span key={p.key} style={{ flexGrow: p.share, background: p.color, opacity: p.opacity }} />)}
    </div>
    <ChartLegend className="sstack-legend" items={parts.map(p => ({ key: p.key, mark: 'fill', color: p.color, opacity: p.opacity, label: p.label, value: fmtValue(p), muted: !(p.share > 0) }))} />
  </div>
}

/**
 * One legend style for every Stats chart: a swatch drawn as the mark it explains ('fill' a square
 * with the bar's ends, 'band' the pale target span, 'tick' the 2px plan mark, 'dot' a line chart's
 * point), its label, and optionally its value right after it.
 */
export function ChartLegend({ items, className = '' }) {
  return <ul className={'slegend' + (className ? ' ' + className : '')}>
    {items.map(it => <li key={it.key || it.label} className={it.muted ? 'muted' : undefined}>
      <span className={'slegend-m ' + (it.mark || 'fill')} style={it.color || it.opacity != null ? { '--m': it.color, opacity: it.opacity } : undefined} aria-hidden="true" />
      <span className="slegend-l">{it.label}</span>
      {it.value != null && <span className="slegend-v">{it.value}</span>}
    </li>)}
  </ul>
}
