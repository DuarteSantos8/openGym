// The parts of "arrange your own Home and Stats" you can see (lib/page-layout.js has the rules):
//   <Arranged>      draws a page's cards in the person's order, folded ones as one line, and tells
//                   lib/card-live.js which of them drew anything
//   <CustomizeLink> the quiet button at the end of the page that opens the sheet
//   layoutSheet()   the sheet: Show / Collapsed / Hide per card, and its place among its neighbours
//
// Moving (1.4.6, owner 2026-11-23): hold a row and drag it, or drag it by its grip at once; the
// rows make room as it passes and it glides into its slot (lib/use-list-reorder.js). The two
// arrow buttons are still there for a keyboard and a screen reader, out of sight. The sheet only
// lists the cards that have something to show today, plus the hidden ones (so they can come
// back); a card turned on that has nothing yet says when it will show up.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { isOn } from '../lib/modules.js'
import { useListReorder } from '../lib/use-list-reorder.js'
import { reportCard, cardLive, liveVersion, subscribeLive } from '../lib/card-live.js'
import Icon from './Icon.jsx'
import { Button, Segmented, Switch } from './ui.jsx'
import { PAGES, GROUP_LABELS, STATS_LINKS, groupOf, linkShown, setLinkShown, arrange, cardState, orderedCards, setCardState, moveCard, placeCard, resetLayout, isCustom, dismissedNote } from '../lib/page-layout.js'

const labelOf = (page, id) => t(PAGES[page].find(c => c.id === id).label)

/**
 * A folded card: one line with its name. A tap opens it for this visit and the line stays as its
 * header, so the same tap puts it away again. Many cards decide for themselves whether they have
 * anything to show (no deload this week, no challenge yet); a card that draws nothing gets no
 * line either, which is why the card is always rendered and only hidden.
 */
function Fold({ page, id, label, children }) {
  const [open, setOpen] = useState(false)
  const [has, setHas] = useState(true)
  const body = useRef(null)
  useLayoutEffect(() => {
    const now = !!body.current && body.current.childElementCount > 0
    if (now !== has) setHas(now)
    reportCard(page, id, now)
  })
  return <div className={'fold' + (open ? ' open' : '')} data-fold>
    {has && <button type="button" className="fold-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span>{label}</span><Icon name={open ? 'chevronUp' : 'chevronDown'} />
    </button>}
    <div ref={body} className="fold-b" hidden={!open}>{children}</div>
  </div>
}

function Shown({ page, id, children }) {
  const el = useRef(null)
  useLayoutEffect(() => { reportCard(page, id, !!el.current && el.current.childElementCount > 0) })
  return <div ref={el} className="arr" data-card={id}>{children}</div>
}

/**
 * `items`: [{ id, node }] in the built-in order; falsy nodes are cards that do not apply right now.
 * `group` (Stats) limits the list to one part of the page.
 */
export function Arranged({ page, items, S }) {
  const live = items.filter(x => x && x.node)
  const byId = new Map(live.map(x => [x.id, x.node]))
  const off = items.filter(x => x && !x.node).map(x => x.id).join(',')
  useLayoutEffect(() => { for (const id of off ? off.split(',') : []) reportCard(page, id, false) }, [page, off])
  return arrange(S, page, live.map(x => x.id)).map(id => cardState(S, page, id) === 'folded'
    ? <Fold key={id} page={page} id={id} label={labelOf(page, id)}>{byId.get(id)}</Fold>
    : <Shown key={id} page={page} id={id}>{byId.get(id)}</Shown>)
}

export function CustomizeLink({ page }) {
  return <div className="customize-link">
    <Button size="sm" variant="ghost" className="dim" icon="layout" onClick={() => layoutSheet(page)}>{t('Customize')}</Button>
  </div>
}

const STATES = () => [{ value: 'shown', label: t('Show') }, { value: 'folded', label: t('Collapsed') }, { value: 'hidden', label: t('Hide') }]

