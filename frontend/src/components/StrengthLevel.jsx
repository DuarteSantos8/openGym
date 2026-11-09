// Strength level per lift (lib/strength-level.js): the block in an exercise's details, the Stats
// card, and the small "About you" sheet (sex and year of birth) the levels read.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, exerciseNameText } from '../lib/format.js'
import { dateLocale } from '../lib/i18n-core.js'

// A bodyweight ratio to two decimals whatever the weight decimals are set to: 1.25 is not 1.3.
const fmtRatio = r => new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 2 }).format(r)
import { EXIDX } from '../lib/exercises.js'
import {
  strengthLevel, strengthCard, levelPosition, liftOf, LEVELS, LEVEL_NAME, sexOf, BAR_EDGES, bandRanges, populationShown,
} from '../lib/strength-level.js'
import Icon from './Icon.jsx'
import { Button, Segmented, Stepper } from './ui.jsx'
import { isOn } from '../lib/modules.js'

const weightOf = (lv, w, unit) => (lv.perBell ? t('{0} each', fmtNum(w)) : fmtNum(w)) + ' ' + unit

// Where the Weight / Population choice is remembered between visits on this device.
const SCALE_KEY = 'gym_strength_scale'
const readScale = () => {
  try { return localStorage.getItem(SCALE_KEY) === 'population' ? 'population' : 'ratio' } catch { return 'ratio' }
}
const writeScale = v => { try { localStorage.setItem(SCALE_KEY, v) } catch { /* private mode: just not remembered */ } }

/** Five steps, the reached ones filled. */
function LevelBar({ level }) {
  return <div className="slevel-bar" aria-hidden="true">
    {LEVELS.map((name, i) => <span key={name} className={i <= level ? 'on' : ''} />)}
  </div>
}

/** A band's body-weight ratios as text: '< 0.75×' for Beginner, '≥ 2×' for Elite. */
function weightRange(w) {
  const x = v => fmtRatio(v) + '×'
  return w.hi == null ? '≥ ' + x(w.lo) : w.lo === 0 ? '< ' + x(w.hi) : x(w.lo) + ' – ' + x(w.hi)
}

/** The same range in the lifter's own unit, at their latest body weight (not for dumbbell lifts). */
function kgRange(w, bw, unit) {
  const k = v => fmtNum(Math.round(v * bw * 2) / 2)
  return w.hi == null ? '≥ ' + k(w.lo) + ' ' + unit : w.lo === 0 ? '< ' + k(w.hi) + ' ' + unit : k(w.lo) + ' – ' + k(w.hi) + ' ' + unit
}

/** The Stats level bar: five bands, one per level, each in its own colour (novice green up to
 *  elite gold). The fill runs through the bands to where the lifter stands. Each band is a button:
 *  tapping it shows that level's cut-offs in the info line below. The ticks mark where each level
 *  starts, as a ratio (Weight) or a percentile (Population; the narrow Elite band gets none). */
function LevelTrack({ lv, mode = 'ratio', sel, onPick }) {
  const p = levelPosition(lv, mode)
  const edges = BAR_EDGES[mode]
  const bands = bandRanges(lv)
  // band widths follow the mode: equal fifths, or the population share of each level
  const cols = { gridTemplateColumns: edges.slice(1).map((e, i) => Math.round((e - edges[i]) * 1000) + 'fr').join(' ') }
  const tick = i => {
    if (!i) return ''
    if (mode === 'population') return edges[i + 1] - edges[i] < 0.1 ? '' : Math.round(edges[i] * 100) + '%'
    return lv.thresholds ? fmtRatio(lv.thresholds[i]) + '×' : ''
  }
  return <>
    <div className="slevel-track" style={cols}>
      {LEVELS.map((name, i) => <button key={name} type="button" className={'slevel-lv-' + i + (sel === i ? ' sel' : '')}
        aria-label={t(LEVEL_NAME[name]) + ', ' + weightRange(bands[i].weight)} aria-pressed={sel === i} onClick={() => onPick(i)}>
        <i style={{ '--f': Math.min(1, Math.max(0, (p - edges[i]) / (edges[i + 1] - edges[i]))) }} />
      </button>)}
    </div>
    <div className="slevel-ticks" style={cols} aria-hidden="true">
      {LEVELS.map((name, i) => <span key={name}>{tick(i)}</span>)}
    </div>
  </>
}

