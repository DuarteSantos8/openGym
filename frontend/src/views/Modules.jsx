// Settings → Modules (v1.4.4): whole feature areas on and off (lib/modules.js has the rules).
//
// A preset row on top (Just training, Training and body, Everything, or Custom once the switches
// below make a mix of their own), then one row per module in three groups, each with its switch.
// A module with parts (#1087) has a chevron beside its switch: the row unfolds the parts under it,
// each with its own switch, and folds them again. Folded at first; the fold is not stored.
// Off hides; it never deletes. A module that is connected to something (the phone's health app,
// a watch, webhooks, scheduled Coach reviews) says what pauses and asks once before it goes off.
import { useEffect, useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { platformNow } from '../lib/platform-now.js'
import { api } from '../lib/api.js'
import { libraryOn } from '../lib/shared-api.js'
import { MODULES, GROUPS, PRESETS, isOn, presetOf, presetModules, applyPreset, setModule, turnedOff, moduleBuilt, partsOf, partSwitch, partsOnCount, setPart } from '../lib/modules.js'
import { readWatchStatus, readGarminLink } from '../lib/watch-settings.js'
import { moduleCopy, groupCopy, presetCopy, partCopy } from '../lib/modules-copy.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, SelectRow, Switch } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

/* What is connected right now, read once when the page opens. Each answer is a promise that never
   rejects: a check that fails counts as nothing connected, and the switch simply goes off. */
function useConnections() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const [found, setFound] = useState({})
  useEffect(() => {
    let gone = false
    const put = patch => { if (!gone) setFound(f => ({ ...f, ...patch })) }
    if (MOBILE) {
      import('../lib/health-sync.js').then(m => m.loadHealth()).then(h => {
        if (h && (h.on || h.readHr || h.readWeight || h.readBody || h.readVitals)) put({ health: platformNow() === 'android' ? 'Health Connect' : 'Apple Health' })
      }).catch(() => {})
      // An Apple Watch that has reported in, or a Garmin the watch link found (docs/GARMIN.md).
      if (readWatchStatus() || readGarminLink()) put({ watch: true })
    }
    if (user && !DEMO) {
      import('../lib/watch-relay.js').then(m => m.relayLinks()).then(links => { if (links.length) put({ watch: true }) }).catch(() => {})
      if ((config?.integrations?.providers || []).includes('webhook')) {
        api('/api/integrations').then(d => {
          const n = (d?.connections || []).filter(c => c.provider === 'webhook' && !c.paused).length
          if (n) put({ webhooks: n })
        }).catch(() => {})
      }
    }
    return () => { gone = true }
  }, [user, config]) // eslint-disable-line react-hooks/exhaustive-deps
  const cadence = S.coach?.cadence
  return { ...found, coach: !!coachMode || (!!S.coach?.consent?.agreedAt && !!cadence && cadence !== 'off') }
}

/** The sentence per module that is connected, for the modules about to go off. */
export function connectionNotes(ids, conn) {
  const out = []
  for (const id of ids) {
    if (id === 'health' && conn.health) out.push(t('{0} stops syncing while Health is off. Nothing is disconnected, and it catches up once Health is back.', conn.health))
    if (id === 'watch' && conn.watch) out.push(t('Your watch stops getting workouts while Watch is off. It stays paired.'))
    if (id === 'integrations' && conn.webhooks) out.push(t('Your webhooks stop sending while Integrations is off. They stay set up.'))
    if (id === 'coach' && conn.coach) out.push(t('Scheduled Coach reviews take a break while the AI Coach is off. Your setup and chats stay.'))
  }
  return out
}

/* A module with parts: its row, whose switch is the module's and whose rest is one button that
   unfolds the parts under it (a button cannot hold the switch, so it is laid over the row). Folded,
   the parts are hidden, not left out, so a search hit's row is there to find. With the module off
   the parts show as they are, disabled: back on, each is as it was left. */
