// The trainer dashboard (docs/TRAINERS.md): the people who connected to me, what each of them
// shares, who needs a nudge, and one gym's whole picture for its gym lead. Only for sessions that
// train someone or lead a gym (config.trainers.roles); every number on it is a projection the
// server built from what each member chose to share, and it lives in this screen's memory only.
//
//   /trainer            the list (and on a wide screen, the detail beside it)
//   /trainer/m/:id      one member
//   /trainer?gym=<id>   the gym lead's view of that gym
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDaysAgo, todayISO } from '../lib/format.js'
import { categoryLabel } from '../lib/sharing-api.js'
import {
  getOverview, getMembers, getMember, getGym, sendOps, answerRequest, dropMember, setGymTrainer,
  sortMembers, trainerError, trainerRoles, showsDashboard,
} from '../lib/trainer-api.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, Button, SearchField, Segmented, Check, TextField, openSelectSheet } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import TrainerMember, { Avatar, FlagPill } from '../components/TrainerMember.jsx'
import { InviteSheet, GymCodeSheet, AssignSheet, CommentSheet, WeighSheet, WorkoutEditSheet, WorkoutAddSheet, MeasureSheet } from '../components/TrainerSheets.jsx'

// Held for this visit of the dashboard only (never stored): going from the list to a member and
// back does not fetch the list again for a few seconds.
let listCache = null
const SORTS = () => [{ value: 'attention', label: t('Needs you first') }, { value: 'last', label: t('Last workout') }, { value: 'streak', label: t('Streak') }, { value: 'name', label: t('Name') }]
const CACHE_MS = 15000

