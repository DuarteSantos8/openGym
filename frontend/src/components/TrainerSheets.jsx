// The trainer dashboard's sheets: inviting a member (code + QR), assigning a routine to one or many,
// a comment on a workout, a weigh-in, a check-in, a workout logged or corrected. Each one says
// before sending what will happen per member.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO, weekOrder, weekStartOf } from '../lib/format.js'
import { renderQrToCanvas } from '../lib/qr.js'
import { assignRoutine, assignOutcome, assignResult, commentOn, makeCode, makeGymCode, sendOps, trainerError, weekdayName, exName } from '../lib/trainer-api.js'
import { MEASUREMENT_FIELDS } from '../lib/measurements.js'
import { CATALOGUE, searchExercises } from '../lib/exercises.js'
import { Section, Row, SelectRow, Button, TextArea, TextField, NumberField, SearchField } from './ui.jsx'
import DateField from './DateField.jsx'
import Icon from './Icon.jsx'

async function copyText(s, toast) {
  try { await navigator.clipboard.writeText(s); toast(t('Copied')) } catch { toast(s) }
}

/** A code, shown once, big and as a QR, with copy and share. */
export function CodeCard({ code, link, expires, uses }) {
  const toast = useUI(s => s.toast)
  const ref = useRef(null)
  useEffect(() => { renderQrToCanvas(ref.current, link).catch(() => {}) }, [link])
  const share = () => (navigator.share ? navigator.share({ text: link }).catch(() => {}) : copyText(link, toast))
  return <div className="tr-code">
    <canvas ref={ref} className="qr-canvas tr-qr" aria-label={t('QR code for {0}', code)} role="img" />
    <div className="tr-code-v" aria-live="polite">{code}</div>
    <div className="tr-tile-s">{t('Valid until {0}', fmtDate(new Date(expires).toISOString().slice(0, 10)))}{uses ? ' · ' + t('{0} uses', uses) : ''}</div>
    <div className="tr-code-a">
      <Button size="sm" variant="tinted" icon="copy" onClick={() => copyText(code, toast)}>{t('Copy code')}</Button>
      <Button size="sm" variant="tinted" icon="share" onClick={share}>{t('Share link')}</Button>
    </div>
  </div>
}

/** "Connect a member": private or for one of the trainer's gyms, one person or a whole class. */
export function InviteSheet({ overview, close }) {
  const toast = useUI(s => s.toast)
  const gyms = overview?.gyms || []
  const where = [...gyms.filter(g => !g.disabled).map(g => ({ value: g.id, label: g.name })), ...(overview?.canInviteFree ? [{ value: '', label: t('Private client') }] : [])]
  const [gym, setGym] = useState(where[0]?.value ?? '')
  const [uses, setUses] = useState(1)
  const [made, setMade] = useState(null)
  const [busy, setBusy] = useState(false)
  const go = () => {
    setBusy(true)
    makeCode({ gymId: gym || null, maxUses: uses, days: 7 }).then(setMade).catch(e => toast(trainerError(e))).finally(() => setBusy(false))
  }
  if (!where.length) return <><h3>{t('Connect a member')}</h3><p className="intg-lead">{t('You are not a trainer anywhere yet. An admin or gym lead can change that.')}</p><Button onClick={close}>{t('Close')}</Button></>
  return <>
    <h3>{t('Connect a member')}</h3>
    {!made ? <>
      <p className="intg-lead">{t('They scan it or type it in Trainer & gym, pick what to share, and you confirm. Nothing moves before that.')}</p>
      <Section>
        {where.length > 1 && <SelectRow icon="mapPin" iconTint="var(--green)" title={t('For')} value={gym} options={where} onChange={setGym} />}
        <Row icon="person" iconTint="var(--blue)" title={t('How many people')}>
          <NumberField className="tr-num" value={uses} decimal={false} onChange={v => setUses(Math.max(1, Math.min(200, Math.round(+v || 1))))} aria-label={t('How many people')} />
        </Row>
      </Section>
      <p className="sect-f" style={{ marginTop: -6 }}>{t('One code for a whole class works too. It runs out after 7 days.')}</p>
      <Button variant="primary" icon="qr" disabled={busy} onClick={go}>{t('Make a code')}</Button>
    </> : <>
      <CodeCard code={made.code} link={made.link} expires={made.expires} uses={made.maxUses > 1 ? made.maxUses : 0} />
      <p className="intg-lead">{t('This is the only time the code is shown. Make a new one any time.')}</p>
      <Button onClick={close}>{t('Done')}</Button>
    </>}
  </>
}

