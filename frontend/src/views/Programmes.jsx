// Plan → Programmes (#159): the list, a programme's weeks, and the running one's controls. The
// model is lib/programmes.js; this screen only ever writes through it.
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { DAYS, exerciseNameText, fmtNum, todayISO, weekOrder, weekStartOf } from '../lib/format.js'
import { confirmSheet, exportProgrammeFile } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Row, Section, Stepper, Switch } from '../components/ui.jsx'
import { effortOf, modeOf, isBw } from '../lib/history.js'
import { exOr } from '../lib/exercises.js'
import { weightIncrement } from '../lib/progression.js'
import { REST } from '../lib/rotation.js'
import { starterProgrammeOptions, buildStarterProgramme } from '../lib/starter.js'
import { exView, viewTarget, exUnitOf } from '../lib/ex-unit.js'
import {
  programmesOf, programmeById, programmeStatus, newProgramme, saveProgramme, deleteProgramme, resizeWeeks,
  stepWeek, cleanWeek, currentSchedule, startProgramme, pauseProgramme, resumeProgramme, endProgramme,
  repeatProgramme, programmeRoutineIds, pctWeight, rpeAs, cleanPct, programmeChip, MAX_WEEKS, REPEAT_BUMP,
} from '../lib/programmes.js'

// Names and blurbs as t() literals, for check-source-strings.mjs (see lib/starter.js).
const STARTER_COPY = {
  'strength-4': () => ({ name: t('Strength block, 4 weeks'), about: t('Three days on the 5×5 routines, a little heavier every week, then a light week to bounce back.') }),
  'hypertrophy-6': () => ({ name: t('Upper / lower by effort, 6 weeks'), about: t('Four days. Your progression picks the weights, the effort climbs to RPE 9, then a deload.') }),
  'linear-12': () => ({ name: t('Linear 5×5 style, 12 weeks'), about: t('Three days of plain linear progression, with a deload every fourth week.') }),
}

const RPES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10]
const rpeText = (rpe, S) => { const r = rpeAs(rpe, effortOf(S)); return `${r.k} ${fmtNum(r.v)}` }

export function weekSummary(w, S) {
  const c = cleanWeek(w)
  const parts = []
  if (c.deload) parts.push(t('Deload week'))
  if (c.rpe != null) parts.push(rpeText(c.rpe, S))
  const n = Object.values(c.t || {}).filter(x => x.pct != null).length
  if (n) parts.push(tn('{0} lift at a %1RM', '{0} lifts at a %1RM', n))
  return parts.length ? parts.join(' · ') : t('Nothing set, progression as usual')
}

function scheduleSummary(S, p) {
  const name = id => (id === REST ? t('Rest day') : (S.routines || []).find(r => r.id === id)?.name)
  if (p.sequence) return p.sequence.map(name).filter(Boolean).join(' → ')
  return weekOrder(weekStartOf(S)).filter(d => p.days?.[d]?.length)
    .map(d => `${t(DAYS[d])} ${p.days[d].map(name).filter(Boolean).join(' + ')}`).join(' · ')
}

function confirmStart(p) {
  confirmSheet({
    title: t('Start “{0}”?', p.name || t('Programme')),
    message: t('Its schedule takes over your plan until you end it. Then your plan comes back as it was.'),
    confirmText: t('Start programme'),
    onConfirm: () => {
      useStore.getState().update(s => { startProgramme(s, p.id) })
      useUI.getState().toast(t('Week 1 starts now. Have fun!'))
    },
  })
}
function confirmEnd(name) {
  confirmSheet({
    title: t('End “{0}”?', name || t('Programme')),
    message: t('Your plan from before it comes back.'),
    confirmText: t('End programme'),
    onConfirm: () => useStore.getState().update(s => { endProgramme(s) }),
  })
}

