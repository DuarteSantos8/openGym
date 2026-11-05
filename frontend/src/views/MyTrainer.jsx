// Settings → Account → Trainer & gym (docs/TRAINERS.md): what each trainer and gym lead sees of
// this profile, per category, with a way to change it, end it, or connect a new trainer by code.
// The member decides, the server enforces: every change here is a request the server checks, and
// counts from the trainer's very next request. Only shown with config.trainers (TRAINERS=on).
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, baseLang } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { CATEGORY_IDS, TRAINER_DEFAULTS, leadScopes, sharesNothing } from '../lib/sharing-scopes.js'
import {
  getSharing, checkCode, connectTrainer, declineCode, updateGrant, disconnectGrant, leaveGym, sharingLog, sharingExport,
  categoryLabel, levelLabel, levelsFor, summarize, consentWords, logLine, sharingError,
} from '../lib/sharing-api.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, SelectRow, Button, TextField } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { getInbox, answerItem, markSeen, undoChange, previewGrant, changeLines, trainerError } from '../lib/trainer-api.js'
import { noticeText } from '../lib/trainer-notice-text.js'
import TrainerMember from '../components/TrainerMember.jsx'

const ICON = { metrics: 'gauge', workouts: 'dumbbell', plans: 'calendar', bodyweight: 'scale', measurements: 'ruler', photos: 'image', notes: 'pencil', nutrition: 'heart' }
const TINT = { metrics: 'var(--blue)', workouts: 'var(--green)', plans: 'var(--orange)', bodyweight: 'var(--teal)', measurements: 'var(--indigo)', photos: 'var(--pink)', notes: 'var(--yellow)', nutrition: 'var(--red)' }

// One row per category. `cap` keeps the gym lead row at See; `ceiling` keeps it under the trainer's.
function ScopeRows({ scopes, onChange, cap = 'apply', ceiling }) {
  return CATEGORY_IDS.map(cat => {
    let opts = levelsFor(cat, cap)
    if (ceiling) opts = opts.filter(lv => lv === 'off' || ceiling[cat] !== 'off')
    if (opts.length < 2) return <Row key={cat} icon={ICON[cat]} iconTint={TINT[cat]} title={categoryLabel(cat)} value={levelLabel('off')} />
    return <SelectRow key={cat} icon={ICON[cat]} iconTint={TINT[cat]} title={categoryLabel(cat)} value={scopes[cat] || 'off'}
      options={opts.map(lv => ({ value: lv, label: levelLabel(lv) }))} onChange={v => onChange({ ...scopes, [cat]: v })} />
  })
}

// "Sees: …" and "May suggest: …" under a name, so the page answers the question without a tap.
function shareLine(scopes) {
  const parts = []
  const sees = summarize(scopes, 'view', true)
  if (sees) parts.push(t('Sees: {0}', sees))
  const sug = summarize(scopes, 'suggest'), app = summarize(scopes, 'apply')
  if (sug) parts.push(t('May suggest: {0}', sug))
  if (app) parts.push(t('May change: {0}', app))
  return parts.length ? parts.join('. ') : t('Sees nothing right now')
}

