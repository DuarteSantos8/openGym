import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { Segmented } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import Stats from './Stats.jsx'
import Social from './Social.jsx'
import '../social.css'

export default function Profile() {
  const nav = useNavigate()
  const loc = useLocation()
  const user = useStore(s => s.user)
  // Existing /stats links open progress; Social has an explicit URL for back navigation
  const view = new URLSearchParams(loc.search).get('view') === 'social' ? 'social' : 'stats'
  return <>
    <div className="hdr"><div><h1>{t('Profile')}</h1><div className="sub">{user?.name || t('Progress & history')}</div></div>
      <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')}><Icon name="history" /></button></div>
    <div className="profile-tabs" role="group" aria-label={`${t('Stats')} / ${t('Social')}`}>
      <Segmented value={view} onChange={next => nav(next === 'social' ? '/stats?view=social' : '/stats')}
        options={[{ value: 'stats', label: t('Stats') }, { value: 'social', label: t('Social') }]} />
    </div>
    <section key={view} aria-label={view === 'stats' ? t('Stats') : t('Social')}>
      {view === 'stats' ? <Stats embedded /> : <Social />}
    </section>
  </>
}
