import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Section, Row, Switch, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'
import { GlanceLock, GlanceIsland, GlanceNotification, GlanceStrip } from './LiveGlance.jsx'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MOBILE } from '../lib/mobile.js'
import { platformNow } from '../lib/platform-now.js'
import { ACTIONS } from '../lib/live-layout.js'
import { liveStatus, tryLive, endTryLive, TRY_SECONDS } from '../lib/live-activity.js'
import { recordHintsOn } from '../lib/set-records.js'
import { glanceOf, glanceView, shortOf, isDefaultGlance, normalizeGlance, KINDS, KIND_DETAILS, KIND_BUTTONS, BUTTON_ROOM, byPriority, detailsFor, workButtons } from '../lib/live-glance.js'
import { sampleLive, sampleIds, sampleLabel, sampleBase } from '../lib/live-samples.js'
import { EFFORT, effortOf } from '../lib/history.js'

// Settings > Workout > Live widget. The widget works out what to show from the set you are on
// (lib/live-glance.js), so this page is a preview first: the real Lock Screen, Dynamic Island,
// notification or workout strip for a moment you pick, then a few plain switches. Per exercise
// type control lives one level down (LiveWidgetCustomise), for the people who want it.

// Words as literal t() calls, so scripts/check-source-strings.mjs sees every one of them.
const SURFACES = [
  { id: 'lock', label: () => t('Lock Screen'), os: 'ios' },
  { id: 'island', label: () => t('Dynamic Island'), os: 'ios' },
  { id: 'android', label: () => t('Notification'), os: 'android' },
  { id: 'app', label: () => t('In the app') },
]
export const kindName = k => ({ lift: t('Strength'), band: t('Bands'), hold: t('Holds'), cardio: t('Cardio'), carry: t('Carries') })[k]
const KIND_SAMPLE = { lift: 'strength', band: 'band', hold: 'hold', cardio: 'cardio', carry: 'carry' }
const detailName = k => ({ effort: t('Effort'), record: t('Record hint'), partner: t('Superset partner'), equip: t('Equipment'), notes: t('Notes') })[k]

function useNow (on) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    const iv = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 1000)
    return () => clearInterval(iv)
  }, [on])
  return now
}

/** One surface's preview of `sample` with the setting `G` (the stored one, or Customise's). */
export function GlancePreview ({ S, surface, sample, G }) {
  const timer = useUI(s => s.timer)
  // The samples keep their own clocks, counting down from when the preview opened and starting
  // again just before 0: a rest that ran out drew the set it rests before (TestFlight 67).
  const [base] = useState(() => Date.now())
  const now = useNow(true)
  const at = sampleBase(sample, base, now)
  const live = useMemo(() => {
    try { return sampleLive(S, sample, { glance: G, timer, now: at }) } catch { return null }
  }, [S, sample, G, timer, at])
  if (!live) return null
  const view = glanceView(live.attributes, live.state, surface === 'app' ? 'lock' : surface, now)
  const still = view.still || null
  // What the preview shows, for a screen reader (the drawing itself is hidden from it). No clock: it ticks.
  const said = [view.heading, view.next, view.title, view.big, view.sub, ...view.chips.map(c => c.t)].filter(Boolean).join(', ')
  return <div className={'gl-stage gl-stage-' + surface}>
    <p className="vh">{said}</p>
    {surface === 'lock' && <><div className="gl-wall-time" aria-hidden="true">9:41</div><GlanceLock view={view} live={live} now={now} stillSrc={still} /></>}
    {surface === 'island' && <GlanceIsland view={view} live={live} now={now} stillSrc={still} pill={shortOf(live.state.cur) || view.count} />}
    {surface === 'android' && <GlanceNotification view={view} live={live} now={now} stillSrc={still} />}
    {surface === 'app' && <div className="card gl-card gl-card-preview"><GlanceStrip live={live} /></div>}
  </div>
}

function SampleChips ({ ids, value, onChange }) {
  return <div className="gl-samples" role="radiogroup" aria-label={t('Preview a moment')}>
    {ids.map(id => <button key={id} type="button" role="radio" aria-checked={value === id}
      className={'chip gl-sample' + (value === id ? ' on' : '')} onClick={() => onChange(id)}>{sampleLabel(id)}</button>)}
  </div>
}

