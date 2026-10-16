import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { deltaTone, weighInTime } from '../lib/bodyweight.js'
import { t } from '../lib/i18n.js'
import { rangeFrom, rangeOptions, rangeStart, storedRange } from '../lib/progress-range.js'
import { bwSheet, goalSheet, weighInsSheet } from '../sheets.jsx'
import { Card, EmptyState } from './blocks.jsx'
import { LineArt } from './line-art.jsx'
import LineChart from './LineChart.jsx'
import { ActionButton, ActionRow, HeroStatus, TabSection } from './tab-kit.jsx'
import { Segmented } from './ui.jsx'

const TONE = { toward: 'ink-acc', away: 'ink-danger' }
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n))

// Body › Weight: [Log weight] [Goal] [All weigh-ins], the latest weigh-in with its change over the
// range and the way to the goal, then the trend at the range the Progress root was on (its own
// range buttons below it). No weigh-in yet: the scale, empty, and Log weight.
export default function BodyWeight() {
  const S = useStore(s => s.S)
  const { search } = useLocation()
  const [range, setRange] = useState(() => rangeFrom(search, storedRange()))
  const from = useMemo(() => rangeStart(range), [range])
  const last = S.bodyweight.at(-1)
  const inRange = useMemo(() => S.bodyweight.filter(b => weighInTime(b) >= from), [S.bodyweight, from])
  const points = useMemo(() => inRange.map(b => ({ t: weighInTime(b), y: b.w, d: b.d })), [inRange])
  const change = inRange.length > 1 ? inRange.at(-1).w - inRange[0].w : null
  const goal = S.targetW
  const toGoal = last && goal ? goal - last.w : null

  return <>
    <TabSection>
      <ActionRow>
        <ActionButton icon="plus" label={t('Log weight')} onClick={() => bwSheet()} />
        <ActionButton icon="target" label={goal ? fmtNum(goal) + ' ' + S.unit : t('Goal')} ariaLabel={goal ? t('Goal {0}', fmtNum(goal) + ' ' + S.unit) : undefined} onClick={goalSheet} />
        <ActionButton icon="list" label={t('All weigh-ins')} onClick={weighInsSheet} disabled={!last} />
      </ActionRow>
    </TabSection>
    {last ? <>
      <TabSection>
        <HeroStatus eyebrow={t('Body weight')} value={fmtNum(last.w)} unit={S.unit} caption={fmtDate(last.d, true)}>
          {!!change && <p className="hero-c">
            <span className={TONE[deltaTone(change, last.w, goal)]}>{signed(change) + ' ' + S.unit}</span> · {t('this period')}
          </p>}
          {toGoal != null && <p className="hero-c">
            {t('Goal')} {fmtNum(goal)} {S.unit} · {Math.abs(toGoal) < 0.05 ? t('reached!') : t(toGoal > 0 ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(toGoal)) + ' ' + S.unit)}
          </p>}
        </HeroStatus>
      </TabSection>
      <TabSection>
        <Card title={t('Trend')}>
          <Segmented className="seg-range" value={range} onChange={setRange} options={rangeOptions()} />
          <div className="chart"><LineChart points={points} h={160} unit={S.unit} goal={goal} label={t('Weight')} /></div>
        </Card>
      </TabSection>
    </> : <EmptyState art={<LineArt scene="scale" />} title={t('No weigh-ins yet')}
      secondary={{ icon: 'plus', label: t('Log weight'), onClick: () => bwSheet() }}>
      {S.weighIn === false ? t('Log your weight to start the curve.') : t('Log your weight to start the curve. We also ask before every workout.')}
    </EmptyState>}
  </>
}
