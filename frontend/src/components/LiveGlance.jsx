import Icon from './Icon.jsx'
import { BrandMark } from './BrandLogo.jsx'
import { t } from '../lib/i18n.js'
import { islandChips } from '../lib/live-glance.js'
import { useState } from 'react'

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
  wDown: { icon: 'minus', sub: 'scale' }, wUp: { icon: 'plus', sub: 'scale' }, rDown: { icon: 'minus', sub: 'repeat' }, rUp: { icon: 'plus', sub: 'repeat' },
  effort: { icon: 'gauge' }, pause: { icon: 'pause' }, warm: { icon: 'sunrise' }, addSet: { icon: 'plusCircle' }, stopAuto: { icon: 'stop' }, finish: { icon: 'flag' },
}
const btnLabel = (k, tl, labels) => (k === 'log' ? labels?.done || t('Log set') : k === 'stopAuto' ? labels?.stopAuto || t('Stop auto') : tl?.['a.' + k] || '')

function Buttons ({ list, tl, labels, paused, effort = '', logWords = true, primaryLast = true, className = 'gl-btns' }) {
  if (!list.length) return null
  const order = primaryLast ? [...list.filter(k => k !== 'log' && k !== 'finish'), ...list.filter(k => k === 'log' || k === 'finish')] : list
  return <div className={className}>
    {order.map(k => {
      const d = BTN[k] || {}
      const primary = k === 'log' || k === 'finish'
      const label = k === 'pause' && paused ? tl?.['a.resume'] || t('Resume') : btnLabel(k, tl, labels)
      // Log set says its words only when it is the only button (glanceView logWords); the effort
      // button says where the set stands ("RIR 2"), as on the phone.
      const words = primary && (k !== 'log' || logWords)
      return <span key={k} className={'gl-btn' + (primary ? ' gl-primary' : '') + (primary && !words ? ' gl-icon-only' : '')} role="img" aria-label={label}>
        {k === 'effort' && effort ? <span>{effort}</span> : d.icon && <Icon name={k === 'pause' && paused ? 'play' : d.icon} />}
        {d.sub && <Icon name={d.sub} className="gl-btn-sub" />}
        {d.text && <span>{d.text}</span>}
        {words && <span>{label}</span>}
      </span>
    })}
  </div>
}

/** iOS's − and + beside the numbers they change: "− 80 kg + × − 8 +". */
function Steps ({ steps, tl, sub }) {
  if (!steps?.length) return null
  return <div className="gl-steps">
    {steps.map((x, i) => <span key={x.f} className="gl-step">
      {i > 0 && <span className="gl-step-x">×</span>}
      <span className="gl-btn gl-step-btn" role="img" aria-label={tl?.['a.' + x.f + 'Down'] || ''}><Icon name="minus" /></span>
      <span className="gl-step-v">{x.t}</span>
      <span className="gl-btn gl-step-btn" role="img" aria-label={tl?.['a.' + x.f + 'Up'] || ''}><Icon name="plus" /></span>
    </span>)}
    {sub && <span className="gl-sub gl-step-sub">{sub}</span>}
  </div>
}

/** The time since the start, small, under a rest's or a hold's clock. */
const Since = ({ start, now }) => (start ? <span className="gl-since"><Icon name="stopwatch" />{clockValue({ kind: 'elapsed', start }, now)}</span> : null)

function Chips ({ chips, hs }) {
  if (!chips.length) return null
  return <div className="gl-chips">
    {chips.map(c => <span key={c.k} className="gl-chip">
      {c.k === 'hr' && <Icon name={hs === 'watch' ? 'watch' : 'heart'} className="gl-heart" />}{c.t}
    </span>)}
  </div>
}

// A still that did not load (a web build without the media, a pack not downloaded yet) leaves a
// quiet grey tile with the picture glyph, not a white square: the place is still spoken for.
function Still ({ src, size = 44, className = 'gl-still' }) {
  const [bad, setBad] = useState(null)
  if (!src) return null
  const missing = bad === src
  return <span className={className + (missing ? ' gl-still-none' : '')} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>
    {missing ? <Icon name="image" /> : <img src={src} alt="" width="180" height="180" loading="lazy" decoding="async" onError={() => setBad(src)} />}
  </span>
}

