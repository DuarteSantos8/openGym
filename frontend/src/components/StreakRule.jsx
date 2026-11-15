import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { RULE_IDS, NEW_PROFILE_RULE, currentRule, streakRuleOf, setStreakRule, EXCUSE_CHOICES, excuseCapOf, setExcuseCap } from '../lib/streak-rule.js'
import { ruleLabel, ruleDesc, fromNowOn } from '../lib/streak-explain.js'
import Icon from './Icon.jsx'
import { Button, Row, Segmented } from './ui.jsx'

/* How forgiving the week streak is (lib/streak-rule.js): no freezes, one, or two. Picked on a
   new profile's Home (StreakRuleWelcome) and in Settings → Look & Home (StreakRuleRow). It takes
   effect from the moment it is saved and never rewrites the weeks already counted, and both
   places say so before you save. Discord, 11-04: "48 week streak" through two missed weeks. */

/** The three rules as a radio list, each with what it does. */
export function RuleOptions ({ value, onChange, name = 'streak-rule' }) {
  return <div className="rule-opts" role="radiogroup" aria-label={t('Streak freezes')}>
    {RULE_IDS.map(r => <button key={r} type="button" role="radio" aria-checked={value === r} data-rule={r}
      className={'rule-opt' + (value === r ? ' on' : '')} onClick={() => onChange(r)} name={name}>
      <span className="rule-dot" aria-hidden="true">{value === r && <Icon name="check" />}</span>
      <span className="rule-txt"><span className="rule-t">{ruleLabel(r)}</span><span className="rule-d">{ruleDesc(r)}</span></span>
    </button>)}
  </div>
}

/** Settings: the rule picker with Save, and what saving it means, said before it is saved. */
export function StreakRuleSheet ({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const now = currentRule(S)
  const since = streakRuleOf(S)?.since
  const [pick, setPick] = useState(now)
  const changed = pick !== now
  const save = () => {
    update(s => { setStreakRule(s, pick) })
    useUI.getState().toast(t('From now on: {0}.', ruleLabel(pick)))
    close()
  }
  return <div className="rule-sheet">
    <h3>{t('Streak freezes')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('How forgiving should your week streak be?')}</div>
    <RuleOptions value={pick} onChange={setPick} />
    <div className="rule-note small" data-rule-note aria-live="polite">
      {changed
        ? <><Icon name="info" /><span>{fromNowOn(pick)}</span></>
        : <><Icon name="check" /><span>{since ? t('{0} since the week of {1}.', ruleLabel(now), fmtDate(since)) : t('Your rule right now: {0}.', ruleLabel(now))}</span></>}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={!changed} onClick={save}>{t('Save')}</Button>
  </div>
}
export const streakRuleSheet = () => useUI.getState().openSheet(close => <StreakRuleSheet close={close} />)

/**
 * Settings → Look & Home: how many missed weeks a year a sick, travel or injured day note keeps
 * the streak through (api/coach/core/streak.js). Off leaves those weeks to the freezes.
 */
export function StreakExcuseRow () {
  const cap = useStore(s => excuseCapOf(s.S))
  const update = useStore(s => s.update)
  return <Row icon="cloud" iconTint="var(--indigo)" title={t('Sick and travel weeks')}
    subtitle={t('A day note saying sick, travelling or injured keeps the streak going, this many weeks a year.')}>
    <Segmented className="seg-inline"
      options={EXCUSE_CHOICES.map(n => ({ value: String(n), label: n ? String(n) : t('Off') }))}
      value={String(cap)} onChange={v => update(s => { setExcuseCap(s, Number(v)) })} />
  </Row>
}

/** The Settings row. */
export function StreakRuleRow () {
  const rule = useStore(s => currentRule(s.S))
  return <Row icon="snowflake" iconTint="var(--teal)" title={t('Streak freezes')} value={ruleLabel(rule)} accessory="chevron" onClick={streakRuleSheet} />
}

/**
 * A new profile's first pick (S.streakRuleAsk, set by freshState): on Home until answered, Gentle
 * ready to go. A first pick judges every week, so sessions imported later count by it too.
 */
export function StreakRuleWelcome () {
  const update = useStore(s => s.update)
  const [pick, setPick] = useState(NEW_PROFILE_RULE)
  const save = () => update(s => { setStreakRule(s, pick, undefined, { always: true }); delete s.streakRuleAsk })
  return <div className="card rule-welcome" data-rule-welcome>
    <div className="rule-welcome-t">{t('How strict should your streak be?')}</div>
    <div className="muted small" style={{ margin: '2px 0 12px' }}>{t('Your streak counts weeks with at least one workout. Freezes can cover the odd missed week.')}</div>
    <RuleOptions value={pick} onChange={setPick} name="streak-rule-welcome" />
    <div className="muted small" style={{ margin: '10px 2px 12px' }}>{t('You can change it later in Settings. A change counts from then on.')}</div>
    <Button variant="tinted" onClick={save}>{t('Save')}</Button>
  </div>
}
