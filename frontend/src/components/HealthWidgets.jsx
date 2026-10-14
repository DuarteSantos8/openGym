import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { HEALTH_METRICS } from '../lib/health/metrics.js'
import { MAX_WIDGETS, moveWidget, toggleWidget, visibleWidgets, widgetChoices, widgetsOf } from '../lib/health/widgets.js'
import { MetricCard } from '../views/Health.jsx'
import Icon from './Icon.jsx'
import { Button, Check } from './ui.jsx'

// Home's health card: the readings the profile chose (lib/health/widgets.js), each a tile with its
// latest value, its change and the last month's curve; a tap opens the metric. The card is there
// only when one of them has a reading, so a profile that never logs any health data keeps the Home
// it had.
export default function HealthWidgets() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const shown = visibleWidgets(S)
  if (!shown.length) return null
  return <div className="card">
    <div className="row between" style={{ marginBottom: 10 }}>
      <h2 style={{ margin: 0 }}>{t('Health')}</h2>
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn" onClick={widgetsSheet} aria-label={t('Health widgets')}><Icon name="pencil" /></button>
        <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Open Health')}><Icon name="chevronRight" /></button>
      </div>
    </div>
    <div className="health-grid" style={{ marginTop: 0 }}>{shown.map(k => <MetricCard key={k} S={S} type={k} />)}</div>
  </div>
}

function WidgetChooser({ close }) {
  const S = useStore(s => s.S)
  const chosen = widgetsOf(S)
  const set = list => useStore.getState().update(s => { s.homeWidgets = list })
  const others = widgetChoices(S).filter(k => !chosen.includes(k))
  const row = (k, on) => <div className="lrow" key={k}>
    <Check checked={on} label={t(HEALTH_METRICS[k].label)} onChange={() => set(toggleWidget(chosen, k))} />
    <span className="lrow-m"><span className="lrow-t">{t(HEALTH_METRICS[k].label)}</span></span>
    {on && <>
      <button className="iconbtn sm" aria-label={t('Move up')} disabled={chosen[0] === k} onClick={() => set(moveWidget(chosen, k, -1))}><Icon name="chevronUp" /></button>
      <button className="iconbtn sm" aria-label={t('Move down')} disabled={chosen[chosen.length - 1] === k} onClick={() => set(moveWidget(chosen, k, 1))}><Icon name="chevronDown" /></button>
    </>}
  </div>
  return <>
    <h3>{t('Health widgets')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Choose up to {0} readings for Home, in the order you want them. A widget shows once it has a reading.', MAX_WIDGETS)}</div>
    <div className="sect-b">{chosen.map(k => row(k, true))}</div>
    {chosen.length < MAX_WIDGETS && <>
      <h4 className="sec" style={{ marginTop: 14 }}>{t('More')}</h4>
      <div className="sect-b">{others.map(k => row(k, false))}</div>
    </>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export const widgetsSheet = () => useUI.getState().openSheet(close => <WidgetChooser close={close} />)
