// The Garmin screen's settings sheet: which cards show and in what order, what the Home card
// says, where else Garmin shows up, goals, pushes and sharing. Per account, kept on the server
// (lib/garmin-layout.js, PUT /api/garmin/prefs). Plain English: ours, not upstream's.
import { useUI } from '../store/useUI.js'
import { CARDS, PLACES, HOME_ITEMS, cardOrder, isShown, toggle, move, homeItems } from '../lib/garmin-layout.js'
import { sleepTarget } from '../lib/garmin-insights.js'
import { fmtDuration } from '../lib/garmin.js'
import { todayISO } from '../lib/format.js'
import { useGarmin, setGarminPrefs } from './useGarmin.js'
import { Section, Segmented, Switch } from './ui.jsx'
import Icon from './Icon.jsx'

const SHARE = [['ready', 'Readiness'], ['sleep', 'Sleep'], ['steps', 'Steps'], ['im', 'Intensity minutes'], ['bb', 'Body battery']]
const save = patch => setGarminPrefs(patch).catch(e => useUI.getState().toast(e.message))

function SwitchRow({ title, sub, on, set, children }) {
  return <div className="lrow">
    <span className="lrow-m"><span className="lrow-t">{title}</span>{sub && <span className="lrow-s">{sub}</span>}</span>
    {children}
    <Switch checked={!!on} onChange={set} aria-label={title} />
  </div>
}

function Stepper({ label, value, step, min, max, fmt, set }) {
  return <div className="lrow">
    <span className="lrow-m"><span className="lrow-t">{label}</span></span>
    <button className="iconbtn" aria-label={`Less ${label}`} disabled={value <= min} onClick={() => set(Math.max(min, value - step))}><Icon name="minus" /></button>
    <span className="lrow-v" style={{ minWidth: 92, textAlign: 'center' }}>{fmt(value)}</span>
    <button className="iconbtn" aria-label={`More ${label}`} disabled={value >= max} onClick={() => set(Math.min(max, value + step))}><Icon name="plus" /></button>
  </div>
}

export default function GarminSettings() {
  const g = useGarmin()
  if (!g?.connected) return null
  const p = g.prefs || {}
  const order = cardOrder(p)
  const label = Object.fromEntries(CARDS.map(c => [c.id, c.label]))
  const home = homeItems(p)
  const target = sleepTarget(g, todayISO(), p.sleepMin)
  const share = p.share || { with: [], what: [] }
  const setShare = s => save({ share: { ...share, ...s } })
  const flip = (list, x, on) => (on ? [...new Set([...list, x])] : list.filter(y => y !== x))
  const teamKind = p.teamKind || 'steps'

  return <>
    <h3>Garmin settings</h3>
    <p className="muted small">Only for your account. Your partner sets their own.</p>

    <Section title="Cards on the Garmin screen" footer="Switch a card off to hide it; the arrows change the order.">
      {order.map((id, i) => <SwitchRow key={id} title={label[id]} on={isShown(p, id)} set={v => save(toggle(p, id, v))}>
        <button className="iconbtn" aria-label={`Move ${label[id]} up`} disabled={i === 0} onClick={() => save(move(p, id, -1))}><Icon name="chevronUp" /></button>
        <button className="iconbtn" aria-label={`Move ${label[id]} down`} disabled={i === order.length - 1} onClick={() => save(move(p, id, 1))}><Icon name="chevronDown" /></button>
      </SwitchRow>)}
    </Section>

    <Section title="Garmin elsewhere in the app">
      {PLACES.map(x => <SwitchRow key={x.id} title={x.label} on={isShown(p, x.id)} set={v => save(toggle(p, x.id, v))} />)}
    </Section>

    <Section title="What the Home card shows" footer="The title is always today's readiness.">
      {HOME_ITEMS.map(x => <SwitchRow key={x.id} title={x.label} on={home.includes(x.id)}
        set={v => save({ home: HOME_ITEMS.map(y => y.id).filter(id => (id === x.id ? v : home.includes(id))) })} />)}
    </Section>

    <Section title="Goals" footer={target.source === 'garmin'
      ? `Your watch works out tonight's sleep need: ${fmtDuration(target.min * 60)}. The bedtime follows it; your own target is used when it sends none.`
      : 'Your watch sends no sleep need of its own (newer ones like the Venu 3 do), so the bedtime uses this target.'}>
      <Stepper label="Sleep target" value={p.sleepMin || 450} step={15} min={300} max={600} fmt={m => fmtDuration(m * 60)} set={v => save({ sleepMin: v })} />
      <Stepper label="Zone 2 a week" value={p.zoneGoal || 150} step={10} min={30} max={600} fmt={m => `${m} min`} set={v => save({ zoneGoal: v })} />
    </Section>

    <Section title="Notifications" footer="Sent to the devices where notifications are on in openGym's settings.">
      <SwitchRow title="Morning readiness" sub="Once last night's sleep is in, between 6 and 12" on={p.push?.morning} set={v => save({ push: { ...p.push, expiry: p.push?.expiry !== false, morning: v } })} />
      <SwitchRow title="Key runs out" sub="A week before your Garmin key expires" on={p.push?.expiry !== false} set={v => save({ push: { morning: !!p.push?.morning, expiry: v } })} />
    </Section>

    <Section title="Share with" footer="They see only what you tick, from today and this week. Nothing is shared until you pick someone.">
      {!(g.people || []).length && <div className="lrow"><span className="lrow-m"><span className="lrow-s">No other accounts on this server.</span></span></div>}
      {(g.people || []).map(u => <SwitchRow key={u.uid} title={u.name || 'Account'} on={share.with.includes(u.uid)} set={v => setShare({ with: flip(share.with, u.uid, v) })} />)}
      {share.with.length > 0 && SHARE.map(([k, l]) => <SwitchRow key={k} title={l} sub="shared" on={share.what.includes(k)} set={v => setShare({ what: flip(share.what, k, v) })} />)}
    </Section>

    <Section title="Together this week" footer="A joint goal with everyone who shares with you. Each of you sets your own.">
      <div className="lrow"><Segmented value={teamKind} onChange={v => save({ teamKind: v, teamGoal: v === 'im' ? 300 : 140000 })} options={[{ value: 'steps', label: 'Steps' }, { value: 'im', label: 'Intensity minutes' }]} /></div>
      <Stepper label="Goal" value={p.teamGoal || (teamKind === 'im' ? 300 : 140000)} step={teamKind === 'im' ? 30 : 10000} min={teamKind === 'im' ? 30 : 10000} max={teamKind === 'im' ? 3000 : 1000000}
        fmt={v => v.toLocaleString()} set={v => save({ teamGoal: v })} />
    </Section>
  </>
}
