import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { activeProfile, profileEquipment } from '../lib/equipment.js'
import { DAYN } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { buildStarterPlan, starterPlanDays, starterPlanOptions } from '../lib/starter.js'
import Icon from '../components/Icon.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { update, ui, toast } from './shared.js'
import { confirmSheet } from './confirm-menu.jsx'

/* ============================ starter plan ============================ */
// Plan names and blurbs live here, not in lib/starter.js: check-source-strings.mjs only finds
// string literals written inside a t() call, so copy parked in the catalog and passed in as a
// variable is invisible to it — it would quietly stay English in every language.
const PLAN_COPY = {
  ppl: () => ({ name: t('Push / Pull / Legs'), about: t('Push, pull and legs each get their own day.') }),
  'upper-lower': () => ({ name: t('Upper / Lower'), about: t('Upper body twice, lower body twice.') }),
  'full-body': () => ({ name: t('Full Body'), about: t('Three sessions, the whole body each time.') }),
  '5x5': () => ({ name: t('5×5'), about: t('Five sets of five on the main barbell lifts.') })
}

// Adds the plan's routines (reusing one you already have under the same name) and puts them on
// its weekdays. Existing routines are never touched
// and only the weekdays the plan asks for are reassigned; an id with no plan behind it changes
// nothing at all. planId is deliberately required — a default invites `onClick={loadStarterPlan}`,
// which hands the click event in as the plan and silently loads nothing.
export function loadStarterPlan(planId, profile) {
  const plan = buildStarterPlan(planId, profile ? profileEquipment(profile) : undefined)
  if (!plan) return false
  update(st => {
    // Loading the same plan again reuses the routines it added last time (same name, same
    // exercises) for the weekdays instead of a second Upper A, Lower A, ... under the same names.
    // A plan fitted to different equipment has other exercises, so it is added alongside.
    const idOf = {}
    const sameLift = (a, b) => a.ex.length === b.ex.length && a.ex.every((e, i) => e.id === b.ex[i].id)
    plan.routines.forEach(r => {
      const have = st.routines.find(x => x.name === r.name && sameLift(x, r))
      if (have) idOf[r.id] = have.id
      else { st.routines.push(r); idOf[r.id] = r.id }
    })
    plan.schedule.forEach(({ day, routineId }) => { st.week[day] = [idOf[routineId]] })
  })
  if (plan.fit) toast(t('{0} loaded, fitted to "{1}": {2} swapped, {3} dropped', PLAN_COPY[planId]().name, profile.name, plan.fit.swapped, plan.fit.dropped))
  else toast(t('{0} loaded', PLAN_COPY[planId]().name))
  return true
}

// Intl joins the days the way each language does it — "and" vs "und", "、" in Chinese.
const dayList = days => new Intl.ListFormat(dateLocale()).format(days.map(d => t(DAYN[d])))

function StarterPlanChooser({ close }) {
  const week = useStore(s => s.S.week)
  const routines = useStore(s => s.S.routines)
  const profiles = useStore(s => s.S.equipProfiles) || []
  // Fitting starts on for the profile you already filter by; '' leaves the plan as written.
  const [fitId, setFitId] = useState(() => activeProfile(useStore.getState().S)?.id || '')
  const fit = profiles.find(p => p.id === fitId) || null
  const choose = (id, name) => {
    const days = starterPlanDays(id)
    close()
    // A confirmation is only worth showing when one of those days is actually occupied — by a
    // routine that still exists, not by a stale id the Plan already shows as "Rest".
    const taken = day => [].concat(week[day] || []).some(id => routines.some(r => r.id === id))
    if (!days.some(taken)) { loadStarterPlan(id, fit); return }
    confirmSheet({
      title: t('Load {0}?', name),
      message: t('The new plan goes on {0}. Your existing routines stay; only those days of the weekly plan change.', dayList(days)),
      confirmText: t('Load plan'),
      onConfirm: () => loadStarterPlan(id, fit)
    })
  }
  return <>
    <h3>{t('Choose starter plan')}</h3>
    {profiles.length > 0
      ? <div className="chips" style={{ margin: '0 0 10px' }}>
          <div className="small dim" style={{ width: '100%' }}>{t('Fit to my equipment')}</div>
          <button className={'chip nocap' + (!fit ? ' on' : '')} onClick={() => setFitId('')}>{t('As written')}</button>
          {profiles.map(p => <button key={p.id} className={'chip nocap' + (fit?.id === p.id ? ' on' : '')} onClick={() => setFitId(p.id)}>{p.name}</button>)}
        </div>
      : <div className="small dim" style={{ margin: '0 0 10px' }}>{t('Add an equipment profile in Settings to fit a plan to what you own.')}</div>}
    <div className="list">
      {starterPlanOptions().map(({ id, days }) => {
        const { name, about } = PLAN_COPY[id]()
        return <div key={id} className="item" {...tappable(() => choose(id, name))}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="clipboard" /></span>
          <div className="grow"><div className="tt">{name}</div><div className="ss">{t('{0} days per week', days)} · {about}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}
    </div>
  </>
}

export const starterPlanSheet = () => ui().openSheet(close => <StarterPlanChooser close={close} />)