// The consent screen: who, which gym, who is responsible, what each side may, and the text.
function ConsentSheet({ code, preview, lang, close, done }) {
  const toast = useUI(s => s.toast)
  const [scopes, setScopes] = useState(preview.defaults || TRAINER_DEFAULTS)
  const mode = preview.leadMode
  const hasLead = !!preview.gym && mode !== 'none'
  const [lead, setLead] = useState(preview.leadDefaults || null)
  const [busy, setBusy] = useState(false)
  // The lead row follows the trainer row down as it is edited, never up past what was ticked.
  const shownLead = hasLead ? leadScopes(mode, scopes, mode === 'row' ? lead : null) : null
  const nothing = sharesNothing(scopes)
  const yes = () => {
    setBusy(true)
    connectTrainer({ code, scopes, leadScopes: shownLead, consent: preview.consent, lang })
      .then(() => { close(); toast(t('Sent. {0} confirms it next.', preview.trainer.name)); done() })
      .catch(e => { setBusy(false); toast(sharingError(e)) })
  }
  const no = () => { declineCode(code).catch(() => {}); close() }
  return <>
    <h3>{t('Connect with {0}?', preview.trainer.name)}</h3>
    {preview.gym && <p className="intg-lead" style={{ marginBottom: 6 }}>{t('Trainer at {0}', preview.gym.name)}
      {preview.gym.contact ? <><br />{t('Responsible: {0}', preview.gym.contact)}</> : null}</p>}
    <Section title={t('{0} can', preview.trainer.name)} footer={t('{0} sees only what is on here.', preview.trainer.name)}>
      <ScopeRows scopes={scopes} onChange={setScopes} />
    </Section>
    {hasLead && <Section title={preview.gym.leads?.length ? t('Gym lead ({0})', preview.gym.leads.join(', ')) : t('Gym lead')}
      footer={t('The gym lead only ever sees, never changes. Switch off what they should not see.')}>
      {mode === 'row'
        ? <ScopeRows scopes={shownLead} onChange={setLead} cap="view" ceiling={scopes} />
        : <Row title={shareLine(shownLead)} />}
    </Section>}
    <p className="intg-lead">{consentWords(preview.consent)}</p>
    {nothing && <p className="intg-problem" role="alert" style={{ marginBottom: 10 }}>{t('Share at least one thing, or tap Not now.')}</p>}
    <Button variant="primary" disabled={busy || nothing} onClick={yes}>{t('Connect')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={no} disabled={busy}>{t('Not now')}</Button>
  </>
}

// A gym's join code (GY-…): no trainer, only the gym lead row, under the lead text.
const LEAD_CONSENT = 'You are joining this gym. Its gym lead sees your name and the categories you mark here, never more than view. You can change this or leave the gym any time, and it stops working the moment you do.'
function JoinGymSheet({ code, preview, lang, close, done }) {
  const toast = useUI(s => s.toast)
  const mode = preview.leadMode
  const [lead, setLead] = useState(preview.leadDefaults || {})
  const [busy, setBusy] = useState(false)
  const yes = () => {
    setBusy(true)
    connectTrainer({ code, scopes: {}, leadScopes: lead, consent: preview.consent, lang })
      .then(() => { close(); toast(t('Welcome to {0}', preview.gym.name)); done() })
      .catch(e => { setBusy(false); toast(sharingError(e)) })
  }
  if (preview.member) return <><h3>{preview.gym.name}</h3><p className="intg-lead">{t('You are in this gym already.')}</p><Button onClick={close}>{t('Close')}</Button></>
  return <>
    <h3>{t('Join {0}?', preview.gym.name)}</h3>
    {preview.gym.contact && <p className="intg-lead" style={{ marginBottom: 6 }}>{t('Responsible: {0}', preview.gym.contact)}</p>}
    {mode !== 'none' ? <Section title={preview.gym.leads?.length ? t('Gym lead ({0})', preview.gym.leads.join(', ')) : t('Gym lead')}
      footer={t('The gym lead only ever sees, never changes. Switch off what they should not see.')}>
      <ScopeRows scopes={lead} onChange={setLead} cap="view" />
    </Section> : <p className="intg-lead">{t('The gym lead sees your name, nothing else.')}</p>}
    <p className="intg-lead">{preview.consent?.text === LEAD_CONSENT ? t(LEAD_CONSENT) : preview.consent?.text}</p>
    <Button variant="primary" disabled={busy} onClick={yes}>{t('Join')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close} disabled={busy}>{t('Not now')}</Button>
  </>
}

// What a trainer or gym sent: suggestions to take or leave, comments, notices, the private offer.
function InboxCard({ item, unit, onAnswer }) {
  const who = item.from?.name || t('A former trainer')
  const when = fmtDate(new Date(item.at).toISOString().slice(0, 10))
  if (item.kind === 'suggest') return <div className="tr-card tr-inbox">
    <div className="tr-inbox-h"><span className="tr-inbox-i" style={{ '--tint': 'var(--orange)' }}><Icon name="lightbulb" /></span>
      <span><b>{t('{0} suggests', who)}</b><span className="tr-tile-s"> · {when}</span></span></div>
    <ul className="tr-inbox-l">{changeLines(item.summary, unit).map((l, i) => <li key={i}>{l}</li>)}</ul>
    {item.message && <p className="tr-quote">{item.message}</p>}
    <div className="tr-code-a"><Button size="sm" variant="primary" onClick={() => onAnswer(item, true)}>{t('Take it')}</Button>
      <Button size="sm" variant="tinted" onClick={() => onAnswer(item, false)}>{t('No thanks')}</Button></div>
  </div>
  if (item.kind === 'offer') return <div className="tr-card tr-inbox">
    <div className="tr-inbox-h"><span className="tr-inbox-i" style={{ '--tint': 'var(--blue)' }}><Icon name="personCircle" /></span>
      <span><b>{t('{0} left {1}', item.names?.[0] || who, item.names?.[1] || '')}</b></span></div>
    <p className="tr-inbox-p">{t('Keep training together privately? Your sharing stays as it is, without the gym lead. Until {0}, then it ends by itself.', fmtDate(new Date(item.expires).toISOString().slice(0, 10)))}</p>
    <div className="tr-code-a"><Button size="sm" variant="primary" onClick={() => onAnswer(item, true)}>{t('Stay connected')}</Button>
      <Button size="sm" variant="tinted" onClick={() => onAnswer(item, false)}>{t('End it')}</Button></div>
  </div>
  const isComment = item.kind === 'comment'
  const n = isComment ? null : noticeText(item.notice, item.names || [])
  return <div className={'tr-card tr-inbox' + (item.seen ? '' : ' new')}>
    <div className="tr-inbox-h"><span className="tr-inbox-i" style={{ '--tint': isComment ? 'var(--green)' : 'var(--indigo)' }}><Icon name={isComment ? 'chat' : 'bell'} /></span>
      <span><b>{isComment ? (item.workout || item.about ? t('{0} on {1}', who, item.workout ? item.workout.name || t('Workout') : item.about) : who) : n.title}</b><span className="tr-tile-s"> · {when}</span></span>
      <button className="tr-x" onClick={() => onAnswer(item, false)} aria-label={t('Dismiss')}><Icon name="xmark" /></button></div>
    {isComment ? <p className="tr-quote">{item.text}</p> : n.body && <p className="tr-inbox-p">{n.body}</p>}
  </div>
}

export default function MyTrainerPage() {
  const S = useStore(s => s.S)
  const lang = S.lang || baseLang(navigator.language || 'en')
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const loc = useLocation()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [log, setLog] = useState(null)
  const [code, setCode] = useState(() => new URLSearchParams(loc.search).get('code') || '')
  const [busy, setBusy] = useState(false)
  const autoChecked = useRef(false)

  const [inbox, setInbox] = useState(null)
  const load = () => {
    getSharing().then(r => { setD(r); setErr(null) }).catch(e => setErr(sharingError(e)))
    sharingLog().then(r => setLog(r.log || [])).catch(() => setLog([]))
    getInbox().then(setInbox).catch(() => setInbox(null))
  }
  useEffect(load, [])
  // Opening the page is reading it: the notice on Home goes away.
  useEffect(() => { if (inbox?.unseen) markSeen().catch(() => {}) }, [inbox?.unseen])
  const answer = (item, yes) => {
    const extra = item.kind === 'offer' && yes ? { consent: d?.consent ? { v: d.consent.v, hash: d.consent.hash } : null, lang } : null
    answerItem(item.id, yes, extra).then(r => {
      if (item.kind === 'suggest') toast(yes ? t('Done. It syncs to your devices in a moment.') : t('Turned down. No hard feelings.'))
      if (item.kind === 'offer') toast(yes ? (r.paused ? t('Kept. It starts once they may train privately here.') : t('Kept. Same sharing, no gym in between.')) : t('Ended.'))
      load()
    }).catch(e => { toast(trainerError(e)); load() })
  }
  const undo = (u, force) => undoChange(u.id, force).then(() => { toast(t('Undone. Your devices catch up in a moment.')); load() }).catch(e => {
    if (e?.data?.code === 'changed-since') return confirmSheet({ title: t('Undo anyway?'), message: t('You changed it yourself since. Undo puts it back the way it was before {0}.', u.by?.name || t('your trainer')), confirmText: t('Undo'), onConfirm: () => undo(u, true) })
    toast(trainerError(e))
  })
  const preview = c => previewGrant(c.id).then(p => openSheet(close => <><TrainerMember d={p} preview /><Button onClick={close}>{t('Close')}</Button></>, { wide: true }))
    .catch(e => toast(sharingError(e)))

  const check = c => {
    const typed = (c ?? code).trim()
    if (!typed) return
    setBusy(true)
    checkCode(typed)
      .then(preview => openSheet(close => preview.kind === 'gym'
        ? <JoinGymSheet code={typed} preview={preview} lang={lang} close={close} done={() => { setCode(''); load() }} />
        : <ConsentSheet code={typed} preview={preview} lang={lang} close={close} done={() => { setCode(''); load() }} />))
      .catch(e => toast(sharingError(e)))
      .finally(() => setBusy(false))
  }
  // Opened from a trainer's QR (#/settings/trainer?code=…): straight to the consent screen.
  useEffect(() => {
    if (autoChecked.current || !code || !d) return
    autoChecked.current = true
    check(code)
  }, [d])

  const change = (g, scopes) => updateGrant({ id: g.id, scopes, consent: d.consent, lang })
    .then(() => { toast(t('Saved. It counts right away.')); load() })
    .catch(e => toast(sharingError(e)))
  const disconnect = (g, name) => confirmSheet({
    title: t('Disconnect {0}?', name),
    message: t('It stops the moment you tap. {0} notices on the next reload.', name),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => disconnectGrant(g.id).then(() => { toast(t('Disconnected')); load() }).catch(e => toast(sharingError(e))),
  })
  const leave = gym => confirmSheet({
    title: t('Leave {0}?', gym.name),
    message: t('Your gym lead and the trainers of this gym stop seeing anything. Private trainers stay.'),
    confirmText: t('Leave'), danger: true,
    onConfirm: () => leaveGym(gym.id).then(() => { toast(t('You left {0}', gym.name)); load() }).catch(e => toast(sharingError(e))),
  })
  const download = () => sharingExport().then(r => {
    const json = JSON.stringify(r, null, 2), name = 'opengym-sharing.json'
    if (MOBILE) return shareExport(json, name)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }).catch(e => toast(sharingError(e)))

  if (err && !d) return <Section footer={err}><Row icon="reset" title={t('Try again')} onClick={load} accessory="chevron" /></Section>
  if (!d) return <div className="muted small" style={{ padding: 16 }}>{t('Loading…')}</div>

  const open = (inbox?.items || []).filter(i => i.status === 'open')
  const undos = (inbox?.undo || []).filter(u => u.canUndo || u.undoneAt).slice(0, 15)
  return <>
    {open.length > 0 && <Section title={t('For you')}>
      <div className="tr-inbox-list">{open.map(i => <InboxCard key={i.id} item={i} unit={S.unit === 'lb' ? 'lb' : 'kg'} onAnswer={answer} />)}</div>
    </Section>}
    <Section title={t('Add a trainer')} footer={t('Your trainer gives you a code or a QR. Nothing is shared until you say yes.')}>
      <div className="intg-field" style={{ margin: '10px 12px' }}>
        <label className="intg-label" htmlFor="trainer-code">{t('Trainer or gym code')}</label>
        <TextField id="trainer-code" name="trainer-code" placeholder="TR-XXXXX-XXXXX" value={code} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          maxLength={20} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') check() }} />
      </div>
      <div style={{ margin: '0 12px 12px' }}><Button variant="primary" size="sm" disabled={busy || !code.trim()} onClick={() => check()}>{t('Check code')}</Button></div>
    </Section>

    {d.connections.map(c => {
      const name = c.trainer.name || t('A former trainer')
      const status = c.status === 'pending' ? t('Waiting for {0} to say yes', name)
        : c.paused ? t('Paused for now. Nothing is shared while it is.') : t('Connected since {0}', fmtDate(new Date(c.since).toISOString().slice(0, 10)))
      return <div key={c.id}>
        <Section title={c.gym ? t('{0} at {1}', name, c.gym.name) : name} footer={t('Changes count right away.')}>
          <Row icon="personCircle" iconTint="var(--acc)" title={status} subtitle={shareLine(c.scopes)} />
          <ScopeRows scopes={c.scopes} onChange={s => change(c, s)} />
        </Section>
        {c.lead && <Section title={c.gym?.leads?.length ? t('Gym lead ({0})', c.gym.leads.join(', ')) : t('Gym lead')}
          footer={t('The gym lead only ever sees, never changes. Switch off what they should not see.')}>
          {d.leadMode === 'row'
            ? <ScopeRows scopes={c.lead.scopes} onChange={s => change(c.lead, s)} cap="view" ceiling={c.scopes} />
            : <Row title={shareLine(c.lead.scopes)} />}
        </Section>}
        <Section>
          {c.status === 'active' && <Row icon="magnifier" iconTint="var(--blue)" title={t('See what {0} sees', name)} accessory="chevron" onClick={() => preview(c)} />}
          <Row icon="signOut" iconTint="var(--red)" title={t('Disconnect')} danger onClick={() => disconnect(c, name)} />
        </Section>
      </div>
    })}

    {d.gyms.length > 0 && <Section title={t('Your gyms')}>
      {d.gyms.map(g => <Row key={g.id} icon="mapPin" iconTint="var(--green)" title={g.name}
        subtitle={g.contact ? t('Responsible: {0}', g.contact) : null} value={t('Leave')} onClick={() => leave(g)} />)}
    </Section>}

    {undos.length > 0 && <Section title={t('What your trainers changed')} footer={t('Undo puts back what was there before, on all your devices. For 30 days.')}>
      {undos.map(u => <Row key={u.id} icon={u.accepted ? 'lightbulb' : 'pencil'} iconTint={u.accepted ? 'var(--orange)' : 'var(--acc)'}
        title={changeLines(u.summary, S.unit === 'lb' ? 'lb' : 'kg').join(', ') || t('A change')}
        subtitle={(u.accepted ? t('{0} suggested, you took it', u.by?.name || t('A former trainer')) : t('By {0}', u.by?.name || t('A former trainer'))) + ' · ' + fmtDate(new Date(u.at).toISOString().slice(0, 10))}
        value={u.undoneAt ? t('Undone') : null}>
        {!u.undoneAt && <Button size="xs" variant="tinted" icon="undo" onClick={() => undo(u)}>{t('Undo')}</Button>}
      </Row>)}
    </Section>}

    <Section title={t('Sharing log')} footer={t('Only you can read this.')}>
      {log && !log.length && <Row title={t('Nothing here yet.')} />}
      {(log || []).slice(0, 30).map(e => <Row key={e.id} title={logLine(e)}
        subtitle={fmtDate(new Date(e.last || e.at).toISOString().slice(0, 10))} value={e.n > 1 ? '×' + e.n : null} />)}
      <Row icon="download" iconTint="var(--blue)" title={t('Download my sharing record')}
        subtitle={t('Everything this server keeps about your sharing, in one file.')} accessory="chevron" onClick={download} />
    </Section>
  </>
}