/** What the phone says about itself (lib/live-activity.js liveStatus): null until it answered. */
export function useLiveStatus () {
  const [st, setSt] = useState(null)
  useEffect(() => {
    let on = true
    liveStatus().then(x => { if (on) setSt(x) }).catch(() => { if (on) setSt({ native: false, supported: false, island: false }) })
    return () => { on = false }
  }, [])
  return st
}

/**
 * The surfaces to preview: on a phone only its own, and the Dynamic Island only on an iPhone that
 * has one (the plugin says so; not known yet or not known at all: no island). On the web, all of
 * them, to show what the phone apps do.
 */
export function surfacesFor (os, status, card) {
  return SURFACES.filter(x => !os || !x.os || x.os === os)
    .filter(x => x.id !== 'island' || !os || status?.island === true)
    .filter(x => x.id !== 'app' || card)
}

function useSurfaces (G, status) {
  const os = MOBILE ? platformNow() : null
  return useMemo(() => surfacesFor(os, status, G.card), [os, status, G.card])
}

/**
 * The preview stays in view while the switches scroll under it (owner: flip a switch, watch the
 * widget change). Pinned under the status bar; once pinned it drops the wallpaper's clock and
 * tightens, so it does not eat a small phone's screen.
 */
function StickyPreview ({ children }) {
  const mark = useRef(null)
  const box = useRef(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = mark.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const top = parseFloat(getComputedStyle(box.current).top) || 0
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < top + 1), { rootMargin: `-${Math.ceil(top) + 1}px 0px 0px 0px`, threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <>
    <div ref={mark} className="gl-sticky-mark" aria-hidden="true" />
    <div ref={box} className={'gl-sticky' + (stuck ? ' stuck' : '')}>{children}</div>
  </>
}

/**
 * "Try it": the real Live Activity (iOS) or notification (Android) with the moment previewed and
 * the settings as they are, so the Dynamic Island shows right here and the Lock Screen when the
 * phone is locked. Marked a preview, so its buttons log nothing (WorkoutActivity.swift enqueue,
 * WorkoutCardReceiver). Never over a running workout. Ends after TRY_SECONDS, on Stop, or when
 * the page closes; follows the moment and the switches while it runs.
 */
function TryIt ({ S, G, sample, os, status }) {
  const timer = useUI(s => s.timer)
  const [on, setOn] = useState(false)
  const busy = !!S.active
  const supported = !!status?.supported
  const build = () => { try { return sampleLive(S, sample === 'live' ? 'strength' : sample, { glance: G, timer, now: Date.now() }) } catch { return null } }
  const start = () => tryLive(build(), S).then(ok => setOn(!!ok))
  const stop = () => { setOn(false); endTryLive() }
  // Follows the moment and the switches while it runs.
  useEffect(() => { if (on && !busy) tryLive(build(), S) }, [sample, G]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on) return undefined
    const tm = setTimeout(() => setOn(false), TRY_SECONDS * 1000)
    return () => clearTimeout(tm)
  }, [on])
  // A workout that starts takes the card over (its own update replaces the preview).
  useEffect(() => { if (busy && on) { setOn(false); endTryLive() } }, [busy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { endTryLive() }, [])
  if (!status?.native) return null
  const hint = busy ? t('Not while a workout is running. It shows your workout already.')
    : !supported ? t('Live Activities are off for openGym. Turn them on in the iPhone’s Settings.')
      : os === 'android' ? t('Pull down from the top to see it with your notifications.') : t('Lock your phone to see it on the Lock Screen.')
  return <div className="gl-try">
    <button type="button" className={'btn ' + (on ? 'tinted' : 'primary')} disabled={busy || !supported} aria-pressed={on} onClick={on ? stop : start}>
      <Icon name={on ? 'stop' : 'play'} /><span>{on ? t('Stop') : t('Try it on this phone')}</span>
    </button>
    <p className="gl-try-hint">{hint}{on && <> {t('Ends by itself after 2 minutes.')}</>}</p>
  </div>
}

/** The kinds whose picks come from Per exercise type, so the main page's switches leave them alone. */
const ownKinds = G => KINDS.filter(k => G.kinds[k])

