import { Children } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { cx, oneOf } from '../lib/ui-kit.js'
import Icon from './Icon.jsx'
import { Skeleton } from './blocks.jsx'
import { Button } from './ui.jsx'
import { Loader } from './Loader.jsx'

// The blocks the four tab roots are rebuilt from (fitness-eval ui-redesign-components §1; their
// look is tab-kit.css). Every colour is a token, so the accent stays the user's: fills --acc,
// text --acc-ink, line art --acc-graphic; macros keep their own fixed colours.

const STATUSES = ['ready', 'loading', 'error', 'empty']
// An empty value is an en dash, the app's one (lib/empty-placeholder.test.js).
const EMPTY = '–'

// A tab's state at a glance, centred: a glyph, an eyebrow (never a greeting), then a title or a
// big value with its unit, and a caption; and/or `metrics`, two values side by side split by a
// hairline, under the caption. `link` ({ label, onClick }): a text button under the caption (the
// day's workout). `action`: one control at the top end (a ⋯ menu). `children`: quiet lines at
// the end. status: loading (skeletons at the same sizes), error (the caption and a retry),
// empty (the values as dashes). tone="over": over a target, said in orange ink, not as an alarm.
export function HeroStatus({ glyph, eyebrow, title, value, unit, caption, metrics, link, action, status = 'ready', tone, onRetry, children }) {
  oneOf('HeroStatus', 'status', status, STATUSES)
  oneOf('HeroStatus', 'tone', tone, ['over'])
  if (status === 'loading') {
    return <div className="hero" role="status">
      <span className="sr-only">{t('Loading today')}</span>
      {glyph && <Skeleton w={32} h={32} r={8} />}
      {eyebrow != null && <Skeleton w={96} h={15} />}
      <Skeleton w={metrics ? 220 : 140} h={title != null ? 34 : 48} r={8} />
      {caption != null && <Skeleton w={160} h={15} />}
    </div>
  }
  const shown = status === 'empty' ? EMPTY : value
  return <div className={cx('hero', action && 'hero-has-a')}>
    {glyph && <Icon name={glyph} className="hero-g" />}
    {eyebrow != null && <div className="hero-e">{eyebrow}</div>}
    {title != null
      ? <h2 className="hero-t">{title}</h2>
      : shown != null && <p className="hero-v"><span className="hero-num">{shown}</span>{unit && status !== 'empty' && <span className="hero-u">{unit}</span>}</p>}
    {/* After the heading in reading order; placed at the top end by CSS. */}
    {action && <div className="hero-a">{action}</div>}
    {caption != null && <div className={cx('hero-c', tone === 'over' && 'ink-orange')}>{caption}</div>}
    {link && <button type="button" className="hero-l" onClick={link.onClick}>{link.label}<Icon name="chevronRight" /></button>}
    {metrics && <div className="hero-m">
      {metrics.map(m => <div key={m.label} className="hero-mi">
        <p className="hero-v"><span className="hero-num">{status === 'empty' ? EMPTY : m.value}</span>{m.unit && status !== 'empty' && <span className="hero-u">{m.unit}</span>}</p>
        <div className="hero-ml">{m.label}</div>
        {m.sub != null && <div className="hero-ms">{m.sub}</div>}
      </div>)}
    </div>}
    {children}
    {status === 'error' && onRetry && <Button variant="tinted" size="sm" className="mt-4" onClick={onRetry}>{t('Try again')}</Button>}
  </div>
}

// One section of a redesigned tab root: the root's sections sit --gap-tab-section apart, which is
// the kit's rhythm and not the page's to choose.
export function TabSection({ children }) {
  return <section className="tab-sec">{children}</section>
}

// A row of two to four actions, equal widths. Per Owner decision 7 none of them is filled: the
// centre + is the app's one accent disc.
export function ActionRow({ children }) {
  const n = Children.toArray(children).length
  if (import.meta.env.DEV && (n < 2 || n > 4)) throw new Error(`ActionRow: 2 to 4 actions, not ${n}`)
  return <div className="act-row" style={{ '--n': n }}>{children}</div>
}

// One action: a 56px disc with its icon, the label under it. `busy` swaps the icon for a spinner;
// `badge` (words, e.g. "1 pending") adds a dot and says it to a screen reader. `ariaLabel`: the
// name where the label alone does not say what it does ("+250 ml").
export function ActionButton({ icon, label, ariaLabel, onClick, disabled = false, busy = false, badge }) {
  const name = ariaLabel || label
  return (
    <button type="button" className="act-b" onClick={onClick} disabled={disabled} aria-busy={busy || undefined}
      aria-label={badge ? name + ', ' + badge : ariaLabel}>
      <span className="act-d">
        {busy ? <Loader size="icon" /> : <Icon name={icon} />}
        {badge && <span className="act-badge" aria-hidden="true" />}
      </span>
      <span className="act-l">{label}</span>
    </button>
  )
}

