// The trainer dashboard's sheets: inviting a member (code + QR), assigning a routine to one or many,
// a comment on a workout, a weigh-in. Each one says before sending what will happen per member.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO, weekOrder, weekStartOf } from '../lib/format.js'
import { renderQrToCanvas } from '../lib/qr.js'
import { assignRoutine, assignOutcome, assignResult, commentOn, makeCode, makeGymCode, sendOps, trainerError, weekdayName } from '../lib/trainer-api.js'
import { Section, Row, SelectRow, Button, TextArea, NumberField } from './ui.jsx'
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
