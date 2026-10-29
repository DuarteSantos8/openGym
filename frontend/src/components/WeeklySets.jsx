// Weekly sets per muscle against a target range (lib/muscle-targets.js): the Stats card, the
// optional Home line, and the sheet that sets each muscle's range.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { weeklyMuscleSets, mostRoom, targetOf, withTarget, TARGET_MUSCLES, TARGET_MAX } from '../lib/muscle-targets.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import Icon from './Icon.jsx'
import { Button, Stepper } from './ui.jsx'

const STATUS = {
  below: { label: () => t('room for more'), color: 'var(--blue)' },
  in: { label: () => t('in range'), color: 'var(--green)' },
  above: { label: () => t('above range'), color: 'var(--orange)' },
}

/** One muscle's line: name, "14 / 10–20", and a bar with the range drawn in. */
function SetsRow({ r }) {
  const top = Math.max(r.hi * 1.25, r.sets, 1)
  const pct = v => Math.min(100, (v / top) * 100)
  const st = STATUS[r.status]
  return <div className="wsets-row" role="group"
    aria-label={t('{0}: {1} sets this week, range {2} to {3}', t(r.name), fmtNum(r.sets), r.lo, r.hi) + ', ' + st.label()}>
    <div className="wsets-head">
      <span className="wsets-name">{t(r.name)}</span>
      <span className="wsets-num"><b>{fmtNum(r.sets)}</b> / {r.lo}–{r.hi}</span>
    </div>
    <div className="wsets-bar" aria-hidden="true">
      <span className="wsets-band" style={{ insetInlineStart: pct(r.lo) + '%', width: (pct(r.hi) - pct(r.lo)) + '%' }} />
      <span className="wsets-fill" style={{ width: pct(r.sets) + '%', background: st.color }} />
    </div>
    <div className="wsets-st small" style={{ color: st.color }}>{st.label()}</div>
  </div>
}

/** Stats: every main muscle's working sets this week against its range. */
export function WeeklySetsCard({ S }) {
  const rows = weeklyMuscleSets(S, todayISO())
  const inRange = rows.filter(r => r.status === 'in').length
  return <div className="card wsets-card" data-weekly-sets>
    <div className="row between" style={{ marginBottom: 2 }}>
      <h2 style={{ margin: 0 }}>{t('Sets per muscle this week')}</h2>
      <Button size="sm" icon="slider" onClick={muscleTargetsSheet}>{t('Ranges')}</Button>
    </div>
    <div className="small muted" style={{ marginBottom: 10 }}>
      {t('In range: {0} of {1} main muscles. A supporting muscle counts as a bit under half a set.', inRange, rows.length)}
    </div>
    {rows.map(r => <SetsRow key={r.slug} r={r} />)}
  </div>
}

/** Home (Settings → Look & Home → Weekly sets on Home): the muscle with the most room this week. */
export function WeeklySetsHomeLine({ S, onOpen }) {
  const today = todayISO()
  const rows = weeklyMuscleSets(S, today)
  if (!rows.some(r => r.sets > 0)) return null
  const room = mostRoom(rows)
  return <button type="button" className="wsets-home small" onClick={onOpen} onKeyDown={ev => ev.stopPropagation()}>
    <Icon name="figureStrength" />
    <span>{room
      ? t('Most room this week: {0}, {1} of {2}–{3} sets', t(room.name), fmtNum(room.sets), room.lo, room.hi)
      : t('Every main muscle is in range this week. Tidy.')}</span>
    <Icon name="chevronRight" className="chev" />
  </button>
}

function TargetsEditor() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const set = (slug, range) => update(s => {
    const next = withTarget(s.muscleTargets, slug, range)
    if (Object.keys(next).length) s.muscleTargets = next; else delete s.muscleTargets
  })
  const own = S.muscleTargets && Object.keys(S.muscleTargets).length > 0
  return <>
    <h3>{t('Weekly sets per muscle')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Starting points from hypertrophy research: below the low end is room for more, past the high end extra sets stop paying. Tweak them to fit you.')}</div>
    {TARGET_MUSCLES.map(slug => {
      const [lo, hi] = targetOf(S, slug)
      return <div key={slug} className="wsets-edit">
        <div className="wsets-edit-n">{t(MUSCLE_NAME[slug])}</div>
        <Stepper ariaLabel={t('{0}: low end', t(MUSCLE_NAME[slug]))} value={lo} step={1} min={0} max={TARGET_MAX} decimal={false}
          onChange={v => set(slug, [v, Math.max(v, hi)])} />
        <span className="dim">–</span>
        <Stepper ariaLabel={t('{0}: high end', t(MUSCLE_NAME[slug]))} value={hi} step={1} min={0} max={TARGET_MAX} decimal={false}
          onChange={v => set(slug, [Math.min(lo, v), v])} />
      </div>
    })}
    {own && <><div style={{ height: 12 }} /><Button variant="ghost" icon="reset" onClick={() => update(s => { delete s.muscleTargets })}>{t('Back to the defaults')}</Button></>}
  </>
}
export const muscleTargetsSheet = () => useUI.getState().openSheet(() => <TargetsEditor />)