// A macro's 270° gauge, open at the bottom, in the macro's own colour (never the accent). The
// start cap is always drawn, so the colour key reads at 0 g too. Over target: the arc is full and
// the caption says by how much, in orange ink.
const MACROS = { protein: () => t('Protein'), carbs: () => t('Carbs'), fat: () => t('Fat') }
// r 42 about (50, 50), from 135° (bottom left) clockwise to 45° (bottom right)
const ARC = 'M20.3 79.7A42 42 0 1 1 79.7 79.7'
export function MacroGauge({ macro, value, target, unit = 'g', label }) {
  oneOf('MacroGauge', 'macro', macro, Object.keys(MACROS))
  const name = label || MACROS[macro]()
  const v = Math.max(0, value || 0)
  const pct = target > 0 ? Math.min(1, v / target) : 0
  const over = target > 0 && v > target ? v - target : 0
  const amount = fmtNum(v) + ' ' + unit
  // A meter's value never exceeds its max; with no target the amount is the whole scale.
  const max = target > 0 ? target : Math.max(v, 1)
  const valueText = target > 0
    ? amount + ' ' + t('of {0}', fmtNum(target) + ' ' + unit) + (over > 0 ? ', ' + t('over by {0}', fmtNum(over) + ' ' + unit) : '')
    : amount
  return (
    <div className={cx('mg', 'mg-' + macro)} role="meter" aria-label={name} aria-valuenow={Math.min(v, max)} aria-valuemin={0}
      aria-valuemax={max} aria-valuetext={valueText}>
      <span className="mg-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <path className="mg-track" d={ARC} pathLength="100" />
          <path className="mg-arc" d={ARC} pathLength="100" style={{ '--mg': pct }} />
          <circle className="mg-cap" cx="20.3" cy="79.7" r="4" />
        </svg>
        <span className="mg-v"><span className="mg-num">{fmtNum(v)}</span><span className="mg-u">{unit}</span></span>
      </span>
      <span className="mg-l">{name}</span>
      {target > 0 && <span className={cx('mg-of', over > 0 && 'ink-orange')}>
        {over > 0 ? '+' + fmtNum(over) + ' ' + unit : t('of {0}', fmtNum(target) + ' ' + unit)}
      </span>}
    </div>
  )
}

// Protein, carbs and fat side by side.
export function MacroGauges({ children }) {
  return <div className="mg-row">{children}</div>
}

// A section's heading on a tab root (--fs-title2; SectionTitle stays the small grey one). `link`
// with `onLink`: a text button at its end ("See all"). `onOpen`: the whole heading is one button
// with a chevron.
export function SectionHeader({ title, link, onLink, onOpen }) {
  if (onOpen) {
    return <h2 className="sec-h"><button type="button" className="sec-h-b" onClick={onOpen}><span>{title}</span><Icon name="chevronRight" /></button></h2>
  }
  return <div className="sec-h">
    <h2 className="sec-h-t">{title}</h2>
    {link && <button type="button" className="sec-h-l" onClick={onLink}>{link}</button>}
  </div>
}

// A card on the Progress root that opens its page: the title with a chevron is the one button;
// under it an optional art lead and one or two values (`values`: [{ value, unit, label, tone }],
// tone an .ink-* colour for the number) split by a hairline, then a footer (a sparkline, a pill).
// status: loading, empty (a dash, `note`, and `action` { label, icon, onClick } as the one pill
// that fills it), error (`note` and a retry). No icon tile: the title names the section.
const VALUE_TONES = ['danger', 'warn', 'orange', 'acc', 'ok']
export function StatSection({ title, onOpen, art, values = [], footer, status = 'ready', note, action, onRetry }) {
  oneOf('StatSection', 'status', status, STATUSES)
  if (import.meta.env.DEV && values.length > 2) throw new Error('StatSection: one or two values')
  for (const v of values) oneOf('StatSection', 'tone', v.tone, VALUE_TONES)
  return <section className="card stat-sec" aria-busy={status === 'loading' || undefined}>
    <h2 className="stat-sec-h"><button type="button" onClick={onOpen}><span>{title}</span><Icon name="chevronRight" /></button></h2>
    {status === 'loading'
      ? <div className="stat-sec-b"><Skeleton w="60%" h={30} r={6} /></div>
      : <div className="stat-sec-b">
        {art && <span className="stat-sec-art">{art}</span>}
        {status !== 'error' && values.map(v => <div key={v.label} className="stat-sec-v">
          <p className={cx('stat-sec-num', status !== 'empty' && v.tone && 'ink-' + v.tone)}>{status === 'empty' ? EMPTY : v.value}{v.unit && status !== 'empty' && <span className="stat-sec-u">{v.unit}</span>}</p>
          <div className="stat-sec-l">{v.label}</div>
        </div>)}
      </div>}
    {note != null && status !== 'loading' && <p className="stat-sec-n">{note}</p>}
    {status === 'empty' && action && <Button shape="pill" icon={action.icon} onClick={action.onClick}>{action.label}</Button>}
    {status === 'error' && onRetry && <Button variant="tinted" size="sm" onClick={onRetry}>{t('Try again')}</Button>}
    {footer && status === 'ready' && <div className="stat-sec-f">{footer}</div>}
  </section>
}

