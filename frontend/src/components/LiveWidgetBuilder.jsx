import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { BrandMark } from './BrandLogo.jsx'
import { Section } from './ui.jsx'
import { LiveTile, LiveActions, tileTexts, hideBroken } from './LiveCard.jsx'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { menuSheet } from '../sheets.jsx'
import { MOBILE } from '../lib/mobile.js'
import { platformNow } from '../lib/platform-now.js'
import { useListReorder } from '../lib/use-list-reorder.js'
import {
  TILES, ACTIONS, LIMITS, PRESET_IDS, layoutOf, presetLayout, presetMatches, fitSurface, lockRows,
  tileAllowed, actionAllowed, addTile, removeTile, resizeTile, moveTile, addAction, removeAction, moveAction, resetSurface,
} from '../lib/live-layout.js'

// Settings > Workout > Live widget: what the workout shows on each surface, tile by tile and
// button by button (lib/live-layout.js). One list per surface because each platform has its own
// room; the preview draws only what fits, and every item that does not fit says why, right there.

// Words as literal t() calls, so scripts/check-source-strings.mjs sees every one of them.
const SURFACE_TABS = [
  { id: 'app', label: () => t('In the app'), icon: 'phoneScreen' },
  { id: 'lock', label: () => t('Lock Screen'), icon: 'lock', os: 'ios' },
  { id: 'island', label: () => t('Dynamic Island'), icon: 'dot', os: 'ios' },
  { id: 'android', label: () => t('Android'), icon: 'bell', os: 'android' },
  { id: 'widget', label: () => t('Home Screen widget'), icon: 'grid' },
]
const presetName = id => ({ minimal: t('Minimal'), lifter: t('Lifter'), cardio: t('Cardio'), everything: t('Everything') })[id]
const sizeName = s => ({ s: t('Small'), m: t('Medium'), l: t('Large') })[s]

/** Why an item is left out on `surface`, in words. */
function whyText (surface, why) {
  if (why === 'height') return t('No room on the Lock Screen. Apple keeps Live Activities to about 160 points tall.')
  if (why === 'buttons') {
    if (surface === 'android') return t('Android allows three buttons on a notification. Three it is.')
    if (surface === 'island') return t('Three buttons fit in the Dynamic Island.')
    return t('Four buttons fit on the Lock Screen.')
  }
  if (surface === 'island') return t('The Dynamic Island holds four tiles. It is an island, not a continent.')
  if (surface === 'compact') return t('The pill has two spots, one each side of the camera.')
  if (surface === 'android') return t('Six tiles fit in a notification before it starts mumbling.')
  if (surface === 'widget') return t('The widget fits three lines under the set.')
  return ''
}

const tileName = k => (TILES[k].labelArgs ? t(TILES[k].label, 'x', 'y') : t(TILES[k].label))

// A sample workout for the preview when none is running: a real catalogue exercise, so names and
// numbers come out in the profile's language and units like the real thing.
function sampleState (S) {
  if (S.active && !S.active.editingWorkoutId) return S
  const now = Date.now()
  return {
    ...S,
    active: {
      id: 'preview', name: t('Workout'), start: now - 23 * 60e3, cur: 0,
      entries: [
        { id: '0025', target: { mode: 'reps', reps: 8, weight: 80 }, sets: [
          { w: 60, r: 8, done: true, phase: 'warmup', at: now - 9 * 60e3 },
          { w: 80, r: 8, done: true, rir: 2, at: now - 4 * 60e3, hr: { avg: 128, max: 141 } },
          { w: 80, r: 8 }, { w: 80, r: 8 }] },
        { id: '0043', target: { mode: 'reps', reps: 5, weight: 100 }, sets: [{ w: 100, r: 5 }, { w: 100, r: 5 }] },
      ],
    },
  }
}
const SAMPLE_REST = { endsAt: Date.now() + 75e3, left: 75, total: 90, kind: 'rest' }

/* ---------- the previews ---------- */

function AppPreview ({ PS, list }) {
  const text = tileTexts(PS, list.t)
  return <div className="card lw-card lw-preview-app" aria-hidden="true">
    {list.t.length > 0 && <div className="lw-grid">
      {list.t.map(x => <LiveTile key={x.k} k={x.k} s={x.s} text={text} A={PS.active} timer={SAMPLE_REST} now={Date.now()} />)}
    </div>}
    <LiveActions acts={list.a} S={PS} timer={SAMPLE_REST} preview />
    {!list.t.length && !list.a.length && <p className="lw-empty">{t('Nothing here yet, so the workout screen stays as it is. Add a tile or pick a preset.')}</p>}
  </div>
}