function SexHint({ S }) {
  if (sexOf(S)) return <div className="small dim slevel-src">{t('Against published strength standards, worked out on this device.')}</div>
  return <div className="small dim slevel-src">
    {t('Using the men’s table for now. Add your sex and year of birth for a fairer read.')}{' '}
    <button type="button" className="slevel-about" onClick={aboutYouSheet}>{t('About you')}</button>
  </div>
}

/** Exercise details: this lift's level, hidden when it has no standard, no estimate or no weigh-in. */
export function StrengthLevelBlock({ exId }) {
  const S = useStore(s => s.S)
  // Settings → Modules: Strength levels off hides the block; nothing is computed for it.
  if (!liftOf(exId) || !isOn(S, 'strength')) return null
  const lv = strengthLevel(S, exId)
  if (!lv) return null
  return <div className="slevel" data-strength-level>
    <h4 className="sec">{t('Strength level')}</h4>
    <div className="row between" style={{ alignItems: 'baseline', gap: 8 }}>
      <div className="slevel-name">{t(LEVEL_NAME[lv.name])}</div>
      <div className="small muted">{t('{0} × body weight', fmtRatio(lv.ratio))}</div>
    </div>
    <LevelBar level={lv.level} />
    <div className="small muted">{lv.next
      ? t('{0} from an estimated 1RM of {1}', t(LEVEL_NAME[lv.next.name]), weightOf(lv, lv.next.weight, S.unit))
      : t('Top of the table. Take a bow.')}</div>
    <SexHint S={S} />
  </div>
}

/** The line under a graded lift: what the next level takes, or that the top is reached. */
function nextLine(lv, unit) {
  return lv.next
    ? t('{0} from an estimated 1RM of {1}', t(LEVEL_NAME[lv.next.name]), weightOf(lv, lv.next.weight, unit))
    : t('Top of the table. Take a bow.')
}

/** What each level usually takes to reach: rough rules of thumb, shown beside the cut-offs. */
function levelDesc() {
  return {
    beginner: t('Under about 6 months of regular training.'),
    novice: t('About 6 months to 2 years of regular training.'),
    intermediate: t('About 2 to 5 years of regular training.'),
    advanced: t('Usually 5 years or more, on a planned program.'),
    elite: t('Competitive lifters, usually many years of training.'),
  }
}

/** The info line under a bar: the tapped level's body-weight ratios (and in kg, for a barbell
 *  lift), its population share when that is shown, and what it usually takes. It has a fixed
 *  minimum height, so tapping a band never moves the rest of the card. */
function BandInfo({ band, pop, lv, unit }) {
  const kg = !lv.perBell && lv.bw > 0
  return <div className="slevel-info" aria-live="polite">
    <div><b>{t(LEVEL_NAME[band.name])}</b></div>
    <div>
      {weightRange(band.weight)}{kg ? ' (' + kgRange(band.weight, lv.bw, unit) + ')' : ''}
      {pop ? ' · ' + (band.pop.lo === 0 ? '< ' + band.pop.hi + '%' : band.pop.lo + '% – ' + band.pop.hi + '%') : ''}
    </div>
    <div className="dim">{levelDesc()[band.name]}</div>
  </div>
}

/** One graded lift: its line, its bar (tap a band for its cut-offs) and the next step. The bar
 *  opens on the lifter's own level. */
function LevelRow({ lv, mode, unit, name, pop }) {
  const [sel, setSel] = useState(lv.level)
  return <div className="slevel-row" role="group"
    aria-label={name + ': ' + t(LEVEL_NAME[lv.name]) + ', ' + t('{0} × body weight', fmtRatio(lv.ratio)) + '. ' + nextLine(lv, unit)}>
    <div className="slevel-top" aria-hidden="true">
      <span className="slevel-ex">{name}</span>
      <span className="slevel-lvl">{t(LEVEL_NAME[lv.name])}</span>
      <span className="slevel-num">{fmtRatio(lv.ratio)}×</span>
      <span className="slevel-num">{fmtNum(lv.e1rm)} {unit}</span>
    </div>
    <LevelTrack lv={lv} mode={mode} sel={sel} onPick={setSel} />
    <BandInfo band={bandRanges(lv)[sel]} pop={pop} lv={lv} unit={unit} />
    <div className="small muted" aria-hidden="true">{nextLine(lv, unit)}</div>
  </div>
}

