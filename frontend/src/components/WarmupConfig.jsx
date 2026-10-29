// The warm-up part of an exercise's settings (#156, #525): where its warm-ups come from, and the
// rows of a block of your own. The rules live in lib/warmup-ramp.js; this only edits the slot's
// `warmup`, `warmupRows` and the older `warmupSets` count.
import { t } from '../lib/i18n.js'
import { SelectRow, Stepper, Button } from './ui.jsx'
import { fmtNum } from '../lib/format.js'
import { MAX_PLANNED_WARMUPS, barFloor, isBw, modeOf } from '../lib/history.js'
import { dropGrid } from '../lib/plates.js'
import { warmupAutoOf, warmupModeOf, warmupBlock, isCompoundEx, ownRowsOf, autoRungs, MAX_OWN_WARMUPS, OWN_PCT_MAX } from '../lib/warmup-ramp.js'
import { isWarmupRow } from '../lib/workout-model.js'

const LB_KG = 0.45359237

/** Which of the five choices the sheet shows for a config. */
export const warmupChoiceOf = c => warmupModeOf(c) || ((Math.round(c?.warmupSets) || 0) > 0 ? 'count' : 'default')

/** The config with `choice` picked: the keys of the others cleared, a block of your own seeded. */
export function withWarmupChoice(c, choice, seedRows) {
  const { warmup: _w, warmupRows, warmupSets: _s, ...rest } = c
  if (choice === 'default') return rest
  if (choice === 'count') return { ...rest, warmupSets: Math.max(1, Math.round(c.warmupSets) || 2) }
  if (choice === 'own') return { ...rest, warmup: 'own', warmupRows: warmupRows?.length ? warmupRows : seedRows }
  return { ...rest, warmup: choice }
}

/** The rows today's work weight would open with, as "20 × 10 · 40 × 5". Null when there is none to show. */
function previewLine(st, cfg, work, unit) {
  if (!(work > 0)) return null
  const rows = warmupBlock(st, cfg, [{ w: work, r: cfg.reps || 5 }], { grid: dropGrid(st, cfg), floor: barFloor(st, cfg.id), unit })
  if (!rows) return null
  if (!rows.length) return t('Nothing at {0} {1}: that one starts cold.', fmtNum(work), unit)
  return rows.filter(isWarmupRow).map(r => fmtNum(r.w) + ' × ' + (r.sides ? r.sides.L.r : r.r)).join(' · ')
}