/** The gym's join code (gym leads): members join the gym, no trainer involved. */
export function GymCodeSheet({ gym, close }) {
  const toast = useUI(s => s.toast)
  const [made, setMade] = useState(null)
  useEffect(() => { makeGymCode(gym.id).then(setMade).catch(e => { toast(trainerError(e)); close() }) }, [])
  return <>
    <h3>{t('Join {0}', gym.name)}</h3>
    <p className="intg-lead">{t('Put it on the front desk. Whoever scans it joins the gym and chooses what you see.')}</p>
    {made ? <CodeCard code={made.code} link={made.link} expires={made.expires} uses={made.maxUses} /> : <p className="muted small">{t('Loading…')}</p>}
    <Button onClick={close}>{t('Done')}</Button>
  </>
}

/** Assign one of my routines to `members` ({ member, levels }[]), optionally onto a weekday. */
export function AssignSheet({ members, close, done }) {
  const toast = useUI(s => s.toast)
  const S = useStore(s => s.S)
  const routines = (S.routines || []).filter(r => r && r.ex?.length)
  const [rid, setRid] = useState(routines[0]?.id ?? null)
  const [day, setDay] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const order = weekOrder(weekStartOf(S))
  const plan = members.map(m => ({ ...m, outcome: assignOutcome(m.levels) }))
  const n = plan.filter(p => p.outcome !== 'skipped').length
  const go = () => {
    setBusy(true)
    assignRoutine({ memberIds: members.map(m => m.member.id), routineId: rid, day: day === '' ? null : +day, message: msg.trim() || undefined })
      .then(r => { toast(assignResult(r)); close(); done?.(r) })
      .catch(e => { setBusy(false); toast(trainerError(e)) })
  }
  if (!routines.length) return <><h3>{t('Assign a routine')}</h3>
    <p className="intg-lead">{t('Build the routine in your own Plan tab first. It goes out as a copy, yours stays yours.')}</p>
    <Button onClick={close}>{t('Close')}</Button></>
  return <>
    <h3>{t('Assign a routine')}</h3>
    <Section>
      <SelectRow icon="dumbbell" iconTint="var(--acc)" title={t('Routine')} value={rid} options={routines.map(r => ({ value: r.id, label: r.name }))} onChange={setRid} />
      <SelectRow icon="calendar" iconTint="var(--orange)" title={t('On their week')} value={day}
        options={[{ value: '', label: t('Not on a day') }, ...order.map(d => ({ value: String(d), label: t('Every {0}', weekdayName(d)) }))]} onChange={setDay} />
    </Section>
    <div className="intg-field" style={{ margin: '0 0 14px' }}>
      <label className="intg-label" htmlFor="tr-msg">{t('A word with it (optional)')}</label>
      <TextArea id="tr-msg" rows={2} maxLength={300} value={msg} onChange={e => setMsg(e.target.value)} placeholder={t('Focus on form, the weight can wait.')} />
    </div>
    <Section title={t('Who gets it')} footer={t('They decide how far you may go. Suggestions wait for their yes.')}>
      {plan.map(p => <Row key={p.member.id} title={p.member.name}
        value={{ applied: t('Added directly'), suggested: t('As a suggestion'), skipped: t('Skipped, plans not shared') }[p.outcome]}
        icon={p.outcome === 'applied' ? 'checkCircle' : p.outcome === 'suggested' ? 'lightbulb' : 'xmark'}
        iconTint={p.outcome === 'applied' ? 'var(--green)' : p.outcome === 'suggested' ? 'var(--orange)' : 'var(--grey)'} />)}
    </Section>
    <Button variant="primary" disabled={busy || !n || rid == null} onClick={go}>{n ? t('Send to {0}', n) : t('Nobody can take it')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Cancel')}</Button>
  </>
}

/** A comment on one workout. It goes to their inbox, never into their data. */
export function CommentSheet({ member, workout, close, done }) {
  const toast = useUI(s => s.toast)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const go = () => {
    setBusy(true)
    commentOn(member.id, workout.id, text.trim()).then(() => { toast(t('Sent to {0}', member.name)); close(); done?.() })
      .catch(e => { setBusy(false); toast(trainerError(e)) })
  }
  return <>
    <h3>{t('Comment on {0}', workout.name || t('Workout'))}</h3>
    <p className="intg-lead">{fmtDate(workout.d)}. {t('{0} reads it in their inbox.', member.name)}</p>
    <TextArea rows={4} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder={t('Clean reps! Add 2.5 next time.')} aria-label={t('Comment')} autoFocus />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !text.trim()} onClick={go}>{t('Send')}</Button>
  </>
}

