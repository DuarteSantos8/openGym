// One member as a trainer or gym lead sees them (views/Trainer.jsx), and as the member sees
// themselves in "See what Marco sees" (views/MyTrainer.jsx): the same component on the same
// projection, so the preview cannot drift from the truth. Only the categories the member shared
// arrive at all; everything below renders from what is there and says plainly what is not.
import { useEffect, useMemo, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtDaysAgo, fmtNum, todayISO, weekOrder } from '../lib/format.js'
import { CATEGORY_IDS } from '../lib/sharing-scopes.js'
import { categoryLabel } from '../lib/sharing-api.js'
import { exName, flagText, changeLines, weekdayName, initials, tintOf } from '../lib/trainer-api.js'
import { Segmented, Button } from './ui.jsx'
import Icon from './Icon.jsx'
import TrainerPhotos from './TrainerPhotos.jsx'
import { isoRun } from '../lib/bidi.js'

const TAB_CATS = { overview: ['metrics', 'bodyweight'], workouts: ['workouts'], plan: ['plans'], body: ['bodyweight', 'measurements'], notes: ['notes'] }

export function Avatar({ id, name, size = 40 }) {
  return <span className="tr-av" style={{ '--tint': tintOf(id), width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{initials(name)}</span>
}

// Sessions per week as bars, the last one this week. Numbers on top, so it reads without a legend.
function WeekBars({ weeks }) {
  const max = Math.max(1, ...weeks.map(w => w.sessions))
  return <div className="tr-bars" role="img" aria-label={t('Sessions per week, last {0} weeks: {1}', weeks.length, weeks.map(w => w.sessions).join(', '))}>
    {weeks.map((w, i) => <div key={w.week} className={'tr-bar' + (i === weeks.length - 1 ? ' now' : '')}>
      <span className="tr-bar-n">{w.sessions || ''}</span>
      <span className="tr-bar-f" style={{ height: `${Math.max(w.sessions ? 10 : 3, Math.round(w.sessions / max * 100))}%` }} />
      <span className="tr-bar-l">{fmtDate(w.week).replace(/\s.*/, '')}</span>
    </div>)}
  </div>
}

// The weight line of the last entries, scaled to its own range.
function Spark({ points }) {
  if (points.length < 2) return null
  const ws = points.map(p => p.w), lo = Math.min(...ws), hi = Math.max(...ws), span = hi - lo || 1
  const d = points.map((p, i) => `${(i / (points.length - 1) * 100).toFixed(2)},${(36 - (p.w - lo) / span * 32 - 2).toFixed(2)}`).join(' ')
  return <svg className="tr-spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><polyline points={d} vectorEffect="non-scaling-stroke" /></svg>
}

function Tile({ label, value, sub }) {
  return <div className="tr-tile"><div className="tr-tile-l">{label}</div><div className="tr-tile-v">{value}</div>{sub && <div className="tr-tile-s">{sub}</div>}</div>
}

function Overview({ d }) {
  const m = d.metrics, bw = d.bodyweight
  const today = d.today || todayISO()
  return <>
    {m && <div className="tr-tiles">
      <Tile label={t('Last workout')} value={m.lastWorkout ? fmtDaysAgo(m.lastWorkout, today) : t('Not yet')} />
      <Tile label={t('Streak')} value={t('{0} wk', m.streak ?? 0)} />
      <Tile label={t('This week')} value={m.week ? (m.week.planned ? `${m.week.done} / ${m.week.planned}` : String(m.week.done)) : '–'} sub={m.week?.planned ? t('done of planned') : null} />
      <Tile label={t('Per week')} value={fmtNum(m.perWeek ?? 0)} sub={t('last 4 weeks')} />
    </div>}
    {m?.flags?.length > 0 && <div className="tr-flags tr-flags-wide">{m.flags.map(f => <FlagPill key={f.kind} f={f} exNames={d.customEx} />)}</div>}
    {m?.stats?.weeks && <div className="tr-card">
      <div className="tr-card-t">{t('Sessions per week')}</div>
      <WeekBars weeks={m.stats.weeks} />
    </div>}
    {m?.stats?.lifts?.length > 0 && <div className="tr-card">
      <div className="tr-card-t">{t('Best estimated 1RM, last 120 days')}</div>
      {m.stats.lifts.map(l => {
        const pct = l.before ? Math.round((l.e1rm - l.before) / l.before * 100) : null
        return <div key={l.id} className="tr-line">
          <span className="tr-line-t">{exName(l.id, d.customEx)}</span>
          <span className="tr-line-v">{fmtNum(l.e1rm)} {d.unit}{pct != null && pct !== 0 && <b className={pct > 0 ? 'up' : 'down'}> {pct > 0 ? '+' : ''}{pct}%</b>}</span>
        </div>
      })}
    </div>}
    {bw?.entries?.length > 0 && <div className="tr-card">
      <div className="tr-card-t">{t('Body weight')}</div>
      <div className="tr-weight">
        <div><span className="tr-weight-v">{fmtNum(bw.entries[bw.entries.length - 1].w)}</span> <span className="muted">{d.unit}</span>
          <div className="tr-tile-s">{fmtDate(bw.entries[bw.entries.length - 1].d)}{bw.targetW ? ' · ' + t('Goal {0} {1}', fmtNum(bw.targetW), d.unit) : ''}</div></div>
        <Spark points={bw.entries.slice(-30)} />
      </div>
    </div>}
    {!m && !bw && <p className="tr-empty">{t('No key numbers shared. The other tabs show what is.')}</p>}
  </>
}

export function FlagPill({ f, exNames }) {
  const x = flagText(f, exNames)
  return <span className={'tr-pill ' + x.tone}><Icon name={x.icon} />{x.text}</span>
}

function bestSet(e) {
  let best = null
  for (const s of e.sets || []) {
    if (s.phase === 'warmup' || s.warmup) continue
    const w = s.sides ? Math.max(+s.sides.L?.w || 0, +s.sides.R?.w || 0) : +s.w || 0
    const r = s.sides ? Math.max(+s.sides.L?.r || 0, +s.sides.R?.r || 0) : +s.r || 0
    if (!best || w * (1 + r / 30) > best.w * (1 + best.r / 30)) best = { w, r }
  }
  return best
}

function WorkoutCard({ w, d, comments, onComment, onEdit }) {
  const [open, setOpen] = useState(false)
  const mine = comments.filter(c => c.workoutId === String(w.id))
  return <div className="tr-card tr-wo">
    <button className="tr-wo-h" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="tr-wo-d">{fmtDate(w.d)}</span>
      <span className="tr-wo-n">{w.name || t('Workout')}</span>
      <span className="tr-wo-m">{[w.mins ? t('{0} min', w.mins) : null, w.volume ? `${fmtNum(w.volume)} ${d.unit}` : null, t('{0} sets', w.sets)].filter(Boolean).join(' · ')}</span>
      {w.prs?.length > 0 && <span className="tr-pill good"><Icon name="trophy" />{t('PRs: {0}', w.prs.length)}</span>}
      <Icon name={open ? 'chevronUp' : 'chevronDown'} className="tr-wo-c" />
    </button>
    {open && <div className="tr-wo-b">
      {w.entries.map((e, i) => { const b = bestSet(e); return <div key={i} className="tr-line">
        <span className="tr-line-t">{exName(e.id, d.customEx)}{w.prs?.includes(String(e.id)) && <Icon name="trophy" className="tr-pr" />}</span>
        <span className="tr-line-v">{b ? isoRun(`${fmtNum(b.w)} × ${b.r}`) : '–'} <span className="muted">{t('{0} sets', e.sets.filter(s => s.done && s.phase !== 'warmup' && !s.warmup).length)}</span></span>
        {e.note && <span className="tr-note">{e.note}</span>}
      </div> })}
      {w.note && <p className="tr-note">{w.note}</p>}
    </div>}
    {mine.map(c => <div key={c.id} className="tr-comment"><Icon name="chat" /><span>{c.text}</span><span className="tr-tile-s">{c.seen ? t('Seen') : t('Sent')}</span></div>)}
    {w._by && <div className="tr-by">{t('Logged by {0}', w._by.name)}</div>}
    {w._edit && <div className="tr-by">{t('Corrected by {0}', w._edit.name)}</div>}
    {(onComment || onEdit) && <div className="tr-wo-a">
      {onComment && <Button variant="plain" size="xs" icon="chat" onClick={() => onComment(w)}>{t('Comment')}</Button>}
      {onEdit && <Button variant="plain" size="xs" icon="pencil" onClick={() => onEdit(w)}>{t('Correct')}</Button>}
    </div>}
  </div>
}

function Workouts({ d, onComment, onEdit, onLog, onMore, more, levels }) {
  const list = d.workouts?.list || []
  const log = onLog && <Button variant="tinted" icon="plus" onClick={onLog}>{levels?.workouts === 'apply' ? t('Log a workout') : t('Suggest a workout')}</Button>
  if (!list.length) return <><p className="tr-empty">{t('No workouts yet. Everyone starts somewhere.')}</p>{log}</>
  return <>
    {log}
    {list.map(w => <WorkoutCard key={w.id} w={w} d={d} comments={d.comments || []} onComment={onComment} onEdit={onEdit} />)}
    {d.workouts.next && onMore && <Button onClick={onMore} disabled={more}>{t('Show older')}</Button>}
  </>
}

function Plan({ d, onAssign, onRemove, levels }) {
  const p = d.plans
  const name = id => p.routines.find(r => r.id === id)?.name
  const order = weekOrder(p.weekStart === 0 ? 0 : 1)
  return <>
    <div className="tr-card">
      <div className="tr-card-t">{t('Week plan')}</div>
      <div className="tr-week-grid">
        {order.map(day => {
          const ids = [].concat(p.week?.[day] || [])
          return <div key={day} className={'tr-day' + (ids.length ? ' on' : '')}>
            <span className="tr-day-n">{weekdayName(day).slice(0, 3)}</span>
            <span className="tr-day-r">{ids.map(name).filter(Boolean).join(', ') || t('Rest')}</span>
          </div>
        })}
      </div>
      {p.queue && <div className="tr-tile-s">{t('Uses a queue: sessions move to the next free day.')}</div>}
    </div>
    <div className="tr-card">
      <div className="tr-card-t">{t('Routines')}</div>
      {!p.routines.length && <p className="tr-empty">{t('No routines yet.')}</p>}
      {p.routines.map(r => <div key={r.id} className="tr-line">
        <span className="tr-line-t">{r.name}{r._by && <span className="tr-badge">{t('from {0}', r._by.name)}</span>}</span>
        <span className="tr-line-v muted">{t('{0} exercises', r.ex.length)}</span>
        {onRemove && levels?.plans !== 'view' && r.origin?.kind === 'trainer' && <button className="tr-x" onClick={() => onRemove(r)} aria-label={t('Remove {0}', r.name)}><Icon name="xmark" /></button>}
      </div>)}
    </div>
    {onAssign && <Button variant="primary" icon="plus" onClick={onAssign}>{levels?.plans === 'apply' ? t('Assign a routine') : t('Suggest a routine')}</Button>}
  </>
}

function Body({ d, onWeigh, onMeasure, levels }) {
  const bw = d.bodyweight, ms = d.measurements
  return <>
    {bw && <div className="tr-card">
      <div className="tr-card-t">{t('Body weight')}</div>
      {!bw.entries.length && <p className="tr-empty">{t('No weigh-ins yet.')}</p>}
      {bw.entries.length > 1 && <Spark points={bw.entries.slice(-60)} />}
      {bw.entries.slice(-8).reverse().map(e => <div key={e.d} className="tr-line">
        <span className="tr-line-t">{fmtDate(e.d)}{e._by && <span className="tr-badge">{t('from {0}', e._by.name)}</span>}</span>
        <span className="tr-line-v">{fmtNum(e.w)} {d.unit}</span>
      </div>)}
      {onWeigh && levels?.bodyweight !== 'view' && <div className="tr-wo-a"><Button size="sm" icon="scale" onClick={onWeigh}>{levels?.bodyweight === 'apply' ? t('Log a weigh-in') : t('Suggest a weigh-in')}</Button></div>}
    </div>}
    {ms && <div className="tr-card">
      <div className="tr-card-t">{t('Body measurements')}</div>
      {!ms.entries.length && <p className="tr-empty">{t('No check-ins yet.')}</p>}
      {ms.entries.slice(-5).reverse().map(e => <div key={e.d} className="tr-line">
        <span className="tr-line-t">{fmtDate(e.d)}</span>
        <span className="tr-line-v muted">{t('{0} values', Object.keys(e).filter(k => k !== 'd' && k !== '_by' && typeof e[k] === 'number').length)}</span>
      </div>)}
      {onMeasure && levels?.measurements !== 'view' && <div className="tr-wo-a"><Button size="sm" icon="ruler" onClick={onMeasure}>{levels?.measurements === 'apply' ? t('Log a check-in') : t('Suggest a check-in')}</Button></div>}
    </div>}
  </>
}

function Notes({ d }) {
  const days = Object.entries(d.notes?.days || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  if (!days.length) return <p className="tr-empty">{t('No notes in the last 90 days.')}</p>
  return <div className="tr-card">{days.map(([day, n]) => <div key={day} className="tr-line">
    <span className="tr-line-t">{fmtDate(day)}</span><span className="tr-line-v">{n.text || n.tag}</span>
  </div>)}</div>
}

function Activity({ d }) {
  const rows = [
    ...(d.changes || []).map(c => ({ at: c.at, icon: 'pencil', text: changeLines(c.summary, d.unit).join(', '), sub: c.undoneAt ? t('Undone by them') : t('Changed directly') })),
    ...(d.suggestions || []).map(s => ({ at: s.at, icon: 'lightbulb', text: changeLines(s.summary, d.unit).join(', '),
      sub: { open: t('Waiting for an answer'), accepted: t('Taken'), declined: t('Not taken'), expired: t('Lapsed') }[s.status] || s.status })),
  ].sort((a, b) => b.at - a.at)
  if (!rows.length) return <p className="tr-empty">{t('Nothing from you yet. Assign a routine or leave a comment.')}</p>
  return <div className="tr-card">{rows.map((r, i) => <div key={i} className="tr-line">
    <span className="tr-line-t"><Icon name={r.icon} className="tr-line-i" />{r.text}</span>
    <span className="tr-line-v muted">{r.sub} · {fmtDate(new Date(r.at).toISOString().slice(0, 10))}</span>
  </div>)}</div>
}

/**
 * `d` is a projection (GET /api/trainer/member or /api/sharing/preview). The handlers are optional:
 * without them the view is read-only (the member's preview, a gym lead).
 */
export default function TrainerMember({ d, onBack, onComment, onEdit, onLog, onAssign, onWeigh, onMeasure, onRemoveRoutine, onDisconnect, onMore, more, preview = false }) {
  const shared = useMemo(() => new Set(d.shared || []), [d])
  const tabs = useMemo(() => [
    { value: 'overview', label: t('Overview') },
    shared.has('workouts') && { value: 'workouts', label: t('Workouts') },
    shared.has('plans') && { value: 'plan', label: t('Plan') },
    (shared.has('bodyweight') || shared.has('measurements')) && { value: 'body', label: t('Body') },
    shared.has('notes') && { value: 'notes', label: t('Notes') },
    !preview && { value: 'activity', label: t('You') },
  ].filter(Boolean), [shared, preview])
  const [tab, setTab] = useState('overview')
  useEffect(() => { if (!tabs.some(x => x.value === tab)) setTab('overview') }, [tabs])
  const notShared = CATEGORY_IDS.filter(c => !shared.has(c))
  const levels = d.levels || {}
  const gym = (d.grants || []).find(g => g.gym)?.gym
  return <div className="tr-detail">
    <div className="tr-dh">
      {onBack && <button className="iconbtn tr-back" onClick={onBack} aria-label={t('Back')}><Icon name="chevronLeft" /></button>}
      <Avatar id={d.member?.id} name={d.member?.name} size={52} />
      <div className="tr-dh-t">
        <h2>{d.member?.name}</h2>
        <div className="sub">{preview ? t('This is exactly what they see.') : gym ? t('At {0}', gym.name) : t('Private client')}</div>
      </div>
    </div>
    {tabs.length > 1 && <Segmented className="tr-tabs" options={tabs} value={tab} onChange={setTab} />}
    <div className="tr-pane" key={tab}>
      {tab === 'overview' && <Overview d={d} />}
      {tab === 'workouts' && <Workouts d={d} onComment={onComment} onEdit={onEdit} onLog={onLog} onMore={onMore} more={more} levels={levels} />}
      {tab === 'plan' && d.plans && <Plan d={d} onAssign={onAssign} onRemove={onRemoveRoutine} levels={levels} />}
      {tab === 'body' && <Body d={d} onWeigh={onWeigh} onMeasure={onMeasure} levels={levels} />}
      {tab === 'notes' && <Notes d={d} />}
      {tab === 'activity' && <Activity d={d} />}
      {tab === 'overview' && shared.has('nutrition') && <div className="tr-card"><div className="tr-card-t">{t('Nutrition')}</div>
        <p className="tr-empty">{d.nutrition?.status === 'ok' ? t('Linked. Numbers arrive with the next version of openNutrition.') : t('Shared, but no nutrition app is linked yet.')}</p></div>}
      {tab === 'overview' && shared.has('photos') && <TrainerPhotos photos={d.photos} memberId={preview ? null : d.member?.id} />}
    </div>
    {notShared.length > 0 && <p className="tr-foot">{t('Not shared: {0}. {1} decides.', notShared.map(categoryLabel).join(', '), d.member?.name || '')}</p>}
    {onDisconnect && <div className="tr-foot-a"><Button variant="plain" size="sm" icon="signOut" className="tr-danger" onClick={onDisconnect}>{t('Disconnect')}</Button></div>}
  </div>
}
export { TAB_CATS }
