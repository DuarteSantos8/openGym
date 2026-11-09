import Icon from './Icon.jsx'
import { BrandMark } from './BrandLogo.jsx'
import { t } from '../lib/i18n.js'

// The glance as each surface draws it (lib/live-glance.js glanceView), for the preview in Settings
// and the strip on the workout screen. The Swift views (ios/App/App/WidgetViews.swift, the
// "glance" part) and Android's notification (WorkoutNotification.glanceCard) follow the same
// rules from the same payload, so what you see here is what the phone shows.

// A still that is not there (a web build without the media) leaves no broken-picture icon behind.
export const hideBroken = e => { e.currentTarget.style.visibility = 'hidden' }

const clockText = s => {
  const n = Math.max(0, Math.round(s))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}
/** A clock of the view as it reads at `now`: "1:15" for a countdown, "26:04" since the start. */
export function clockValue (clock, now = Date.now()) {
  if (!clock) return ''
  if (clock.kind === 'elapsed') return clockText((now - clock.start) / 1000)
  if (clock.left != null) return clockText(clock.left)
  return clockText(((clock.endsAt || now) - now) / 1000)
}

// The button's look on the platform: its icon and, for the primary, its word.
const BTN = {
  log: { icon: 'check' }, restSkip: { icon: 'skipForward' }, restAdd: { text: '+15' }, next: { icon: 'chevronRight' },
  wDown: { icon: 'minus', sub: 'barbell' }, wUp: { icon: 'plus', sub: 'barbell' }, rDown: { icon: 'minus', sub: 'repeat' }, rUp: { icon: 'plus', sub: 'repeat' },
  effort: { icon: 'gauge' }, pause: { icon: 'pause' }, warm: { icon: 'sunrise' }, addSet: { icon: 'plusCircle' }, stopAuto: { icon: 'stop' }, finish: { icon: 'flag' },
}
const btnLabel = (k, tl, labels) => (k === 'log' ? labels?.done || t('Log set') : k === 'stopAuto' ? labels?.stopAuto || t('Stop auto') : tl?.['a.' + k] || '')

function Buttons ({ list, tl, labels, paused, primaryLast = true, className = 'gl-btns' }) {
  if (!list.length) return null
  const order = primaryLast ? [...list.filter(k => k !== 'log' && k !== 'finish'), ...list.filter(k => k === 'log' || k === 'finish')] : list
  return <div className={className}>
    {order.map(k => {
      const d = BTN[k] || {}
      const primary = k === 'log' || k === 'finish'
      const label = k === 'pause' && paused ? tl?.['a.resume'] || t('Resume') : btnLabel(k, tl, labels)
      return <span key={k} className={'gl-btn' + (primary ? ' gl-primary' : '')} role="img" aria-label={label}>
        {d.icon && <Icon name={k === 'pause' && paused ? 'play' : d.icon} />}
        {d.sub && <Icon name={d.sub} className="gl-btn-sub" />}
        {d.text && <span>{d.text}</span>}
        {primary && <span>{label}</span>}
      </span>
    })}
  </div>
}

function Chips ({ chips, hs }) {
  if (!chips.length) return null
  return <div className="gl-chips">
    {chips.map(c => <span key={c.k} className="gl-chip">
      {c.k === 'hr' && <Icon name={hs === 'watch' ? 'watch' : 'heart'} className="gl-heart" />}{c.t}
    </span>)}
  </div>
}

function Still ({ src, size = 44 }) {
  if (!src) return null
  return <span className="gl-still" style={{ width: size, height: size }}>
    <img src={src} alt="" width="180" height="180" loading="lazy" decoding="async" onError={hideBroken} />
  </span>
}

/** The iPhone's Lock Screen (and the Smart Stack of a paired Apple Watch). */
export function GlanceLock ({ view, live, now = Date.now(), stillSrc }) {
  const st = live.state
  const resting = view.phase === 'rest' || view.phase === 'switch'
  const timed = view.clock && view.clock.kind !== 'elapsed'
  return <div className={'gl-lock gl-' + view.phase} aria-hidden="true">
    {resting || timed
      ? <div className="gl-top gl-split">
        <div className="gl-timer">
          <span className="gl-kicker">{view.heading}</span>
          <span className="gl-countdown">{clockValue(view.clock, now)}</span>
        </div>
        <div className="gl-head">
          {view.next && <span className="gl-kicker">{view.next}</span>}
          <span className="gl-title">{view.title}</span>
          {view.big && <span className="gl-sub gl-strong">{view.big}</span>}
          {view.sub && <span className="gl-sub">{view.sub}</span>}
        </div>
      </div>
      : <div className="gl-top">
        <Still src={stillSrc} />
        <div className="gl-head">
          <span className="gl-title">{view.title}</span>
          {view.sub && <span className="gl-sub">{view.sub}</span>}
        </div>
        {view.clock && <div className="gl-elapsed"><Icon name="stopwatch" />{clockValue(view.clock, now)}</div>}
      </div>}
    {!resting && !timed && view.big && <div className="gl-big">{view.big}</div>}
    <Chips chips={view.chips} hs={st.hs} />
    {view.note && <div className="gl-note"><Icon name="trophy" />{view.note}</div>}
    <div className="gl-foot">
      {view.progress != null && <span className="gl-bar"><i style={{ width: Math.round(view.progress * 100) + '%' }} /></span>}
      <span className="gl-count">{view.count}</span>
      <Buttons list={view.buttons} tl={st.tl} labels={live.attributes.labels} paused={view.paused} />
    </div>
  </div>
}

