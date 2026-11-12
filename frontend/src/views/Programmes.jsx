// Plan → Programmes (#159): the list, a programme's weeks, and the running one's controls. The
// model is lib/programmes.js; this screen only ever writes through it. Its weeks are still edited
// as %1RM and RPE per lift, through the bridge (legacyWeeksOf / setLegacyWeek) that writes only
// those numbers into the engine definition, until the programme editor replaces this screen.
import { useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { DAYN, DAYS, exerciseNameText, fmtNum, todayISO, weekOrder, weekStartOf } from '../lib/format.js'
import { confirmSheet, exportProgrammeFile, menuSheet, referenceSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { Button, NumberField, Row, Section, Segmented, Stepper, Switch, openSelectSheet } from '../components/ui.jsx'
import { effortOf, modeOf, isBw } from '../lib/history.js'
import { exOr } from '../lib/exercises.js'
import { planPhase, operatorFor } from '../lib/prescription/index.js'
import { weightIncrement } from '../lib/exercises.js'
import { REST } from '../lib/rotation.js'
import { starterProgrammeOptions, buildStarterProgramme } from '../lib/starter.js'
import { exView, viewTarget, exUnitOf } from '../lib/ex-unit.js'
import {
  programmesOf, programmeById, programmeView, newProgramme, saveProgramme, deleteProgramme, resizeWeeks,
  stepWeek, cleanWeek, currentSchedule, startProgramme, pauseProgramme, resumeProgramme, endProgramme,
  repeatProgramme, programmeRoutineIds, pctWeight, rpeAs, cleanPct, programmeChip, MAX_WEEKS, REPEAT_BUMP,
  legacyWeeksOf, setLegacyWeek, setLegacyWeeks, fixedOf, liftPcts, missingFor, firstWeekOf, bindProgramme, startReferences, openSessions,
  stageNumber, closeWeek, resolveSlot, runChoices, setRunPolicy, setRunEnd, referenceOffers, refText,
} from '../lib/programmes.js'

// Names and blurbs as t() literals, for check-source-strings.mjs (see lib/starter.js).
const STARTER_COPY = {
  'strength-4': () => ({ name: t('Strength block, 4 weeks'), about: t('Three days on the 5×5 routines, a little heavier every week, then a light week to bounce back.') }),
  'hypertrophy-6': () => ({ name: t('Upper / lower by effort, 6 weeks'), about: t('Four days. Your progression picks the weights, the effort climbs to RPE 9, then a deload.') }),
  'linear-12': () => ({ name: t('Linear 5×5 style, 12 weeks'), about: t('Three days of plain linear progression, with a deload every fourth week.') }),
}

const RPES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10]
const rpeText = (rpe, S) => { const r = rpeAs(rpe, effortOf(S)); return `${r.k} ${fmtNum(r.v)}` }

// `fixed`: what the week fixes beyond a %1RM (lib/programmes.js fixedOf), which this screen keeps but does not edit.
export function weekSummary(w, S, fixed = []) {
  const c = cleanWeek(w)
  const parts = []
  if (c.deload) parts.push(t('Deload week'))
  if (c.rpe != null) parts.push(rpeText(c.rpe, S))
  const n = Object.values(c.t || {}).filter(x => x.pct != null).length
  if (n) parts.push(tn('{0} lift at a %1RM', '{0} lifts at a %1RM', n))
  if (fixed.length) parts.push(t('fixed at {0}', fixed.join(', ')))
  return parts.length ? parts.join(' · ') : t('Nothing set, progression as usual')
}

// A loop as the plan wrote it: a rotation, or a legacy loop kept (in `src`) until it is bound to weeks.
const loopOf = p => (p.schedule.mode === 'rotation' ? p.schedule.sequence : Array.isArray(p.src?.sequence) ? p.src.sequence : null)
function scheduleSummary(S, p) {
  const name = id => (id === REST ? t('Rest day') : (S.routines || []).find(r => r.id === id)?.name)
  if (loopOf(p)) return loopOf(p).map(name).filter(Boolean).join(' → ')
  const days = {}
  for (const a of p.schedule.appts || []) if (a.day != null) (days[a.day] ||= []).push(a.rid)
  return weekOrder(weekStartOf(S)).filter(d => days[d]?.length)
    .map(d => `${t(DAYS[d])} ${days[d].map(name).filter(Boolean).join(' + ')}`).join(' · ')
}
const exName = id => exerciseNameText(exOr(id))
// "Monday’s Push": an appointment by its preferred day, else by its routine alone.
const apptLabel = (S, a) => {
  const name = (S.routines || []).find(r => r.id === a?.rid)?.name || ''
  return a?.day != null ? t('{0}’s {1}', t(DAYN[a.day]), name) : name
}
const apptsOf = def => (def.schedule.mode === 'weeks' ? def.schedule.appts : def.schedule.sequence.map(rid => ({ rid })))
const POLICY = () => [{ value: 'advance', label: t('Move on') }, { value: 'repeat', label: t('Repeat it') }]
// What a start (or a repeat) still waits for, in the words the activation sheet uses for it.
const missingText = (m, rounds) => ({
  policy: t('Choose both answers for every exercise.'),
  end: rounds ? t('Choose what happens when the rounds run out.') : t('Choose what happens when the weeks run out.'),
  'effort-off': t('Turn on effort per set in Settings'),
  binding: t('Choose how to count the weeks for this rotation'),
  repair: t('Fix in the editor'),
})[m]
const tryWord = n => (n === 2 ? t('second try') : n === 3 ? t('third try') : t('try {0}', n))

/**
 * Both advance/repeat answers for every exercise (spec 8.1), none chosen until chosen, with a row on
 * top that sets every exercise at once and stays there. `policies` is `{ [trackId]: Policy }`.
 */
function PolicyRows({ def, policies, setPolicies }) {
  const uid = useId()
  const rounds = def.schedule.mode === 'rotation'
  const ids = def.tracks.map(tr => tr.id)
  const common = k => { const v = ids.map(id => policies[id]?.[k]); return v.length && v.every(x => x && x === v[0]) ? v[0] : null }
  const set = (which, k, v) => setPolicies(p => ({ ...p, ...Object.fromEntries(which.map(id => [id, { ...p[id], [k]: v }])) }))
  const rows = (key, which, value) => [['onFailure', rounds ? t('After a missed round') : t('After a missed week')], ['onSkipped', rounds ? t('After a skipped round') : t('After a skipped week')]]
    .map(([k, label]) => <Row key={k} title={<span id={`${uid}${key}${k}`}>{label}</span>}>
      <Segmented className="seg-inline" options={POLICY()} value={value(k)} onChange={v => set(which, k, v)} ariaLabelledby={`${uid}${key} ${uid}${key}${k}`} />
    </Row>)
  return <>
    <Section title={<span id={`${uid}all`}>{t('For every exercise')}</span>}>{rows('all', ids, common)}</Section>
    {def.tracks.map((tr, i) => <Section key={tr.id} title={<span id={`${uid}${i}`}>{exName(tr.exerciseId)}</span>}>{rows(String(i), [tr.id], k => policies[tr.id]?.[k] ?? null)}</Section>)}
  </>
}

// A choice with long answers: a row that opens the app's picker, the answer chosen shown under its
// title where it wraps (a segmented control or a row value cannot hold these answers on a phone).
function PickRow({ title, value, options, onChange }) {
  return <Row title={title} subtitle={options.find(o => o.value === value)?.label} accessory="chevron"
    onClick={() => openSelectSheet({ title, value, options, onChange })} />
}

/** Stop at the last week, or keep going until every goal is reached (spec 8.5); the Config default marked, not chosen. */
function EndRow({ S, rounds, end, setEnd }) {
  const mine = S.programmeEnd === 'extend' ? 'extend' : 'stop'
  const mark = v => (v === mine ? { subtitle: t('(your default)') } : {})
  return <PickRow title={rounds ? t('When the rounds run out') : t('When the weeks run out')} value={end} onChange={setEnd}
    options={[{ value: 'stop', label: t('Stop'), ...mark('stop') }, { value: 'extend', label: t('Keep going until every goal is reached'), ...mark('extend') }]} />
}

/**
 * The activation sheet (spec 8.1, 8.5, 7.2, 10.1, 11): every choice the start needs, nothing
 * preselected; what this first week owes, with the earlier appointments to add back; the 1RM each
 * %1RM lift keeps. Start stays disabled while anything is missing, and the line under it says what.
 */
function StartSheet({ id, close, nav }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const missId = useId()
  const [policies, setPolicies] = useState({})
  const [end, setEnd] = useState(null)
  const [bind, setBind] = useState(null)
  const [also, setAlso] = useState([])
  const p = programmeById(S, id)
  if (!p) return null
  const binding = !!p.needs?.includes('binding')
  const def = binding && bind ? bindProgramme(p, bind) : p
  const rounds = def.schedule.mode === 'rotation'
  const today = todayISO()
  const owed = firstWeekOf(S, def, today)
  const earlier = owed ? def.schedule.appts.map((a, i) => i).filter(i => !owed.includes(i)) : []
  const missing = missingFor(S, def, policies, end)
  const refs = startReferences(S, def)
  const go = () => {
    let res = null
    update(s => {
      if (binding && bind && programmeById(s, id)?.needs?.includes('binding')) saveProgramme(s, bindProgramme(programmeById(s, id), bind))
      res = startProgramme(s, id, { policies, end, today, ...(earlier.length ? { firstWeek: [...owed, ...also].sort((a, b) => a - b) } : {}) })
    })
    // Refused (something changed under the sheet): it stays open, and its line says what is missing.
    if (!res?.ok) return
    close()
    useUI.getState().toast(rounds ? t('Round 1 starts now. Have fun!') : t('Week 1 starts now. Have fun!'))
  }
  return <>
    <h3>{t('Start “{0}”?', p.name || t('Programme'))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Its schedule takes over your plan until you end it. Then your plan comes back as it was.')}</div>
    {(binding || missing.includes('effort-off') || missing.includes('repair')) && <Section>
      {missing.includes('effort-off') && <Row icon="gauge" iconTint="var(--purple)" title={missingText('effort-off')} accessory="chevron" onClick={() => { close(); nav('/settings/workout') }} />}
      {binding && <PickRow title={missingText('binding')} value={bind} onChange={setBind}
        options={[{ value: 'weeks', label: t('One round a week') }, { value: 'rounds', label: t('By rounds, any days') }]} />}
      {missing.includes('repair') && <Row icon="wrench" iconTint="var(--orange)" title={missingText('repair')} accessory="chevron" onClick={() => { close(); nav('/plan/prog/' + id) }} />}
    </Section>}
    <PolicyRows def={def} policies={policies} setPolicies={setPolicies} />
    <Section><EndRow S={S} rounds={rounds} end={end} setEnd={setEnd} /></Section>
    {earlier.length > 0 && <Section>
      <Row icon="calendar" title={owed.length ? t('This week: {0}', owed.map(i => apptLabel(S, def.schedule.appts[i])).join(', ')) : t('Nothing is left this week.')} />
      {earlier.map(i => { const label = t('Also do {0} this week', apptLabel(S, def.schedule.appts[i])); return <Row key={i} title={label}>
        <Switch aria-label={label} checked={also.includes(i)} onChange={v => setAlso(x => (v ? [...x, i] : x.filter(y => y !== i)))} />
      </Row> })}
    </Section>}
    {refs.length > 0 && <Section title={t('The 1RM each lift keeps')}>
      {refs.map(r => <Row key={r.exerciseId} title={exName(r.exerciseId)} subtitle={r.ref ? refText(r.ref) : t('No 1RM yet: your first session asks for one')} />)}
    </Section>}
    {!rounds && <div className="small dim" style={{ margin: '0 2px 6px' }}>{t('Sessions can move to another day of the same week')}</div>}
    {(rounds || def.schedule.ordered === true) && <div className="small dim" style={{ margin: '0 2px 6px' }}>{t('Skipping ahead counts the sessions in between as skipped')}</div>}
    <Button variant="primary" icon="play" disabled={missing.length > 0} aria-describedby={missing.length ? missId : undefined} onClick={go} style={{ marginTop: 8 }}>{t('Start programme')}</Button>
    {missing.length > 0 && <div id={missId} className="small dim" role="status" style={{ margin: '6px 2px 0' }}>{missing.map(m => <div key={m}>{missingText(m, rounds)}</div>)}</div>}
  </>
}
const startSheet = (id, nav) => useUI.getState().openSheet(close => <StartSheet id={id} close={close} nav={nav} />)

/** The running programme's choices, changed from its next week on (spec 8.1, 8.5): its own events, never the start's. */
function ChoicesSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [now] = useState(() => runChoices(S))
  const [policies, setPolicies] = useState(() => now?.policies || {})
  const [end, setEnd] = useState(() => now?.end ?? null)
  if (!now) return null
  const save = () => {
    update(s => {
      for (const [id, pol] of Object.entries(policies)) if (pol?.onFailure && pol.onSkipped && JSON.stringify(pol) !== JSON.stringify(now.policies[id])) setRunPolicy(s, id, pol)
      if (end !== now.end) setRunEnd(s, end)
    })
    close()
  }
  return <>
    <h3>{t('Choices')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{now.def.schedule.mode === 'rotation' ? t('They count from the next round you have not started.') : t('They count from the next week you have not started.')}</div>
    <PolicyRows def={now.def} policies={policies} setPolicies={setPolicies} />
    <Section><EndRow S={S} rounds={now.def.schedule.mode === 'rotation'} end={end} setEnd={setEnd} /></Section>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

// Ending asks whether the weights reached go into your routines (endProgramme keepReached).
function confirmEnd(name) {
  const end = keepReached => useStore.getState().update(s => { endProgramme(s, todayISO(), Date.now(), { keepReached }) })
  menuSheet({
    title: t('End “{0}”?', name || t('Programme')),
    subtitle: t('Your plan from before it comes back.') + ' ' + t('Keep the weights you reached in your routines?'),
    sections: [
      { items: [
        { icon: 'check', danger: true, label: t('Keep the weights'), onClick: () => end(true) },
        { icon: 'reset', danger: true, label: t('Leave my routines as they were'), onClick: () => end(false) },
      ] },
      { items: [{ icon: 'xmark', label: t('Cancel'), onClick: () => {} }] },
    ],
  })
}

/** One exercise of the running programme: where it is, or what it waits for. */
function TrackLine({ S, v, id, tv }) {
  const update = useStore(s => s.update)
  const rounds = v.def.schedule.mode === 'rotation'
  const unknown = tv.state === 'held' ? tv.slots.filter(sl => sl.outcome === 'unknown') : []
  const who = sl => { const a = apptsOf(v.def)[sl.appt]; return a?.day != null ? t(DAYN[a.day]) : (S.routines || []).find(r => r.id === sl.rid)?.name || '' }
  const n = stageNumber(tv.def, id, tv.stage)
  const where = rounds ? t('Training round {0}', n) : t('Training week {0}', n)
  const line = ['maintenance', 'achieved'].includes(tv.state) ? t('Reached its goal, kept steady')
    : tv.state === 'blocked' ? t('Needs a fix in the editor')
    : unknown.length ? (unknown[0].reasons.includes('missing_effort') ? t('Waiting for effort on {0}’s set', who(unknown[0])) : t('Waiting for {0}’s numbers', who(unknown[0])))
    : tv.attempt > 1 ? where + ' · ' + tryWord(tv.attempt) : where
  const ex = tv.def?.tracks.find(tr => tr.id === id)?.exerciseId
  return <div className="row between" style={{ gap: 8, marginTop: 6 }}>
    <span className="small" style={{ minWidth: 0 }}><span className="capitalize">{exName(ex)}</span> · <span className="dim">{line}</span></span>
    {unknown.length > 0 && <Button size="sm" variant="tinted" aria-label={`${t('Count it as missed')}, ${exName(ex)}`} onClick={() => update(s => { for (const sl of unknown) resolveSlot(s, sl.id, 'failed') })}>{t('Count it as missed')}</Button>}
  </div>
}

/** The running programme's card: where it and each exercise stand, what is still open, and what to do with it. */
function RunningCard({ S, nav }) {
  const update = useStore(s => s.update)
  const v = programmeView(S)
  if (!v) return null
  const p = programmeById(S, v.run.programmeId) || v.def
  const rounds = v.nominal.unit === 'blocks'
  const done = ['stopped', 'complete', 'ended'].includes(v.status)
  const week = Math.min(v.nominal.used + 1, v.nominal.of)
  const tracks = Object.entries(v.tracks).filter(([, tv]) => tv.state !== 'removed')
  const open = done || v.status === 'paused' ? [] : openSessions(v)
  const labels = open.map(a => apptLabel(S, a)).join(', ')
  const unreached = tracks.filter(([, tv]) => !['achieved', 'maintenance'].includes(tv.state)).map(([id, tv]) => tv.def?.tracks.find(tr => tr.id === id)?.exerciseId)
  const close = () => confirmSheet({
    title: rounds ? t('Close this round?') : t('Close this week?'),
    message: t('These count as skipped: {0}', labels),
    confirmText: rounds ? t('Close this round') : t('Close this week'),
    onConfirm: () => update(s => { closeWeek(s) }),
  })
  const choices = () => useUI.getState().openSheet(c => <ChoicesSheet close={c} />)
  // A repeat that cannot start says why, as the start would.
  const again = bump => {
    let res = null
    update(s => { res = repeatProgramme(s, todayISO(), bump) })
    if (!res?.ok) useUI.getState().toast(t('Not yet: {0}', missingText(res.missing[0], rounds)))
  }
  return <div className="card prog-run">
    <div className="row between" style={{ gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div className="lbl2">{t('Running now')}</div>
        <div className="ttl prog-name">{p.name || t('Programme')}</div>
      </div>
      <span className="tag acc">{programmeChip(S)}</span>
    </div>
    {!done && <div className="prog-bar" aria-hidden="true"><span style={{ width: `${(week / v.nominal.of) * 100}%` }} /></div>}
    {!done && tracks.map(([id, tv]) => <TrackLine key={id} S={S} v={v} id={id} tv={tv} />)}
    {open.length > 0 && <div className="small dim" style={{ marginTop: 8 }}>{rounds ? t('Still open this round: {0}', labels) : t('Still open this week: {0}', labels)}</div>}
    {done ? <>
      <div className="small" style={{ margin: '8px 0' }}>{v.status === 'stopped'
        ? [rounds ? t('Stopped after round {0}.', v.nominal.used) : t('Stopped after week {0}.', v.nominal.used), ...unreached.map(ex => t('{0} did not reach its goal.', exName(ex)))].join(' ')
        : v.status === 'complete' ? t('Every goal reached.') : t('“{0}” is done. Nicely lifted. What next?', p.name || t('Programme'))}</div>
      <div className="prog-actions">
        <Button size="sm" variant="tinted" onClick={() => again(REPEAT_BUMP)}>{t('Again, a bit heavier')}</Button>
        <Button size="sm" variant="tinted" onClick={() => again(0)}>{t('Run it again')}</Button>
        {/* Where an answer a repeat needs is given (an exercise added since). */}
        <Button size="sm" onClick={choices}>{t('Choices')}</Button>
        <Button size="sm" onClick={() => confirmEnd(p.name)}>{t('Back to my plan')}</Button>
      </div>
      <div className="small dim" style={{ marginTop: 6 }}>{t('Heavier means every %1RM goes up {0} points.', fmtNum(REPEAT_BUMP))}</div>
    </> : <div className="prog-actions">
      {v.status === 'paused'
        ? <Button size="sm" variant="tinted" icon="play" onClick={() => update(s => { resumeProgramme(s) })}>{t('Resume')}</Button>
        : <Button size="sm" variant="tinted" icon="pause" onClick={() => update(s => { pauseProgramme(s) })}>{t('Pause')}</Button>}
      {open.length > 0 && <Button size="sm" onClick={close}>{rounds ? t('Close this round') : t('Close this week')}</Button>}
      <Button size="sm" onClick={choices}>{t('Choices')}</Button>
      <Button size="sm" onClick={() => nav('/plan/prog/' + p.id)}>{t('Edit')}</Button>
      <Button size="sm" variant="danger" onClick={() => confirmEnd(p.name)}>{t('End programme')}</Button>
    </div>}
  </div>
}

/**
 * What the programme-model upgrade did (S.contractNotice, once, until dismissed): the choices a
 * running programme kept, what waits on you, and the 1RM each %1RM lift now keeps (spec 15.2, 15.3).
 */
function AdoptionNotice({ S }) {
  const dismiss = useStore(s => s.dismissContractNotice)
  const items = Array.isArray(S.contractNotice) ? S.contractNotice : []
  if (!items.length) return null
  const name = pid => programmeById(S, pid)?.name || t('Programme')
  const once = (kind, key) => [...new Map(items.filter(i => i.kind === kind).map(i => [i[key], i])).values()]
  const lines = [
    ...(items.some(i => i.kind === 'legacy-choices') ? [t('Your running programme moves on each week as before; choose differently any time')] : []),
    ...(items.some(i => i.kind === 'credit') ? [t('Sessions you did this week count toward it.')] : []),
    ...once('binding', 'programmeId').map(i => t('“{0}” needs you to choose how to count its weeks.', name(i.programmeId))),
    ...once('repair', 'programmeId').map(i => t('“{0}” needs a fix in the editor before it can start.', name(i.programmeId))),
  ]
  const refs = [...new Map(items.filter(i => i.kind === 'reference' || i.kind === 'reference-missing').map(i => [i.exerciseId, i])).values()]
  return <div className="card prog-run">
    <div className="ttl prog-name">{t('Your programmes were updated')}</div>
    {lines.map((l, i) => <div key={i} className="small" style={{ marginTop: 6 }}>{l}</div>)}
    {refs.length > 0 && <>
      <div className="small muted" style={{ marginTop: 10 }}>{t('The 1RM each lift keeps')}</div>
      {refs.map(i => <div key={i.exerciseId} className="small dim" style={{ marginTop: 4 }}>{i.ref ? `${exName(i.exerciseId)}: ${refText(i.ref)}` : t('{0} has no 1RM yet; its first session asks for one.', exName(i.exerciseId))}</div>)}
    </>}
    <div className="prog-actions"><Button size="sm" variant="tinted" onClick={dismiss}>{t('Got it')}</Button></div>
  </div>
}

export default function Programmes() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const list = programmesOf(S)
  const runningId = programmeView(S)?.run.programmeId
  const offers = referenceOffers(S)

  const create = () => {
    const p = newProgramme(S, t('My programme'), 4)
    update(s => { saveProgramme(s, p) })
    nav('/plan/prog/' + p.id)
  }
  const addStarter = id => {
    const built = buildStarterProgramme(id, STARTER_COPY[id]().name, Date.now(), S.weekStart === 0 ? 0 : 1)
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
    <AdoptionNotice S={S} />
    <RunningCard S={S} nav={nav} />
    {/* A newer 1RM a routine or this programme could take (sheets.jsx referenceSheet), listed while it is offered. */}
    {offers.length > 0 && <Section>
      {offers.map(o => <Row key={o.exerciseId + o.candidateId} icon="chartLine" iconTint="var(--teal)" title={t('New 1RM for {0}', exName(o.exerciseId))}
        subtitle={t('Update future sessions?')} accessory="chevron" onClick={() => referenceSheet(o)} />)}
    </Section>}
    <Section title={t('Your programmes')}>
      {list.length ? list.map(p => <Row key={p.id} icon="calendar" title={p.name || t('Programme')} accessory="chevron"
        subtitle={tn('{0} week', '{0} weeks', p.duration.n) + (p.id === runningId ? ' · ' + t('running') : '')}
        onClick={() => nav('/plan/prog/' + p.id)} />)
        : <EmptyState className="in-sect" text={t('No programmes yet. Make one from your plan, or grab a starter below.')}>
          <Button variant="tinted" icon="plus" onClick={create}>{t('New programme')}</Button>
        </EmptyState>}
    </Section>
    {list.length > 0 && <Button variant="tinted" icon="plus" onClick={create}>{t('New programme')}</Button>}
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
    for (const occurrence of r.ex || []) {
      const id = occurrence.exerciseId || occurrence.id
      const phase = occurrence.rule && planPhase(occurrence.rule)
      const step = phase && operatorFor(phase, 'load')?.step
      const cfg = { ...occurrence, id, ...(step?.type === 'absolute' ? { inc: step.value } : {}) }
      if (!out.has(id) && !phase?.parameters.durationSeconds && modeOf(cfg) === 'reps' && !isBw(cfg)) out.set(id, cfg)
    }
  }
  return [...out.values()]
}

function WeekSheet({ id, index, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const p = programmeById(S, id)
  const weeks = p ? legacyWeeksOf(p) : []
  if (!p || !weeks[index]) return null
  const w = weeks[index]
  const setWeek = fn => update(s => {
    const cur = programmeById(s, id)
    if (!cur) return
    saveProgramme(s, setLegacyWeek(cur, index, cleanWeek(fn(clone(legacyWeeksOf(cur)[index] || {}))), s))
  })
  // A lift's %1RM is the same in every routine it is in. A routine's own entry ("A:0025", the Coach
  // can set one) is read whole, so it takes the typed value too (its own RPE kept), or loses its own.
  const ofLift = (k, exId) => k === exId || k.endsWith(':' + exId)
  const setPct = (exId, v) => setWeek(x => {
    const pct = cleanPct(v)
    const tgt = Object.fromEntries(Object.entries(x.t || {}).map(([k, y]) => {
      if (!ofLift(k, exId)) return [k, y]
      const { pct: _, ...rest } = y
      return [k, pct != null ? { ...rest, pct } : rest]
    }))
    if (pct != null) tgt[exId] = { ...(tgt[exId] || {}), pct }
    return { ...x, t: tgt }
  })
  // The week's effort is for every lift: a lift's own RPE goes. A week whose lifts differ shows no choice.
  const setRpe = v => setWeek(x => ({ ...x, rpe: v, t: Object.fromEntries(Object.entries(x.t || {}).map(([k, { rpe: _, ...rest }]) => [k, rest])) }))
  const mixed = Object.values(w.t || {}).some(x => x.rpe != null)
  return <>
    <h3>{t('Week {0} of {1}', index + 1, weeks.length)}</h3>
    <div className="sect-b" style={{ marginBottom: 14 }}>
      <Row icon="chartLineSlash" iconTint="var(--orange)" title={t('Deload week')} subtitle={t('Lighter weights, and its sessions do not count toward progression.')}>
        <Switch checked={w.deload === true} onChange={v => setWeek(x => ({ ...x, deload: v }))} />
      </Row>
    </div>
    <div className="small muted" style={{ margin: '0 2px 6px' }}>{t('Effort for the week')}</div>
    <div className="chips" style={{ marginBottom: 14 }}>
      <button className={'chip' + (w.rpe == null && !mixed ? ' on' : '')} onClick={() => setRpe(null)}>{t('None')}</button>
      {RPES.map(v => <button key={v} className={'chip' + (w.rpe === v && !mixed ? ' on' : '')} onClick={() => setRpe(v)}>{rpeText(v, S)}</button>)}
    </div>
    <div className="small muted" style={{ margin: '0 2px 6px' }}>{t('%1RM per lift')}</div>
    <div className="sect-b prog-lifts" style={{ marginBottom: 6 }}>
      {liftsOf(S, p).map(cfg => {
        // The lift's %1RM in each routine it is in: one shows in the field; different ones are listed, as
        // the Coach's card says them, until one is typed for every routine.
        const cells = [...new Set(liftPcts(p, w, cfg.id))]
        const pct = cells.length > 1 ? null : cells.length ? cells[0] : w.t?.[cfg.id]?.pct ?? null
        // Worked out and rounded in the lift's own weight unit (#657): 5 lb steps on a lb-pinned bar.
        const unit = exUnitOf(S, cfg.id)
        const est = pct != null ? pctWeight(exView(S, cfg.id), cfg.id, pct, { step: weightIncrement(viewTarget(S, cfg.id, cfg), unit) }) : null
        const fixed = pct == null ? fixedOf(p, index, cfg.id) : []
        const each = cells.length > 1 ? cells.filter(v => v != null) : []
        return <div key={cfg.id} className="lrow prog-lift">
          <span className="lrow-m"><span className="lrow-t">{exerciseNameText(exOr(cfg.id))}</span>
            {pct != null && <span className="lrow-s">{est != null ? t('about {0}', fmtNum(est) + ' ' + unit) : t('Log a set first to work this out')}</span>}
            {fixed.length > 0 && <span className="lrow-s">{t('fixed at {0}', fixed.join(', '))}</span>}
            {each.length > 0 && <span className="lrow-s">{t('fixed at {0}', each.map(v => fmtNum(v) + '%').join(', '))}</span>}</span>
          <PctField pct={pct} onChange={v => setPct(cfg.id, v)} label={t('%1RM for {0}', exerciseNameText(exOr(cfg.id)))} />
        </div>
      })}
    </div>
    <div className="small dim" style={{ margin: '0 2px 14px' }}>{t('Empty leaves the weight to your progression. A %1RM is worked out from your best estimated 1RM.')}</div>
    {index > 0 && <Button variant="tinted" icon="copy" onClick={() => setWeek(() => stepWeek(weeks[index - 1]))}>{t('Same as last week, a bit heavier')}</Button>}
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
  const view = programmeView(S)
  const running = view?.run.programmeId === id
  const nowWeek = view && !['stopped', 'complete', 'ended'].includes(view.status) ? Math.min(view.nominal.used + 1, view.nominal.of) : null
  const weeks = legacyWeeksOf(p)
  // A running programme keeps how it counts its weeks (saveProgramme refuses, and nothing is saved).
  const edit = fn => {
    try { update(s => { const cur = programmeById(s, id); if (cur) saveProgramme(s, fn(cur, s)) }) }
    catch (e) { if (e?.message !== 'running programme') throw e; useUI.getState().toast(t('Stop this programme before changing how it counts the weeks.')) }
  }
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
        <input className="input" defaultValue={p.name} aria-label={t('Name')} style={{ fontWeight: 600, fontSize: 'var(--fs-title3)', letterSpacing: '-.021em', width: '100%' }}
          onChange={e => { const v = e.target.value.trim(); edit(cur => ({ ...cur, name: v || t('Programme') })) }} />
      </div>
    </div>
    {running && <RunningCard S={S} nav={nav} />}
    <div className="sect-b" style={{ marginBottom: 16 }}>
      <div className="lrow prog-weeks">
        <span className="lrow-m"><span className="lrow-t">{t('Weeks')}</span></span>
        <Stepper value={weeks.length} min={1} max={MAX_WEEKS} decimal={false} ariaLabel={t('Weeks')}
          onChange={n => edit((cur, s) => setLegacyWeeks(cur, resizeWeeks(legacyWeeksOf(cur), n), s))} />
      </div>
      <Row icon={loopOf(p) ? 'swap' : 'calendar'} title={loopOf(p) ? t('Rotation') : t('Schedule')}
        subtitle={summary || t('No schedule yet. Put routines on your week or in a loop in Plan, then take it over here.')} />
      <Row icon="download" title={t('Use my current plan')} subtitle={t('The schedule in your plan right now becomes this programme’s.')}
        onClick={() => edit((cur, s) => setLegacyWeeks(cur, legacyWeeksOf(cur), s, currentSchedule(s)))} />
    </div>
    <Section title={t('Weeks')} footer={t('The week is the calendar week: week 1 is the one you start in. A pause holds it.')}>
      {weeks.map((w, i) => <Row key={i} title={t('Week {0}', i + 1)} subtitle={weekSummary(w, S, fixedOf(p, i))} accessory="chevron"
        icon={w.deload ? 'chartLineSlash' : 'chartLine'} iconTint={w.deload ? 'var(--orange)' : undefined}
        className={running && nowWeek === i + 1 ? 'prog-now' : ''} onClick={() => weekSheet(id, i)} />)}
    </Section>
    <div className="prog-actions col">
      {!running && <Button variant="primary" icon="play" disabled={!summary} onClick={() => startSheet(id, nav)}>{t('Start programme')}</Button>}
      <Button variant="tinted" icon="share" onClick={() => exportProgrammeFile(id)}>{t('Share programme')}</Button>
      <Button variant="danger" icon="trash" onClick={remove}>{t('Delete programme')}</Button>
    </div>
  </div>
}
