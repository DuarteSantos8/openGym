import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtAgo } from '../lib/format.js'
import { copyText } from '../lib/clipboard.js'
import { getCalendar, setCalendar, stopCalendar, webcalUrl } from '../lib/api-tokens.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Row, Switch, Button } from './ui.jsx'
import Icon from './Icon.jsx'

/* Settings → Integrations → Calendar feed (v1.4.5): your planned sessions, and if you like your
   finished workouts, as a private address Apple Calendar, Google Calendar or Outlook subscribe
   to. The server makes and keeps the address (api/integrations/calendar.js); this sheet turns it
   on, copies it, changes what it shows, makes a new one, or turns it off. */

export const CALENDAR_DOCS = 'https://github.com/DuarteSantos8/openGym/blob/main/docs/CALENDAR.md'
const toast = m => useUI.getState().toast(m)

export const calendarSheet = onChange => useUI.getState().openSheet(close => <CalendarSheet close={close} onChange={onChange} />)

export function CalendarSheet({ close, onChange }) {
  const [feed, setFeed] = useState(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let gone = false
    getCalendar().then(f => { if (!gone) { setFeed(f || { on: false }); setDone(!!f?.done) } }).catch(() => { if (!gone) setErr(true) })
    return () => { gone = true }
  }, [])
  const apply = async (fn, msg) => {
    setBusy(true)
    try { const f = await fn(); setFeed(f); setDone(!!f?.done); onChange?.(f); if (msg) toast(msg) }
    catch { toast(t('Something went wrong')) }
    finally { setBusy(false) }
  }
  const copy = async () => { if (await copyText(feed.url)) toast(t('Link copied. Paste it into your calendar app.')); else toast(t('Something went wrong')) }
  const head = <div className="intg-head">
    <h3 className="intg-h"><Icon name="calendar" /><span>{t('Calendar feed')}</span></h3>
    {feed?.on && <span className="intg-pill connected">{t('Connected')}</span>}
  </div>
  if (err) return <>{head}<p className="intg-lead">{t('Could not reach your server')}</p><Button variant="plain" onClick={close}>{t('Done')}</Button></>
  if (!feed) return <>{head}<p className="intg-lead">{t('Loading…')}</p></>
  const doneRow = <Section footer={t('A tick on every day you trained, with how many sets. Only you see it, the same as the plan.')}>
    <Row icon="checkCircle" iconTint="var(--green)" title={t('Show finished workouts too')}>
      <Switch aria-label={t('Show finished workouts too')} checked={done} disabled={busy}
        onChange={v => { setDone(v); if (feed.on) apply(() => setCalendar({ done: v })) }} />
    </Row>
  </Section>
  if (!feed.on) return <>
    {head}
    <p className="intg-lead">{t('Your planned sessions in Apple Calendar, Google Calendar or Outlook, kept up to date. A private link only your calendar knows.')}</p>
    {doneRow}
    <Button variant="primary" disabled={busy} onClick={() => apply(() => setCalendar({ done }))}>{t('Make my calendar link')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="tinted" onClick={() => window.open(CALENDAR_DOCS, '_blank', 'noopener')}>{t('How to set it up')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
  return <>
    {head}
    <p className="intg-lead">{t('Subscribe to this link in your calendar app. Anyone with it sees your plan, so keep it to yourself.')}</p>
    {feed.url
      ? <div className="cal-url" translate="no"><code>{feed.url}</code></div>
      : <p className="intg-note warn">{t('The server cannot show this link again. Make a new one.')}</p>}
    <p className="intg-note">{feed.used ? t('Last fetched by a calendar {0}', fmtAgo(feed.used)) : t('No calendar has fetched it yet.')}</p>
    {feed.url && <div className="intg-btns" style={{ marginTop: 12 }}>
      <Button variant="primary" icon="copy" onClick={copy}>{t('Copy link')}</Button>
      <Button variant="tinted" icon="calendar" onClick={() => { window.location.href = webcalUrl(feed.url) }}>{t('Open in my calendar app')}</Button>
    </div>}
    <div style={{ height: 12 }} />
    {doneRow}
    <div className="sect-b">
      <button type="button" className="lrow tap" disabled={busy} onClick={() => confirmSheet({
        title: t('Make a new link?'), message: t('The old link stops working, and every calendar that uses it needs the new one.'),
        confirmText: t('Make a new link'), onConfirm: () => apply(() => setCalendar({ done, renew: true }), t('New link made. The old one is gone.')),
      })}><Icon name="reset" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Make a new link')}</span></span></button>
    </div>
    <div className="sect-b intg-end">
      <button type="button" className="lrow tap danger" disabled={busy} onClick={() => confirmSheet({
        title: t('Turn off the calendar feed?'), message: t('The link stops working at once. What your calendar already shows may stay until it refreshes.'),
        confirmText: t('Turn off'), danger: true, onConfirm: () => apply(() => stopCalendar(), t('Calendar feed off')),
      })}><Icon name="trash" className="intg-act-i" /><span className="lrow-m"><span className="lrow-t">{t('Turn off')}</span></span></button>
    </div>
    <div style={{ height: 8 }} />
    <Button variant="plain" onClick={close}>{t('Done')}</Button>
  </>
}
