import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { MOBILE, syncReminder } from '../lib/mobile.js'
import { enabledMeasurementFields, BP_KEY } from '../lib/measurements.js'
import { reminderOf, withReminder, checkinLabel, EVERY_CHOICES } from '../lib/checkin-reminder.js'
import { isOn } from '../lib/modules.js'
import { Button, Row, Section, SelectRow, Switch } from './ui.jsx'

// Check-in reminders (lib/checkin-reminder.js): one interval per thing you track, one time of day,
// one notification for whatever is due that morning. Body measurements → the bell, Progress photos
// → the bell, Settings → Notifications → Check-in reminders.

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined } }

/** The things one can be reminded of here, in the order the sheet lists them. */
export function reminderKeys(S) {
  const keys = []
  if (isOn(S, 'body')) keys.push('weight')
  for (const f of enabledMeasurementFields(S)) {
    if (f.pair) { if (!keys.includes(BP_KEY)) keys.push(BP_KEY); continue }
    keys.push(f.key)
  }
  keys.push('photos')
  // One set for something you no longer show stays listed, so it can be switched off.
  for (const k of Object.keys(reminderOf(S).items)) if (!keys.includes(k)) keys.push(k)
  return keys
}

const everyLabel = d => d === 7 ? t('Every week') : d === 14 ? t('Every 2 weeks') : d === 28 ? t('Every 4 weeks') : t('Every {0} days', d)

function CheckinReminder({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = reminderOf(S)
  const save = patch => {
    update(s => { s.checkinReminder = { ...withReminder(s, patch), tz: zone() } })
    // On the phones the notifications are queued right away, asking for permission once.
    if (MOBILE) syncReminder({ ...useStore.getState().S }, !!patch.on).catch(() => {})
  }
  const setEvery = (key, every) => {
    const items = { ...r.items }
    if (!every) delete items[key]
    else items[key] = { every, since: items[key]?.since || todayISO() }
    save({ items, ...(every && !r.on ? { on: true } : {}) })
  }
  const keys = reminderKeys(S)
  const choices = [{ value: 0, label: t('Off') }, ...EVERY_CHOICES.map(d => ({ value: d, label: everyLabel(d) }))]
  const anySet = Object.keys(r.items).length > 0
  return <>
    <h3>{t('Check-in reminders')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick how often for each one. On a day something is due you get one notification for all of it, not a pile of pings.')}</div>
    <div className="sect-b" style={{ marginBottom: 14 }}>
      <Row icon="bell" iconTint="var(--orange)" title={t('Remind me')}>
        <Switch checked={r.on} onChange={on => save({ on, ...(on && !anySet ? { items: { photos: { every: 28, since: todayISO() }, ...(isOn(S, 'body') ? { weight: { every: 7, since: todayISO() } } : {}) } } : {}) })} aria-label={t('Remind me')} />
      </Row>
      {r.on && <Row icon="clock" iconTint="var(--purple)" title={t('Time')} subtitle={t('Mornings work best: same time, before breakfast.')}>
        <input type="time" className="timef" value={r.time} aria-label={t('Time')} onChange={e => e.target.value && save({ time: e.target.value })} />
      </Row>}
    </div>
    {r.on && <Section title={t('What and how often')}>
      {keys.map(k => {
        const label = checkinLabel(S, k, t)
        if (!label) return null
        const cur = r.items[k]?.every || 0
        return <SelectRow key={k} title={label} sheetTitle={label} value={cur}
          options={choices.some(c => c.value === cur) ? choices : [...choices, { value: cur, label: everyLabel(cur) }]}
          onChange={v => setEvery(k, Number(v) || 0)} />
      })}
    </Section>}
    {r.on && <div className="muted small" style={{ margin: '4px 4px 14px', lineHeight: 1.45 }}>
      {MOBILE
        ? t('Comes from this phone, even offline. Log the thing and that reminder resets.')
        : t('Arrives as a browser notification when notifications are on (Settings → Notifications) and you are signed in to a server. Log the thing and that reminder resets.')}
    </div>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export const checkinReminderSheet = () => useUI.getState().openSheet(close => <CheckinReminder close={close} />)

/** The row in Settings → Notifications. */
export function CheckinReminderRow() {
  const S = useStore(s => s.S)
  const r = reminderOf(S)
  const on = r.on && Object.keys(r.items).length > 0
  return <Row icon={on ? 'bell' : 'bellSlash'} iconTint="var(--orange)" title={t('Check-in reminders')} accessory="chevron"
    value={on ? t('On') : t('Off')} onClick={checkinReminderSheet} />
}