/** Stats: every lift with a level, strongest first, each with its colour bar and the next step.
 *  The standard lifts not logged yet sit under "Not tried yet". Without a weigh-in the levels
 *  cannot be worked out, so the card says so instead of hiding. */
export function StrengthLevelsCard({ S }) {
  const [more, setMore] = useState(false)
  // the bar's scale: 'Weight' spaces the bands by body-weight ratio, 'Population' by share of lifters
  const [mode, setMode] = useState(readScale)
  const pop = populationShown(S)
  const scale = pop ? mode : 'ratio'
  const pick = v => { setMode(v); writeScale(v) }
  const { done, todo, weighed } = strengthCard(S)
  const nameOf = id => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : id)
  return <div className="card" data-strength-levels>
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }} id="strength-levels-h">{t('Strength levels')}</h2>
      <Button size="sm" icon="person" onClick={aboutYouSheet}>{t('About you')}</Button>
    </div>
    {weighed && pop && <Segmented ariaLabelledby="strength-levels-h" className="slevel-scale" value={scale} onChange={pick}
      options={[{ value: 'ratio', label: t('Weight') }, { value: 'population', label: t('Population') }]} />}
    {!weighed && <div className="small muted">{t('Add a bodyweight to see your levels.')}</div>}
    {weighed && done.map(lv => <LevelRow key={lv.lift} lv={lv} mode={scale} unit={S.unit} name={nameOf(lv.id)} pop={pop} />)}
    {weighed && todo.length > 0 && <>
      <Button className="sbar-more" trailingIcon={more ? 'chevronUp' : 'chevronDown'} aria-expanded={more}
        onClick={() => setMore(v => !v)}>{t('Not tried yet')}</Button>
      {more && todo.map(x => <div key={x.lift} className="slevel-row slevel-todo">
        <div className="slevel-top">
          <span className="slevel-ex">{nameOf(x.id)}</span>
          <span className="small dim">{t('Log a set to see your level.')}</span>
        </div>
      </div>)}
    </>}
    {weighed && <SexHint S={S} />}
    {weighed && <div className="small dim slevel-src">{t('Weight ratios and population shares: strengthlevel.com, Strength Standards. Age: McCulloch’s masters coefficients.')}</div>}
    {weighed && !pop && <div className="small dim slevel-src">{t('Population shares are only shown for the men’s table, under 40.')}</div>}
  </div>
}

function AboutYou() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const year = new Date().getFullYear()
  const born = Number(S.birthYear) > 0 ? Number(S.birthYear) : null
  return <>
    <h3>{t('About you')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Only used to grade your strength levels, on this device. Leave it blank if you like.')}</div>
    <div className="about-lbl" id="about-sex">{t('Sex')}</div>
    <Segmented ariaLabelledby="about-sex" options={[{ value: '', label: t('Not set') }, { value: 'female', label: t('Female') }, { value: 'male', label: t('Male') }]}
      value={sexOf(S) || ''} onChange={v => update(s => { if (v) s.sex = v; else delete s.sex })} />
    <div style={{ height: 16 }} />
    <div className="about-lbl">{t('Year of birth')}</div>
    <div className="row" style={{ gap: 8 }}>
      {/* Unset, the stepper offers a starting year in the placeholder grey, so it does not read
          as a saved 1996 above the words "Not set". */}
      <Stepper ariaLabel={t('Year of birth')} className={born ? '' : 'unset'} value={born ?? year - 30} step={1} min={1920} max={year - 10} decimal={false}
        onChange={v => update(s => { s.birthYear = Math.round(v) })} />
      {born && <Button size="sm" variant="ghost" icon="xmark" onClick={() => update(s => { delete s.birthYear })}>{t('Clear')}</Button>}
    </div>
    {!born && <div className="small dim about-hint"><Icon name="info" /><span>{t('Not set')}</span></div>}
  </>
}
export const aboutYouSheet = () => useUI.getState().openSheet(() => <AboutYou />)