/** The running programme's card: where it stands, and what to do with it. */
function RunningCard({ S, nav }) {
  const update = useStore(s => s.update)
  const st = programmeStatus(S)
  if (!st) return null
  const p = st.programme
  return <div className="card prog-run">
    <div className="row between" style={{ gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div className="lbl2">{t('Running now')}</div>
        <div className="ttl prog-name">{p.name || t('Programme')}</div>
      </div>
      <span className="tag acc">{programmeChip(S)}</span>
    </div>
    {!st.done && <div className="prog-bar" aria-hidden="true"><span style={{ width: `${(st.week / st.weeks) * 100}%` }} /></div>}
    {!st.done && st.current && <div className="small dim" style={{ marginTop: 6 }}>{weekSummary(st.current, S)}</div>}
    {st.done ? <>
      <div className="small" style={{ margin: '8px 0' }}>{t('“{0}” is done. Nicely lifted. What next?', p.name || t('Programme'))}</div>
      <div className="prog-actions">
        <Button size="sm" variant="tinted" onClick={() => update(s => { repeatProgramme(s, todayISO(), REPEAT_BUMP) })}>{t('Again, a bit heavier')}</Button>
        <Button size="sm" variant="tinted" onClick={() => update(s => { repeatProgramme(s) })}>{t('Run it again')}</Button>
        <Button size="sm" onClick={() => update(s => { endProgramme(s) })}>{t('Back to my plan')}</Button>
      </div>
      <div className="small dim" style={{ marginTop: 6 }}>{t('Heavier means every %1RM goes up {0} points.', fmtNum(REPEAT_BUMP))}</div>
    </> : <div className="prog-actions">
      {st.paused
        ? <Button size="sm" variant="tinted" icon="play" onClick={() => update(s => { resumeProgramme(s) })}>{t('Resume')}</Button>
        : <Button size="sm" variant="tinted" icon="pause" onClick={() => update(s => { pauseProgramme(s) })}>{t('Pause')}</Button>}
      <Button size="sm" onClick={() => nav('/plan/prog/' + p.id)}>{t('Edit')}</Button>
      <Button size="sm" variant="danger" onClick={() => confirmEnd(p.name)}>{t('End programme')}</Button>
    </div>}
  </div>
}

export default function Programmes() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const list = programmesOf(S)
  const runningId = programmeStatus(S)?.programme.id

  const create = () => {
    const p = newProgramme(S, t('My programme'), 4)
    update(s => { saveProgramme(s, p) })
    nav('/plan/prog/' + p.id)
  }
  const addStarter = id => {
    const built = buildStarterProgramme(id, STARTER_COPY[id]().name)
    if (!built) return
    update(s => {
      s.routines = [...(s.routines || []), ...built.routines]
      saveProgramme(s, built.programme)
    })
    useUI.getState().toast(tn('Added with {0} new routine.', 'Added with {0} new routines.', built.routines.length))
    nav('/plan/prog/' + built.programme.id)
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px', minWidth: 0 }}><h1>{t('Programmes')}</h1>
        <div className="sub">{t('Your routines as a block of weeks, each week with its own %1RM or RPE.')}</div></div>
    </div>
    <RunningCard S={S} nav={nav} />
    <Section title={t('Your programmes')}>
      {list.length ? list.map(p => <Row key={p.id} icon="calendar" title={p.name || t('Programme')} accessory="chevron"
        subtitle={tn('{0} week', '{0} weeks', p.weeks.length) + (p.id === runningId ? ' · ' + t('running') : '')}
        onClick={() => nav('/plan/prog/' + p.id)} />)
        : <div className="empty" style={{ padding: '18px 12px' }}>{t('No programmes yet. Make one from your plan, or grab a starter below.')}</div>}
    </Section>
    <Button variant="tinted" icon="plus" onClick={create}>{t('New programme')}</Button>
    <Section title={t('Starter programmes')} footer={t('Each adds its own routines, so your plan stays as it is until you start it.')}>
      {starterProgrammeOptions().map(o => {
        const c = STARTER_COPY[o.id]()
        return <Row key={o.id} icon="clipboard" title={c.name} accessory="chevron"
          subtitle={c.about + ' ' + tn('{0} day a week', '{0} days a week', o.days)} onClick={() => addStarter(o.id)} />
      })}
    </Section>
  </div>
}

/** The exercises a programme can give a %1RM: loaded, rep-counted lifts of its routines, once each. */
function liftsOf(S, p) {
  const ids = programmeRoutineIds(S, p)
  const out = new Map()
  for (const r of S.routines || []) {
    if (!ids.includes(r.id)) continue
    for (const cfg of r.ex || []) if (!out.has(cfg.id) && modeOf(cfg) === 'reps' && !isBw(cfg)) out.set(cfg.id, cfg)
  }
  return [...out.values()]
}

function WeekSheet({ id, index, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const p = programmeById(S, id)
  if (!p || !p.weeks[index]) return null
  const w = p.weeks[index]
  const setWeek = fn => update(s => {
    const cur = programmeById(s, id)
    if (!cur) return
    const weeks = cur.weeks.slice()
    weeks[index] = cleanWeek(fn(clone(weeks[index] || {})))
    saveProgramme(s, { ...cur, weeks })
  })
  const setPct = (exId, v) => setWeek(x => {
    const tgt = { ...(x.t || {}) }
    const pct = cleanPct(v)
    if (pct == null) { const { pct: _, ...rest } = tgt[exId] || {}; tgt[exId] = rest } else tgt[exId] = { ...(tgt[exId] || {}), pct }
    return { ...x, t: tgt }
  })
  return <>
    <h3>{t('Week {0} of {1}', index + 1, p.weeks.length)}</h3>
    <div className="sect-b" style={{ marginBottom: 14 }}>
      <Row icon="chartLineSlash" iconTint="var(--orange)" title={t('Deload week')} subtitle={t('Lighter weights, and its sessions do not count toward progression.')}>
        <Switch checked={w.deload === true} onChange={v => setWeek(x => ({ ...x, deload: v }))} />
      </Row>
    </div>
    <div className="small muted" style={{ margin: '0 2px 6px' }}>{t('Effort for the week')}</div>
    <div className="chips" style={{ marginBottom: 14 }}>
      <button className={'chip' + (w.rpe == null ? ' on' : '')} onClick={() => setWeek(x => ({ ...x, rpe: null }))}>{t('None')}</button>
      {RPES.map(v => <button key={v} className={'chip' + (w.rpe === v ? ' on' : '')} onClick={() => setWeek(x => ({ ...x, rpe: v }))}>{rpeText(v, S)}</button>)}
    </div>
    <div className="small muted" style={{ margin: '0 2px 6px' }}>{t('%1RM per lift')}</div>
    <div className="sect-b prog-lifts" style={{ marginBottom: 6 }}>
      {liftsOf(S, p).map(cfg => {
        const pct = w.t?.[cfg.id]?.pct ?? null
        // Worked out and rounded in the lift's own weight unit (#657): 5 lb steps on a lb-pinned bar.
        const unit = exUnitOf(S, cfg.id)
        const est = pct != null ? pctWeight(exView(S, cfg.id), cfg.id, pct, { step: weightIncrement(viewTarget(S, cfg.id, cfg), unit) }) : null
        return <div key={cfg.id} className="lrow prog-lift">
          <span className="lrow-m"><span className="lrow-t">{exerciseNameText(exOr(cfg.id))}</span>
            {pct != null && <span className="lrow-s">{est != null ? t('about {0}', fmtNum(est) + ' ' + unit) : t('Log a set first to work this out')}</span>}</span>
          <PctField pct={pct} onChange={v => setPct(cfg.id, v)} label={t('%1RM for {0}', exerciseNameText(exOr(cfg.id)))} />
        </div>
      })}
    </div>
    <div className="small dim" style={{ margin: '0 2px 14px' }}>{t('Empty leaves the weight to your progression. A %1RM is worked out from your best estimated 1RM.')}</div>
    {index > 0 && <Button variant="tinted" icon="copy" onClick={() => setWeek(() => stepWeek(p.weeks[index - 1]))}>{t('Same as last week, a bit heavier')}</Button>}
    <Button variant="primary" onClick={close} style={{ marginTop: 8 }}>{t('Done')}</Button>
  </>
}
const clone = v => JSON.parse(JSON.stringify(v))

// A %1RM typed digit by digit: "7" on the way to "75" is no target yet, and saving it would clear
// the field under the finger. Saved once it is one (30 to 110), cleared on leaving it otherwise.
function PctField({ pct, onChange, label }) {
  const [v, setV] = useState(pct)
  return <span className="prog-pct" onBlur={() => { if (cleanPct(v) == null) { setV(null); if (pct != null) onChange(null) } }}>
    <NumberField nullable value={v} aria-label={label}
      onChange={n => { setV(n); if (cleanPct(n) != null) onChange(n) }} /><i>%</i>
  </span>
}
const weekSheet = (id, index) => useUI.getState().openSheet(close => <WeekSheet id={id} index={index} close={close} />)

export function ProgrammeEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const p = programmeById(S, id)
  if (!p) return <div className="narrow"><div className="hdr">
    <button className="iconbtn" data-back="/plan/programmes" onClick={() => nav('/plan/programmes')} aria-label={t('Programmes')}><Icon name="chevronLeft" /></button>
  </div><div className="empty">{t('This programme is gone.')}</div></div>
  const st = programmeStatus(S)
  const running = st?.programme.id === id
  const edit = fn => update(s => { const cur = programmeById(s, id); if (cur) saveProgramme(s, fn(cur)) })
  const summary = scheduleSummary(S, p)
  const remove = () => confirmSheet({
    title: t('Delete “{0}”?', p.name || t('Programme')),
    message: running ? t('It is running: ending it brings your plan back. Its routines stay.') : t('Its routines stay.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { deleteProgramme(s, id) }); nav('/plan/programmes') },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/plan/programmes" onClick={() => nav('/plan/programmes')} aria-label={t('Programmes')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px', minWidth: 0 }}>
        <input className="input" defaultValue={p.name} aria-label={t('Name')} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em', width: '100%' }}
          onChange={e => { const v = e.target.value.trim(); edit(cur => ({ ...cur, name: v || t('Programme') })) }} />
      </div>
    </div>
    {running && <RunningCard S={S} nav={nav} />}
    <div className="sect-b" style={{ marginBottom: 16 }}>
      <div className="lrow prog-weeks">
        <span className="lrow-m"><span className="lrow-t">{t('Weeks')}</span></span>
        <Stepper value={p.weeks.length} min={1} max={MAX_WEEKS} decimal={false} ariaLabel={t('Weeks')}
          onChange={n => edit(cur => ({ ...cur, weeks: resizeWeeks(cur.weeks, n) }))} />
      </div>
      <Row icon={p.sequence ? 'swap' : 'calendar'} title={p.sequence ? t('Rotation') : t('Schedule')}
        subtitle={summary || t('No schedule yet. Put routines on your week or in a loop in Plan, then take it over here.')} />
      <Row icon="download" title={t('Use my current plan')} subtitle={t('The schedule in your plan right now becomes this programme’s.')}
        onClick={() => edit(cur => { const { days, sequence, ...rest } = cur; return { ...rest, ...currentSchedule(S) } })} />
    </div>
    <Section title={t('Weeks')} footer={t('The week is the calendar week: week 1 is the one you start in. A pause holds it.')}>
      {p.weeks.map((w, i) => <Row key={i} title={t('Week {0}', i + 1)} subtitle={weekSummary(w, S)} accessory="chevron"
        icon={w.deload ? 'chartLineSlash' : 'chartLine'} iconTint={w.deload ? 'var(--orange)' : undefined}
        className={running && st.week === i + 1 && !st.done ? 'prog-now' : ''} onClick={() => weekSheet(id, i)} />)}
    </Section>
    <div className="prog-actions col">
      {!running && <Button variant="primary" icon="play" disabled={!summary} onClick={() => confirmStart(p)}>{t('Start programme')}</Button>}
      <Button variant="tinted" icon="share" onClick={() => exportProgrammeFile(id)}>{t('Share programme')}</Button>
      <Button variant="danger" icon="trash" onClick={remove}>{t('Delete programme')}</Button>
    </div>
  </div>
}