export default function WarmupConfig({ st, ex, c, setC }) {
  const cfg = { ...c, id: ex.id }
  const mode = modeOf(cfg)
  const choice = warmupChoiceOf(c)
  const floor = barFloor(st, ex.id)
  const bw = isBw(cfg)
  const setting = warmupAutoOf(st)
  const followsAuto = setting === 'all' || (setting === 'compounds' && isCompoundEx(ex.id))
  const defaultLabel = followsAuto ? t('Default (auto)') : t('Default (none)')
  // The work weight the preview is built on: the slot's own, else the confirmed working weight.
  const work = Number(c.weight) > 0 ? Number(c.weight) : Number(st.exWeights?.[ex.id]?.w) || 0
  const unit = st.unit === 'lb' ? 'lb' : 'kg'
  const kg = unit === 'lb' ? work * LB_KG : work
  // A block of your own starts from what Auto would do, so there is something to edit.
  const seed = () => {
    const rungs = autoRungs({ work: work || 100, kg: kg || 100, bar: floor, compound: isCompoundEx(ex.id), bw })
    return (rungs.length ? rungs : [{ wp: 50, r: 10 }]).slice(0, MAX_OWN_WARMUPS)
  }
  const pick = v => setC(x => withWarmupChoice(x, v, seed()))
  const rows = ownRowsOf(c)
  const setRows = next => setC(x => ({ ...x, warmup: 'own', warmupRows: next }))
  const options = [
    { value: 'default', label: defaultLabel, subtitle: t('Follows Settings → Workout → Automatic warm-ups.') },
    { value: 'auto', label: t('Auto'), subtitle: t('Ramped from the work weight: more rungs when it is heavy, fewer when it is light.') },
    { value: 'own', label: t('My own'), subtitle: t('Your rows, as a share of the work weight, so they grow with it.') },
    { value: 'count', label: t('A number of ramp sets'), subtitle: t('Each one closes half the gap to the work weight.') },
    { value: 'none', label: t('None'), subtitle: t('Straight into the work sets.') },
  ]
  const shown = choice === 'auto' || (choice === 'default' && followsAuto) || choice === 'own'
  const preview = shown && mode === 'reps' ? previewLine(st, cfg, work, unit) : null
  // The lightest a rung can be: the bar on a barbell lift, the body alone on a bodyweight one.
  const lowest = floor > 0 || bw ? 0 : 5
  const pctLabel = r => (r.wb ? t('Bar') : r.wp === 0 ? t('Body') : r.wp + '%')
  return <div className="warmup-cfg" style={{ marginBottom: 18 }}>
    <div className="sect-b" style={{ marginBottom: 6 }}>
      <SelectRow icon="sunrise" iconTint="var(--orange)" title={t('Warm-ups')} value={choice} onChange={pick} options={options} />
    </div>
    {choice === 'count' && <div className="row cfgrow" style={{ marginBottom: 6 }}>
      <Stepper label={t('Warm-up sets')} value={c.warmupSets || 1} step={1} min={1} max={MAX_PLANNED_WARMUPS} decimal={false}
        onChange={v => setC(x => ({ ...x, warmupSets: Math.max(1, Math.min(MAX_PLANNED_WARMUPS, Math.round(v) || 1)) }))} />
    </div>}
    {choice === 'own' && <div className="warmup-rows">
      {rows.map((r, i) => <div className="row cfgrow warmup-row" key={i} style={{ marginBottom: 6, alignItems: 'flex-end' }}>
        <Stepper label={t('Warm-up {0}', i + 1)} value={r.wb ? 0 : r.wp} step={5} min={lowest} max={OWN_PCT_MAX} decimal={false}
          ariaLabel={t('Warm-up {0}', i + 1) + ': ' + pctLabel(r)}
          unit="%" display={r.wb ? t('Bar') : r.wp === 0 ? t('Body') : undefined}
          onChange={v => setRows(rows.map((x, j) => j !== i ? x : v <= 0 ? (floor > 0 ? { wb: true, r: x.r } : { wp: 0, r: x.r }) : { wp: Math.max(5, v), r: x.r }))} />
        <Stepper label={t('Reps')} value={r.r} step={1} min={1} max={30} decimal={false}
          onChange={v => setRows(rows.map((x, j) => j !== i ? x : { ...x, r: Math.max(1, Math.round(v) || 1) }))} />
        <Button size="sm" icon="trash" aria-label={t('Remove warm-up {0}', i + 1)} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
      </div>)}
      {rows.length < MAX_OWN_WARMUPS && <Button size="sm" icon="plus" onClick={() => {
        const last = rows[rows.length - 1]
        const next = last ? { wp: Math.min(OWN_PCT_MAX, (last.wb ? 40 : last.wp) + 20), r: Math.max(1, last.r - 2) } : { wp: 50, r: 8 }
        setRows([...rows, next])
      }}>{t('Add a warm-up')}</Button>}
    </div>}
    <div className="small dim" style={{ marginTop: 6 }}>
      {/* Settings > Units can count warm-ups in volume (#719); records and progression never do. */}
      {preview ? t('With {0} {1} today: {2}', fmtNum(work), unit, preview)
        : choice === 'count'
          ? st.volumeWarmups === true
            ? t('Added before your work sets. They count in your volume (Settings), but stay out of records and progression. Each one closes half the gap to the work weight, never below the bar on a barbell lift, and you can still change any of them mid-session.')
            : t('Added before your work sets and left out of volume, records and progression. Each one closes half the gap to the work weight, never below the bar on a barbell lift, and you can still change any of them mid-session.')
          : choice === 'none' || (choice === 'default' && !followsAuto) ? t('Ramp-up sets added before the work sets, so you do not have to add them by hand each session.')
            : t('Built from your work weight when the workout starts.')}
    </div>
  </div>
}
