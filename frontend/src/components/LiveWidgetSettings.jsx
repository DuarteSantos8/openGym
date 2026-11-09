import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Section, Row, Switch, Segmented, Check } from './ui.jsx'
import { GlanceLock, GlanceIsland, GlanceNotification, GlanceStrip } from './LiveGlance.jsx'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MOBILE } from '../lib/mobile.js'
import { platformNow } from '../lib/platform-now.js'
import { ACTIONS } from '../lib/live-layout.js'
import { glanceOf, glanceView, shortOf, isDefaultGlance, normalizeGlance, KINDS, KIND_DETAILS, KIND_BUTTONS, detailsFor, workButtons } from '../lib/live-glance.js'
import { sampleLive, sampleIds, sampleLabel } from '../lib/live-samples.js'
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
  // The samples keep their own clocks: fixed when the preview opens, so they count down from there.
  const [base] = useState(() => Date.now())
  const now = useNow(true)
  const live = useMemo(() => {
    try { return sampleLive(S, sample, { glance: G, timer, now: base }) } catch { return null }
  }, [S, sample, G, timer, base])
  if (!live) return null
  const view = glanceView(live.attributes, live.state, surface === 'app' ? 'lock' : surface, now)
  const still = view.still || null
  return <div className={'gl-stage gl-stage-' + surface}>
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

function useSurfaces (G) {
  const os = MOBILE ? platformNow() : null
  return useMemo(() => SURFACES.filter(x => !os || !x.os || x.os === os).filter(x => x.id !== 'app' || G.card), [os, G.card])
}

const NOTE = {
  ios: () => t('Needs iOS 17 or later. The buttons work without unlocking, Finish opens the app.'),
  android: () => t('A Live Update by the clock on Android 16, a regular notification before that. While a rest runs, it shows the rest’s own buttons.'),
  web: () => t('The Lock Screen and the notification come with the phone apps. This is how they look there.'),
}

export default function LiveWidgetSettings () {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const G = useMemo(() => glanceOf(S), [S.liveWidget, S.liveLayout])
  const surfaces = useSurfaces(G)
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
  return <div className="gl-settings">
    <div className="gl-preview-head">
      {surfaces.length > 1 && <Segmented className="gl-surface" value={shown} onChange={setSurface}
        options={surfaces.map(x => ({ value: x.id, label: x.label() }))} />}
      <GlancePreview S={S} surface={shown} sample={sample} G={G} />
      <SampleChips ids={ids} value={sample} onChange={setSample} />
      <p className="gl-lede">{t('It follows the exercise and the moment by itself: weight and reps for a lift, the clock for a hold or a rest, what’s next between exercises.')}</p>
    </div>

    <Section title={t('Show')}>
      <Row icon="heart" iconTint="var(--red)" title={t('Heart rate')} subtitle={t('From your watch or headphones. Stays out of the way without one.')}>
        <Switch aria-label={t('Heart rate')} checked={G.show.heart} onChange={sw('show', 'heart')} />
      </Row>
      <Row icon="chevronRight" iconTint="var(--blue)" title={t('What’s next')} subtitle={t('During a rest, the set coming up or the next exercise.')}>
        <Switch aria-label={t('What’s next')} checked={G.show.next} onChange={sw('show', 'next')} />
      </Row>
      <Row icon="stopwatch" iconTint="var(--orange)" title={t('Time since start')} subtitle={t('A running clock beside the set.')}>
        <Switch aria-label={t('Time since start')} checked={G.show.elapsed} onChange={sw('show', 'elapsed')} />
      </Row>
      <Row icon="gauge" iconTint="var(--purple)" title={effortWord ? t('Effort ({0})', effortWord) : t('Effort')} subtitle={t('Once you’ve rated the set, or when the effort button is there.')}>
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

    <Section title={t('Buttons')} footer={t('Log set is always there. These join it when they make sense, as many as the screen has room for.')}>
      <Row icon="slider" iconTint="var(--blue)" title={t('Weight and reps')} subtitle={t('− and + on the set, so you can fix it without unlocking.')}>
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
  const own = !!G.kinds[kind]
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
      <GlancePreview S={S} surface={surface} sample={KIND_SAMPLE[kind]} G={G} />
    </div>
    <Section title={t('Details')} footer={t('Short words beside the set. Heart rate and calories come from the main page.')}>
      {KIND_DETAILS[kind].map(k => <Row key={k} title={detailName(k)} onClick={() => set(x => ({ ...x, d: toggle(x.d, k) }))}>
        <Check checked={details.includes(k)} onChange={() => set(x => ({ ...x, d: toggle(x.d, k) }))} label={detailName(k)} />
      </Row>)}
    </Section>
    <Section title={t('Buttons')} footer={t('Log set is always there. The Lock Screen has room for three more, the Dynamic Island and Android for two.')}>
      {KIND_BUTTONS[kind].map(k => <Row key={k} title={t(ACTIONS[k].label)} onClick={() => set(x => ({ ...x, b: toggle(x.b, k) }))}>
        <Check checked={buttons.includes(k)} onChange={() => set(x => ({ ...x, b: toggle(x.b, k) }))} label={t(ACTIONS[k].label)} />
      </Row>)}
    </Section>
    {own && <Section>
      <Row icon="reset" iconTint="var(--grey)" title={t('Use the defaults for {0}', kindName(kind))} onClick={() => update(s => { const next = normalizeGlance(glanceOf(s)); delete next.kinds[kind]; s.liveWidget = next })} />
    </Section>}
  </div>
}