const NOTE = {
  ios: () => t('Needs iOS 17 or later. The buttons work without unlocking, Finish opens the app.'),
  android: () => t('A Live Update by the clock on Android 16, a regular notification before that. While a rest runs, it shows the rest’s own buttons.'),
  web: () => t('The Lock Screen and the notification come with the phone apps. This is how they look there.'),
}

export default function LiveWidgetSettings () {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const G = useMemo(() => glanceOf(S), [S.liveWidget, S.liveLayout])
  const status = useLiveStatus()
  const surfaces = useSurfaces(G, status)
  const [surface, setSurface] = useState(surfaces[0].id)
  const shown = surfaces.some(x => x.id === surface) ? surface : surfaces[0].id
  const ids = sampleIds(S)
  const [sample, setSample] = useState(ids[0] === 'live' ? 'live' : 'strength')
  const os = MOBILE ? platformNow() : null
  const set = fn => update(s => { const next = normalizeGlance(glanceOf(s)); fn(next); s.liveWidget = next })
  const sw = (group, k) => v => set(g => { g[group][k] = v })
  const effortWord = EFFORT[effortOf(S)]?.hd
  const nav = useNavigate()
  const open = id => nav('/settings/' + id)
  const reset = () => {
    const before = S.liveWidget ?? null
    update(s => { s.liveWidget = normalizeGlance(null) })
    useUI.getState().toast(t('Back to the defaults.'), { action: t('Undo'), onAction: () => update(s => { if (before == null) delete s.liveWidget; else s.liveWidget = before }) })
  }
  const own = ownKinds(G)
  const ownNote = own.length ? t('{0} use their own picks from Per exercise type, so these switches leave them alone.', own.map(kindName).join(', ')) : null
  const effortOff = effortOf(S) === 'none'
  return <div className="gl-settings">
    {surfaces.length > 1 && <div className="gl-preview-head">
      <Segmented className="gl-surface" value={shown} onChange={setSurface}
        options={surfaces.map(x => ({ value: x.id, label: x.label() }))} />
    </div>}
    <StickyPreview>
      <GlancePreview S={S} surface={shown} sample={sample} G={G} />
      <SampleChips ids={ids} value={sample} onChange={setSample} />
    </StickyPreview>
    <p className="gl-lede">{t('It follows the exercise and the moment by itself: weight and reps for a lift, the clock for a hold or a rest, what’s next between exercises.')}</p>
    <TryIt S={S} G={G} sample={sample} os={os} status={status} />

    <Section title={t('Show')} footer={ownNote}>
      <Row icon="heart" iconTint="var(--red)" title={t('Heart rate')} subtitle={t('From your watch or headphones. Stays out of the way without one.')}>
        <Switch aria-label={t('Heart rate')} checked={G.show.heart} onChange={sw('show', 'heart')} />
      </Row>
      <Row icon="chevronRight" iconTint="var(--blue)" title={t('What’s next')} subtitle={t('During a rest, the set coming up or the next exercise.')}>
        <Switch aria-label={t('What’s next')} checked={G.show.next} onChange={sw('show', 'next')} />
      </Row>
      <Row icon="stopwatch" iconTint="var(--orange)" title={t('Time since start')} subtitle={t('A running clock beside the set and under the rest.')}>
        <Switch aria-label={t('Time since start')} checked={G.show.elapsed} onChange={sw('show', 'elapsed')} />
      </Row>
      <Row icon="gauge" iconTint="var(--purple)" title={effortWord ? t('Effort ({0})', effortWord) : t('Effort')} subtitle={effortOff ? t('Effort tracking is off.') : t('How hard the last set was, until you rate this one.')}>
        <Switch aria-label={t('Effort')} checked={G.show.effort} onChange={sw('show', 'effort')} />
      </Row>
      <Row icon="trophy" iconTint="var(--yellow)" title={t('Record hints')} subtitle={t('“2 more reps for a record”, in the detailed look.')}>
        <Switch aria-label={t('Record hints')} checked={G.show.record} onChange={sw('show', 'record')} />
      </Row>
      <Row icon="flame" iconTint="var(--orange)" title={t('Calories')} subtitle={t('A rough running total.')}>
        <Switch aria-label={t('Calories')} checked={G.show.calories} onChange={sw('show', 'calories')} />
      </Row>
      <Row icon="image" iconTint="var(--teal)" title={t('Exercise picture')} subtitle={t('A small still. Never an animation.')}>
        <Switch aria-label={t('Exercise picture')} checked={G.show.picture} onChange={sw('show', 'picture')} />
      </Row>
    </Section>

    <Section title={t('Buttons')} footer={<>{t('Log set is always there. These join it when they make sense, as many as the screen has room for.')}{ownNote && <> {ownNote}</>}</>}>
      <Row icon="slider" iconTint="var(--blue)" title={t('Weight and reps')} subtitle={t('− and + on the weight and the reps, and a tap to rate the effort, without unlocking.')}>
        <Switch aria-label={t('Weight and reps')} checked={G.buttons.adjust} onChange={sw('buttons', 'adjust')} />
      </Row>
      <Row icon="timer" iconTint="var(--green)" title={t('+15 s on rests')} subtitle={t('For when the rest needs a little more rest.')}>
        <Switch aria-label={t('+15 s on rests')} checked={G.buttons.addRest} onChange={sw('buttons', 'addRest')} />
      </Row>
      <Row icon="skipForward" iconTint="var(--indigo, var(--blue))" title={t('Next exercise')} subtitle={t('For when someone took your machine.')}>
        <Switch aria-label={t('Next exercise')} checked={G.buttons.nextEx} onChange={sw('buttons', 'nextEx')} />
      </Row>
      <Row icon="pause" iconTint="var(--grey)" title={t('Pause')} subtitle={t('Pauses the whole workout, clock and all.')}>
        <Switch aria-label={t('Pause')} checked={G.buttons.pause} onChange={sw('buttons', 'pause')} />
      </Row>
    </Section>

    <Section title={t('Look')} footer={G.look === 'clean' ? t('The set, the clock and the buttons, with up to two extras.') : t('Adds a progress bar, the record hint and up to four extras.')}>
      <div className="gl-look">
        <Segmented value={G.look} onChange={v => set(g => { g.look = v })}
          options={[{ value: 'clean', label: t('Clean') }, { value: 'detailed', label: t('Detailed') }]} />
      </div>
    </Section>

    <Section footer={t('What comes after this exercise, plus heart rate and calories when they’re on. The rest is on the screen already.')}>
      <Row icon="phoneScreen" iconTint="var(--green)" title={t('Show a strip in the workout')}>
        <Switch aria-label={t('Show a strip in the workout')} checked={G.card} onChange={v => { set(g => { g.card = v }); if (v) setSurface('app') }} />
      </Row>
    </Section>

    <Section footer={NOTE[os || 'web']()}>
      <Row icon="slider" iconTint="var(--grey)" title={t('Per exercise type')} subtitle={t('Pick details and buttons for strength, bands, holds, cardio and carries.')} accessory="chevron" onClick={() => open('live-custom')} />
      {!isDefaultGlance(G) && <Row icon="reset" iconTint="var(--grey)" title={t('Back to the defaults')} onClick={reset} />}
    </Section>
  </div>
}

