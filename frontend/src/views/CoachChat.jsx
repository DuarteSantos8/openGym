// The conversation with the Coach.
//
// Everything the Coach does happens here: your answers as the opening message, a typing
// bubble while a job runs (with how long it usually takes), the plan or the suggestions as a
// card you page through, a composer to say what to change, and one button that imports the
// result. History stays in the thread — come back any time, ask for a review, refine again.
//
// The thread is `S.coach.chat` (small, synced) plus whatever is live right now from the
// status poll: a running job or a pending proposal. Nothing about the proposal is copied into
// the chat until a decision is made about it, so two devices can never disagree on what is
// pending. Once decided, the chat line carries a `ref` into `S.coach.log`, where the whole
// proposal — every change, accepted or not, the notes, the evidence — is kept, so saying yes
// or no never makes it disappear. Turning the Coach off is the admin's decision, not a control
// on this screen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, DAYS } from '../lib/format.js'
import { exLine } from '../lib/history.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import {
  coachAvailable, hasConsent, emptyCoach, appendChat, recordTiming, estimateMs, profileLines,
  markStale, applicable, applyChangeSet, applyCreatedPlan, recordDismissal, recordDebrief, logEntry,
  changeTitle, changeValues, exName, canRevert, revertLast
} from '../lib/coach.js'
import { insightsFor, sessionInsights } from '../lib/coach-insights.js'
import { useCoachStatus, requestReview, requestDebrief, requestPlan, refinePlan, resolvePending, cohortStats, setCohortShare, jobErrorText } from '../lib/coach-api.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Check, Switch, Section, Row, SelectRow } from '../components/ui.jsx'
import '../coach.css'