/** The iPhone's Lock Screen (and the Smart Stack of a paired Apple Watch). */
export function GlanceLock ({ view, live, now = Date.now(), stillSrc }) {
  const st = live.state
  const timed = view.clock && view.clock.kind !== 'elapsed'
  const effort = live.state.cur?.tv?.effort || ''
  const stepped = view.steps?.length > 0
  return <div className={'gl-lock gl-' + view.phase} aria-hidden="true">
    {timed
      ? <div className="gl-top gl-split">
        <div className="gl-timer">
          <span className="gl-kicker">{view.heading}</span>
          <span className="gl-countdown">{clockValue(view.clock, now)}</span>
          <Since start={view.since} now={now} />
        </div>
        <div className="gl-head">
          {view.next && <span className="gl-kicker">{view.next}</span>}
          <span className="gl-title">{view.title}</span>
          {view.big && <span className="gl-sub gl-strong">{view.big}</span>}
          {view.sub && <span className="gl-sub">{view.sub}</span>}
        </div>
      </div>
      : stepped
        // − + beside the numbers: the title on one line (a small still before it), the steppers
        // in place of the big line, the set's line after them while it fits.
        ? <div className="gl-top gl-top-line">
          <Still src={stillSrc} size={28} />
          <span className="gl-title">{view.title}</span>
          {view.clock && <div className="gl-elapsed"><Icon name="stopwatch" />{clockValue(view.clock, now)}</div>}
        </div>
        : <div className="gl-top">
          <Still src={stillSrc} />
          <div className="gl-head">
            <span className="gl-title">{view.title}</span>
            {/* With the still, the numbers sit beside it under the title, so nothing is squeezed. */}
            {stillSrc && view.big
              ? <span className="gl-bigline"><span className={'gl-big' + (view.big.length > 14 ? ' gl-big-long' : '')}>{view.big}</span>{view.sub && <span className="gl-sub">{view.sub}</span>}</span>
              : !view.big && view.sub && <span className="gl-sub">{view.sub}</span>}
          </div>
          {view.clock && <div className="gl-elapsed"><Icon name="stopwatch" />{clockValue(view.clock, now)}</div>}
        </div>}
    {stepped && <Steps steps={view.steps} tl={st.tl} sub={view.sub} />}
    {!timed && !stepped && !stillSrc && view.big && <div className="gl-bigrow"><span className={'gl-big' + (view.big.length > 14 ? ' gl-big-long' : '')}>{view.big}</span>{view.sub && <span className="gl-sub">{view.sub}</span>}</div>}
    <Chips chips={view.chips} hs={st.hs} />
    {view.note && <div className="gl-note"><Icon name="trophy" />{view.note}</div>}
    <div className="gl-foot">
      {view.progress != null ? <span className="gl-bar"><i style={{ width: Math.round(view.progress * 100) + '%' }} /></span> : <span className="gl-fill" />}
      <Buttons list={view.buttons} tl={st.tl} labels={live.attributes.labels} paused={view.paused} effort={effort} logWords={view.logWords} />
    </div>
  </div>
}