function ModuleWithParts({ m, title, subtitle, flip, startOpen }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [open, setOpen] = useState(!!startOpen)
  const id = useId()
  const on = isOn(S, m.id)
  const parts = partsOf(m.id), pc = partCopy()
  const n = partsOnCount(S, m.id)
  return <>
    <Row icon={m.icon} iconTint={m.tint} title={title} subtitle={subtitle} className="module-row" tour={'module-' + m.id}>
      <button type="button" className="module-open" aria-expanded={open} aria-controls={id}
        aria-label={t('Parts of {0}', title)} onClick={() => setOpen(o => !o)} />
      {!open && <span className="lrow-v">{!on ? t('Off') : n === parts.length ? t('All') : t('{0} of {1}', n, parts.length)}</span>}
      <Icon name={open ? 'chevronDown' : 'chevronRight'} className="lrow-c" />
      <Switch aria-label={title} checked={on} onChange={v => flip(m.id, v)} />
    </Row>
    <div id={id} className="module-parts" role="group" aria-label={t('Parts of {0}', title)} hidden={!open}>
      {parts.map(p => {
        const [pt, pd] = pc[m.id + '.' + p.id]
        return <Row key={p.id} title={pt} subtitle={pd} className={on ? '' : 'dis'}>
          <Switch aria-label={pt} checked={partSwitch(S, m.id, p.id)} disabled={!on}
            onChange={v => update(s => { setPart(s, m.id, p.id, v) })} />
        </Row>
      })}
      {!on && <p className="module-parts-off">{t('{0} is off, so all of it is hidden.', title)}</p>}
    </div>
  </>
}

// `find`: a search hit's title (views/Settings.jsx). A part's title unfolds the module that holds it.
export default function ModulesPage({ find = null } = {}) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const conn = useConnections()
  const preset = presetOf(S)

  // Applies a change, after one question when it pauses something that is connected.
  const change = (next, title, apply) => {
    const notes = connectionNotes(turnedOff(S, next), conn)
    if (!notes.length) { update(apply); return }
    confirmSheet({
      title,
      message: notes.map((n, i) => <p key={i} style={{ margin: i ? '8px 0 0' : 0 }}>{n}</p>),
      confirmText: t('Switch off'),
      onConfirm: () => update(apply),
    })
  }
  const mc = moduleCopy(), gc = groupCopy(), pc = presetCopy()
  const pickPreset = id => {
    if (id === 'custom' || id === preset) return
    const next = presetModules(id)
    const off = turnedOff(S, next)
    change(next, off.length === 1 ? t('Switch off {0}?', mc[off[0]][0]) : t('Switch these off?'), s => applyPreset(s, id))
  }
  const flip = (id, on) => {
    if (on) { update(s => setModule(s, id, true)); return }
    change({ [id]: false }, t('Switch off {0}?', mc[id][0]), s => setModule(s, id, false))
  }

  const options = [
    ...PRESETS.map(p => ({ value: p.id, label: pc[p.id][0], subtitle: pc[p.id][1] })),
    { value: 'custom', label: t('Custom'), subtitle: t('Your own mix. Flip the switches below.') },
  ]
  // Community only where the server has a library (LIBRARY=on): elsewhere it would switch nothing.
  const libOn = useStore(st => libraryOn(st.config, st.user))
  // openGym Offline has no Coach, Integrations or Community (lib/build-caps.js): not offered at all.
  const shown = MODULES.filter(m => moduleBuilt(m.id) && (m.id !== 'community' || libOn))
  return <div className="modules">
    <p className="sect-f modules-intro">{t('Switch off what you don’t use. Nothing gets deleted: switch it back on and it’s all still there.')}</p>
    <Section footer={preset === 'custom' ? t('{0} of {1} modules on.', shown.filter(m => isOn(S, m.id)).length, shown.length) : null}>
      <SelectRow icon="slider" iconTint="var(--blue)" title={t('Start from')} sheetTitle={t('Modules')}
        value={preset} onChange={pickPreset} options={options} />
    </Section>
    {GROUPS.map((g, gi) => <Section key={g.id} title={gc[g.id]}
      footer={gi === GROUPS.length - 1 ? t('Logging, plans, history, the exercise library and the basic stats are always on.') : null}>
      {shown.filter(m => m.group === g.id).map(m => partsOf(m.id).length
        ? <ModuleWithParts key={m.id} m={m} title={mc[m.id][0]} subtitle={mc[m.id][1]} flip={flip}
          startOpen={!!find && partsOf(m.id).some(p => p.title === find)} />
        : <Row key={m.id} icon={m.icon} iconTint={m.tint} title={mc[m.id][0]} subtitle={mc[m.id][1]} className="module-row" tour={'module-' + m.id}>
          <Switch aria-label={mc[m.id][0]} checked={isOn(S, m.id)} onChange={v => flip(m.id, v)} />
        </Row>
      )}
    </Section>)}
  </div>
}
