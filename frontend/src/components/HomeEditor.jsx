import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { HOME_CARDS, cardShown, homeOrderOf, moveCard } from '../lib/home-layout.js'
import { widgetsSheet } from './HealthWidgets.jsx'
import Icon from './Icon.jsx'
import { Button, Switch } from './ui.jsx'

// The pencil on Home: each card below the week, switched on or off and moved up or down. The
// health card has its own readings to choose, one tap further.
function HomeEditor({ close }) {
  const S = useStore(s => s.S)
  const update = fn => useStore.getState().update(fn)
  const order = homeOrderOf(S)
  return <>
    <h3>{t('Edit Home')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('The week and today’s workout stay on top. Choose the cards below them and their order.')}</div>
    <div className="sect-b">{order.map((id, i) => {
      const card = HOME_CARDS.find(c => c.id === id)
      return <div className="lrow" key={id}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name={card.icon} /></span>
        <span className="lrow-m">
          <span className="lrow-t">{t(card.label)}</span>
          {id === 'health' && <button className="link small" style={{ textAlign: 'start', color: 'var(--acc)' }} onClick={widgetsSheet}>{t('Health widgets')}</button>}
        </span>
        <button className="iconbtn sm" aria-label={t('Move up')} disabled={i === 0} onClick={() => update(s => { s.homeOrder = moveCard(order, id, -1) })}><Icon name="chevronUp" /></button>
        <button className="iconbtn sm" aria-label={t('Move down')} disabled={i === order.length - 1} onClick={() => update(s => { s.homeOrder = moveCard(order, id, 1) })}><Icon name="chevronDown" /></button>
        <Switch checked={cardShown(S, id)} aria-label={t(card.label)} onChange={v => update(s => { s[card.flag] = v })} />
      </div>
    })}</div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}

export const homeEditorSheet = () => useUI.getState().openSheet(close => <HomeEditor close={close} />)