// A tile as the small native surfaces draw it: a label over a short value, or the thing itself.
function MiniTile ({ k, s, text, A }) {
  if (k === 'progress') return <div className="lwm-tile lwm-l lwm-bar"><i style={{ width: '45%' }} /></div>
  if (k === 'still') return text._still ? <div className="lwm-tile lwm-s lwm-still"><img src={text._still} alt="" width="180" height="180" loading="lazy" onError={hideBroken} /></div> : null
  let v = text[k]
  if (k === 'rest') v = '1:15'
  else if (k === 'elapsed') v = '23:04'
  else if (k === 'clock') v = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (!v) return null
  const own = k === 'ex' || k === 'setOf' || k === 'target'
  return <div className={'lwm-tile lwm-' + s + (own ? ' lwm-own' : '') + (k === 'ex' ? ' lwm-ex' : '') + (k === 'rest' ? ' lwm-acc' : '')}>
    {!own && <span className="lwm-label">{TILES[k].labelArgs ? '' : t(TILES[k].label)}</span>}
    <span className="lwm-value">{v}</span>
  </div>
}

function MiniButtons ({ acts }) {
  if (!acts.length) return null
  return <div className="lwm-acts">{acts.map(k => <span key={k} className={'lwm-btn' + (k === 'log' ? ' lwm-primary' : '')}>
    <Icon name={ACTIONS[k].icon} />{k === 'log' && <span>{t(ACTIONS[k].label)}</span>}
  </span>)}</div>
}

function LockPreview ({ PS, layout }) {
  const f = fitSurface('lock', layout)
  const tiles = f.tiles.filter(x => x.fit)
  const text = tileTexts(PS, tiles)
  return <div className="lwm-lock" aria-hidden="true">
    {lockRows(tiles).map((row, i) => <div key={i} className="lwm-row">{row.map(x => <MiniTile key={x.k} {...x} text={text} A={PS.active} />)}</div>)}
    <MiniButtons acts={f.actions.filter(x => x.fit).map(x => x.k)} />
  </div>
}

function IslandPreview ({ PS, layout }) {
  const f = fitSurface('island', layout)
  const c = fitSurface('compact', layout)
  const tiles = f.tiles.filter(x => x.fit)
  const pill = c.tiles.filter(x => x.fit)
  const text = tileTexts(PS, [...tiles, ...pill])
  return <div className="lwm-island-wrap" aria-hidden="true">
    <div className="lwm-pill">
      <span className="lwm-pill-side">{pill[0] && <MiniTile {...pill[0]} s="s" text={text} />}</span>
      <span className="lwm-cam" />
      <span className="lwm-pill-side end">{pill[1] && <MiniTile {...pill[1]} s="s" text={text} />}</span>
    </div>
    <div className="lwm-island">
      <div className="lwm-row">{tiles.slice(0, 2).map(x => <MiniTile key={x.k} {...x} s="m" text={text} />)}</div>
      {tiles.length > 2 && <div className="lwm-row">{tiles.slice(2).map(x => <MiniTile key={x.k} {...x} s="m" text={text} />)}</div>}
      <MiniButtons acts={f.actions.filter(x => x.fit).map(x => x.k)} />
    </div>
  </div>
}

function AndroidPreview ({ PS, layout }) {
  const f = fitSurface('android', layout)
  const tiles = f.tiles.filter(x => x.fit)
  const text = tileTexts(PS, tiles)
  const words = tiles.filter(x => !['still', 'progress', 'rest', 'elapsed', 'clock'].includes(x.k)).map(x => text[x.k]).filter(Boolean)
  const clock = tiles.some(x => x.k === 'rest') ? '1:15' : tiles.some(x => x.k === 'elapsed') ? '23:04' : null
  const still = tiles.some(x => x.k === 'still') && text._still
  return <div className="lwm-android" aria-hidden="true">
    <div className="lwm-and-head"><BrandMark className="icn" height={7} color="currentColor" /><span>openGym</span>{clock && <span className="lwm-and-clock">{clock}</span>}</div>
    <div className="lwm-and-body">
      <div className="grow">
        <div className="lwm-and-title">{words[0] || t('Workout')}</div>
        {words.length > 1 && <div className="lwm-and-text">{words.slice(1).join(' · ')}</div>}
      </div>
      {still && <img className="lwm-and-img" src={text._still} alt="" width="180" height="180" loading="lazy" onError={hideBroken} />}
    </div>
    {tiles.some(x => x.k === 'progress') && <div className="lwm-tile lwm-bar"><i style={{ width: '45%' }} /></div>}
    {f.actions.some(x => x.fit) && <div className="lwm-and-acts">{f.actions.filter(x => x.fit).map(x => <span key={x.k}>{t(ACTIONS[x.k].label)}</span>)}</div>}
  </div>
}

