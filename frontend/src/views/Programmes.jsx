// Plan → Programmes (#159): the list, the running one's controls, and a programme's editor (spec
// 14): its schedule, and every training week of every exercise. The model is lib/programmes.js;
// this screen only ever writes through it.
import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { DAYN, DAYS, exerciseNameText, fmtNum, todayISO, weekOrder, weekStartOf } from '../lib/format.js'
import { confirmSheet, exportProgrammeFile, menuSheet, referenceSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import FailureSets from '../components/FailureSets.jsx'
import { RangeField } from '../components/RuleEditor.jsx'
import { Button, PickRow, Row, Section, Segmented, SelectButton, Stepper, Switch, openSelectSheet } from '../components/ui.jsx'
import { effortOf, isBw } from '../lib/history.js'
import { exOr, EXIDX } from '../lib/exercises.js'
import { currentOneRm, operatorFor, planPhase, scalable, stageRule, supports, validateProgramme, weeklyTemplate } from '../lib/prescription/index.js'
import { REST } from '../lib/rotation.js'
import { speedUnitOf, toSpeed, fromSpeed, fmtSpeed } from '../lib/speed.js'
import { clampIncline, inclineFits, INCLINE_MAX, INCLINE_STEP } from '../lib/incline.js'
import { starterProgrammeOptions, buildStarterProgramme } from '../lib/starter.js'
import {
  programmesOf, programmeById, programmeView, newProgramme, saveProgramme, deleteProgramme,
  currentSchedule, startProgramme, pauseProgramme, resumeProgramme, endProgramme,
  repeatProgramme, rpeAs, programmeChip, MAX_WEEKS, REPEAT_BUMP,
  missingFor, firstWeekOf, bindProgramme, startReferences, openSessions,
  stageNumber, closeWeek, resolveSlot, runChoices, setRunPolicy, setRunEnd, referenceOffers, refText,
  occMode, loadedOcc, setSchedule, setDuration, setTarget, setStageKind, copyStage, moveStage, linkSlots, linkable, applyTemplate, setTrackChoice, checkedEdit,
  legacyScheduleOf, repairNotes, confirmRepair,
} from '../lib/programmes.js'

// Names and blurbs as t() literals, for check-source-strings.mjs (see lib/starter.js).
const STARTER_COPY = {
  'strength-4': () => ({ name: t('Strength block, 4 weeks'), about: t('Three days on the 5×5 routines, a little heavier every week, then a light week to bounce back.') }),
  'hypertrophy-6': () => ({ name: t('Upper / lower by effort, 6 weeks'), about: t('Four days. Your progression picks the weights, the effort climbs to RPE 9, then a deload.') }),
  'linear-12': () => ({ name: t('Linear 5×5 style, 12 weeks'), about: t('Three days of plain linear progression, with a deload every fourth week.') }),
}

const RPES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10]
const rpeText = (rpe, S) => { const r = rpeAs(rpe, effortOf(S)); return `${r.k} ${fmtNum(r.v)}` }

