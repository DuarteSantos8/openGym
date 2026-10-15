import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { featuresFor, pageTrail, PAGES } from '../views/settings-pages.js'
import { Row, Section } from './ui.jsx'

// Profile › Features (ia-proposal §5, §9 q12): every switch that starts off, whether it is on, and
// the page it is on. A tap opens that page with the switch flashed (or, for a reminder that waits
// on push, the push switch), so each one is set in one place only. A switch only its page can read
// (web push, Health Connect) shows no value here.
export default function FeaturesList({ S, ctx }) {
  const nav = useNavigate()
  const rows = featuresFor(ctx)
  const valueOf = e => {
    const on = e.feature(S, ctx)
    return on == null ? null : on ? t('On') : t('Off')
  }
  return <Section title={t('Off until you turn them on')} footer={t('Tap one to go to its switch.')}>
    {rows.map(e => (
      <Row key={e.page + ':' + e.title} icon={PAGES[e.page].icon} iconTint={PAGES[e.page].tint} title={t(e.title)}
        subtitle={pageTrail(e.page)} value={valueOf(e)} accessory="chevron"
        onClick={() => nav('/me/' + e.page, { state: e.via ? { find: e.title, via: e.via } : { find: e.title } })} />
    ))}
  </Section>
}
