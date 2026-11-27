// The first workout of a new profile asks once how it should look (S.layoutAsk, set by
// freshState): one exercise per page, or the whole session as a list with its ticks. Both are
// drawn small, so the choice is a picture rather than two words. Coming from another app the list
// is often what people expect, and it used to hide behind ⋯ → Layout (Discord, 2026-11-24).
// Asked once: the question goes the moment it opens, so a swipe down keeps the cards for good.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'

/** Whether the first workout should ask: a profile made fresh here, not the tour's practice run,
    not editing an old workout or logging a past one. */
export const shouldAskLayout = (S, { sandbox = false, editing = false } = {}) =>
  S?.layoutAsk === true && !sandbox && !editing && !!S.active && !S.active.backfill

function Preview({ kind }) {
  const rows = n => Array.from({ length: n }, (_, i) => <i key={i} className={kind === 'list' && i < 2 ? 'on' : ''} />)
  return <div className={'lp-prev lp-' + kind} aria-hidden="true">
    {kind === 'cards'
      ? <><b className="lp-card"><s />{rows(3)}</b><b className="lp-card lp-peek" /></>
      : <><b className="lp-card"><s />{rows(2)}</b><b className="lp-card"><s />{rows(2)}</b><b className="lp-card"><s />{rows(1)}</b></>}
  </div>
}

function LayoutPickSheet({ close }) {
  const update = useStore(s => s.update)
  const pick = v => {
    update(s => { s.workoutView = v; if (s.active) delete s.active.workoutView })
    close()
  }
  const opts = [
    { v: 'cards', title: t('One at a time'), sub: t('One exercise per page. Next takes you on.') },
    { v: 'list', title: t('All on one page'), sub: t('The whole workout as a list, ticks and all.') },
  ]
  return <>
    <h3>{t('How should your workout look?')}</h3>
    <p className="intg-lead">{t('Pick what feels right. You can switch any time under ⋯ → Layout, or for good in Settings → Workout.')}</p>
    <div className="lp-opts">
      {opts.map(o => <button key={o.v} type="button" className="lp-opt" data-layout={o.v} onClick={() => pick(o.v)}>
        <Preview kind={o.v} />
        <span className="lp-t">{o.title}</span>
        <span className="lp-s">{o.sub}</span>
      </button>)}
    </div>
  </>
}

/** Opens the question and marks it asked. */
export function askLayout() {
  useStore.getState().update(s => { delete s.layoutAsk })
  useUI.getState().openSheet(close => <LayoutPickSheet close={close} />)
}