// The schedule in a line, as the plan screens get it (legacyScheduleOf): weekdays, or a loop (a
// rotation, a loop bound to weeks, sessions with no preferred day). Empty when nothing is planned.
function scheduleSummary(S, p) {
  const name = id => (id === REST ? t('Rest day') : (S.routines || []).find(r => r.id === id)?.name)
  const plan = legacyScheduleOf(p)
  if (plan.sequence) return plan.sequence.filter(id => id !== REST).length ? plan.sequence.map(name).filter(Boolean).join(' → ') : ''
  const days = plan.days
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
  // Set to keep the 1RM in use: never offered by itself, reviewed here by hand (spec 10.2).
  const kept = referenceOffers(S, null, { kept: true })

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
    {offers.length + kept.length > 0 && <Section>
      {offers.map(o => <Row key={o.exerciseId + o.candidateId} icon="chartLine" iconTint="var(--teal)" title={t('New 1RM for {0}', exName(o.exerciseId))}
        subtitle={t('Update future sessions?')} accessory="chevron" onClick={() => referenceSheet(o)} />)}
      {kept.map(o => <Row key={'k' + o.exerciseId + o.candidateId} icon="chartLine" iconTint="var(--teal)" title={t('New 1RM for {0}', exName(o.exerciseId))}
        subtitle={t('You keep the 1RM in use. Review the newer one here.')} accessory="chevron" onClick={() => referenceSheet(o)} />)}
    </Section>}
    <Section title={t('Your programmes')}>
      {list.length ? list.map(p => <Row key={p.id} icon="calendar" title={p.name || t('Programme')} accessory="chevron"
        subtitle={(p.schedule.mode === 'rotation' ? tn('{0} round', '{0} rounds', p.duration.n) : tn('{0} week', '{0} weeks', p.duration.n)) + (p.id === runningId ? ' · ' + t('running') : '')}
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

/* ------------------------------------ the editor (spec 14) ------------------------------------ */
// Every change goes through lib/programmes.js's authoring helpers, each giving a new definition
// with its week ids kept, and is saved only when checkedEdit (validateProgramme) passes; a refused
// one leaves the saved programme as it was and says why in plain words.

const occAt = (S, sl) => (S.routines || []).find(r => r.id === sl.rid)?.ex?.find(o => o.occurrenceId === sl.oid) || null
const routineName = (S, rid) => (rid === REST ? t('Rest day') : (S.routines || []).find(r => r.id === rid)?.name || t('Routine'))
// "Monday’s Push" where the schedule gives the routine a day, else "Push".
const slotWhere = (S, p, sl) => apptLabel(S, (p.schedule.appts || []).find(a => a.rid === sl.rid && a.day != null) ?? { rid: sl.rid })
const weekWord = (p, n) => (p.schedule.mode === 'rotation' ? t('Round {0}', n) : t('Week {0}', n))

// validateProgramme's reasons in plain words: the first that applies, else a general one.
const REASONS = [
  [/cannot change while the programme runs/, () => t('Stop this programme before changing how it counts the weeks.')],
  [/needs seed\./, () => t('Choose where this week starts.')],
  [/must say hold or reset/, () => t('Choose what happens at the top of the range.')],
  [/needs a deciding set/, () => t('Every set this week is AMRAP or to failure, so effort cannot decide progress.')],
  [/seed\.\w+ must be a number/, () => t('There is no earlier week to start from.')],
  [/needs program\.trainingMax/, () => t('Set a training max for this exercise first.')],
  [/schedule needs|tracks must hold/, () => t('Add a routine with exercises to the schedule.')],
  [/is not in the schedule|is not in routine|has no valid rule/, () => t('An exercise of this programme is no longer in its routine.')],
]
const OVER = () => t('This programme has more exercises than it can hold. Remove a session from the schedule, or delete the programme.')
/**
 * Why `def` (the definition the errors are about) is refused, in plain words, naming the exercise
 * and the week where the validator says which: "Barbell Bench Press · Week 2: …". `here` ({ trackId,
 * stageId }, a week's own sheet) leaves out what goes without saying.
 */
function reasonOf(errors, def = null, here = {}) {
  if (def?.tracks.length > 50 && errors.some(e => /tracks must hold/.test(e))) return OVER()
  const hit = REASONS.find(([re]) => errors.some(e => re.test(e)))
  const said = hit ? hit[1]() : t('That change does not fit this exercise.')
  const at = def && /^tracks\[(\d+)\](?:\.stages\[(\d+)\])?/.exec(errors.find(e => !hit || hit[0].test(e)) ?? '')
  const tr = at && def.tracks[+at[1]], st = tr && at[2] != null ? tr.stages[+at[2]] : null
  const where = [tr && tr.id !== here.trackId ? exName(tr.exerciseId) : null, st && st.id !== here.stageId ? weekWord(def, +at[2] + 1) : null].filter(Boolean)
  return where.length ? t('{0}: {1}', where.join(' · '), said) : said
}
// The weeks of one occurrence that must say where they start (validateProgramme: a step new in that week).
const SEED_RE = /^tracks\[(\d+)\]\.stages\[(\d+)\]\.targets\.(.+): the (\w+) step is new in this stage and needs seed\.\w+$/
const seedsWanted = (errors, ti, oid) => (errors || []).map(e => SEED_RE.exec(e)).filter(m => m && +m[1] === ti && m[3] === oid).map(m => ({ si: +m[2], metric: m[4] }))

const range = r => (r.min === r.max ? fmtNum(r.min) : `${fmtNum(r.min)}–${fmtNum(r.max)}`)
const stepText = (op, unit) => (op.metric === 'load' ? (op.step.type === 'absolute' ? `${fmtNum(op.step.value)} ${op.step.unit || unit}` : `${fmtNum(op.step.value)}%`) : fmtNum(op.step))
const loadText = (g, p, unit) => (g.load.basis === 'training_max' ? t('{0}% of training max', fmtNum(g.load.percent))
  : g.load.basis === 'absolute' ? `${fmtNum(g.load.value)} ${g.load.unit}`
  : g.load.basis === 'anchor' && g.load.percent !== 100 ? t('{0}% of the top set', fmtNum(g.load.percent))
  : p.load.mode === 'percent_1rm' ? t('{0}% of 1RM', fmtNum(p.load.percent))
  : p.load.mode === 'absolute' && p.load.value > 0 ? `${fmtNum(p.load.value)} ${p.load.unit || unit}` : null)

/**
 * One week of one occurrence in a line: each value with where it comes from (spec 14): set by the
 * week, progressing (with its bounds and step) or derived from the top set.
 */
function weekParts(S, st, x, occ) {
  if (st.kind === 'rest') return [{ text: t('Rest') }]
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const eff = x?.effort ? [{ text: `${rpeText(x.effort.rpe, S)} · ${x.effort.mode === 'operational' ? t('Decides progress') : t('For reference')}` }] : []
  if (x?.own !== 'set') {
    if (x?.deload) return [{ text: t('Lighter by {0}%', Math.round((1 - x.deload.factor) * 100)) }, ...eff]
    return [{ text: t('Follow my progression'), src: occ && planPhase(occ.rule).progression.length ? 'progressing' : null }, ...eff]
  }
  const ph = x.phase, p = ph.parameters, mode = occMode(occ)
  const op = m => ph.progression.find(o => o.metric === m)
  if (mode !== 'reps') {
    const each = mode === 'cardio' ? `${fmtNum(p.durationSeconds.min / 60)} min` : `${range(p.durationSeconds)} s`
    return [{ text: `${range(p.sets)} × ${each}${mode === 'cardio' && p.speed ? ` · ${fmtSpeed(p.speed, speedUnitOf(S))}` : ''}`, src: 'set' }, ...eff]
  }
  // One group: its sets and reps, and its load, each with its source (consecutive values of one source share a chip).
  if (ph.groups.length === 1) {
    const g = ph.groups[0], load = loadText(g, p, unit)
    const values = [{ text: `${range(p.sets)} × ${range(p.reps)}`, src: op('reps') || op('sets') ? 'progressing' : 'set' }, ...(load ? [{ text: load, src: op('load') ? 'progressing' : 'set' }] : [])]
    const parts = values.reduce((out, v) => (out.at(-1)?.src === v.src ? [...out.slice(0, -1), { ...v, text: out.at(-1).text + ' · ' + v.text }] : [...out, v]), [])
    for (const o of ph.progression) {
      const r = o.metric === 'reps' ? p.reps : o.metric === 'sets' ? p.sets : null
      parts.push({ text: r ? t('{0} to {1}, +{2} after a good session', fmtNum(r.min), fmtNum(r.max), stepText(o, unit)) : t('+{0} after a good session', stepText(o, unit)) })
    }
    return [...parts, ...eff]
  }
  // Several groups (a top set and back-offs, 5/3/1's sets): one line each, sourced by its load.
  return [...ph.groups.map(g => {
    const reps = g.max ? t('Max') : range(g.reps === 'parameters' ? p.reps : g.reps) + (g.amrap ? '+' : '')
    const load = loadText(g, p, unit)
    return { text: `${range(g.count === 'parameters' ? p.sets : g.count)} × ${reps}${load ? ' · ' + load : ''}`, src: g.load.basis === 'anchor' && g.load.percent !== 100 ? 'derived' : 'set' }
  }), ...eff]
}
const SRC = { set: () => t('Set'), progressing: () => t('Progressing'), derived: () => t('From the top set') }
const WeekLine = ({ parts }) => parts.map((x, i) => <span key={i}>{i > 0 && ' · '}{x.text}{x.src && <> <span className="tag nocap">{SRC[x.src]()}</span></>}</span>)

// The occurrence's own steps a set week keeps: its reps (and sets) chain, its load step, or both.
// With the load fixed the chain says what happens at its top (spec 6): the person's choice, never
// the template's, so a chain kept without its load step asks again.
function keptOps(occPh, ph, { reps, load }) {
  const chain = o => o.metric === 'reps' || o.metric === 'sets'
  const choice = !operatorFor(ph, 'load') ? ph.progression.find(o => chain(o) && typeof o.resetOnCarry === 'boolean')?.resetOnCarry : undefined
  const progression = occPh.progression.filter(o => (chain(o) && reps) || (o.metric === 'load' && load)).map(o => {
    if (!chain(o) || load) return o
    const { resetOnCarry, ...rest } = o
    return choice === undefined ? rest : { ...rest, resetOnCarry: choice }
  })
  return { ...ph, progression, target: load ? occPh.target : { mode: 'none' } }
}

/** One week of one exercise (spec 14): work, recovery or rest; its targets for the exercise's mode; copied or moved. */
function StageSheet({ id, trackId, stageId, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const saved = programmeById(S, id)
  const [draft, setDraft] = useState(saved)
  const [slotAt, setSlotAt] = useState(0)
  const [saveWhy, setSaveWhy] = useState(null)
  // Each week asked where it starts stays on show once answered, to change the answer.
  const asked = useRef(new Set())
  const whyId = useId()
  const track = draft?.tracks.find(tr => tr.id === trackId)
  const stage = track?.stages.find(st => st.id === stageId)
  const sl = track?.slots[Math.min(slotAt, track.slots.length - 1)]
  const occ = sl && occAt(S, sl)
  // Checked as you go on this exercise alone (the rest of the programme is not edited here), once per
  // change; Save checks the whole programme. Whether its effort could decide progress, likewise.
  const one = useMemo(() => track && { ...draft, tracks: [track] }, [draft, track])
  const live = useMemo(() => one && validateProgramme(one, { routines: S.routines || [] }), [one, S.routines])
  const probe = useMemo(() => {
    const x0 = stage && sl ? stage.targets[sl.oid] ?? { own: 'inherit' } : null
    return x0?.effort ? validateProgramme(setTarget(one, trackId, stageId, sl.oid, { ...x0, effort: { mode: 'operational', rpe: x0.effort.rpe } }), { routines: S.routines || [] }) : null
  }, [one, stage, sl, trackId, stageId, S.routines])
  if (!saved || !stage || !occ) return null
  const ti = draft.tracks.indexOf(track), at = track.stages.indexOf(stage)
  const x = stage.targets[sl.oid] ?? { own: 'inherit' }
  const mode = occMode(occ)
  const occPh = planPhase(occ.rule)
  const unit = occPh.parameters.load.unit || (S.unit === 'lb' ? 'lb' : 'kg')
  const bw = isBw({ ...occ, id: occ.exerciseId })
  const res = live.errors.length ? { errors: live.errors } : { ok: true }
  // A refusal at Save stands until the next change.
  const why = res.errors ? reasonOf(res.errors, one, { trackId, stageId }) : saveWhy?.draft === draft ? saveWhy.why : null
  const target = next => setDraft(d => setTarget(d, trackId, stageId, sl.oid, typeof next === 'function' ? next(d.tracks[ti].stages.find(st => st.id === stageId).targets[sl.oid] ?? { own: 'inherit' }) : next))
  const phase = fn => target(cur => ({ ...cur, phase: fn(cur.phase) }))
  const params = patch => phase(ph => ({ ...ph, parameters: { ...ph.parameters, ...patch } }))
  const option = (k, v) => target(cur => { const options = { ...(cur.options || {}) }; if (v === undefined) delete options[k]; else options[k] = v; return Object.keys(options).length ? { ...cur, options } : (({ options: _, ...rest }) => rest)(cur) })
  const rounds = draft.schedule.mode === 'rotation'
  const save = () => {
    const all = checkedEdit(S, draft)
    if (all.errors) { setSaveWhy({ draft, why: reasonOf(all.errors, all.checked, { trackId, stageId }) }); return }
    if (JSON.stringify(all.def) !== JSON.stringify(saved)) update(s => { saveProgramme(s, all.def) })
    close()
  }
  // The rule this week compiles to, for what it can take (supports) and what a week before it left.
  const ruleOf = st => { try { return stageRule({ def: draft, track, stage: st, oid: sl.oid, occRule: occ.rule, runId: 'edit' }) } catch { return null } }
  const rule = ruleOf(stage)
  const can = rule ? supports(rule) : {}
  const ph = x.own === 'set' ? x.phase : null
  const p = ph?.parameters
  const op = m => (ph ? operatorFor(ph, m) : null)
  const chainOp = op('reps') ?? op('sets')
  const occChain = operatorFor(occPh, 'reps') ?? operatorFor(occPh, 'sets')
  const occLoad = operatorFor(occPh, 'load')
  const groupsRead = (m, g) => (m === 'reps' ? g.reps === 'parameters' : g.load.basis === 'anchor')
  const loadKind = !ph ? null : ph.groups.some(g => g.load.basis === 'training_max') ? 'tm' : p.load.mode === 'percent_1rm' ? 'pct' : p.load.mode === 'absolute' ? 'abs' : 'none'
  const loadFits = !!occLoad && !!ph && ph.groups.every(g => groupsRead('load', g)) && (occLoad.step.type === 'percentage_points') === (loadKind === 'pct') && loadKind !== 'none'
  const setOps = flags => phase(cur => keptOps(occPh, cur, { reps: !!(operatorFor(cur, 'reps') ?? operatorFor(cur, 'sets')), load: !!operatorFor(cur, 'load'), ...flags }))
  const decides = x.effort?.mode === 'operational'
  const decideWhy = effortOf(S) === 'none' ? t('Turn on effort per set in Settings') : probe?.errors.some(e => /needs a deciding set/.test(e)) ? t('Every set this week is AMRAP or to failure, so effort cannot decide progress.') : null
  for (const w of seedsWanted(res.errors, 0, sl.oid)) asked.current.add(`${sl.oid}|${track.stages[w.si].id}|${w.metric}`)
  for (const m of Object.keys(x.seed || {})) asked.current.add(`${sl.oid}|${stageId}|${m}`)
  const seeds = [...asked.current].map(k => k.split('|')).filter(([oid, sid]) => oid === sl.oid && track.stages.some(st => st.id === sid))
    .map(([, sid, metric]) => ({ si: track.stages.findIndex(st => st.id === sid), metric }))
  const eff = (k, v) => x.options?.[k] ?? v
  const intensifier = eff('intensifier', occ.intensifier)
  const warm = eff('warmup', occ.warmup)
  const setLoadKind = kind => phase(cur => {
    const prev = cur.parameters.load, base = prev.mode === 'percent_1rm' ? prev.percent : 75
    const top = Math.max(...cur.groups.map(g => (g.load.basis === 'training_max' ? g.load.percent : 0)), 0) || base
    const groups = cur.groups.map(g => (kind === 'tm' && g.load.basis === 'anchor' ? { ...g, load: { basis: 'training_max', percent: Math.round(base * g.load.percent / 50) / 2 } }
      : kind !== 'tm' && g.load.basis === 'training_max' ? { ...g, load: { basis: 'anchor', percent: Math.round(g.load.percent / top * 200) / 2 } } : g))
    const load = kind === 'abs' ? { mode: 'absolute', value: prev.mode === 'absolute' ? prev.value : unit === 'lb' ? 45 : 20, unit }
      : kind === 'pct' ? { mode: 'percent_1rm', percent: prev.mode === 'percent_1rm' ? prev.percent : top } : { mode: 'empty' }
    const { loadTo, ...rest } = cur.parameters
    // A step on the load fits one kind of load only: changing it lets the step go.
    return keptOps(occPh, { ...cur, groups, parameters: { ...rest, load } }, { reps: !!(operatorFor(cur, 'reps') ?? operatorFor(cur, 'sets')), load: false })
  })
  const tmNeeded = loadKind === 'tm' && !track.tm
  const setTm = value => setDraft(d => setTrackChoice(d, trackId, { tm: { value, unit, increment: track.tm?.increment ?? (unit === 'lb' ? 5 : 2.5) } }))
  const tmDefault = () => { const rm = currentOneRm(S.oneRepMaxes, track.exerciseId); return rm?.unit === unit ? Math.round(rm.value * 0.9 / 2.5) * 2.5 : unit === 'lb' ? 225 : 100 }
  const setGroup = (i, patch) => phase(cur => ({ ...cur, groups: cur.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) }))
  const groupTitle = (g, i) => (g.id === 'top' ? t('Top set') : g.id === 'backoff' ? t('Back-off sets') : t('Set {0}', i + 1))
  const others = track.stages.map((st, i) => ({ value: st.id, label: weekWord(draft, i + 1) })).filter(o => o.value !== stageId)
  const work = stage.kind === 'work', recovery = stage.kind === 'recovery'
  const lighter = !!rule && scalable(ruleOf({ ...stage, targets: { [sl.oid]: { own: 'inherit' } } }) ?? rule)

  const fields = ph && <>
    {mode === 'reps' && ph.groups.length === 1 && <>
      <RangeField label={t('Sets')} value={p.sets} policy="either" onChange={sets => params({ sets })} />
      {ph.groups[0].reps === 'parameters' && <RangeField label={t('Reps')} value={p.reps} policy="either" onChange={reps => params({ reps })} />}
    </>}
    {mode === 'time' && <>
      <RangeField label={t('Sets')} value={p.sets} policy="either" onChange={sets => params({ sets })} />
      <RangeField label={t('Seconds')} value={p.durationSeconds} step={5} policy="either" onChange={durationSeconds => params({ durationSeconds })} />
    </>}
    {mode === 'cardio' && <div className="row cfgrow cfgrow-4" style={{ marginBottom: 14 }}>
      <Stepper label={t('Intervals')} value={p.sets.min} decimal={false} min={1} onChange={n => params({ sets: { min: n, max: n } })} />
      <Stepper label={t('Minutes')} value={p.durationSeconds.min / 60} decimal={false} min={1} onChange={n => params({ durationSeconds: { min: n * 60, max: n * 60 } })} />
      <Stepper label={speedUnitOf(S) === 'mph' ? t('Speed (mph)') : t('Speed (km/h)')} value={toSpeed(p.speed ?? 8, speedUnitOf(S))} step={0.5} min={0.5}
        onChange={v => params({ speed: fromSpeed(v, speedUnitOf(S)) })} />
      {(inclineFits(EXIDX[occ.exerciseId]) || eff('incline', occ.cardio?.incline) > 0) && <Stepper label={t('Incline (%)')} value={eff('incline', occ.cardio?.incline) ?? 0}
        step={INCLINE_STEP} max={INCLINE_MAX} onChange={v => option('incline', clampIncline(v))} />}
    </div>}
    {mode !== 'cardio' && <div className="row cfgrow" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
      {loadKind === 'abs' || loadKind === 'none'
        ? <Stepper label={t('Load')} value={p.load.value ?? 0} step={occ.rule.rounding.step ?? 2.5} unit={unit} disabled={loadKind === 'none'}
          onChange={v => params({ load: { mode: 'absolute', value: v, unit } })} />
        : loadKind === 'pct' ? <Stepper label={t('Load')} value={p.load.percent} step={2.5} unit="%" onChange={percent => params({ load: { mode: 'percent_1rm', percent } })} />
        : ph.groups.length === 1 ? <Stepper label={t('% of training max')} value={ph.groups[0].load.percent} step={2.5} unit="%" onChange={percent => setGroup(0, { load: { basis: 'training_max', percent } })} /> : null}
      {(mode === 'reps' && !bw) && <SelectButton className="unit-btn" title={t('Load')} value={loadKind}
        onChange={setLoadKind} options={[{ value: 'abs', label: unit }, { value: 'pct', label: t('% 1RM') }, { value: 'tm', label: t('% of training max') }]} />}
      {(mode === 'time' || bw) && <SelectButton className="unit-btn" title={t('Load')} value={loadKind === 'abs' ? 'abs' : 'none'}
        onChange={setLoadKind} options={[{ value: 'none', label: t('None') }, { value: 'abs', label: unit }]} />}
    </div>}
    {loadKind === 'tm' && <div className="row cfgrow" style={{ marginBottom: 14 }}>
      <Stepper label={t('Training max')} value={track.tm?.value ?? tmDefault()} step={2.5} unit={unit} onChange={setTm} />
      {tmNeeded && <Button size="sm" variant="tinted" onClick={() => setTm(tmDefault())}>{t('Use')}</Button>}
    </div>}
    {mode === 'reps' && ph.groups.length > 1 && ph.groups.map((g, i) => <div key={g.id} className="sect-b" style={{ marginBottom: 10, padding: '10px 14px' }}>
      <div className="small muted" style={{ marginBottom: 6 }}>{groupTitle(g, i)}</div>
      <div className="row cfgrow">
        {g.count !== 'parameters' && <Stepper label={t('Sets')} value={g.count.min} decimal={false} min={1} onChange={n => setGroup(i, { count: { min: n, max: n } })} />}
        {g.reps !== 'parameters' && !g.max && <Stepper label={t('Reps')} value={g.reps.min} decimal={false} min={1} onChange={n => setGroup(i, { reps: { min: n, max: n } })} />}
        {g.load.basis === 'anchor' && g.load.percent !== 100 && <Stepper label={t('From the top set')} value={g.load.percent} step={5} unit="%" decimal={false} onChange={percent => setGroup(i, { load: { basis: 'anchor', percent } })} />}
        {g.load.basis === 'training_max' && <Stepper label={t('% of training max')} value={g.load.percent} step={2.5} unit="%" onChange={percent => setGroup(i, { load: { basis: 'training_max', percent } })} />}
        {g.load.basis === 'absolute' && <Stepper label={t('Weight ({0})', g.load.unit)} value={g.load.value} step={occ.rule.rounding.step ?? 2.5} onChange={value => setGroup(i, { load: { ...g.load, value } })} />}
      </div>
      {g.count !== 'parameters' && g.count.max === 1 && !g.max && <Row title={t('As many reps as you can')}>
        <Switch aria-label={`${t('As many reps as you can')}, ${groupTitle(g, i)}`} checked={!!g.amrap} onChange={v => setGroup(i, { amrap: v || undefined })} />
      </Row>}
    </div>)}
    <div className="row cfgrow" style={{ marginBottom: 14 }}>
      <Stepper label={mode === 'cardio' ? t('Recovery') : t('Rest (s)')} value={p.restSeconds ?? occPh.parameters.restSeconds} step={15} unit="s" decimal={false}
        onChange={restSeconds => params({ restSeconds })} />
      {mode === 'time' && occ.side && <Stepper label={t('Rest between sides')} value={eff('sideRestSec', occ.sideRestSec ?? 0)} step={5} unit="s" decimal={false} onChange={v => option('sideRestSec', v)} />}
    </div>
    {mode === 'reps' && (occChain || occLoad) && <Section>
      {occChain && ph.groups.every(g => groupsRead('reps', g)) && <Row title={t('Keep progressing reps')}
        subtitle={chainOp ? t('{0} to {1}, +{2} after a good session', fmtNum((chainOp.metric === 'reps' ? p.reps : p.sets).min), fmtNum((chainOp.metric === 'reps' ? p.reps : p.sets).max), fmtNum(chainOp.step)) : null}>
        <Switch aria-label={t('Keep progressing reps')} checked={!!chainOp} onChange={v => setOps({ reps: v })} />
      </Row>}
      {loadFits && <Row title={t('Keep progressing load')} subtitle={op('load') ? t('+{0} after a good session', stepText(op('load'), unit)) : null}>
        <Switch aria-label={t('Keep progressing load')} checked={!!op('load')} onChange={v => setOps({ load: v })} />
      </Row>}
      {chainOp && !op('load') && <PickRow title={t('At the top')} value={typeof chainOp.resetOnCarry === 'boolean' ? chainOp.resetOnCarry : null}
        onChange={v => phase(cur => ({ ...cur, progression: cur.progression.map(o => (o.metric === 'reps' || o.metric === 'sets' ? { ...o, resetOnCarry: v } : o)) }))}
        options={[{ value: false, label: t('Stay there') }, { value: true, label: t('Start the range again') }]} />}
    </Section>}
  </>

  return <>
    <h3 id={whyId + 'h'}>{weekWord(draft, at + 1)}</h3>
    <div className="muted small capitalize" style={{ marginBottom: 12 }}>{exName(track.exerciseId)} · {track.slots.map(s => slotWhere(S, draft, s)).join(' · ')}</div>
    {track.slots.length > 1 && <Section><PickRow title={t('Routine')} value={slotAt} onChange={setSlotAt}
      options={track.slots.map((s, i) => ({ value: i, label: slotWhere(S, draft, s) }))} /></Section>}
    <div style={{ marginBottom: 14 }}>
      <Segmented ariaLabelledby={whyId + 'h'} value={stage.kind} onChange={kind => setDraft(d => setStageKind(d, trackId, stageId, kind))}
        options={[{ value: 'work', label: t('Work') }, { value: 'recovery', label: t('Recovery') }, { value: 'rest', label: t('Rest') }]} />
    </div>
    {work && <div style={{ marginBottom: 14 }}>
      <Segmented ariaLabel={t('Target')} value={x.own} onChange={own => target(cur => (own === 'set' ? { ...weeklyTemplate('copy', { oid: sl.oid, occRule: occ.rule })[0].targets[sl.oid], ...(cur.effort ? { effort: cur.effort } : {}), ...(cur.options ? { options: cur.options } : {}) }
        : { own: 'inherit', ...(cur.effort ? { effort: cur.effort } : {}), ...(cur.options ? { options: cur.options } : {}) }))}
        options={[{ value: 'inherit', label: t('Follow my progression') }, { value: 'set', label: t('Set the targets') }]} />
    </div>}
    {recovery && <div style={{ marginBottom: 14 }}>
      <Segmented ariaLabel={t('Target')} value={x.own === 'set' ? 'set' : 'light'} onChange={v => target(v === 'set' ? weeklyTemplate('copy', { oid: sl.oid, occRule: occ.rule })[0].targets[sl.oid] : { own: 'inherit', ...(lighter ? { deload: { factor: 0.9 } } : {}) })}
        options={[{ value: 'light', label: lighter ? t('Lighter by {0}%', 10) : t('Follow my progression') }, { value: 'set', label: t('Set the targets') }]} />
      {/* Done once its sessions are, or with its week (round) whatever was done (spec 9). */}
      <div style={{ marginTop: 10 }}>
        <Segmented ariaLabel={t('Recovery')} value={stage.close ?? 'completion'} onChange={c => setDraft(d => setStageKind(d, trackId, stageId, 'recovery', c))}
          options={[{ value: 'completion', label: t('Needs its sessions done') }, { value: 'calendar', label: rounds ? t('Passes with the round') : t('Passes with the week') }]} />
      </div>
    </div>}
    {stage.kind !== 'rest' && fields}
    {seeds.map(({ si, metric }) => {
      const st = track.stages[si], tx = st.targets[sl.oid] ?? { own: 'inherit' }, prev = track.stages.slice(0, si).findLastIndex(s => s.kind === 'work')
      const at0 = ruleOf(st)?.program.phases[0].parameters
      const typed = typeof tx.seed?.[metric] === 'number'
      const seed = v => setDraft(d => setTarget(d, trackId, st.id, sl.oid, { ...tx, seed: { ...(tx.seed || {}), [metric]: v } }))
      const now = metric === 'load' ? (at0?.load.value ?? at0?.load.percent ?? 0) : metric === 'reps' ? at0?.reps.min : at0?.sets.min
      return <Section key={`${si}${metric}`} title={rounds ? t('Round {0} starts from', si + 1) : t('Week {0} starts from', si + 1)}>
        <PickRow title={metric === 'load' ? t('Load') : metric === 'sets' ? t('Sets') : t('Reps')} value={typed ? 'type' : tx.seed?.[metric] === 'copy' ? 'copy' : null}
          onChange={v => seed(v === 'copy' ? 'copy' : now ?? 0)}
          options={[...(prev >= 0 ? [{ value: 'copy', label: weekWord(draft, prev + 1) }] : []), { value: 'type', label: t('Type a value') }]} />
        {typed && <div className="row cfgrow" style={{ padding: '0 14px 10px' }}>
          <Stepper ariaLabel={metric === 'load' ? t('Load') : metric === 'sets' ? t('Sets') : t('Reps')} value={tx.seed[metric]} step={metric === 'load' ? 2.5 : 1} unit={metric === 'load' ? (at0?.load.mode === 'percent_1rm' ? '%' : unit) : undefined} onChange={seed} />
        </div>}
      </Section>
    })}
    {stage.kind !== 'rest' && <Section>
      <PickRow title={<span id={whyId + 'e'}>{t('Effort')}</span>} value={x.effort?.rpe ?? 0} onChange={rpe => target(cur => { const { effort, ...rest } = cur; return rpe ? { ...rest, effort: { mode: mode === 'reps' ? effort?.mode ?? 'advisory' : 'advisory', rpe } } : rest })}
        options={[{ value: 0, label: t('None') }, ...RPES.map(v => ({ value: v, label: rpeText(v, S) }))]} />
      {/* Holds and cardio keep effort for reference (spec 11); a rep week may let it decide. */}
      {x.effort && mode === 'reps' && <div style={{ padding: '2px 14px 12px' }}>
        <Segmented ariaLabelledby={whyId + 'e'} value={x.effort.mode} onChange={m => target(cur => ({ ...cur, effort: { ...cur.effort, mode: m } }))}
          options={[{ value: 'advisory', label: t('For reference') }, { value: 'operational', label: t('Decides progress'), disabled: !!decideWhy && !decides, describedBy: decideWhy ? whyId + 'd' : undefined }]} />
        {decideWhy && <div id={whyId + 'd'} className="small dim" style={{ marginTop: 6 }}>{decideWhy}</div>}
      </div>}
    </Section>}
    {work && mode === 'reps' && rule && <Section>
      {can.dropset && <Row title={t('Drop-set')}><Switch aria-label={t('Drop-set')} checked={intensifier?.type === 'dropset'} disabled={!x.options?.intensifier && occ.intensifier?.type === 'dropset'}
        onChange={v => option('intensifier', v ? { type: 'dropset', count: 1, pct: 20 } : undefined)} /></Row>}
      {can.restpause && <Row title={t('Rest-pause')}><Switch aria-label={t('Rest-pause')} checked={intensifier?.type === 'restpause'} disabled={!x.options?.intensifier && occ.intensifier?.type === 'restpause'}
        onChange={v => option('intensifier', v ? { type: 'restpause', totalReps: 8, restSec: S.restPauseSec || 15 } : undefined)} /></Row>}
      {can.warmup && <Row title={t('Warm-ups')}><Switch aria-label={t('Warm-ups')} checked={warm !== 'none' && warm?.mode !== 'off'}
        onChange={v => option('warmup', v ? { mode: 'smart', count: 2 } : { mode: 'off' })} /></Row>}
      {loadedOcc(occ) && !['pyramid_reps', 'pyramid'].includes(occ.rule.preset) && intensifier?.type !== 'restpause' && <Row title={t('Back-off sets')}>
        <Switch aria-label={t('Back-off sets')} checked={eff('backoff', occ.backoff === true)} onChange={v => option('backoff', v)} /></Row>}
    </Section>}
    {work && mode !== 'cardio' && rule && can.failure && intensifier?.type !== 'restpause' && <FailureSets rule={rule} value={eff('failureSets', occ.failureSets ?? (occ.lastToFailure ? 'last' : []))} onChange={v => option('failureSets', v)} />}
    <Section>
      {others.length > 0 && <PickRow title={t('Copy from')} value={null} onChange={from => setDraft(d => copyStage(d, trackId, from, stageId))} options={others} />}
    </Section>
    <div className="row" style={{ gap: 8, marginBottom: 14 }}>
      <Button size="sm" icon="chevronUp" disabled={at === 0} onClick={() => setDraft(d => moveStage(d, trackId, stageId, -1))}>{t('Move up')}</Button>
      <Button size="sm" icon="chevronDown" disabled={at === track.stages.length - 1} onClick={() => setDraft(d => moveStage(d, trackId, stageId, 1))}>{t('Move down')}</Button>
    </div>
    <Button variant="primary" disabled={!!res.errors} aria-describedby={why ? whyId : undefined} onClick={save}>{t('Save')}</Button>
    {why && <div id={whyId} className="small dim" role="status" style={{ margin: '6px 2px 0' }}>{why}</div>}
  </>
}
const stageSheet = (id, trackId, stageId) => useUI.getState().openSheet(close => <StageSheet id={id} trackId={trackId} stageId={stageId} close={close} />)

/** 5/3/1 by week needs the training max it starts from (spec 12.3): 90% of the 1RM in use, else asked. */
function TemplateSheet({ S, tr, unit, edit, close }) {
  const rm = currentOneRm(S.oneRepMaxes, tr.exerciseId)
  const [tm, setTm] = useState(() => tr.tm?.value ?? (rm?.unit === unit ? Math.round(rm.value * 0.9 / 2.5) * 2.5 : unit === 'lb' ? 225 : 100))
  return <>
    <h3>{t('5/3/1 by week (needs a training max)')}</h3>
    <div className="row cfgrow" style={{ marginBottom: 14 }}><Stepper label={t('Training max')} value={tm} step={2.5} unit={unit} onChange={setTm} /></div>
    <Button variant="primary" onClick={() => { edit((cur, s) => applyTemplate(cur, tr.id, 'five_three_one', { S: s, tm: { value: tm, unit, increment: unit === 'lb' ? 5 : 2.5 } })); close() }}>{t('Fill in')}</Button>
  </>
}

/** One exercise of the programme: its training weeks with where each value comes from, its templates and links. */
function TrackCard({ S, p, tr, edit, links, now }) {
  const rounds = p.schedule.mode === 'rotation'
  const occs = tr.slots.map(sl => occAt(S, sl))
  const unit = occs[0] && planPhase(occs[0].rule).parameters.load.unit || (S.unit === 'lb' ? 'lb' : 'kg')
  const where = sl => slotWhere(S, p, sl)
  const word = v => (v === 'repeat' ? t('repeat it') : t('move on'))
  const fill = () => menuSheet({ title: t('Fill from a template'), items: [
    ...(occs.every(o => o && loadedOcc(o)) ? [{ icon: 'chartLine', label: t('5/3/1 by week (needs a training max)'), onClick: () => useUI.getState().openSheet(close => <TemplateSheet S={S} tr={tr} unit={unit} edit={edit} close={close} />) }] : []),
    { icon: 'copy', label: t('Same work every week'), onClick: () => edit((cur, s) => applyTemplate(cur, tr.id, 'copy', { S: s })) },
  ] })
  return <Section title={<span className="capitalize">{exName(tr.exerciseId)} · <span className="dim">{tr.slots.map(where).join(' · ')}</span></span>}
    footer={tr.policy ? (rounds ? t('{0}: after a missed round, {1}; after a skipped round, {2}. You choose when you start it.', exName(tr.exerciseId), word(tr.policy.onFailure), word(tr.policy.onSkipped))
      : t('{0}: after a missed week, {1}; after a skipped week, {2}. You choose when you start it.', exName(tr.exerciseId), word(tr.policy.onFailure), word(tr.policy.onSkipped))) : null}>
    {tr.stages.map((st, i) => <Row key={st.id} title={weekWord(p, i + 1)} accessory="chevron" className={now === st.id ? 'prog-now' : ''}
      icon={st.kind === 'work' ? 'chartLine' : 'chartLineSlash'} iconTint={st.kind === 'work' ? undefined : 'var(--orange)'}
      subtitle={<WeekLine parts={weekParts(S, st, st.targets[tr.slots[0].oid], occs[0])} />} onClick={() => stageSheet(p.id, tr.id, st.id)} />)}
    <Row icon="clipboard" iconTint="var(--teal)" title={t('Fill from a template')} accessory="chevron" onClick={fill} />
    {links.filter(([a]) => a === tr.id).map(([a, b]) => { const other = p.tracks.find(x => x.id === b)
      return <Row key={b} icon="link" iconTint="var(--blue)" title={t('Count {0} in {1} and in {2} as one', exName(tr.exerciseId), tr.slots.map(where).join(', '), other.slots.map(where).join(', '))}
        onClick={() => edit(cur => linkSlots(cur, [a, b]))} /> })}
  </Section>
}

/**
 * What a programme waiting on a repair asks you to check (spec 15.2): per exercise, what the old
 * programme asked and what it became. Only "I checked these" ends the wait, never an edit; past 50
 * exercises the way out is said instead (fewer sessions, or delete it).
 */
function RepairPanel({ S, p, edit }) {
  const notes = repairNotes(S, p)
  if (!notes.length) return null
  const over = notes.some(n => n.reason === 'too-many-tracks')
  const text = n => {
    const ex = n.exerciseId ? exName(n.exerciseId) : ''
    if (n.reason === 'training-max' && n.pct != null) return t('{0}: the old programme asked {1}% of the 1RM in week {2}. Its sets work from a training max, so its weeks follow its own progression now.', ex, fmtNum(n.pct), n.week)
    if (n.reason === 'group-loads' && n.pct != null) return t('{0}: the old programme asked {1}% of the 1RM in week {2}. Its sets have loads of their own, so its weeks follow its own progression now.', ex, fmtNum(n.pct), n.week)
    if (n.reason === 'policy') return t('{0}: the old programme gave two different answers for a missed or skipped week. You choose when you start it.', ex)
    if (n.reason === 'too-many-tracks') return OVER()
    if (n.reason === 'empty') return t('Add a routine with exercises to the schedule.')
    if (ex) return t('{0}: some numbers the old programme set do not fit this exercise. Check its weeks.', ex)
    return t('A routine of this programme changed. Check its exercises before you start.')
  }
  return <div className="card prog-run">
    <div className="ttl" style={{ fontWeight: 500 }}>{t('Check these before you start')}</div>
    {notes.map((n, i) => <div key={i} className="small" style={{ marginTop: 6 }}>{text(n)}</div>)}
    {!over && <div className="prog-actions"><Button size="sm" variant="tinted" icon="check" onClick={() => edit(cur => confirmRepair(cur))}>{t('I checked these')}</Button></div>}
  </div>
}

/** Calendar weeks (appointments, a preferred day each, in order or not) or a rotation, its length, its end and its 1RM preference. */
function ScheduleSection({ S, p, edit, live = false }) {
  const lockId = useId()
  const rounds = p.schedule.mode === 'rotation'
  const binding = !!p.needs?.includes('binding')
  const routines = (S.routines || []).filter(r => r.ex?.length).map(r => ({ value: r.id, label: r.name || t('Routine') }))
  const appts = p.schedule.appts || [], seq = p.schedule.sequence || []
  const setMode = mode => edit((cur, s) => (binding ? bindProgramme(cur, mode === 'rotation' ? 'rounds' : 'weeks')
    : mode === 'rotation' ? setSchedule(cur, { mode, sequence: (cur.schedule.appts || []).map(a => a.rid) }, s)
    : setSchedule(cur, { mode, appts: (cur.schedule.sequence || []).filter(x => x !== REST).map(rid => ({ rid })), ordered: true }, s)))
  const setAppts = fn => edit((cur, s) => setSchedule(cur, { ...cur.schedule, appts: fn(cur.schedule.appts) }, s))
  const setSeq = fn => edit((cur, s) => setSchedule(cur, { mode: 'rotation', sequence: fn(cur.schedule.sequence) }, s))
  const days = [{ value: -1, label: t('No preferred day') }, ...weekOrder(weekStartOf(S)).map(d => ({ value: d, label: t(DAYN[d]) }))]
  const pick = (title, value, options, onChange) => openSelectSheet({ title, value, options, onChange })
  const apptMenu = i => menuSheet({ title: apptLabel(S, appts[i]), items: [
    { icon: 'calendar', label: t('Routine'), sub: routineName(S, appts[i].rid), onClick: () => pick(t('Routine'), appts[i].rid, routines, rid => setAppts(a => a.map((x, j) => (j === i ? { ...x, rid } : x)))) },
    { icon: 'calendar', label: t('Day'), sub: appts[i].day != null ? t(DAYN[appts[i].day]) : t('No preferred day'),
      onClick: () => pick(t('Day'), appts[i].day ?? -1, days, d => setAppts(a => a.map((x, j) => (j === i ? { rid: x.rid, ...(d >= 0 ? { day: d } : {}) } : x)))) },
    { icon: 'trash', label: t('Remove'), danger: true, onClick: () => setAppts(a => a.filter((_, j) => j !== i)) },
  ] })
  const seqMenu = i => menuSheet({ title: routineName(S, seq[i]), items: [
    { icon: 'calendar', label: t('Routine'), sub: routineName(S, seq[i]), onClick: () => pick(t('Routine'), seq[i], [...routines, { value: REST, label: t('Rest day') }], rid => setSeq(q => q.map((x, j) => (j === i ? rid : x)))) },
    ...(i > 0 ? [{ icon: 'chevronUp', label: t('Move up'), onClick: () => setSeq(q => { const n = q.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n }) }] : []),
    ...(i < seq.length - 1 ? [{ icon: 'chevronDown', label: t('Move down'), onClick: () => setSeq(q => { const n = q.slice(); [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n }) }] : []),
    { icon: 'trash', label: t('Remove'), danger: true, onClick: () => setSeq(q => q.filter((_, j) => j !== i)) },
  ] })
  const add = () => pick(t('Add routine'), null, rounds ? [...routines, { value: REST, label: t('Rest day') }] : routines,
    rid => (rounds ? setSeq(q => [...q, rid]) : setAppts(a => [...a, { rid }])))
  const refsShown = startReferences(S, p).length > 0
  const mine = S.refUpdates === 'keep' ? t('Keep the one in use') : t('Ask me first')
  return <>
    <Section title={t('Schedule')} footer={rounds ? t('A round is one pass through the list') : null}>
      <div style={{ padding: '10px 14px' }}>
        {/* A run counts its weeks or rounds as it started (programme-run.js): a running one keeps how. */}
        <Segmented ariaLabel={t('Schedule')} value={binding ? null : p.schedule.mode} onChange={setMode}
          options={[{ value: 'weeks', label: t('Calendar weeks') }, { value: 'rotation', label: t('Rotation') }].map(o => (live && o.value !== p.schedule.mode ? { ...o, disabled: true, describedBy: lockId } : o))} />
        {live && <div id={lockId} className="small dim" style={{ marginTop: 6 }}>{t('Stop this programme before changing how it counts the weeks.')}</div>}
      </div>
      {binding && <Row icon="swap" iconTint="var(--orange)" title={t('Choose how to count the weeks for this rotation')} />}
      {!rounds && appts.map((a, i) => <Row key={i} title={routineName(S, a.rid)} subtitle={a.day != null ? t(DAYN[a.day]) : t('No preferred day')} accessory="chevron" onClick={() => apptMenu(i)} />)}
      {rounds && seq.map((rid, i) => <Row key={i} title={routineName(S, rid)} accessory="chevron" onClick={() => seqMenu(i)} />)}
      <Row icon="plus" title={t('Add routine')} onClick={add} />
      {!rounds && !binding && <Row title={t('In this order')} subtitle={t('Skipping ahead counts the sessions in between as skipped')}>
        <Switch aria-label={t('In this order')} checked={p.schedule.ordered === true} onChange={v => edit((cur, s) => setSchedule(cur, { ...cur.schedule, ...(v ? { ordered: true } : { ordered: undefined }) }, s))} />
      </Row>}
      <Row icon="download" title={t('Use my current plan')} subtitle={t('The schedule in your plan right now becomes this programme’s.')}
        onClick={() => edit((cur, s) => { const c = currentSchedule(s); return setSchedule(cur, c.sequence ? { mode: 'rotation', sequence: c.sequence }
          : { mode: 'weeks', appts: weekOrder(weekStartOf(s)).flatMap(d => (c.days[d] || []).map(rid => ({ rid, day: d }))) }, s) })} />
    </Section>
    <Section>
      <div className="lrow prog-weeks">
        <span className="lrow-m"><span className="lrow-t">{rounds ? t('Rounds') : t('Weeks')}</span></span>
        <Stepper value={p.duration.n} min={1} max={MAX_WEEKS} decimal={false} ariaLabel={rounds ? t('Rounds') : t('Weeks')} onChange={n => edit(cur => setDuration(cur, n))} />
      </div>
      <EndRow S={S} rounds={rounds} end={p.end} setEnd={end => edit(cur => ({ ...cur, end }))} />
      {refsShown && <PickRow title={t('New 1RM estimates')} value={p.refs} onChange={refs => edit(cur => ({ ...cur, refs }))}
        options={[{ value: 'inherit', label: t('Use my default ({0})', mine), subtitle: t('Set in Settings') }, { value: 'ask', label: t('Ask me') }, { value: 'keep', label: t('Keep the 1RM it starts with') }]} />}
    </Section>
  </>
}

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
  const startId = id + ':start'
  // Saved when it validates; else the saved one stays and the reason shows.
  const edit = fn => {
    let why = null
    update(s => {
      const cur = programmeById(s, id)
      if (!cur) return
      const res = checkedEdit(s, fn(cur, s))
      if (res.errors) why = reasonOf(res.errors, res.checked)
      else saveProgramme(s, res.def)
    })
    if (why) useUI.getState().toast(why)
  }
  const links = linkable(S, p)
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
          onBlur={e => { const v = e.target.value.trim() || t('Programme'); if (v !== p.name) update(s => { const cur = programmeById(s, id); if (cur) saveProgramme(s, { ...cur, name: v }) }) }} />
      </div>
    </div>
    <RepairPanel S={S} p={p} edit={edit} />
    {running && <RunningCard S={S} nav={nav} />}
    <ScheduleSection S={S} p={p} edit={edit} live={running && ['running', 'paused'].includes(view.status)} />
    <h4 className="sec">{t('Exercises')}</h4>
    {p.tracks.map(tr => <TrackCard key={tr.id} S={S} p={p} tr={tr} edit={edit} links={links} now={running ? view.tracks[tr.id]?.stage : null} />)}
    <div className="prog-actions col">
      {!running && <Button variant="primary" icon="play" disabled={!summary} aria-describedby={summary ? undefined : startId} onClick={() => startSheet(id, nav)}>{t('Start programme')}</Button>}
      {!running && !summary && <div id={startId} className="small dim" role="status">{t('Add a routine with exercises to the schedule.')}</div>}
      <Button variant="tinted" icon="share" onClick={() => exportProgrammeFile(id)}>{t('Share programme')}</Button>
      <Button variant="danger" icon="trash" onClick={remove}>{t('Delete programme')}</Button>
    </div>
  </div>
}