// A row of a checklist: the check mark shows the state, and a screen reader hears it said.
const Picked = ({ name, on }) => <>{name}<span className="vh">, {on ? t('On') : t('Off')}</span></>

/**
 * Why a pick of Per exercise type shows nowhere right now, or null when it shows: a checkmark that
 * changes nothing on the phone is a dead switch, so the row says what it waits for instead.
 */
export function detailNote (S, G, kind, k) {
  if (k === 'effort' && effortOf(S) === 'none') return t('Effort tracking is off.')
  if (k === 'record' && G.look === 'clean') return t('Only in the detailed look.')
  if (k === 'record' && !recordHintsOn(S)) return t('Record hints are off.')
  if (k === 'partner') return t('Only in a superset.')
  if (k === 'notes') return t('When the exercise has a note.')
  return null
}

/**
 * Where each picked button fits: the Lock Screen has BUTTON_ROOM.lock places (Log set included),
 * the Dynamic Island and Android BUTTON_ROOM.island / .android, kept in priority order. On iPhone a
 * plain lift's − + pairs sit beside the numbers and take no place. `{ k: note|null }`.
 */
export function buttonNotes (G, kind, os) {
  const list = workButtons(G, kind)
  const steppers = kind === 'lift' && ['wDown', 'wUp', 'rDown', 'rUp'].every(k => list.includes(k)) && os !== 'android'
  const placed = byPriority(list.filter(k => !(steppers && ['wDown', 'wUp', 'rDown', 'rUp'].includes(k))))
  const out = {}
  for (const k of list) {
    if (k === 'log') continue
    if (steppers && ['wDown', 'wUp', 'rDown', 'rUp'].includes(k)) { out[k] = null; continue }
    const at = placed.indexOf(k)
    const lock = at < BUTTON_ROOM.lock, small = at < BUTTON_ROOM.island
    out[k] = os === 'android' ? (at < BUTTON_ROOM.android ? null : t('No room on the notification.'))
      : !lock ? t('No room on the Lock Screen.') : !small ? t('Lock Screen only.') : null
  }
  return out
}