function WidgetPreview ({ PS, layout }) {
  const f = fitSurface('widget', layout)
  const tiles = f.tiles.filter(x => x.fit)
  const text = tileTexts(PS, [{ k: 'ex' }, { k: 'setOf' }, { k: 'weight' }, { k: 'reps' }, ...tiles])
  const info = tiles.map(x => (x.k === 'elapsed' ? '23:04' : x.k === 'rest' ? '1:15' : x.k === 'clock' ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : text[x.k])).filter(Boolean)
  return <div className="lwm-widget" aria-hidden="true">
    <div className="lwm-w-name">{text.ex}</div>
    <div className="lwm-w-line">{text.setOf}</div>
    {info.length > 0 && <div className="lwm-w-info">{info.join(' · ')}</div>}
    <div className="lwm-w-steps"><span>−</span><b>{text.weight}</b><span>+</span></div>
    <div className="lwm-w-steps"><span>−</span><b>{text.reps}</b><span>+</span></div>
    <div className="lwm-btn lwm-primary lwm-w-log"><Icon name="check" /><span>{t('Log set')}</span></div>
  </div>
}

/* ---------- the lists ---------- */

function ItemList ({ surface, items, kind, onMove, onRemove, onResize }) {
  const reorder = useListReorder(items.length, onMove)
  // The reason once, at the first item left out; the ones after it are dimmed and say it to a screen reader.
  const firstOut = items.findIndex(x => !x.fit)
  return <div className="list lw-list" ref={reorder.listRef}>
    {items.map((x, i) => {
      const d = kind === 'tile' ? TILES[x.k] : ACTIONS[x.k]
      const name = kind === 'tile' ? tileName(x.k) : t(d.label)
      return <div key={x.k} data-reorder-row className={'item lw-item' + (x.fit ? '' : ' lw-out')} style={reorder.rowStyle(i)}>
        <button type="button" className="plan-minus" aria-label={t('Remove {0}', name)} title={t('Remove')} onClick={() => onRemove(x.k)}><Icon name="minus" /></button>
        <span className="lrow-i"><Icon name={d.icon} /></span>
        <div className="grow lw-item-m">
          <div className="tt">{name}</div>
          {!x.fit && (i === firstOut
            ? <div className="ss lw-why"><Icon name="info" />{whyText(surface, x.why)}</div>
            : <span className="vh">{whyText(surface, x.why)}</span>)}
          {kind === 'tile' && surface !== 'compact' && d.sizes.length > 1 && <div className="lw-sizes" role="group" aria-label={t('Size of {0}', name)}>
            {['s', 'm', 'l'].filter(s => d.sizes.includes(s)).map(s => <button key={s} type="button" className={'lw-size' + (x.s === s ? ' on' : '')}
              aria-pressed={x.s === s} onClick={() => onResize(x.k, s)}>{sizeName(s)}</button>)}
          </div>}
        </div>
        <div className="re-rail lw-rail">
          <button type="button" className="iconbtn re-up" aria-label={t('Move up')} disabled={i === 0} onClick={() => onMove(i, i - 1)}><Icon name="chevronUp" /></button>
          <button type="button" className="iconbtn re-down" aria-label={t('Move down')} disabled={i === items.length - 1} onClick={() => onMove(i, i + 1)}><Icon name="chevronDown" /></button>
        </div>
        {items.length > 1 && <button type="button" className="plan-handle" aria-label={t('Move {0}', name)} title={t('Drag to reorder')} {...reorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
      </div>
    })}
  </div>
}

function SurfaceEditor ({ surface, layout, setLayout, title }) {
  const f = fitSurface(surface, layout)
  const L = layout[surface]
  const lim = LIMITS[surface]
  const missingTiles = Object.keys(TILES).filter(k => tileAllowed(surface, k) && !L.t.some(x => x.k === k))
  const missingActs = lim.actions > 0 ? Object.keys(ACTIONS).filter(k => actionAllowed(surface, k) && !(L.a || []).includes(k)) : []
  const pickTile = () => menuSheet({
    title: t('Add a tile'),
    items: missingTiles.map(k => ({ icon: TILES[k].icon, label: tileName(k), onClick: () => setLayout(addTile(layout, surface, k)) })),
  })
  const pickAct = () => menuSheet({
    title: t('Add a button'),
    items: missingActs.map(k => ({ icon: ACTIONS[k].icon, label: t(ACTIONS[k].label), sub: ACTIONS[k].open ? t('Opens openGym, since saving asks what to keep.') : undefined, onClick: () => setLayout(addAction(layout, surface, k)) })),
  })
  return <>
    <Section title={title || t('Tiles')}>
      {f.tiles.length ? <ItemList surface={surface} kind="tile" items={f.tiles}
        onMove={(a, b) => setLayout(moveTile(layout, surface, a, b))}
        onRemove={k => setLayout(removeTile(layout, surface, k))}
        onResize={(k, s) => setLayout(resizeTile(layout, surface, k, s))} />
        : <p className="lw-empty">{t('No tiles yet.')}</p>}
      {missingTiles.length > 0 && <button type="button" className="btn plain lw-add" onClick={pickTile}><Icon name="plusCircle" /><span>{t('Add a tile')}</span></button>}
    </Section>
    {lim.actions > 0 && <Section title={t('Buttons')}>
      {f.actions.length ? <ItemList surface={surface} kind="action" items={f.actions}
        onMove={(a, b) => setLayout(moveAction(layout, surface, a, b))}
        onRemove={k => setLayout(removeAction(layout, surface, k))} />
        : <p className="lw-empty">{t('No buttons. A tap on it opens openGym.')}</p>}
      {missingActs.length > 0 && <button type="button" className="btn plain lw-add" onClick={pickAct}><Icon name="plusCircle" /><span>{t('Add a button')}</span></button>}
    </Section>}
  </>
}

const NOTES = {
  app: () => t('As many as you like. They wrap onto new rows.'),
  lock: () => t('Needs iOS 17 or later. No animations on the Lock Screen, so the exercise picture is a still. Buttons work without unlocking, Finish opens the app.'),
  island: () => t('The pill shows two tiles beside the camera. Long-press it for the rest.'),
  android: () => t('Tiles become lines of text, so Android 16 can keep it a Live Update by the clock. While a rest runs, the notification shows its rest buttons.'),
  widget: () => t('Up to three lines under the set. The widget keeps its own − and + buttons.'),
}

export default function LiveWidgetBuilder () {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const layout = useMemo(() => layoutOf(S), [S.liveLayout])
  const os = MOBILE ? platformNow() : null
  const tabs = useMemo(() => {
    const mine = SURFACE_TABS.filter(x => !x.os || !os || x.os === os)
    const other = SURFACE_TABS.filter(x => !mine.includes(x))
    return [...mine, ...other]
  }, [os])
  const [surface, setSurface] = useState('app')
  const PS = useMemo(() => sampleState(S), [S])
  const setLayout = next => update(s => { s.liveLayout = next })
  const applyPreset = id => {
    const before = S.liveLayout ?? null
    setLayout(presetLayout(id))
    useUI.getState().toast(t('{0} layout on.', presetName(id)), { action: t('Undo'), onAction: () => update(s => { if (before == null) delete s.liveLayout; else s.liveLayout = before }) })
  }
  const resetHere = () => {
    let next = resetSurface(layout, surface)
    if (surface === 'island') next = resetSurface(next, 'compact')
    setLayout(next)
  }
  const inUse = PRESET_IDS.find(id => presetMatches(layout, id))
  return <div className="lw-builder">
    <Section title={t('Start from')} footer={t('A preset sets every surface. Then change whatever you like.')}>
      <div className="lw-presets">
        {PRESET_IDS.map(id => <button key={id} type="button" className={'chip lw-preset' + (inUse === id ? ' on' : '')} aria-pressed={inUse === id} onClick={() => applyPreset(id)}>{presetName(id)}</button>)}
      </div>
    </Section>
    <div className="lw-tabs" role="tablist" aria-label={t('Where it shows')}>
      {tabs.map(x => <button key={x.id} type="button" role="tab" aria-selected={surface === x.id} className={'chip lw-tab' + (surface === x.id ? ' on' : '')}
        onClick={() => setSurface(x.id)}><Icon name={x.icon} />{x.label()}</button>)}
    </div>
    <div className="lw-stage" role="tabpanel" aria-label={SURFACE_TABS.find(x => x.id === surface).label()}>
      <div className="lw-preview">
        {surface === 'app' && <AppPreview PS={PS} list={layout.app} />}
        {surface === 'lock' && <LockPreview PS={PS} layout={layout} />}
        {surface === 'island' && <IslandPreview PS={PS} layout={layout} />}
        {surface === 'android' && <AndroidPreview PS={PS} layout={layout} />}
        {surface === 'widget' && <WidgetPreview PS={PS} layout={layout} />}
      </div>
      <p className="lw-note">{NOTES[surface]()}</p>
      {surface === 'island'
        ? <><SurfaceEditor surface="island" layout={layout} setLayout={setLayout} title={t('Long-press view')} />
          <SurfaceEditor surface="compact" layout={layout} setLayout={setLayout} title={t('The pill')} /></>
        : <SurfaceEditor surface={surface} layout={layout} setLayout={setLayout} />}
      <button type="button" className="btn plain lw-reset" onClick={resetHere}><Icon name="reset" /><span>{t('Reset to default')}</span></button>
    </div>
  </div>
}
