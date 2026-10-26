// The weekly rate under the body-weight chart (#759), on Home and in Stats: the trend through the
// last three weeks of weigh-ins (lib/bodyweight.js weightRate), in the profile's unit and in
// percent of body weight, and, with a corridor set, whether it is on pace. Tapping it sets the
// corridor. Without one and without enough weigh-ins it stays out of the way.
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { weightRate, rateCorridor, rateStatus } from '../lib/bodyweight.js'
import Icon from './Icon.jsx'
import { Button, NumberField, Segmented } from './ui.jsx'

// Two decimals, signed: a lean bulk is +0.2 kg a week, and one decimal would round half of it away.
const signed = v => new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(Math.round(v * 100) / 100 + 0)
const size = v => new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 2 }).format(v)

const STATUS = {
  in: { text: () => t('On pace'), color: 'var(--acc)' },
  slow: { text: () => t('Slower than planned'), color: 'var(--yellow)' },
  fast: { text: dir => t(dir === 'gain' ? 'Gaining faster than planned' : 'Losing faster than planned'), color: 'var(--yellow)' },
  off: { text: () => t('Outside your range'), color: 'var(--yellow)' },
}

export const rateText = (rate, unit) => t('Trend {0} a week ({1})', signed(rate.perWeek) + ' ' + unit, signed(rate.pct) + ' %')

export default function WeightRate({ S }) {
  const rate = useMemo(() => weightRate(S.bodyweight), [S.bodyweight])
  const corridor = rateCorridor(S.rateGoal)
  if (!rate.enough && !corridor) return null
  const status = rateStatus(rate, S.rateGoal)
  return <button type="button" className="bw-rate small" onClick={rateGoalSheet} aria-label={t('Weekly rate')}>
    <Icon name="chartLine" style={{ fontSize: 13 }} />
    <span className="bw-rate-t">{rate.enough ? rateText(rate, S.unit) : t('A few more weigh-ins, spread over the next days, and you get a weekly trend.')}</span>
    {status && <b style={{ color: STATUS[status].color }}>{STATUS[status].text(corridor.dir)}</b>}
    <Icon name="chevronRight" className="dim" style={{ fontSize: 11, marginInlineStart: 'auto' }} />
  </button>
}

function RateGoalSheet({ close }) {
  const S = useStore(s => s.S)
  const rate = weightRate(S.bodyweight)
  const had = rateCorridor(S.rateGoal)
  const [dir, setDir] = useState(had?.dir || 'lose')
  const [by, setBy] = useState(had?.by || '%')
  const [lo, setLo] = useState(had ? Math.abs(had.dir === 'gain' ? had.min : had.max) : 0.5)
  const [hi, setHi] = useState(had ? Math.abs(had.dir === 'gain' ? had.max : had.min) : 1)
  const unit = by === 'w' ? S.unit : '%'
  const save = () => {
    const goal = dir === 'hold' ? { dir, by, lo: 0, hi: hi || 0 } : { dir, by, lo: lo || 0, hi: hi || 0 }
    if (!rateCorridor(goal)) { useUI.getState().toast(t('Enter a range first')); return }
    useStore.getState().update(s => { s.rateGoal = goal })
    close()
  }
  return <>
    <h3>{t('Weekly rate')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('The trend through your weigh-ins of the last 3 weeks, so one salty dinner does not move it. Give it a range and the card tells you whether you are on pace.')}
    </div>
    {rate.enough && <div className="small" style={{ marginBottom: 12 }}><b>{rateText(rate, S.unit)}</b></div>}
    <Segmented value={dir} onChange={setDir}
      options={[{ value: 'lose', label: t('Lose') }, { value: 'gain', label: t('Gain') }, { value: 'hold', label: t('Hold') }]} />
    <div style={{ height: 10 }} />
    <Segmented value={by} onChange={setBy}
      options={[{ value: '%', label: t('% of body weight') }, { value: 'w', label: S.unit }]} />
    <div className="rate-range">
      {dir === 'hold'
        ? <label className="measure-field"><span>{t('Within ±')}</span>
            <span className="measure-input"><NumberField value={hi} onChange={setHi} aria-label={t('Within ±')} /><i>{unit}</i></span></label>
        : <>
          <label className="measure-field"><span>{t('From')}</span>
            <span className="measure-input"><NumberField value={lo} onChange={setLo} aria-label={t('From')} /><i>{unit}</i></span></label>
          <label className="measure-field"><span>{t('To')}</span>
            <span className="measure-input"><NumberField value={hi} onChange={setHi} aria-label={t('To')} /><i>{unit}</i></span></label>
        </>}
    </div>
    <div className="small dim" style={{ marginBottom: 14 }}>
      {dir === 'hold'
        ? t('Hold within ±{0} a week.', size(hi || 0) + ' ' + unit)
        : t(dir === 'lose' ? 'Lose {0} to {1} a week.' : 'Gain {0} to {1} a week.', size(Math.min(lo || 0, hi || 0)), size(Math.max(lo || 0, hi || 0)) + ' ' + unit)}
      {' '}{t('A cut is often 0.5 to 1 % a week, a lean bulk 0.25 to 0.5 %.')}
    </div>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {had && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { useStore.getState().update(s => { s.rateGoal = null }); close() }}>{t('Remove range')}</Button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export const rateGoalSheet = () => useUI.getState().openSheet(close => <RateGoalSheet close={close} />)