/** The Dynamic Island: the pill beside the camera, then the view a long press opens. */
export function GlanceIsland ({ view, pill, live, now = Date.now(), stillSrc }) {
  const st = live.state
  const timed = view.clock && view.clock.kind !== 'elapsed'
  const elapsed = view.clock && view.clock.kind === 'elapsed'
  const stepped = view.steps?.length > 0
  const effort = live.state.cur?.tv?.effort || ''
  // As WidgetViews.swift GlanceIslandTrailing/Bottom: the clock on the right (the rest's, else the
  // time since the start when it is on, else the set's numbers), the numbers under it otherwise.
  return <div className="gl-island-wrap" aria-hidden="true">
    <span className="gl-cap">{t('While you use other apps')}</span>
    <div className="gl-pill">
      <span className="gl-pill-side">{stillSrc ? <Still src={stillSrc} size={24} /> : <BrandMark height={11} />}</span>
      <span className="gl-cam" />
      <span className="gl-pill-side end">{timed ? clockValue(view.clock, now) : pill}</span>
    </div>
    <span className="gl-cap">{t('When you touch and hold it')}</span>
    <div className="gl-island">
      <div className="gl-isl-row">
        <div className="gl-head">
          {view.next && <span className="gl-kicker">{view.next}</span>}
          <span className="gl-title">{view.title}</span>
          {view.sub && <span className="gl-sub">{view.sub}</span>}
        </div>
        {timed
          ? <div className="gl-timer end"><span className="gl-kicker">{view.heading}</span><span className="gl-countdown sm">{clockValue(view.clock, now)}</span></div>
          : elapsed ? <div className="gl-elapsed"><Icon name="stopwatch" />{clockValue(view.clock, now)}</div>
            : !stepped && view.big && <div className="gl-isl-big">{view.big}</div>}
      </div>
      {stepped ? <Steps steps={view.steps} tl={st.tl} /> : (timed || elapsed) && view.big && <div className="gl-sub gl-strong">{view.big}</div>}
      <div className="gl-foot">
        <Chips chips={islandChips(view)} hs={st.hs} />
        <Buttons list={view.buttons} tl={st.tl} labels={live.attributes.labels} paused={view.paused} effort={effort} logWords={view.logWords} />
      </div>
    </div>
  </div>
}

/** Android's notification, as a Live Update: text, one clock, a bar, up to three actions. */
export function GlanceNotification ({ view, live, now = Date.now(), stillSrc }) {
  const st = live.state
  const timed = view.clock && view.clock.kind !== 'elapsed'
  const title = view.phase === 'rest' || view.phase === 'switch' ? view.heading : timed ? `${view.heading} · ${view.title}` : view.title
  const resting = view.phase === 'rest' || view.phase === 'switch'
  // As WorkoutNotification: a rest is the rest service's card (what's next under the clock, its own
  // Pause, + 15s and Skip); the set card joins the set's line, its big line and the details.
  const text = resting
    ? (view.next ? `${view.next}: ${view.title}${view.sub ? ', ' + view.sub : ''}${view.big ? ' · ' + view.big : ''}` : view.title)
    : [view.sub, view.big, ...view.chips.map(c => c.t)].filter(Boolean).join(' · ')
  // Android's actions are words, every one of them (no icons in a notification's action row), so
  // Log set keeps its words there; the effort action says where the set stands, as on the phone.
  const acts = resting ? [t('Pause'), '+ 15s', t('Skip')] : view.buttons.map(k => (k === 'restAdd' ? '+15 s' : k === 'pause' && view.paused ? st.tl?.['a.resume'] : k === 'effort' && st.cur?.tv?.effort ? st.cur.tv.effort : btnLabel(k, st.tl, live.attributes.labels)))
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
      <Still src={stillSrc} className="gl-and-img" />
    </div>
    {view.progress != null && <span className="gl-bar"><i style={{ width: Math.round(view.progress * 100) + '%' }} /></span>}
    {acts.length > 0 && <div className="gl-and-acts">{acts.map(a => <span key={a}>{a}</span>)}</div>}
  </div>
}

/** The buttons of a surface as words, in the order it draws them (the preview's spoken label). */
export function buttonWords (view, live, surface) {
  const st = live.state
  if (surface === 'android' && (view.phase === 'rest' || view.phase === 'switch')) return [t('Pause'), '+ 15s', t('Skip')]
  const steps = (view.steps || []).flatMap(x => [st.tl?.['a.' + x.f + 'Down'], st.tl?.['a.' + x.f + 'Up']])
  const list = view.buttons.filter(k => k !== 'log' && k !== 'finish').concat(view.buttons.filter(k => k === 'log' || k === 'finish'))
  return [...steps, ...list.map(k => (k === 'restAdd' ? '+15 s' : k === 'pause' && view.paused ? st.tl?.['a.resume'] || t('Resume') : btnLabel(k, st.tl, live.attributes.labels)))].filter(Boolean)
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