/** The Dynamic Island: the pill beside the camera, then the view a long press opens. */
export function GlanceIsland ({ view, pill, live, now = Date.now(), stillSrc }) {
  const st = live.state
  const timed = view.clock && view.clock.kind !== 'elapsed'
  return <div className="gl-island-wrap" aria-hidden="true">
    <div className="gl-pill">
      <span className="gl-pill-side">{stillSrc ? <Still src={stillSrc} size={24} /> : <BrandMark height={11} />}</span>
      <span className="gl-cam" />
      <span className="gl-pill-side end">{timed ? clockValue(view.clock, now) : pill}</span>
    </div>
    <div className="gl-island">
      <div className="gl-isl-row">
        <div className="gl-head">
          {view.next && <span className="gl-kicker">{view.next}</span>}
          <span className="gl-title">{view.title}</span>
          {view.sub && <span className="gl-sub">{view.sub}</span>}
        </div>
        {timed
          ? <div className="gl-timer end"><span className="gl-kicker">{view.heading}</span><span className="gl-countdown sm">{clockValue(view.clock, now)}</span></div>
          : view.big && <div className="gl-isl-big">{view.big}</div>}
      </div>
      {timed && view.big && <div className="gl-sub gl-strong">{view.big}</div>}
      <div className="gl-foot">
        <Chips chips={view.chips.slice(0, 2)} hs={st.hs} />
        <Buttons list={view.buttons} tl={st.tl} labels={live.attributes.labels} paused={view.paused} />
      </div>
    </div>
  </div>
}

/** Android's notification, as a Live Update: text, one clock, a bar, up to three actions. */
export function GlanceNotification ({ view, live, now = Date.now(), stillSrc }) {
  const st = live.state
  const timed = view.clock && view.clock.kind !== 'elapsed'
  const title = timed ? `${view.heading} · ${view.title}` : view.title
  const text = [view.next && view.next + ':', view.sub, view.big, ...view.chips.map(c => c.t)].filter(Boolean).join(' · ').replace(': · ', ': ')
  return <div className="gl-android" aria-hidden="true">
    <div className="gl-and-head">
      <Icon name="dumbbell" /><span>openGym</span>
      {view.clock && <span className="gl-and-clock">{clockValue(view.clock, now)}</span>}
    </div>
    <div className="gl-and-body">
      <div className="gl-and-m">
        <div className="gl-and-title">{title}</div>
        {text && <div className="gl-and-text">{text}</div>}
      </div>
      {stillSrc && <img className="gl-and-img" src={stillSrc} alt="" width="180" height="180" loading="lazy" onError={hideBroken} />}
    </div>
    {view.progress != null && <span className="gl-bar"><i style={{ width: Math.round(view.progress * 100) + '%' }} /></span>}
    {view.buttons.length > 0 && <div className="gl-and-acts">
      {view.buttons.map(k => <span key={k}>{k === 'restAdd' ? '+15 s' : k === 'pause' && view.paused ? st.tl?.['a.resume'] : btnLabel(k, st.tl, live.attributes.labels)}</span>)}
    </div>}
  </div>
}

/**
 * The strip on the workout screen: only what the screen itself does not already say, so the
 * exercise and its sets stay where they are. What comes after this exercise, and the heart rate,
 * its zone and the calories when they are shown. Null when there is nothing to add.
 */
export function stripContent (live) {
  const st = live?.state
  const cur = st?.cur
  if (!cur) return null
  const after = (st.unitStarts || []).find(x => (x.unit ?? x.entryIdx) !== (cur.unit ?? cur.entryIdx)) || null
  const chips = (st.g?.sx || []).filter(k => st.tv?.[k]).map(k => ({ k, t: st.tv[k] }))
  return after || chips.length ? { after, chips } : null
}

export function GlanceStrip ({ live }) {
  const c = stripContent(live)
  if (!c) return <p className="gl-strip-empty">{t('Nothing to add right now. The strip shows up when there is.')}</p>
  return <div className="gl-strip">
    {c.after && <div className="gl-strip-next"><span className="gl-kicker">{t('After this')}</span><span className="gl-strip-name">{c.after.exName}</span></div>}
    <Chips chips={c.chips} hs={live.state.hs} />
  </div>
}