export default function CoachChat() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const coachLocal = useStore(s => s.coachLocal)
  const update = useStore(s => s.update)
  const storeReady = useStore(s => s.ready)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { job, pending, cap, loading, lastError, last, refresh } = useCoachStatus(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const prevJob = useRef(null)
  const coachMode = coachLocal?.mode

  const ok = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  const ready = ok && hasConsent(S) && !!S.coach?.profile
  // Not before the store has loaded: a cold start straight on #/coach would otherwise read an
  // empty state, decide there is no consent, and bounce a consenting user into the intake.
  useEffect(() => {
    if (!storeReady) return
    if (!ok) nav('/home', { replace: true })
    else if (!ready) nav('/coach/intake', { replace: true })
  }, [storeReady, ok, ready])

  // A job that ends is either a proposal, "nothing to change", or a failure. The server tells
  // the client none of that directly — the job simply stops appearing — so the transition is
  // read here, once, and written into the thread as the Coach's reply.
  useEffect(() => {
    if (loading) return
    const was = prevJob.current
    prevJob.current = job
    if (!was || job) return
    const ms = was.startedAt ? Date.now() - was.startedAt : 0
    update(s => {
      recordTiming(s, ms)
      if (!pending) {
        const cls = lastError?.errorClass || (last?.outcome === 'failed' ? (last.errorClass || 'internal') : null)
        appendChat(s, cls
          ? { role: 'coach', kind: 'error', text: jobErrorText(cls, lastError?.detail) }
          : { role: 'coach', kind: 'nochange', text: last?.reading
            ? last.reading
            : t('I looked through everything and there is nothing I would change right now. Keep going — ask me again after a few more sessions.') })
      }
    })
  }, [job, pending, loading])

  useEffect(() => { if (typeof endRef.current?.scrollIntoView === 'function') endRef.current.scrollIntoView({ block: 'end' }) }, [S.coach?.chat?.length, !!job, !!pending])

  if (!ready) return null
  const coach = S.coach || emptyCoach()
  const community = !!config?.coach?.community && !DEMO && !(MOBILE && coachMode === 'byok')

  const send = async () => {
    const msg = text.trim()
    if (!msg || busy) return
    setBusy(true)
    try {
      // A message about a proposed plan refines it. With no plan at all — the first attempt
      // failed, or nothing was ever built — the message asks for one; a review would only
      // answer that there is no workout to look at, which is how people got stuck.
      if (pending?.kind === 'create' || !(S.routines || []).length) await refinePlan(msg)
      else await requestReview(msg)
      update(s => appendChat(s, { role: 'user', kind: 'text', text: msg }))
      setText('')
      refresh()
    } catch (e) {
      toast(e.message || t('Could not ask the Coach'))
    }
    setBusy(false)
  }

  const ask = async (fn, line) => {
    setBusy(true)
    try {
      await fn()
      update(s => appendChat(s, { role: 'user', kind: 'text', text: line }))
      refresh()
    } catch (e) { toast(e.message || t('Could not ask the Coach')) }
    setBusy(false)
  }
  const askReview = () => ask(() => requestReview(''), t('Have a look at my training and tell me what you would change.'))
  const lastWorkout = (S.workouts || []).filter(w => w && w.d).at(-1) || null
  const askDebrief = () => ask(() => requestDebrief(lastWorkout?.id || null), lastWorkout?.name
    ? t('How did my {0} session go?', lastWorkout.name)
    : t('How did my last workout go?'))
  const askNewPlan = () => ask(() => requestPlan(coach.profile), t('Build me a fresh plan from my answers.'))
  const askImprove = r => ask(
    () => requestReview(t('Focus only on my routine “{0}”. Improve it: exercise choice, order, sets and reps, rep ranges, progression. Leave the other routines alone.', r.name)),
    t('Improve my routine “{0}”.', r.name))

  const pickRoutine = () => openSheet(close => <div className="chat-menu">
    <h3>{t('Improve which routine?')}</h3>
    <div className="sect-b">
      {(S.routines || []).map(r => <Row key={r.id} icon="dumbbell" iconTint="var(--acc)" title={`${r.emoji || ''} ${r.name}`.trim()} subtitle={t('{0} exercises', (r.ex || []).length)} accessory="chevron" onClick={() => { close(); askImprove(r) }} />)}
      {!(S.routines || []).length && <div className="chat-empty">{t('You have no routines yet — ask the Coach for a plan first.')}</div>}
    </div>
    <div style={{ height: 10 }} />
  </div>)

  const showHistory = () => openSheet(close => <HistorySheet S={S} close={close} openSheet={openSheet} />)
  const showCohort = () => openSheet(() => <CohortSheet S={S} update={update} toast={toast} />)

  const idle = !job && !pending
  const menu = () => openSheet(close => <div className="chat-menu">
    <h3>{t('Coach')}</h3>
    <div className="sect-b">
      {idle && <Row icon="sparkles" iconTint="var(--acc)" title={t('Ask for a review')} subtitle={t('What would the Coach change after your last sessions?')} accessory="chevron" onClick={() => { close(); askReview() }} />}
      {idle && !!lastWorkout && <Row icon="checkCircle" iconTint="var(--green)" title={t('Review my last workout')} subtitle={t('What went well, what to watch, what to do next time')} accessory="chevron" onClick={() => { close(); askDebrief() }} />}
      {idle && !!(S.routines || []).length && <Row icon="wrench" iconTint="var(--orange)" title={t('Improve a routine')} subtitle={t('Pick one; the Coach works on just that')} accessory="chevron" onClick={() => { close(); pickRoutine() }} />}
      {community && <Row icon="person" iconTint="var(--teal)" title={t('Compare with others here')} subtitle={t('Anonymous medians from this instance')} accessory="chevron" onClick={() => { close(); showCohort() }} />}
      <Row icon="history" iconTint="var(--blue)" title={t('Everything the Coach proposed')} subtitle={t('Plans, suggestions and debriefs, kept')} accessory="chevron" onClick={() => { close(); showHistory() }} />
      {idle && <Row icon="sparkles" iconTint="var(--indigo)" title={t('Start a new plan')} subtitle={t('A fresh plan from your answers; your workouts stay')} accessory="chevron" onClick={() => { close(); askNewPlan() }} />}
      <Row icon="clipboard" iconTint="var(--indigo)" title={t('Edit my answers')} subtitle={t('Goal, days, equipment, limits')} accessory="chevron" onClick={() => { close(); nav('/coach/intake?edit=1') }} />
      <Row icon="clock" iconTint="var(--purple)" title={t('Automatic reviews')} subtitle={cadenceLabel(coach)} accessory="chevron" onClick={() => { close(); cadenceSheet(openSheet, update) }} />
      {canRevert(S) && <Row icon="reset" iconTint="var(--blue)" title={t('Undo the last Coach changes')} accessory="chevron" onClick={() => { close(); doRevert() }} />}
    </div>
    <div style={{ height: 10 }} />
  </div>)

  const doRevert = () => confirmSheet({
    title: t('Undo the last Coach changes?'),
    message: t('Your plan goes back to how it was before you accepted them. Workouts you have logged since are untouched.'),
    confirmText: t('Undo'),
    onConfirm: () => {
      let ok = false
      update(s => { ok = revertLast(s); if (ok) appendChat(s, { role: 'coach', kind: 'reverted', text: t('Done — your plan is back to how it was before my last changes.') }) })
      toast(ok ? t('Plan restored') : t('Nothing to undo'))
    }
  })

  const status = job ? t('thinking…') : pending ? t('has a suggestion for you') : t('here when you need it')
  const placeholder = pending?.kind === 'create'
    ? t('What should change?')
    : job ? t('Coach is thinking…') : t('Message the Coach…')

  return <div className="narrow chat">
    <div className="chat-hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div className="chat-av"><Icon name="sparkles" /></div>
      <div className="grow">
        <h1>{t('Coach')}</h1>
        <div className={'chat-st' + (job ? ' live' : '')}>{status}</div>
      </div>
      <button className="iconbtn" onClick={menu} aria-label={t('More')}><Icon name="list" /></button>
    </div>

    <div className="msgs">
      <Bubble role="coach">{t('Hi — I’m your Coach. I build your plan from your answers and adjust it from what you actually log. Nothing changes until you say so.')}</Bubble>

      {(coach.chat || []).map(m => <Message key={m.id} m={m} S={S} profile={coach.profile} openSheet={openSheet} />)}

      {job && <Typing S={S} kind={job.kind} coachLocal={coachLocal} config={config} />}

      {pending && !job && (pending.kind === 'create'
        ? <PlanCard p={pending} S={S} update={update} toast={toast} nav={nav} refresh={refresh} />
        : pending.kind === 'debrief'
          ? <DebriefCard p={pending} S={S} update={update} toast={toast} refresh={refresh} />
          : <ReviewCard p={pending} S={S} update={update} toast={toast} refresh={refresh} />)}

      <div ref={endRef} />
    </div>

    <div className="composer">
      {idle && !busy && <div className="chips-row">
        <button className="qchip" onClick={askReview}><Icon name="sparkles" />{t('Review my training')}</button>
        {!!lastWorkout && <button className="qchip" onClick={askDebrief}><Icon name="checkCircle" />{t('Last workout')}</button>}
        {!!(S.routines || []).length && <button className="qchip" onClick={pickRoutine}><Icon name="wrench" />{t('Improve a routine')}</button>}
        {community && <button className="qchip" onClick={showCohort}><Icon name="person" />{t('Compare')}</button>}
      </div>}
      <div className="composer-in">
        <textarea rows={1} value={text} maxLength={1000} placeholder={placeholder} disabled={!!job}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="send" onClick={send} disabled={!text.trim() || busy || !!job} aria-label={t('Send')}><Icon name="arrowUp" /></button>
      </div>
      {cap?.limit > 0 && <div className="composer-cap">{t('{0} of {1} Coach runs used today', cap.used, cap.limit)}</div>}
    </div>
  </div>
}