/** A weigh-in on the studio scale: written directly, or sent as a suggestion. */
export function WeighSheet({ member, unit, level, close, done }) {
  const toast = useUI(s => s.toast)
  const [w, setW] = useState('')
  const [busy, setBusy] = useState(false)
  const go = () => {
    setBusy(true)
    sendOps(member.id, [{ op: 'bodyweight.put', d: todayISO(), w: +w }])
      .then(r => { toast(r.applied ? t('Saved to {0}’s log', member.name) : t('Sent. {0} decides.', member.name)); close(); done?.() })
      .catch(e => { setBusy(false); toast(trainerError(e)) })
  }
  return <>
    <h3>{level === 'apply' ? t('Log a weigh-in') : t('Suggest a weigh-in')}</h3>
    <p className="intg-lead">{t('Today, in {0}.', unit)} {level === 'apply' ? t('It lands in their log with your name on it, and they can undo it.') : t('It waits for their yes.')}</p>
    <div className="tr-weigh"><NumberField value={w} onChange={setW} nullable aria-label={t('Weight')} autoFocus /><span>{unit}</span></div>
    <Button variant="primary" icon="scale" disabled={busy || !(+w > 0)} onClick={go}>{t('Save')}</Button>
  </>
}

// What a change does once sent, the same words on every sheet below.
const sentToast = (r, member) => (r.applied ? t('Saved to {0}’s log', member.name) : t('Sent. {0} decides.', member.name))
const landsLine = level => (level === 'apply' ? t('It lands in their log with your name on it, and they can undo it.') : t('It waits for their yes.'))
const isWarm = s => s?.phase === 'warmup' || (s?.phase == null && s?.warmup === true)