/** Settings > Workout > Live widget > Per exercise type. */
export function LiveWidgetCustomise () {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const G = useMemo(() => glanceOf(S), [S.liveWidget, S.liveLayout])
  const [kind, setKind] = useState('lift')
  const os = MOBILE ? platformNow() : null
  const surface = os === 'android' ? 'android' : 'lock'
  const details = detailsFor(G, kind)
  const buttons = workButtons(G, kind).filter(k => k !== 'log')
  const notes = buttonNotes(G, kind, os)
  const own = !!G.kinds[kind]
  // A superset partner shows only in a superset: the strength preview turns into one when it is picked.
  const sample = kind === 'lift' && details.includes('partner') ? 'superset' : KIND_SAMPLE[kind]
  const set = fn => update(s => {
    const next = normalizeGlance(glanceOf(s))
    const cur = next.kinds[kind] || { d: detailsFor(next, kind), b: workButtons(next, kind).filter(k => k !== 'log') }
    next.kinds[kind] = fn({ d: [...(cur.d || detailsFor(next, kind))], b: [...(cur.b || workButtons(next, kind).filter(k => k !== 'log'))] })
    s.liveWidget = next
  })
  const toggle = (list, k) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  return <div className="gl-settings">
    <div className="gl-preview-head">
      <Segmented className="gl-kinds" value={kind} onChange={setKind} options={KINDS.map(k => ({ value: k, label: kindName(k) }))} />
    </div>
    <StickyPreview>
      <GlancePreview S={S} surface={surface} sample={sample} G={G} />
    </StickyPreview>
    {own && <p className="gl-lede">{t('These picks replace the main page’s switches for {0}.', kindName(kind))}</p>}
    <Section title={t('Details')} footer={t('Short words beside the set. Heart rate and calories come from the main page.')}>
      {KIND_DETAILS[kind].map(k => {
        const on = details.includes(k)
        return <Row key={k} title={<Picked name={detailName(k)} on={on} />} subtitle={on ? detailNote(S, G, kind, k) : null} accessory={on ? 'check' : 'none'}
          onClick={() => set(x => ({ ...x, d: toggle(x.d, k) }))} />
      })}
    </Section>
    <Section title={t('Buttons')} footer={t('Log set is always there. The Lock Screen has room for three more, the Dynamic Island and Android for two. On iPhone, − and + for weight and reps sit beside the numbers and take no room.')}>
      {KIND_BUTTONS[kind].map(k => {
        const on = buttons.includes(k)
        return <Row key={k} title={<Picked name={t(ACTIONS[k].label)} on={on} />} subtitle={on ? notes[k] || (k === 'effort' && effortOf(S) === 'none' ? t('Effort tracking is off.') : null) : null} accessory={on ? 'check' : 'none'}
          onClick={() => set(x => ({ ...x, b: toggle(x.b, k) }))} />
      })}
    </Section>
    {own && <Section>
      <Row icon="reset" iconTint="var(--grey)" title={t('Use the defaults for {0}', kindName(kind))} onClick={() => update(s => { const next = normalizeGlance(glanceOf(s)); delete next.kinds[kind]; s.liveWidget = next })} />
    </Section>}
  </div>
}