function useWide() {
  const q = '(min-width: 1000px)'
  const get = () => { try { return !!window.matchMedia?.(q).matches } catch { return false } }
  const [wide, setWide] = useState(get)
  useEffect(() => {
    let m; try { m = window.matchMedia?.(q) } catch { m = null }
    if (!m?.addEventListener) return
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

// This week as dots: filled for a session done, a ring for a planned day still to come.
function WeekDots({ week }) {
  if (!week) return null
  const total = Math.max(week.planned || 0, week.done || 0)
  if (!total) return null
  return <span className="tr-dots" aria-label={t('{0} of {1} this week', week.done, week.planned || week.done)}>
    {Array.from({ length: Math.min(total, 7) }, (_, i) => <i key={i} className={i < week.done ? 'on' : ''} />)}
  </span>
}

function metaLine(s, today) {
  if (!s || !('lastWorkout' in s)) return s?.shares?.length ? t('Shares: {0}', s.shares.map(categoryLabel).join(', ')) : t('Shares nothing right now')
  const parts = [s.lastWorkout ? t('Trained {0}', fmtDaysAgo(s.lastWorkout, today)) : t('No workout yet')]
  if (s.streak) parts.push(t('{0} wk streak', s.streak))
  return parts.join(' · ')
}

function MemberRow({ m, today, selecting, picked, onPick, onOpen, current, showGym }) {
  const hold = useRef(null)
  const start = () => { clearTimeout(hold.current); hold.current = setTimeout(() => { hold.current = 'fired'; onPick(m, true) }, 450) }
  const end = () => { if (hold.current !== 'fired') clearTimeout(hold.current) }
  const click = () => {
    if (hold.current === 'fired') { hold.current = null; return }
    if (selecting) onPick(m); else onOpen(m)
  }
  const flags = m.summary?.flags || []
  return <div className={'tr-row' + (current ? ' cur' : '') + (m.paused ? ' paused' : '')}>
    {selecting && <Check checked={picked} onChange={() => onPick(m)} label={t('Select {0}', m.member.name)} />}
    <button className="tr-row-b" onClick={click} onPointerDown={start} onPointerUp={end} onPointerLeave={end} onContextMenu={e => { e.preventDefault(); onPick(m, true) }}
      aria-current={current ? 'true' : undefined}>
      <Avatar id={m.member.id} name={m.member.name} />
      <span className="tr-row-m">
        <span className="tr-row-t">{m.member.name}</span>
        <span className="tr-row-s">{m.paused ? t('Paused for now. Nothing is shared while it is.') : metaLine(m.summary, today)}{showGym ? ' · ' + (m.gym ? m.gym.name : t('Private client')) : ''}</span>
        {!m.paused && flags.length > 0 && <span className="tr-flags">{flags.slice(0, 2).map(f => <FlagPill key={f.kind} f={f} exNames={m.exNames} />)}{flags.length > 2 && <span className="tr-pill more">+{flags.length - 2}</span>}</span>}
      </span>
      {!m.paused && <WeekDots week={m.summary?.week} />}
      {!selecting && <Icon name="chevronRight" className="tr-row-c" />}
    </button>
  </div>
}

function Requests({ overview, reload }) {
  const toast = useUI(s => s.toast)
  const reqs = overview?.requests || []
  if (!reqs.length) return null
  const answer = (r, yes) => answerRequest(r.id, yes).then(() => { toast(yes ? t('{0} is connected', r.member.name) : t('Turned down. They will not be told why.')); reload() }).catch(e => toast(trainerError(e)))
  return <Section title={t('Want to connect')} footer={t('Confirming lets you see what they ticked. Nothing else.')}>
    {reqs.map(r => <div key={r.id} className="lrow tr-req">
      <Avatar id={r.member.id} name={r.member.name} size={34} />
      <span className="lrow-m"><span className="lrow-t">{r.member.name}</span>
        <span className="lrow-s">{Object.entries(r.scopes || {}).filter(([, v]) => v !== 'off').map(([k]) => categoryLabel(k)).join(', ')}</span></span>
      <Button size="xs" variant="tinted" onClick={() => answer(r, true)}>{t('Confirm')}</Button>
      <Button size="xs" variant="plain" className="dim" onClick={() => answer(r, false)}>{t('Not now')}</Button>
    </div>)}
  </Section>
}

function MemberList({ list, overview, reload, selected, setSelected, openMember, currentId, loading }) {
  const openSheet = useUI(s => s.openSheet)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('attention')
  const [filter, setFilter] = useState('all')
  const [selecting, setSelecting] = useState(false)
  const today = list?.today || todayISO()
  const shown = useMemo(() => sortMembers(list?.members || [], sort, query, filter), [list, sort, query, filter])
  const pick = (m, enter) => {
    if (enter && !selecting) setSelecting(true)
    setSelected(s => (s.includes(m.member.id) ? s.filter(x => x !== m.member.id) : [...s, m.member.id]))
  }
  const stop = () => { setSelecting(false); setSelected([]) }
  const chosen = (list?.members || []).filter(m => selected.includes(m.member.id))
  const assign = () => openSheet(close => <AssignSheet members={chosen} close={close} done={() => { stop(); reload() }} />)
  const invite = () => openSheet(close => <InviteSheet overview={overview} close={close} />)
  const n = list?.members?.length || 0
  const mixed = new Set((list?.members || []).map(m => m.gym?.id || '')).size > 1
  return <div className="tr-list">
    <ScreenHeader hard title={t('Trainer')} sub={n ? t('{0} people trust you with their training', n) : t('Nobody connected yet')}
      right={<div className="hdr-actions">
        {n > 0 && <Button size="sm" variant="plain" onClick={selecting ? stop : () => setSelecting(true)}>{selecting ? t('Done') : t('Select')}</Button>}
        <button className="iconbtn" onClick={invite} aria-label={t('Connect a member')}><Icon name="qr" /></button>
      </div>} />
    <Requests overview={overview} reload={reload} />
    {n > 0 && <>
      <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} placeholder={t('Search members')} aria-label={t('Search members')} />
      <div className="tr-controls">
        <div className="tr-chips" role="group" aria-label={t('Filter')}>
          {[{ value: 'all', label: t('All') }, { value: 'attention', label: t('Needs you') }, { value: 'pr', label: t('PRs') }, { value: 'inactive', label: t('Quiet') }].map(o =>
            <button key={o.value} className={'chip nocap' + (filter === o.value ? ' on' : '')} aria-pressed={filter === o.value} onClick={() => setFilter(o.value)}>{o.label}</button>)}
        </div>
        <button className="iconbtn tr-sort" aria-label={t('Sort: {0}', SORTS().find(o => o.value === sort)?.label)} aria-haspopup="dialog"
          onClick={() => openSelectSheet({ title: t('Sort'), value: sort, options: SORTS(), onChange: setSort })}><Icon name="chevronsUpDown" /></button>
      </div>
    </>}
    {loading && !list && <p className="muted small tr-pad">{t('Loading…')}</p>}
    {list && !n && <div className="tr-hello">
      <Icon name="qr" />
      <p>{t('Make a code, they scan it, they choose what you see. That is the whole handshake.')}</p>
      <Button variant="primary" onClick={invite}>{t('Connect a member')}</Button>
    </div>}
    {n > 0 && !shown.length && <p className="tr-empty">{t('Nobody here with that. Try another filter.')}</p>}
    <div className="tr-rows">
      {shown.map(m => <MemberRow key={m.grantId} m={m} today={today} selecting={selecting} picked={selected.includes(m.member.id)} showGym={mixed}
        onPick={pick} onOpen={openMember} current={currentId === m.member.id} />)}
    </div>
    {selecting && <div className="tr-bulk" role="toolbar" aria-label={t('Selected members')}>
      <span>{t('{0} selected', chosen.length)}</span>
      <Button variant="primary" size="sm" icon="dumbbell" disabled={!chosen.length} onClick={assign}>{t('Assign a routine')}</Button>
    </div>}
  </div>
}

// The gym lead's view: the gym's trainers and every member who joined, with what each lets the lead see.
function GymView({ gymId, openMember }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [g, setG] = useState(null)
  const [who, setWho] = useState('')
  const [trainer, setTrainer] = useState('all')
  const [add, setAdd] = useState('')
  const load = () => getGym(gymId).then(setG).catch(e => toast(trainerError(e)))
  useEffect(() => { setG(null); load() }, [gymId])
  if (!g) return <p className="muted small tr-pad">{t('Loading…')}</p>
  const today = g.today || todayISO()
  const members = g.members.filter(m => (trainer === 'all' || (trainer === 'none' ? !m.trainers.length : m.trainers.some(x => x.id === trainer)))
    && (!who.trim() || m.member.name.toLowerCase().includes(who.trim().toLowerCase())))
  const addTrainer = () => setGymTrainer(gymId, add.trim(), true).then(r => { toast(t('{0} trains here now', r.trainer.name)); setAdd(''); load() }).catch(e => toast(trainerError(e)))
  const remove = tr => confirmSheet({
    title: t('Take {0} off {1}?', tr.name, g.gym.name),
    message: t('Their members here pause at once and get 30 days to keep training with them privately.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => setGymTrainer(gymId, tr.id, false).then(() => { toast(t('Done')); load() }).catch(e => toast(trainerError(e))),
  })
  return <div className="tr-list">
    <ScreenHeader hard title={g.gym.name} sub={t('Members: {0} · Trainers: {1}', g.members.length, g.trainers.length)}
      right={<div className="hdr-actions"><button className="iconbtn" onClick={() => openSheet(close => <GymCodeSheet gym={g.gym} close={close} />)} aria-label={t('Gym join code')}><Icon name="qr" /></button></div>} />
    <Section title={t('Trainers')} footer={t('Add a trainer by the account id from their Settings. Members still decide what each trainer sees.')}>
      {g.trainers.map(tr => <Row key={tr.id} icon="personCircle" iconTint="var(--acc)" title={tr.name} subtitle={t('Members: {0}', tr.members)}>
        <Button size="xs" variant="plain" className="tr-danger" onClick={() => remove(tr)}>{t('Remove')}</Button>
      </Row>)}
      <div className="tr-add">
        <TextField value={add} onChange={e => setAdd(e.target.value)} placeholder={t('Account id')} aria-label={t('Account id')} autoCapitalize="off" spellCheck={false} />
        <Button size="sm" variant="tinted" disabled={!add.trim()} onClick={addTrainer}>{t('Add')}</Button>
      </div>
    </Section>
    <SearchField value={who} onChange={setWho} onClear={() => setWho('')} placeholder={t('Search members')} aria-label={t('Search members')} />
    {g.trainers.length > 0 && <div className="tr-chips" role="group" aria-label={t('Filter by trainer')}>
      {[{ id: 'all', name: t('All') }, ...g.trainers, { id: 'none', name: t('No trainer') }].map(x =>
        <button key={x.id} className={'chip nocap' + (trainer === x.id ? ' on' : '')} aria-pressed={trainer === x.id} onClick={() => setTrainer(x.id)}>{x.name}</button>)}
    </div>}
    <div className="tr-rows">
      {members.map(m => <div key={m.member.id} className="tr-row">
        <button className="tr-row-b" disabled={!m.sharesWithLead} onClick={() => openMember({ member: m.member })}>
          <Avatar id={m.member.id} name={m.member.name} />
          <span className="tr-row-m">
            <span className="tr-row-t">{m.member.name}</span>
            <span className="tr-row-s">{[m.trainers.map(x => x.name).join(', ') || t('No trainer'), m.sharesWithLead ? metaLine(m.summary, today) : t('Shares nothing with you')].join(' · ')}</span>
            {(m.summary?.flags || []).length > 0 && <span className="tr-flags">{m.summary.flags.map(f => <FlagPill key={f.kind} f={f} />)}</span>}
          </span>
          {m.sharesWithLead && <Icon name="chevronRight" className="tr-row-c" />}
        </button>
      </div>)}
      {!members.length && <p className="tr-empty">{g.members.length ? t('Nobody here with that. Try another filter.') : t('Nobody joined yet. The join code is up top.')}</p>}
    </div>
  </div>
}

// The exercises a member did lately, newest first: the quick picks when logging a workout for them.
const recentIds = d => [...new Set((d.workouts?.list || []).flatMap(w => w.entries.map(e => String(e.id))))]

function Detail({ id, entry, onBack, reloadList }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const nav = useNavigate()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [more, setMore] = useState(false)
  const load = () => getMember(id).then(r => { setD(r); setErr(null) }).catch(e => setErr(trainerError(e)))
  useEffect(() => { setD(null); setErr(null); load() }, [id])
  if (err) return <div className="tr-detail"><p className="tr-empty" role="alert">{err}</p>{onBack && <Button onClick={onBack}>{t('Back')}</Button>}</div>
  if (!d) return <div className="tr-detail"><p className="muted small tr-pad">{t('Loading…')}</p></div>
  const member = d.member
  const mine = (d.grants || []).find(g => g.kind === 'trainer')
  const levels = d.levels || {}
  const asMember = { member, levels }
  const writable = c => levels[c] === 'suggest' || levels[c] === 'apply'
  const older = () => { setMore(true); getMember(id, d.workouts.next).then(r => setD(x => ({ ...x, workouts: { list: [...x.workouts.list, ...r.workouts.list], next: r.workouts.next } }))).catch(e => toast(trainerError(e))).finally(() => setMore(false)) }
  const removeRoutine = r => confirmSheet({
    title: t('Remove {0}?', r.name), message: levels.plans === 'apply' ? t('{0} can undo it from their side.', member.name) : t('{0} gets it as a suggestion.', member.name),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => sendOps(member.id, [{ op: 'routine.remove', id: r.id }]).then(x => { toast(x.applied ? t('Removed') : t('Sent. {0} decides.', member.name)); load() }).catch(e => toast(trainerError(e))),
  })
  const disconnect = () => confirmSheet({
    title: t('Disconnect {0}?', member.name), message: t('You stop seeing anything at once. What you assigned stays theirs.'),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => dropMember(mine.id).then(() => { toast(t('Disconnected')); reloadList(); nav('/trainer', { replace: true }) }).catch(e => toast(trainerError(e))),
  })
  return <TrainerMember d={d} onBack={onBack} more={more}
    onMore={older}
    onComment={levels.workouts !== 'off' && mine ? w => openSheet(close => <CommentSheet member={member} workout={w} close={close} done={load} />) : null}
    onAssign={writable('plans') && mine ? () => openSheet(close => <AssignSheet members={[asMember]} close={close} done={load} />) : null}
    onWeigh={writable('bodyweight') && mine ? () => openSheet(close => <WeighSheet member={member} unit={d.unit} level={levels.bodyweight} close={close} done={load} />) : null}
    onEdit={writable('workouts') && mine ? w => openSheet(close => <WorkoutEditSheet member={member} workout={w} customEx={d.customEx} unit={d.unit} level={levels.workouts} close={close} done={load} />) : null}
    onLog={writable('workouts') && mine ? () => openSheet(close => <WorkoutAddSheet member={member} recent={recentIds(d)} customEx={d.customEx} unit={d.unit} level={levels.workouts} close={close} done={load} />) : null}
    onMeasure={writable('measurements') && mine ? () => openSheet(close => <MeasureSheet member={member} level={levels.measurements} close={close} done={load} />) : null}
    onRemoveRoutine={writable('plans') && mine ? removeRoutine : null}
    onDisconnect={mine ? disconnect : null} />
}

export default function TrainerPage() {
  const config = useStore(s => s.config)
  if (!config) return <p className="muted small tr-pad">{t('Loading…')}</p>
  if (!showsDashboard(config)) return <Navigate to="/home" replace />
  return <Dashboard config={config} />
}

function Dashboard({ config }) {
  const roles = trainerRoles(config)
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const loc = useLocation()
  const { id } = useParams()
  const wide = useWide()
  const gymParam = new URLSearchParams(loc.search).get('gym')
  const [list, setList] = useState(() => (listCache && Date.now() - listCache.at < CACHE_MS ? listCache.list : null))
  const [overview, setOverview] = useState(() => listCache?.overview || null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState([])
  const load = () => {
    setLoading(true)
    Promise.all([roles.trainer ? getMembers() : Promise.resolve({ members: [], leads: [] }), roles.trainer ? getOverview().catch(() => null) : Promise.resolve(null)])
      .then(([l, o]) => { setList(l); setOverview(o); listCache = { at: Date.now(), list: l, overview: o } })
      .catch(e => toast(trainerError(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { if (!list) load() }, [])
  // The gyms this person leads come with the list; a lead without trainer role gets them from config.
  const leads = list?.leads || []
  const [leadGyms, setLeadGyms] = useState([])
  useEffect(() => {
    if (roles.trainer || !roles.lead) return
    getMembers().then(l => setLeadGyms(l.leads || [])).catch(() => {})
  }, [roles.trainer, roles.lead])
  const gyms = leads.length ? leads : leadGyms
  const view = gymParam || (!roles.trainer && gyms[0]?.id) || 'mine'
  const back = () => nav(gymParam ? `/trainer?gym=${gymParam}` : '/trainer')
  const open = m => nav(`/trainer/m/${encodeURIComponent(m.member.id)}${gymParam ? `?gym=${gymParam}` : ''}`)
  const switchOpts = (roles.trainer ? 1 : 0) + gyms.length
  const switcher = switchOpts > 1 && <Segmented className="tr-switch" value={view} onChange={v => nav(v === 'mine' ? '/trainer' : `/trainer?gym=${v}`, { replace: true })}
    options={[...(roles.trainer ? [{ value: 'mine', label: t('My members') }] : []), ...gyms.map(g => ({ value: g.id, label: g.name }))]} />
  const left = view === 'mine'
    ? <MemberList list={list} overview={overview} reload={load} selected={selected} setSelected={setSelected} openMember={open} currentId={id} loading={loading} />
    : <GymView gymId={view} openMember={open} />
  if (id && !wide) return <div className="tr-dash"><Detail id={id} onBack={back} reloadList={load} /></div>
  return <div className={'tr-dash' + (wide ? ' wide' : '')}>
    <div className="tr-col-l">{switcher}{left}</div>
    {wide && <div className="tr-col-r">
      {id ? <Detail id={id} reloadList={load} /> : <div className="tr-placeholder"><Icon name="personCircle" /><p>{t('Pick someone on the left. You see what they chose to share, and nothing else.')}</p></div>}
    </div>}
  </div>
}