/* ---------------------------------- bubbles ---------------------------------- */

function Bubble({ role, kind, at, children }) {
  const cls = kind === 'error' ? ' err' : ''
  return <div className={'msg ' + role}>
    <div className={'bub' + cls}>{children}</div>
    {at && <div className="msg-t">{stamp(at)}</div>}
  </div>
}

function Message({ m, S, profile, openSheet }) {
  if (m.kind === 'intake') {
    const lines = profileLines(profile)
    return <Bubble role="user" at={m.at}>
      {t('Here is what I am working with:')}
      <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </Bubble>
  }
  if (m.kind === 'applied' || m.kind === 'dismissed' || m.kind === 'debrief') {
    const entry = m.ref ? logEntry(S, m.ref) : null
    return <div className="msg coach" style={entry ? { maxWidth: '100%', width: '100%' } : undefined}>
      {!!m.text && <div className="bub">{m.text}</div>}
      {entry && <Recap entry={entry} S={S} openSheet={openSheet} />}
      {m.at && <div className="msg-t">{stamp(m.at)}</div>}
    </div>
  }
  if (m.kind === 'reverted' || m.kind === 'nochange' || m.kind === 'error' || m.kind === 'text') {
    return <Bubble role={m.role} kind={m.kind} at={m.at}>{m.text}</Bubble>
  }
  return null
}

const stamp = at => {
  const d = new Date(at)
  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === today.toDateString() ? time : fmtDate(d.toISOString().slice(0, 10)) + ' · ' + time
}

function Typing({ S, kind, coachLocal, config }) {
  const ms = estimateMs(S)
  // "Local" on either side: the phone's own OpenAI-compatible endpoint, or the server's —
  // /api/config names the provider, and a model on the owner's box is nothing like a cloud API.
  const local = (coachLocal?.mode === 'byok' && coachLocal?.provider === 'compatible') || config?.coach?.provider === 'compatible'
  let eta
  if (ms) {
    const min = Math.round(ms / 60000)
    eta = min < 1 ? t('Usually under a minute.') : t('Usually about {0} min.', min)
  } else {
    // Until a job has been measured, "a minute or two" is a cloud number — say nothing for a
    // local model rather than something wrong; the next line already warns it takes longer.
    eta = local ? '' : t('This usually takes a minute or two.')
  }
  const doing = kind === 'create' ? t('Building your plan…') : kind === 'debrief' ? t('Looking at that session…') : t('Reading your training…')
  return <div className="msg coach">
    <div className="bub typing"><i /><i /><i /></div>
    <div className="typing-eta">
      {doing} {eta}
      {local ? ' ' + t('A local model can take longer.') : ''}
      {' ' + t('You can leave — it keeps going.')}
    </div>
  </div>
}

/* ---------------------------------- the plan ---------------------------------- */

