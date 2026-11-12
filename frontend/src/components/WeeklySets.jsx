// Weekly sets per muscle against a target range (lib/muscle-targets.js): the optional Home line
// and the sheet that sets each muscle's range. On Stats the ranges are drawn in the Muscles card
// (Stats.jsx MusclesCard), the bars beside the map.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { weeklyMuscleSets, mostRoom, targetOf, withTarget, mainMusclesOnly, TARGET_MUSCLES, TARGET_MAX } from '../lib/muscle-targets.js'
import { MUSCLE_NAME } from '../lib/muscles.js'
import Icon from './Icon.jsx'
import { Button, Row, Stepper, Switch } from './ui.jsx'

/** Home (Settings → Look & Home → Weekly sets on Home): the muscle with the most room this week. */
export function WeeklySetsHomeLine({ S, onOpen }) {
  const today = todayISO()
  const rows = weeklyMuscleSets(S, today)
  if (!rows.some(r => r.sets > 0)) return null
  const room = mostRoom(rows)
  return <button type="button" className="wsets-home small" onClick={onOpen}>
    <Icon name="figureStrength" />
    <span>{room
      ? t('Most room this week: {0}, {1} of {2}–{3} sets', t(room.name), fmtNum(room.sets), room.lo, room.hi)
      : t('Every main muscle is in range this week. Tidy.')}</span>
    <Icon name="chevronRight" className="chev" />
  </button>
}

/** The sets on the Stats bars count main muscles only: said under them, so a number that dropped
    is explained. Nothing when supporting muscles count in part, as they do by default. */
export function MainMusclesCaption({ S }) {
  return mainMusclesOnly(S) ? <div className="mus-cap small dim" data-main-muscles>{t('Main muscles only')}</div> : null
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
    {/* S.muscleSetsMain (lib/muscle-targets.js): true when on, no field when off. */}
    <div className="sect-b" style={{ marginBottom: 12 }}>
      <Row title={t('Count main muscles only')} subtitle={t('A set counts for the muscles an exercise mainly trains, not the ones that help.')}>
        <Switch aria-label={t('Count main muscles only')} checked={mainMusclesOnly(S)}
          onChange={v => update(s => { if (v) s.muscleSetsMain = true; else delete s.muscleSetsMain })} />
      </Row>
    </div>
    {TARGET_MUSCLES.map(slug => {
      const [lo, hi] = targetOf(S, slug)
      return <div key={slug} className="wsets-edit">
        <div className="wsets-edit-n">{t(MUSCLE_NAME[slug])}</div>
        <div className="wsets-edit-r">
        <Stepper ariaLabel={t('{0}: low end', t(MUSCLE_NAME[slug]))} value={lo} step={1} min={0} max={TARGET_MAX} decimal={false}
          onChange={v => set(slug, [v, Math.max(v, hi)])} />
        <span className="dim" aria-hidden="true">–</span>
        <Stepper ariaLabel={t('{0}: high end', t(MUSCLE_NAME[slug]))} value={hi} step={1} min={0} max={TARGET_MAX} decimal={false}
          onChange={v => set(slug, [Math.min(lo, v), v])} />
        </div>
      </div>
    })}
    {own && <><div style={{ height: 12 }} /><Button variant="ghost" icon="reset" onClick={() => update(s => { delete s.muscleTargets })}>{t('Back to the defaults')}</Button></>}
  </>
}
export const muscleTargetsSheet = () => useUI.getState().openSheet(() => <TargetsEditor />)