/** A typo fixed in a logged workout: the name, and the weight or reps of the sets it has. */
export function WorkoutEditSheet({ member, workout, customEx, unit, level, close, done }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState(workout.name || '')
  const [vals, setVals] = useState({})
  const [busy, setBusy] = useState(false)
  const key = (e, s, side) => `${e}.${s}.${side || ''}`
  const val = (k, f, was) => (vals[k]?.[f] !== undefined ? vals[k][f] : was)
  const put = (k, f, v) => setVals(x => ({ ...x, [k]: { ...x[k], [f]: v } }))
  const changes = []
  workout.entries.forEach((e, ei) => e.sets.forEach((st, si) => {
    for (const side of st.sides ? ['L', 'R'] : [null]) {
      const was = side ? st.sides[side] || {} : st, k = key(ei, si, side), c = {}
      for (const f of ['w', 'r']) { const v = vals[k]?.[f]; if (v !== undefined && v !== null && v !== '' && +v !== +(was[f] ?? 0)) c[f] = +v }
      if (Object.keys(c).length) changes.push({ e: ei, s: si, ex: e.id, ...(side ? { side } : {}), ...c })
    }
  }))
  const renamed = name.trim() && name.trim() !== (workout.name || '') ? name.trim() : null
  const go = () => {
    setBusy(true)
    sendOps(member.id, [{ op: 'workout.edit', id: workout.id, ...(renamed ? { name: renamed } : {}), sets: changes }])
      .then(r => { toast(sentToast(r, member)); close(); done?.() })
      .catch(e => { setBusy(false); toast(trainerError(e)) })
  }
  const row = (k, was, label) => <div key={k} className="tr-set">
    <span className="tr-set-l">{label}</span>
    <NumberField value={val(k, 'w', was.w ?? 0)} onChange={v => put(k, 'w', v)} nullable className="tr-num" aria-label={t('{0}: weight', label)} />
    <span className="muted">{unit} ×</span>
    <NumberField value={val(k, 'r', was.r ?? 0)} onChange={v => put(k, 'r', v)} decimal={false} nullable className="tr-num" aria-label={t('{0}: reps', label)} />
  </div>
  return <>
    <h3>{level === 'apply' ? t('Correct this workout') : t('Suggest a correction')}</h3>
    <p className="intg-lead">{fmtDate(workout.d)}. {t('Fix a typo in what they logged. Nothing gets added or removed.')} {landsLine(level)}</p>
    <TextField value={name} onChange={e => setName(e.target.value)} maxLength={80} aria-label={t('Name')} />
    {workout.entries.map((e, ei) => <div key={ei} className="tr-card tr-edit-ex">
      <div className="tr-card-t">{exName(e.id, customEx)}</div>
      {e.sets.map((st, si) => {
        const n = isWarm(st) ? t('Warm-up') : t('Set {0}', si + 1)
        return st.sides ? ['L', 'R'].map(side => row(key(ei, si, side), st.sides[side] || {}, `${n} ${side === 'L' ? t('Left') : t('Right')}`)) : row(key(ei, si), st, n)
      })}
    </div>)}
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="pencil" disabled={busy || (!changes.length && !renamed)} onClick={go}>{level === 'apply' ? t('Save') : t('Send')}</Button>
  </>
}

