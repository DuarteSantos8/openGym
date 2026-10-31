// Strength level per lift (lib/strength-level.js): the block in an exercise's details, the Stats
// card, and the small "About you" sheet (sex and year of birth) the levels read.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, exerciseNameText } from '../lib/format.js'
import { dateLocale } from '../lib/i18n-core.js'

// A bodyweight ratio to two decimals whatever the weight decimals are set to: 1.25 is not 1.3.
const fmtRatio = r => new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 2 }).format(r)
import { EXIDX } from '../lib/exercises.js'
import { strengthLevel, strengthLevels, liftOf, LEVELS, LEVEL_NAME, sexOf } from '../lib/strength-level.js'
import Icon from './Icon.jsx'
import { Button, Segmented, Stepper } from './ui.jsx'

const weightOf = (lv, w, unit) => (lv.perBell ? t('{0} each', fmtNum(w)) : fmtNum(w)) + ' ' + unit

/** Five steps, the reached ones filled. */
function LevelBar({ level }) {
  return <div className="slevel-bar" aria-hidden="true">
    {LEVELS.map((name, i) => <span key={name} className={i <= level ? 'on' : ''} />)}
  </div>
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
  if (!liftOf(exId)) return null
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

/** Stats: every graded lift with a level, strongest first. Hidden without one. */
export function StrengthLevelsCard({ S }) {
  const rows = strengthLevels(S)
  if (!rows.length) return null
  return <div className="card" data-strength-levels>
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Strength levels')}</h2>
      <Button size="sm" icon="person" onClick={aboutYouSheet}>{t('About you')}</Button>
    </div>
    {/* Two-line rows: the lift in full (it was cut to "barbell bench…", in the catalogue's lower
        case, beside a level that wrapped), then the level and the ratio, then the steps. */}
    {rows.map(lv => <div key={lv.lift} className="slevel-row">
      <div className="slevel-ex">{EXIDX[lv.id] ? exerciseNameText(EXIDX[lv.id]) : lv.id}</div>
      <div className="slevel-meta"><b>{t(LEVEL_NAME[lv.name])}</b> · {t('{0} × body weight', fmtRatio(lv.ratio))}</div>
      <LevelBar level={lv.level} />
    </div>)}
    <SexHint S={S} />
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