// A period to step through: chevrons either side of a centred title and its sub ("Week of 12
// Oct", "This week"). The next step is off at the present (`nextDisabled`).
export function PeriodNav({ title, sub, onPrev, onNext, prevLabel, nextLabel, prevDisabled = false, nextDisabled = false }) {
  return <div className="pnav">
    <button type="button" className="iconbtn pnav-b" aria-label={prevLabel} disabled={prevDisabled} onClick={onPrev}><Icon name="chevronLeft" /></button>
    <div className="pnav-t">
      <span className="pnav-h">{title}</span>
      {sub != null && <span className="pnav-s">{sub}</span>}
    </div>
    <button type="button" className="iconbtn pnav-b" aria-label={nextLabel} disabled={nextDisabled} onClick={onNext}><Icon name="chevronRight" /></button>
  </div>
}

// One reading picked out of a map or a list: its label with a meta line at the end, the value
// at display size with its unit ("/ 12.4 sets"), and a caption.
export function StatCard({ label, meta, value, unit, caption, children }) {
  return <div className="card stat-card">
    <div className="stat-card-h">
      <span className="stat-card-l">{label}</span>
      {meta != null && <span className="stat-card-m">{meta}</span>}
    </div>
    <p className="stat-card-v"><span className="stat-card-num">{value}</span>{unit != null && <span className="stat-card-u">{unit}</span>}</p>
    {caption != null && <p className="stat-card-c">{caption}</p>}
    {children}
  </div>
}

// A muscle in an inset list, keyed to the map above it: a dot in the muscle's level shade (the
// map's own .lN ramp, so a fatigue or strength map's container recolours both), its name and
// sub, the value, and a chevron when the row picks the muscle. `pressed` says which one is
// picked. Rows sit in a Section.
export function MuscleRow({ level = 0, title, subtitle, value, valueLabel, onClick, pressed, ...rest }) {
  const Tag = onClick ? 'button' : 'div'
  return <Tag type={onClick ? 'button' : undefined} className={cx('lrow', 'mus-row', onClick && 'tap')} onClick={onClick}
    aria-pressed={onClick ? !!pressed : undefined} {...rest}>
    <span className={'mus-dot l' + level} aria-hidden="true" />
    <span className="lrow-m">
      <span className="lrow-t">{title}</span>
      {subtitle != null && <span className="lrow-s">{subtitle}</span>}
    </span>
    {value != null && <span className="lrow-v mus-v" aria-label={valueLabel}>{value}</span>}
    {onClick && <Icon name="chevronRight" className="lrow-c" />}
  </Tag>
}

// A list row led by art at 96×72 (a LineArt scene or a licensed picture), or a 56px thumb in the
// exercise variant. With no control of its own `onOpen` makes the whole row the button; with a
// `link` line ({ icon, label, onClick }) or a play disc (`onPlay`, `playLabel`) the title block
// opens it instead, so each control stays reachable.
export function MediaRow({ art, title, subtitle, link, onOpen, onPlay, playLabel, chevron = false, variant }) {
  oneOf('MediaRow', 'variant', variant, ['exercise'])
  const controls = !!(link || onPlay)
  const text = Tag => <>
    <Tag className="tt">{title}</Tag>
    {subtitle != null && <Tag className="ss">{subtitle}</Tag>}
  </>
  return <div className={cx('item item-lg', variant && 'item-' + variant)} {...(controls ? {} : tappable(onOpen))}>
    <span className="media-lead">{art}</span>
    <div className="grow">
      {controls && onOpen ? <button type="button" className="item-open" onClick={onOpen}>{text('span')}</button> : text('div')}
      {link && <button type="button" className="media-link" onClick={link.onClick}>{link.icon && <Icon name={link.icon} />}<span>{link.label}</span></button>}
    </div>
    {onPlay && <button type="button" className="media-play" onClick={onPlay} aria-label={playLabel}><Icon name="play" /></button>}
    {chevron && <Icon name="chevronRight" className="chev" />}
  </div>
}

// A page's one main action, pinned above the tab bar while the page scrolls under it and resting
// at the end of the page when it is reached, so it never covers the last row.
export function StickyActionBar({ children }) {
  return <div className="sticky-act">{children}</div>
}
