import { useLocation, useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Segmented } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import Stats from './Stats.jsx'
import Social from './Social.jsx'
import '../profile.css'

export default function StatsPage() {
  const nav = useNavigate()
  const loc = useLocation()
  const socialCount = useUI(s => s.socialCount)
  // Existing /stats links always open the charts; Social is an explicit destination
  const view = new URLSearchParams(loc.search).get('view') === 'social' ? 'social' : 'stats'
  const socialLabel = <span className="stats-tab-label">{t('Social')}
    {socialCount > 0 && <b aria-label={t('{0} pending items', socialCount)}>{socialCount > 99 ? '99+' : socialCount}</b>}</span>

  return <>
    <div className="hdr"><div><h1>{t('Stats')}</h1><div className="sub">{t('Progress & history')}</div></div>
      <button className="iconbtn" onClick={() => nav('/history')} aria-label={t('History')}><Icon name="history" /></button></div>
    <div className="stats-tabs-shell">
      <Segmented className="stats-tabs" value={view} onChange={next => nav(next === 'social' ? '/stats?view=social' : '/stats', { replace: true })}
        tablist ariaLabel={`${t('Stats')} / ${t('Social')}`} options={[
          { value: 'stats', label: t('Stats'), controls: 'stats-progress' },
          { value: 'social', label: socialLabel, controls: 'stats-social' }
        ]} />
    </div>
    <section key={view} id={view === 'stats' ? 'stats-progress' : 'stats-social'} role="tabpanel">
      {view === 'stats' ? <Stats embedded /> : <Social embedded />}
    </section>
  </>
}