/** One part of the page (all of Home, or one of Stats' parts): its rows, in order, movable. */
function LayoutGroup({ page, group, cards, S, update }) {
  useSyncExternalStore(subscribeLive, liveVersion)
  const ids = cards.map(c => c.id)
  const r = useListReorder(cards.length, (from, to) => update(s => { placeCard(s, page, ids[from], ids[to]) }))
  return <div className="lay-group">
    {group && <h4 className="sec">{t(GROUP_LABELS[group])}</h4>}
    <div className="sect-b lay-list" ref={r.listRef}>
      {cards.map((c, i) => {
        // A card put away with its own × reads as hidden, with until when; Show brings it back.
        const note = dismissedNote(S, page, c.id)
        const name = t(c.label), state = note ? 'hidden' : cardState(S, page, c.id)
        const empty = state !== 'hidden' && cardLive(page, c.id) === false
        return <div key={c.id} data-reorder-row data-reorder-key={c.id} data-lay={c.id} style={r.rowStyle(i)} {...r.press(i)}
          className={'lay-row' + (state === 'hidden' ? ' off' : '') + (r.held(i) ? ' held' : '')}>
          <div className="lay-top">
            {cards.length > 1 && <button type="button" className="lay-grip" aria-label={t('Move {0}', name)} title={t('Drag to reorder')} {...r.handle(i)}>
              <Icon name="grip" />
            </button>}
            <span className="lay-name">{name}{empty && <span className="lay-hint">{t('Shows up when there is something to show')}</span>}{note && <span className="lay-hint" data-dismissed>{t(note)}</span>}</span>
            <span className="lay-move">
              <button type="button" className="vh" aria-label={t('Move {0} up', name)} disabled={i === 0}
                onClick={() => update(s => { moveCard(s, page, c.id, -1) })}><Icon name="chevronUp" /></button>
              <button type="button" className="vh" aria-label={t('Move {0} down', name)} disabled={i === cards.length - 1}
                onClick={() => update(s => { moveCard(s, page, c.id, 1) })}><Icon name="chevronDown" /></button>
            </span>
          </div>
          <Segmented of={name} value={state} options={STATES()} onChange={v => update(s => { setCardState(s, page, c.id, v) })} />
          {page === 'stats' && c.id === 'links' && state !== 'hidden' && <LinkSwitches S={S} update={update} />}
        </div>
      })}
    </div>
  </div>
}

/** The rows of Stats' More list, each with its own switch (owner 2026-11-24). */
function LinkSwitches({ S, update }) {
  const rows = STATS_LINKS.filter(l => !l.needs || isOn(S, l.needs))
  return <div className="lay-subs" data-lay-links>
    {rows.map(l => <label key={l.id} className="lay-sub" data-lay-link={l.id}>
      <span>{t(l.label)}</span>
      <Switch checked={linkShown(S, l.id)} aria-label={t(l.label)} onChange={v => update(s => { setLinkShown(s, l.id, v) })} />
    </label>)}
  </div>
}

function LayoutSheet({ page, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  // Which cards to offer is decided once, as the sheet opens: what the page drew, plus the hidden
  // ones. A card turned on here that has nothing yet stays in the list, with a word on when.
  const [offered] = useState(() => new Set(orderedCards(S, page)
    .filter(c => cardState(S, page, c.id) === 'hidden' || dismissedNote(S, page, c.id) || cardLive(page, c.id) !== false).map(c => c.id)))
  const cards = orderedCards(S, page).filter(c => (!c.needs || isOn(S, c.needs)) && offered.has(c.id))
  const groups = [...new Set(cards.map(c => groupOf(c, S)))]
  return <>
    <h3>{t('Customize')} · {t(page === 'home' ? 'Home' : 'Stats')}</h3>
    <div className="muted small">{t('Show what you use, collapse what you rarely open and hide the rest. Hold a card to move it.')}</div>
    {groups.map(g => <LayoutGroup key={g || 'all'} page={page} group={g} cards={cards.filter(c => groupOf(c, S) === g)} S={S} update={update} />)}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
    {isCustom(S, page) && <><div style={{ height: 8 }} /><Button onClick={() => update(s => { resetLayout(s, page) })}>{t('Reset')}</Button></>}
  </>
}

export const layoutSheet = page => useUI.getState().openSheet(close => <LayoutSheet page={page} close={close} />)