/** A workout the member did with the trainer, logged for them: a date, a name, exercises and sets. */
export function WorkoutAddSheet({ member, recent = [], customEx, unit, level, close, done }) {
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(todayISO())
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [list, setList] = useState([])
  const [busy, setBusy] = useState(false)
  const hits = q.trim() ? searchExercises(CATALOGUE, q).slice(0, 6) : []
  const add = id => { setList(l => [...l, { id, sets: [{ w: '', r: '' }, { w: '', r: '' }, { w: '', r: '' }] }]); setQ('') }
  const setOf = (i, j, f, v) => setList(l => l.map((x, k) => (k !== i ? x : { ...x, sets: x.sets.map((s, m) => (m === j ? { ...s, [f]: v } : s)) })))
  const entries = list.map(x => ({ id: x.id, sets: x.sets.filter(s => +s.r > 0).map(s => ({ w: +s.w || 0, r: +s.r })) })).filter(x => x.sets.length)
  const go = () => {
    setBusy(true)
    sendOps(member.id, [{ op: 'workout.add', workout: { d, name: name.trim() || t('Workout'), entries } }])
      .then(r => { toast(sentToast(r, member)); close(); done?.() })
      .catch(e => { setBusy(false); toast(trainerError(e)) })
  }
  const quick = recent.filter(id => !list.some(x => x.id === id)).slice(0, 8)
  return <>
    <h3>{level === 'apply' ? t('Log a workout') : t('Suggest a workout')}</h3>
    <p className="intg-lead">{t('For a session you ran together.')} {landsLine(level)}</p>
    <DateField value={d} max={todayISO()} onChange={setD} label={t('Date')} />
    <div style={{ height: 8 }} />
    <TextField value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder={t('Workout')} aria-label={t('Name')} />
    {list.map((x, i) => <div key={i} className="tr-card tr-edit-ex">
      <div className="tr-card-t tr-edit-h"><span>{exName(x.id, customEx)}</span>
        <button className="tr-x" onClick={() => setList(l => l.filter((_, k) => k !== i))} aria-label={t('Remove {0}', exName(x.id, customEx))}><Icon name="xmark" /></button></div>
      {x.sets.map((s, j) => <div key={j} className="tr-set">
        <span className="tr-set-l">{t('Set {0}', j + 1)}</span>
        <NumberField value={s.w} onChange={v => setOf(i, j, 'w', v)} nullable className="tr-num" aria-label={t('{0}: weight', t('Set {0}', j + 1))} />
        <span className="muted">{unit} ×</span>
        <NumberField value={s.r} onChange={v => setOf(i, j, 'r', v)} decimal={false} nullable className="tr-num" aria-label={t('{0}: reps', t('Set {0}', j + 1))} />
      </div>)}
      {x.sets.length < 30 && <Button size="xs" variant="plain" icon="plus" onClick={() => setList(l => l.map((y, k) => (k === i ? { ...y, sets: [...y.sets, { ...y.sets[y.sets.length - 1] }] } : y)))}>{t('Add set')}</Button>}
    </div>)}
    {list.length < 40 && <>
      <div style={{ height: 10 }} />
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Add an exercise')} aria-label={t('Add an exercise')} />
      {(hits.length ? hits.map(e => e.id) : quick).length > 0 && <div className="tr-pick">
        {(hits.length ? hits.map(e => e.id) : quick).map(id => <button key={id} className="tr-pick-i" onClick={() => add(id)}><Icon name="plus" />{exName(id, customEx)}</button>)}
      </div>}
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="check" disabled={busy || !entries.length} onClick={go}>{level === 'apply' ? t('Save') : t('Send')}</Button>
  </>
}

/** A body check-in with the tape measure, in cm (body fat in %). */
export function MeasureSheet({ member, level, close, done }) {
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(todayISO())
  const [vals, setVals] = useState({})
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState(false)
  const values = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== '' && v != null && +v > 0).map(([k, v]) => [k, +v]))
  const go = () => {
    setBusy(true)
    sendOps(member.id, [{ op: 'measurement.put', d, values }])
      .then(r => { toast(sentToast(r, member)); close(); done?.() })
      .catch(e => { setBusy(false); toast(trainerError(e)) })
  }
  // Blood pressure stays the member's own: a trainer check-in is the tape and the body fat (api/trainers/ops.js).
  const fields = MEASUREMENT_FIELDS.filter(f => !f.pair && (all || !f.optional))
  return <>
    <h3>{level === 'apply' ? t('Log a check-in') : t('Suggest a check-in')}</h3>
    <p className="intg-lead">{t('Fill in what you measured, leave the rest.')} {landsLine(level)}</p>
    <DateField value={d} max={todayISO()} onChange={setD} label={t('Date')} />
    <div className="tr-card tr-edit-ex">
      {fields.map(f => <div key={f.key} className="tr-set">
        <span className="tr-set-l">{t(f.label)}</span>
        <NumberField value={vals[f.key] ?? ''} onChange={v => setVals(x => ({ ...x, [f.key]: v }))} nullable className="tr-num" aria-label={t(f.label)} />
        <span className="muted">{f.kind === 'percent' ? '%' : 'cm'}</span>
      </div>)}
      {!all && <Button size="xs" variant="plain" onClick={() => setAll(true)}>{t('More measurements')}</Button>}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="check" disabled={busy || !Object.keys(values).length} onClick={go}>{level === 'apply' ? t('Save') : t('Send')}</Button>
  </>
}