function PlanCard({ p, S, update, toast, nav, refresh }) {
  const b = p.bundle
  const [tab, setTab] = useState(0)
  const [schedule, setSchedule] = useState(true)
  const r = b.routines[Math.min(tab, b.routines.length - 1)]
  const weekDays = useMemo(() => new Set(Object.keys(b.week || {}).map(Number)), [b])

  const accept = () => {
    try {
      let n = 0
      update(s => {
        const res = applyCreatedPlan(s, p, { schedule })
        n = res?.routines?.length || b.routines.length
        appendChat(s, { role: 'coach', kind: 'applied', ref: res.logId, text: schedule
          ? t('Imported — {0} routines are in your plan and your week is set. See you at the next session.', n)
          : t('Imported — {0} routines are in your plan. Your week is unchanged; schedule them whenever you like.', n) })
      })
      resolvePending({ accepted: ['plan'] }).catch(() => {})
      toast(t('Your plan is live'))
      refresh()
    } catch (e) { toast(e.message || t('That proposal can’t be read.')) }
  }
  const discard = () => confirmSheet({
    title: t('Discard this plan?'), message: t('Nothing is saved, and you can ask again anytime.'),
    confirmText: t('Discard'), danger: true,
    onConfirm: () => {
      update(s => { const ref = recordDismissal(s, p); appendChat(s, { role: 'coach', kind: 'dismissed', ref, text: t('Discarded. Tell me what was off and I will build a different one.') }) })
      resolvePending({ dismissed: true }).catch(() => {})
      refresh()
    }
  })

  return <div className="msg coach" style={{ maxWidth: '100%', width: '100%' }}>
    <div className="pcard">
      <div className="pcard-hd">
        <div className="pcard-eyebrow">{p.iteration > 1 ? t('Revision {0}', p.iteration) : t('Your plan')}</div>
        <h2 className="pcard-h">{b.name || t('Coach plan')}</h2>
        {!!b.summary && <p className="pcard-sum">{b.summary}</p>}
        {!!b.basedOn && <p className="pcard-sum" style={{ fontSize: 13 }}>{b.basedOn}</p>}
      </div>

      <WeekStrip days={weekDays} />

      {b.routines.length > 1 && <div className="pcard-tabs">
        {b.routines.map((x, i) => <button key={x.id || i} className={'pcard-tab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}>{x.emoji} {x.name}</button>)}
      </div>}

      {r && <RoutineBlock r={r} unit={S.unit} />}

      <div className="pcard-row">
        <span className="lrow-m"><span className="lrow-t">{t('Use this weekly schedule')}</span><span className="lrow-s">{t('Replaces your current week. Days this plan leaves empty become rest days.')}</span></span>
        <Switch checked={schedule} onChange={setSchedule} />
      </div>
      <div className="pcard-note">{t('The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
      <div className="pcard-ft">
        <Button variant="primary" icon="download" onClick={accept}>{t('Import this plan')}</Button>
        <Button onClick={discard}>{t('Discard')}</Button>
      </div>
    </div>
    <div className="msg-t">{t('Not quite right? Say what to change below and I will revise the whole plan.')}</div>
  </div>
}

const WeekStrip = ({ days }) => <div className="pcard-week">
  {[1, 2, 3, 4, 5, 6, 0].map(d => <div key={d} className={'pcard-wd' + (days.has(d) ? ' on' : '')}>{t(DAYS[d])}</div>)}
</div>

const RoutineBlock = ({ r, unit }) => <div className="pcard-rt">
  <div className="pcard-rt-h"><b>{r.emoji} {r.name}</b><span>{t('{0} exercises', r.ex.length)}</span></div>
  {!!r.why && <div className="pcard-why">{r.why}</div>}
  {r.ex.map((e, i) => <div key={i} className="pcard-ex">
    <div className="pcard-ex-r"><span className="pcard-ex-n">{exName(e.id)}</span><span className="pcard-ex-l">{exLine(e, unit)}</span></div>
    {!!e.why && <div className="pcard-ex-w">{e.why}</div>}
  </div>)}
</div>

/* ---------------------------------- a review ---------------------------------- */

function ReviewCard({ p, S, update, toast, refresh }) {
  const marked = useMemo(() => markStale(p, S), [p, S])
  const usable = applicable(marked)
  const [accepted, setAccepted] = useState(() => new Set(usable.map(c => c.id)))
  const toggle = id => setAccepted(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const apply = () => {
    const ids = [...accepted].filter(id => usable.some(c => c.id === id))
    if (!ids.length) { discard(); return }
    try {
      update(s => {
        const res = applyChangeSet(s, marked, ids)
        appendChat(s, { role: 'coach', kind: 'applied', ref: res.logId, text: t(ids.length === 1 ? 'Applied {0} change to your plan.' : 'Applied {0} changes to your plan.', ids.length) })
      })
      resolvePending({ accepted: ids, rejected: marked.changes.filter(c => !ids.includes(c.id)).map(c => c.id) }).catch(() => {})
      toast(t(ids.length === 1 ? '{0} change applied' : '{0} changes applied', ids.length))
      refresh()
    } catch (e) { toast(e.message || t('Could not apply those changes')) }
  }
  const discard = () => confirmSheet({
    title: t('Dismiss these suggestions?'), message: t('Nothing changes, and the Coach will remember you turned these down.'),
    confirmText: t('Dismiss'), danger: true,
    onConfirm: () => {
      update(s => { const ref = recordDismissal(s, marked); appendChat(s, { role: 'coach', kind: 'dismissed', ref, text: t('Understood — I will not suggest these again without new evidence.') }) })
      resolvePending({ dismissed: true }).catch(() => {})
      refresh()
    }
  })

  return <div className="msg coach" style={{ maxWidth: '100%', width: '100%' }}>
    <div className="pcard">
      <div className="pcard-hd">
        <div className="pcard-eyebrow">{t('Suggestions')}</div>
        <h2 className="pcard-h">{t(marked.changes.length === 1 ? '{0} suggestion' : '{0} suggestions', marked.changes.length)}</h2>
        {!!marked.summary && <p className="pcard-sum">{marked.summary}</p>}
        {!!marked.evidence?.sessions && <p className="pcard-sum" style={{ fontSize: 13 }}>
          {t('Based on your last {0} sessions', marked.evidence.sessions)}{marked.evidence.from ? ` · ${fmtDate(marked.evidence.from)} – ${fmtDate(marked.evidence.to)}` : ''}
        </p>}
        {marked.planMoved && <p className="pcard-sum" style={{ fontSize: 13, color: 'var(--yellow)' }}>
          {t('Your plan changed since the Coach looked at it. Suggestions that no longer match are greyed out — ask for a fresh review to see them again.')}
        </p>}
      </div>

      <Insights S={S} window={marked.evidence} />

      {marked.changes.map(c => {
        const stale = c.status === 'stale'
        return <ChangeRow key={c.id} c={c} S={S} stale={stale}>
          {!stale && <Check checked={accepted.has(c.id)} onChange={() => toggle(c.id)} />}
        </ChangeRow>
      })}

      <Notes notes={marked.notes} />

      <div className="pcard-note">{t('The Coach is not a doctor or a physiotherapist. If something hurts, ask a professional.')}</div>
      <div className="pcard-ft">
        <Button variant="primary" icon="check" onClick={apply}>
          {accepted.size ? t(accepted.size === 1 ? 'Apply {0} change' : 'Apply {0} changes', accepted.size) : t('Apply nothing')}
        </Button>
        <Button onClick={discard}>{t('Dismiss all')}</Button>
      </div>
    </div>
  </div>
}

function ChangeRow({ c, S, stale, badge, children }) {
  const vals = changeValues(c, S)
  return <div className={'pcard-chg' + (stale ? ' stale' : '') + (c.status === 'rejected' ? ' declined' : '')}>
    <div className="grow">
      <div className="pcard-chg-t">{changeTitle(c, S)}{c.routineName ? <span className="dim" style={{ fontWeight: 400 }}> · {c.routineName}</span> : null}</div>
      {vals && <div className="pcard-chg-v"><span className="tag">{vals.before}</span><Icon name="chevronRight" style={{ fontSize: 12, color: 'var(--label-3)' }} /><span className="tag acc">{vals.after}</span></div>}
      <div className="pcard-chg-w">{c.why}</div>
      {stale && <div className="pcard-chg-stale">{t('Doesn’t match your plan any more — can’t be applied.')}</div>}
    </div>
    {badge}
    {children}
  </div>
}

const Notes = ({ notes }) => !!notes?.length && <div className="pcard-notes">
  {notes.map((n, i) => <div key={i}><Icon name="lightbulb" />{n}</div>)}
</div>

/* ---------------------------------- insights ---------------------------------- */

const BP_LABEL = { back: 'Back muscles', cardio: 'Cardio', chest: 'Chest', 'lower arms': 'Forearms', 'lower legs': 'Calves', neck: 'Neck', shoulders: 'Shoulders', 'upper arms': 'Arms', 'upper legs': 'Legs', waist: 'Core', other: 'Other' }
const bpLabel = bp => t(BP_LABEL[bp] || bp)

/**
 * The numbers the Coach read, drawn: how much and how often, where the body weight went,
 * which lifts moved, which body parts got the work. Computed on the device for the window the
 * proposal names, so the picture under a suggestion is the evidence behind it, not decoration.
 */
function Insights({ S, window: win, compact }) {
  const ins = useMemo(() => insightsFor(S, win || {}), [S, win?.from, win?.to])
  if (!ins.sessions && !ins.bodyweight.points.length) return null
  const maxBp = ins.bodyParts[0]?.sets || 1
  const bw = ins.bodyweight
  return <div className="ins">
    <div className="ins-tiles">
      <Tile v={ins.sessions} l={t('Sessions')} />
      <Tile v={ins.minutes != null ? ins.minutes : '—'} l={t('Min / session')} />
      <Tile v={ins.volume ? kfmt(ins.volume) : '—'} l={t('Volume ({0})', S.unit)} />
      <Tile v={ins.sets} l={t('Sets')} />
    </div>

    {bw.points.length > 1 && <div className="ins-block">
      <div className="ins-h">
        <span>{t('Body weight')}</span>
        <span className={'ins-delta' + (bw.delta > 0 ? ' up' : bw.delta < 0 ? ' down' : '')}>
          {bw.delta > 0 ? '+' : ''}{fmtNum(bw.delta)} {S.unit}{bw.goal != null ? ` · ${t('goal')} ${fmtNum(bw.goal)}` : ''}
        </span>
      </div>
      <div className="chart"><LineChart points={bw.points} h={compact ? 96 : 120} unit={S.unit} goal={bw.goal} axes={!compact} /></div>
    </div>}

    {!!ins.strength.length && <div className="ins-block">
      <div className="ins-h"><span>{t('Estimated 1RM')}</span><span className="dim">{t('first → last session')}</span></div>
      {ins.strength.map(x => <div key={x.id} className="ins-row">
        <span className="ins-row-n">{x.name}</span>
        <span className="ins-row-v"><span className="tag">{fmtNum(x.first)}</span><Icon name="chevronRight" /><span className="tag acc">{fmtNum(x.last)}</span></span>
        <span className={'ins-delta' + (x.delta > 0 ? ' up' : x.delta < 0 ? ' down' : '')}>{x.delta > 0 ? '▲' : x.delta < 0 ? '▼' : '•'} {Math.abs(x.pct)}%</span>
      </div>)}
    </div>}

    {!!ins.bodyParts.length && !compact && <div className="ins-block">
      <div className="ins-h"><span>{t('Work sets by body part')}</span></div>
      {ins.bodyParts.slice(0, 6).map(b => <div key={b.bp} className="ins-bar">
        <span className="ins-bar-l">{bpLabel(b.bp)}</span>
        <span className="ins-bar-t"><i style={{ width: Math.max(4, Math.round(b.sets / maxBp * 100)) + '%' }} /></span>
        <span className="ins-bar-v">{b.sets}</span>
      </div>)}
    </div>}
  </div>
}
const Tile = ({ v, l }) => <div className="ins-tile"><div className="ins-tile-v">{v}</div><div className="ins-tile-l">{l}</div></div>
const kfmt = n => (n >= 10000 ? Math.round(n / 1000) + 'k' : fmtNum(n))

/* ---------------------------------- a debrief ---------------------------------- */

function DebriefBody({ p, S }) {
  const w = p.workout || {}
  const live = useMemo(() => sessionInsights(S, (S.workouts || []).find(x => x.id === w.id) || null), [S, w.id])
  const score = Number.isFinite(p.score) ? Math.max(1, Math.min(10, p.score)) : null
  return <>
    {score != null && <div className="deb-score">
      <div className="deb-ring" style={{ '--pct': score / 10 }}><span>{score}</span><small>/10</small></div>
      <div className="deb-score-t"><b>{scoreWord(score)}</b><span>{w.name || t('Workout')}{w.d ? ' · ' + fmtDate(w.d) : ''}</span></div>
    </div>}
    {live && <div className="ins">
      <div className="ins-tiles">
        <Tile v={live.now.sets} l={t('Sets')} />
        <Tile v={live.now.minutes != null ? live.now.minutes : '—'} l={t('Minutes')} />
        <Tile v={live.now.volume ? kfmt(live.now.volume) : '—'} l={t('Volume ({0})', S.unit)} />
        <Tile v={live.now.prs || '—'} l={t('PRs')} />
      </div>
      {live.then && <div className="ins-cmp">
        {t('vs. last {0} on {1}:', w.name || t('session'), fmtDate(live.prevDate))}{' '}
        <Delta v={live.now.volume - live.then.volume} unit={S.unit} label={t('volume')} />
        {live.now.minutes != null && live.then.minutes != null && <Delta v={live.now.minutes - live.then.minutes} unit="min" label={t('time')} />}
      </div>}
      {!!live.lifts.length && <div className="ins-block">
        <div className="ins-h"><span>{t('Best set, estimated 1RM')}</span></div>
        {live.lifts.slice(0, 6).map(x => <div key={x.id} className="ins-row">
          <span className="ins-row-n">{x.name} <span className="dim">{fmtNum(x.w)}×{x.r}</span></span>
          <span className="ins-row-v"><span className="tag acc">{fmtNum(x.est)}</span></span>
          {x.prev != null && <span className={'ins-delta' + (x.est > x.prev ? ' up' : x.est < x.prev ? ' down' : '')}>{x.est > x.prev ? '▲' : x.est < x.prev ? '▼' : '•'} {fmtNum(Math.abs(x.est - x.prev))}</span>}
        </div>)}
      </div>}
    </div>}
    <DebriefList icon="checkCircle" tint="var(--green)" title={t('What went well')} items={p.highlights} />
    <DebriefList icon="warning" tint="var(--yellow)" title={t('Worth watching')} items={p.watch} />
    <DebriefList icon="arrowUp" tint="var(--acc)" title={t('Next time')} items={p.nextTime} />
  </>
}
const Delta = ({ v, unit, label }) => <span className={'ins-delta' + (v > 0 ? ' up' : v < 0 ? ' down' : '')}>{v > 0 ? '+' : ''}{fmtNum(v)} {unit} {label}</span>
const DebriefList = ({ icon, tint, title, items }) => !!items?.length && <div className="deb-list">
  <div className="deb-list-h" style={{ color: tint }}><Icon name={icon} />{title}</div>
  {items.map((x, i) => <div key={i} className="deb-item">{x}</div>)}
</div>
const scoreWord = s => s >= 9 ? t('Excellent session') : s >= 7 ? t('Good session') : s >= 5 ? t('Solid session') : t('Tough session')

function DebriefCard({ p, S, update, toast, refresh }) {
  const done = () => {
    update(s => { const ref = recordDebrief(s, p); appendChat(s, { role: 'coach', kind: 'debrief', ref, text: '' }) })
    resolvePending({ accepted: ['debrief'] }).catch(() => {})
    toast(t('Kept in your Coach history'))
    refresh()
  }
  return <div className="msg coach" style={{ maxWidth: '100%', width: '100%' }}>
    <div className="pcard">
      <div className="pcard-hd">
        <div className="pcard-eyebrow">{t('Workout debrief')}</div>
        <h2 className="pcard-h">{p.workout?.name || t('Your last workout')}</h2>
        {!!p.summary && <p className="pcard-sum">{p.summary}</p>}
      </div>
      <DebriefBody p={p} S={S} />
      <div className="pcard-ft">
        <Button variant="primary" icon="check" onClick={done}>{t('Got it')}</Button>
      </div>
    </div>
    <div className="msg-t">{t('Want changes to the plan from this? Ask for a review below.')}</div>
  </div>
}

/* ---------------------------------- what was decided ---------------------------------- */

/** A decided proposal, folded: one line of what it was and what you did, and a way back in. */
function Recap({ entry, S, openSheet }) {
  const open = () => openSheet(() => <ProposalDetail entry={entry} S={S} />)
  const decisions = entry.decisions || []
  const acc = decisions.filter(d => d.status === 'accepted').length
  const rej = decisions.length - acc
  const kind = entry.kind
  const eyebrow = kind === 'create' ? t('Plan') : kind === 'debrief' ? t('Workout debrief') : t('Suggestions')
  const state = kind === 'debrief' ? null
    : entry.dismissed ? { cls: 'no', text: t('Declined') }
      : kind === 'create' ? { cls: 'yes', text: t('Imported') }
        : rej ? { cls: 'mix', text: t('{0} accepted · {1} declined', acc, rej) } : { cls: 'yes', text: t('{0} accepted', acc) }
  const title = kind === 'create' ? (entry.bundle?.name || t('Coach plan'))
    : kind === 'debrief' ? (entry.workout?.name || t('Workout')) + (entry.score != null ? ` · ${entry.score}/10` : '')
      : t(decisions.length === 1 ? '{0} suggestion' : '{0} suggestions', decisions.length)
  return <button className="recap" onClick={open}>
    <div className="recap-top">
      <span className="pcard-eyebrow">{eyebrow}</span>
      {state && <span className={'recap-state ' + state.cls}>{state.text}</span>}
    </div>
    <div className="recap-t">{title}</div>
    {!!entry.summary && <div className="recap-s">{entry.summary}</div>}
    {kind === 'review' && !!decisions.length && <div className="recap-chips">
      {decisions.slice(0, 4).map(d => <span key={d.id} className={'recap-chip ' + (d.status === 'accepted' ? 'yes' : 'no')}><Icon name={d.status === 'accepted' ? 'check' : 'xmark'} />{changeTitle(d, S)}</span>)}
      {decisions.length > 4 && <span className="recap-chip">+{decisions.length - 4}</span>}
    </div>}
    <div className="recap-more">{t('Show everything')}<Icon name="chevronRight" /></div>
  </button>
}

/** The whole proposal, as it was, read-only. */
function ProposalDetail({ entry, S }) {
  const [tab, setTab] = useState(0)
  const kind = entry.kind
  const b = entry.bundle
  const r = b?.routines?.[Math.min(tab, (b?.routines?.length || 1) - 1)]
  const weekDays = useMemo(() => new Set(Object.keys(b?.week || {}).map(Number)), [b])
  return <div className="pdetail">
    <div className="pcard-hd" style={{ paddingLeft: 0, paddingRight: 0 }}>
      <div className="pcard-eyebrow">{kind === 'create' ? t('Plan') : kind === 'debrief' ? t('Workout debrief') : t('Suggestions')} · {fmtDate(new Date(entry.at).toISOString().slice(0, 10))}</div>
      <h2 className="pcard-h">{kind === 'create' ? (b?.name || t('Coach plan')) : kind === 'debrief' ? (entry.workout?.name || t('Workout')) : t(entry.decisions?.length === 1 ? '{0} suggestion' : '{0} suggestions', entry.decisions?.length || 0)}</h2>
      {!!entry.summary && <p className="pcard-sum">{entry.summary}</p>}
      {entry.dismissed && <p className="pcard-sum" style={{ color: 'var(--red)' }}>{t('You declined this.')}</p>}
      {!!entry.evidence?.sessions && <p className="pcard-sum" style={{ fontSize: 13 }}>
        {t('Based on your last {0} sessions', entry.evidence.sessions)}{entry.evidence.from ? ` · ${fmtDate(entry.evidence.from)} – ${fmtDate(entry.evidence.to)}` : ''}
      </p>}
    </div>

    {kind === 'review' && <>
      <Insights S={S} window={entry.evidence} />
      {(entry.decisions || []).map(d => <ChangeRow key={d.id} c={d} S={S} stale={d.status === 'stale'}
        badge={<span className={'recap-state ' + (d.status === 'accepted' ? 'yes' : 'no')}>{d.status === 'accepted' ? t('Accepted') : d.status === 'stale' ? t('Expired') : t('Declined')}</span>} />)}
      <Notes notes={entry.notes} />
    </>}

    {kind === 'create' && b && <>
      <WeekStrip days={weekDays} />
      {b.routines.length > 1 && <div className="pcard-tabs" style={{ paddingLeft: 0, paddingRight: 0 }}>
        {b.routines.map((x, i) => <button key={x.id || i} className={'pcard-tab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}>{x.emoji} {x.name}</button>)}
      </div>}
      {r && <RoutineBlock r={r} unit={S.unit} />}
      <p className="pcard-sum" style={{ fontSize: 13 }}>{entry.scheduled ? t('Your week was set to this schedule.') : t('Imported without changing your week.')}</p>
    </>}
    {kind === 'create' && !b && <p className="pcard-sum">{t('This plan was imported before the app kept proposals; only its summary is left.')}</p>}

    {kind === 'debrief' && <DebriefBody p={entry} S={S} />}
    {kind === 'revert' && <p className="pcard-sum">{t('Reverted the last Coach changes.')}</p>}
    <div style={{ height: 10 }} />
  </div>
}

/** Every proposal ever made, newest first. Nothing the Coach said is gone after a decision. */
function HistorySheet({ S, close, openSheet }) {
  const log = [...(S.coach?.log || [])].reverse()
  const icon = { create: ['clipboard', 'var(--indigo)'], review: ['sparkles', 'var(--acc)'], debrief: ['checkCircle', 'var(--green)'], revert: ['reset', 'var(--blue)'] }
  return <div className="chat-menu">
    <h3>{t('Everything the Coach proposed')}</h3>
    {!log.length && <div className="chat-empty">{t('Nothing yet. Every plan, suggestion and debrief will be kept here — whether you said yes or no.')}</div>}
    <div className="sect-b">
      {log.map(e => {
        const [ic, tint] = icon[e.kind] || ['sparkles', 'var(--acc)']
        const n = (e.decisions || []).length
        const acc = (e.decisions || []).filter(d => d.status === 'accepted').length
        const title = e.kind === 'create' ? (e.bundle?.name || t('Coach plan')) + (e.iteration > 1 ? ` · ${t('Revision {0}', e.iteration)}` : '')
          : e.kind === 'debrief' ? t('Debrief: {0}', e.workout?.name || t('Workout')) + (e.score != null ? ` · ${e.score}/10` : '')
            : e.kind === 'revert' ? t('Reverted the last Coach changes.')
              : t(n === 1 ? '{0} suggestion' : '{0} suggestions', n)
        const sub = fmtDate(new Date(e.at).toISOString().slice(0, 10)) + ' · ' + (e.kind === 'debrief' ? String(e.summary || '').slice(0, 60)
          : e.dismissed ? t('Declined') : e.kind === 'create' ? t('Imported') : e.kind === 'revert' ? '' : t('{0} accepted · {1} declined', acc, n - acc))
        return <Row key={e.id} icon={ic} iconTint={tint} title={title} subtitle={sub} accessory="chevron"
          onClick={() => { close(); openSheet(() => <ProposalDetail entry={e} S={S} />) }} />
      })}
    </div>
    <div style={{ height: 10 }} />
  </div>
}

/* ---------------------------------- the others here ---------------------------------- */

/**
 * How you sit against everyone else on this instance — medians only, at least three people
 * sharing, nothing that identifies anyone. The admin turns it on for the instance; each person
 * turns it on for themselves; a person who does not share sees nothing either.
 */
function CohortSheet({ S, update, toast }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => cohortStats().then(setD).catch(e => { toast(e.message || t('Could not load')); setD({ ok: false }) })
  useEffect(() => { load() }, [])
  const share = async v => {
    setBusy(true)
    try { await setCohortShare(v); update(s => { (s.coach = s.coach || emptyCoach()).share = v }); await load() }
    catch (e) { toast(e.message || t('Could not save')) }
    setBusy(false)
  }
  const sharing = !!d?.sharing
  return <div className="chat-menu">
    <h3>{t('Compare with others here')}</h3>
    <Section footer={t('Only medians across everyone who shares, never a name, a body weight or a single session. Turning this off removes you from the numbers immediately.')}>
      <Row icon="person" iconTint="var(--teal)" title={t('Include me')} subtitle={sharing ? t('Your lifts count towards the medians') : t('Off — you see nothing and share nothing')}>
        <Switch checked={sharing} disabled={busy || !d} onChange={share} />
      </Row>
    </Section>
    {!d && <div className="chat-empty">{t('Loading…')}</div>}
    {d && sharing && !d.ok && <div className="chat-empty">{d.people != null
      ? t('Not enough people share yet — {0} of {1} needed. Ask your gym mates.', d.people, d.minPeople)
      : t('Not available right now.')}</div>}
    {d && sharing && d.ok && <div className="ins" style={{ padding: 0 }}>
      <div className="ins-tiles">
        <Tile v={d.people} l={t('People')} />
        <Tile v={fmtNum(d.sessionsPerWeek.you)} l={t('Your sessions / wk')} />
        <Tile v={fmtNum(d.sessionsPerWeek.median)} l={t('Median / wk')} />
        <Tile v={d.rankPct != null ? d.rankPct + '%' : '—'} l={t('Your strength rank')} />
      </div>
      {!!d.exercises.length && <div className="ins-block">
        <div className="ins-h"><span>{t('Estimated 1RM, you vs. median')}</span><span className="dim">{S.unit}</span></div>
        {d.exercises.map(x => {
          const max = Math.max(x.median, x.you || 0) || 1
          return <div key={x.id} className="cmp">
            <div className="cmp-h"><span>{x.name}</span><span className="dim">{x.people} {t('people')}</span></div>
            <div className="cmp-bar you"><i style={{ width: Math.round((x.you || 0) / max * 100) + '%' }} /><span>{t('You')} · {x.you != null ? fmtNum(x.you) : '—'}</span></div>
            <div className="cmp-bar"><i style={{ width: Math.round(x.median / max * 100) + '%' }} /><span>{t('Median')} · {fmtNum(x.median)}</span></div>
          </div>
        })}
      </div>}
      {!d.exercises.length && <div className="chat-empty">{t('No exercise is trained by three or more people yet.')}</div>}
    </div>}
    <div style={{ height: 10 }} />
  </div>
}

/* ---------------------------------- cadence ---------------------------------- */

const cadenceLabel = coach => {
  const c = coach.cadence && coach.cadence !== 'off' ? coach.cadence : null
  if (!c) return t('Off')
  if (c.weekly) return t('Weekly')
  return t('After every few workouts')
}

function cadenceSheet(openSheet, update) {
  openSheet(close => <CadenceSheet close={close} update={update} />)
}
function CadenceSheet({ update }) {
  const coach = useStore(s => s.S.coach) || emptyCoach()
  const cadence = coach.cadence && coach.cadence !== 'off' ? coach.cadence : null
  const mode = !cadence ? 'off' : cadence.weekly ? 'weekly' : 'every'
  const setMode = m => update(s => {
    const c = (s.coach = s.coach || emptyCoach())
    c.cadence = m === 'off' ? 'off' : m === 'weekly' ? { weekly: { day: 0, time: '18:00' } } : { everyWorkouts: 4 }
  })
  const patch = fn => update(s => { const c = (s.coach = s.coach || emptyCoach()); fn(c) })
  return <>
    <h3>{t('Automatic reviews')}</h3>
    <Section footer={mode === 'off' ? t('Off — the Coach only looks when you ask it to.') : t('You are only notified when the Coach actually has something to suggest.')}>
      <SelectRow icon="clock" iconTint="var(--purple)" title={t('When')} value={mode} onChange={setMode}
        options={[
          { value: 'off', label: t('Off') },
          { value: 'weekly', label: t('Weekly'), subtitle: t('On a day and time you choose') },
          { value: 'every', label: t('After every few workouts'), subtitle: t('As soon as you have logged enough') }
        ]} />
      {mode === 'weekly' && <>
        <SelectRow icon="calendar" iconTint="var(--orange)" title={t('Day')} value={cadence.weekly.day}
          onChange={v => patch(c => { c.cadence = { weekly: { ...c.cadence.weekly, day: v } } })}
          options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => ({ value: i, label: t(d) }))} />
        <Row icon="clock" iconTint="var(--purple)" title={t('Time')}>
          <input type="time" className="timef" value={cadence.weekly.time || '18:00'}
            onChange={e => patch(c => { c.cadence = { weekly: { ...c.cadence.weekly, time: e.target.value } } })} />
        </Row>
      </>}
      {mode === 'every' && <SelectRow icon="dumbbell" iconTint="var(--teal)" title={t('After how many workouts')}
        value={cadence.everyWorkouts || 4}
        onChange={v => patch(c => { c.cadence = { everyWorkouts: v } })}
        options={[3, 4, 5, 6, 8, 10].map(n => ({ value: n, label: t('{0} workouts', n) }))} />}
    </Section>
  </>
}
