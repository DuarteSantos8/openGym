// The parts of "arrange your own Home and Stats" you can see (lib/page-layout.js has the rules):
//   <Arranged>      draws a page's cards in the person's order, folded ones as one line
//   <CustomizeLink> the quiet button at the end of the page that opens the sheet
//   layoutSheet()   the sheet: Show / Collapsed / Hide per card, and up or down among its neighbours
// No drag and drop: two buttons do the same on a phone, with a keyboard and with a screen reader.
import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { isOn } from '../lib/modules.js'
import Icon from './Icon.jsx'
import { Button, Segmented } from './ui.jsx'
import { PAGES, GROUP_LABELS, arrange, cardState, orderedCards, setCardState, moveCard, resetLayout, isCustom } from '../lib/page-layout.js'

const labelOf = (page, id) => t(PAGES[page].find(c => c.id === id).label)

/**
 * A folded card: one line with its name. A tap opens it for this visit and the line stays as its
 * header, so the same tap puts it away again. Many cards decide for themselves whether they have
 * anything to show (no deload this week, no challenge yet); a card that draws nothing gets no
 * line either, which is why the card is always rendered and only hidden.
 */
function Fold({ label, children }) {
  const [open, setOpen] = useState(false)
  const [has, setHas] = useState(true)
  const body = useRef(null)
  useLayoutEffect(() => {
    const now = !!body.current && body.current.childElementCount > 0
    if (now !== has) setHas(now)
  })
  return <div className={'fold' + (open ? ' open' : '')} data-fold>
    {has && <button type="button" className="fold-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span>{label}</span><Icon name={open ? 'chevronUp' : 'chevronDown'} />
    </button>}
    <div ref={body} className="fold-b" hidden={!open}>{children}</div>
  </div>
}

/**
 * `items`: [{ id, node }] in the built-in order; falsy nodes are cards that do not apply right now.
 * `group` (Stats) limits the list to one part of the page.
 */
export function Arranged({ page, items, S }) {
  const live = items.filter(x => x && x.node)
  const byId = new Map(live.map(x => [x.id, x.node]))
  return arrange(S, page, live.map(x => x.id)).map(id => cardState(S, page, id) === 'folded'
    ? <Fold key={id} label={labelOf(page, id)}>{byId.get(id)}</Fold>
    : <div key={id} className="arr" data-card={id}>{byId.get(id)}</div>)
}

export function CustomizeLink({ page }) {
  return <div className="customize-link">
    <Button size="sm" variant="ghost" className="dim" icon="layout" onClick={() => layoutSheet(page)}>{t('Customize')}</Button>
  </div>
}

function LayoutSheet({ page, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const cards = orderedCards(S, page).filter(c => !c.needs || isOn(S, c.needs))
  const groups = [...new Set(cards.map(c => c.group))]
  const states = [{ value: 'shown', label: t('Show') }, { value: 'folded', label: t('Collapsed') }, { value: 'hidden', label: t('Hide') }]
  return <>
    <h3>{t('Customize')} · {t(page === 'home' ? 'Home' : 'Stats')}</h3>
    <div className="muted small">{t('Show what you use, collapse what you rarely open and hide the rest. The arrows change the order.')}</div>
    {groups.map(g => {
      const mine = cards.filter(c => c.group === g)
      return <div key={g || 'all'} className="lay-group">
        {g && <h4 className="sec">{t(GROUP_LABELS[g])}</h4>}
        <div className="sect-b lay-list">
          {mine.map((c, i) => {
            const name = t(c.label), state = cardState(S, page, c.id)
            return <div key={c.id} className={'lay-row' + (state === 'hidden' ? ' off' : '')} data-lay={c.id}>
              <div className="lay-top">
                <span className="lay-name">{name}</span>
                <span className="lay-move">
                  <button type="button" className="iconbtn" aria-label={t('Move {0} up', name)} disabled={i === 0}
                    onClick={() => update(s => { moveCard(s, page, c.id, -1) })}><Icon name="chevronUp" /></button>
                  <button type="button" className="iconbtn" aria-label={t('Move {0} down', name)} disabled={i === mine.length - 1}
                    onClick={() => update(s => { moveCard(s, page, c.id, 1) })}><Icon name="chevronDown" /></button>
                </span>
              </div>
              <Segmented of={name} value={state} options={states} onChange={v => update(s => { setCardState(s, page, c.id, v) })} />
            </div>
          })}
        </div>
      </div>
    })}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
    {isCustom(S, page) && <><div style={{ height: 8 }} /><Button onClick={() => update(s => { resetLayout(s, page) })}>{t('Reset')}</Button></>}
  </>
}

export const layoutSheet = page => useUI.getState().openSheet(close => <LayoutSheet page={page} close={close} />)
