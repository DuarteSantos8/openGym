// Find my plan (EP22, /start): six questions, then a plan with the reasons for it.
//
// lib/planner.js decides everything; this screen only asks and shows. One question at a time, a
// tap answers and moves on, Back goes back, and the answers can be changed from the result. The
// last question (anything to be careful with) is optional, only ever makes the plan gentler and
// is never saved: not on this device, not on a server.
//
// "Use this plan" does what Load starter plan does (sheets.jsx loadStarterPlan): it adds the
// routines, puts them on their weekdays and leaves every existing routine alone. It also sets the
// experience level the answers stand for (lib/experience.js), so a beginner's workout screen
// starts simple.
import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { DAYN } from '../lib/format.js'
import { fmtRest } from '../lib/duration.js'
import { exOr } from '../lib/exercises.js'
import { planFor, cleanAnswers, GOALS, DAYS, MINUTES, EQUIPMENT, EXPERIENCE, LIMITS, DEFAULT_ANSWERS } from '../lib/planner.js'
import { buildPlanFrom } from '../lib/starter.js'
import { applyExperience, experienceOf } from '../lib/experience.js'
import { levelName } from '../lib/experience-copy.js'
import { starterPlanName, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import CardHead from '../components/CardHead.jsx'
import Term from '../components/Term.jsx'
import { Button } from '../components/ui.jsx'
import './onboarding.css'

// Every label is a literal inside t(), so check-source-strings.mjs sees it (the same reason the
// starter plans' names live in sheets.jsx and not in the catalogue).
const GOAL_COPY = {
  general: () => ({ label: t('General fitness'), icon: 'heart' }),
  muscle: () => ({ label: t('Build muscle'), icon: 'arm' }),
  strength: () => ({ label: t('Get stronger'), icon: 'barbell' }),
  fatloss: () => ({ label: t('Lose fat'), icon: 'figureRun' }),
  mobility: () => ({ label: t('Move better'), icon: 'stretch' }),
}
const EQUIPMENT_COPY = {
  gym: () => ({ label: t('Full gym'), icon: 'machine' }),
  dumbbells: () => ({ label: t('Dumbbells only'), icon: 'dumbbell' }),
  bands: () => ({ label: t('Resistance bands'), icon: 'figureStrength' }),
  none: () => ({ label: t('No equipment'), icon: 'house' }),
  hotel: () => ({ label: t('Hotel room'), icon: 'bed' }),
}
const EXPERIENCE_COPY = {
  never: () => ({ label: t('Never, or not for years') }),
  some: () => ({ label: t('A little') }),
  regular: () => ({ label: t('Regularly, for six months or more') }),
}
const LIMIT_COPY = {
  knees: () => t('Knees'),
  back: () => t('Lower back'),
  shoulders: () => t('Shoulders'),
  pregnancy: () => t('Pregnant or recently gave birth'),
  clinician: () => t('A doctor told me to limit exercise'),
}

const WHY_COPY = {
  equipment: () => t('It only uses the equipment you have.'),
  'plan-full-body': () => t('Every session trains the whole body, so you practise each movement several times a week. That is how beginners improve fastest.'),
  'plan-upper-lower': () => t('Upper and lower days alternate, so you can train four times without working the same muscles two days running.'),
  'plan-ppl': () => t('Pushing, pulling and legs each get their own day, which spreads the work over more sessions.'),
  'plan-5x5': () => t('A few heavy barbell lifts, five sets of five: built for strength.'),
  'goal-general': () => t('A balanced mix of movements to get you fitter all round.'),
  'goal-muscle': () => t('Enough sets for each muscle every week to grow, with room to add more later.'),
  'goal-strength': () => t('Fewer reps with longer rests, which is how strength is built.'),
  'goal-fatloss': () => t('Shorter rests keep you moving. Most fat loss comes from food; training keeps your muscle while you do.'),
  'goal-mobility': () => t('A few controlled sets through a full, comfortable range, well short of straining.'),
  'days-capped': () => t('Fewer days than you offered: when you are starting, rest days are when you get stronger.'),
  trimmed: () => t('Shortened to fit your time. The most important exercises come first.'),
  caution: () => t('Started gentler because of what you ticked. Pain is a signal to stop, not a challenge.'),
}

const QUESTIONS = ['goal', 'days', 'minutes', 'equipment', 'experience', 'limits']

// Where the quiz stands, kept outside the component for as long as the app is open. A page can be
// mounted afresh under it (on iPhone, closing any sheet over a page does exactly that), and
// without this a tap on "What is a set?" sent the person back to question 1. Not saved anywhere:
// a reload starts over, and using the plan clears it.
let draft = null
/** Forgets a quiz in progress (tests, and once its plan has been used). */
export const forgetQuizDraft = () => { draft = null }

function Options({ name, value, options, onPick }) {
  return <div className="iv-quiz-options" role="radiogroup" aria-labelledby={'iv-quiz-q-' + name}>
    {options.map(o => <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value}
      className={'iv-quiz-option' + (value === o.value ? ' on' : '')} data-option={String(o.value)} onClick={() => onPick(o.value)}>
      {o.icon && <span className="lrow-i" aria-hidden="true"><Icon name={o.icon} /></span>}
      <span className="iv-quiz-option-t">{o.label}</span>
      <Icon name={value === o.value ? 'checkCircle' : 'chevronRight'} className="chev" />
    </button>)}
  </div>
}

export default function Onboarding() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  // Answers from the last time, so "Change my answers" months later starts from what was said.
  // The limitations are never among them: they are not kept anywhere.
  // A first visit starts with nothing chosen: a highlighted answer nobody gave would lead.
  const [a, setA] = useState(() => draft?.a || (S.quiz ? cleanAnswers({ ...DEFAULT_ANSWERS, ...S.quiz, limits: [] }) : { goal: null, days: null, minutes: null, equipment: null, experience: null, limits: [] }))
  const [step, setStep] = useState(() => draft?.step || 0)
  useEffect(() => { draft = { a, step } }, [a, step])
  const heading = useRef(null)
  const done = step >= QUESTIONS.length
  // Each new question is announced and takes the focus, so a keyboard or screen reader follows.
  useEffect(() => { heading.current?.focus() }, [step])

  const answer = (key, value) => { setA(x => ({ ...x, [key]: value })); setStep(s => s + 1) }
  const toggleLimit = l => setA(x => ({ ...x, limits: x.limits.includes(l) ? x.limits.filter(v => v !== l) : [...x.limits, l] }))
  const back = () => { if (step === 0) { forgetQuizDraft(); nav(-1) } else setStep(s => s - 1) }

  const plan = useMemo(() => (done ? planFor(a) : null), [done, a])

  const use = () => {
    const name = starterPlanName(plan.planId)
    const load = () => {
      const built = buildPlanFrom({ routines: plan.routines, schedule: plan.schedule })
      if (!built) return
      // The rest that goes with the dose; a plan used as written keeps the profile's own rest.
      if (plan.dose) for (const r of built.routines) for (const e of r.ex) e.restSec = plan.dose.rest
      update(st => {
        const idOf = {}
        const same = (x, y) => x.ex.length === y.ex.length && x.ex.every((e, i) => e.id === y.ex[i].id && e.sets === y.ex[i].sets && (e.reps ?? e.sec) === (y.ex[i].reps ?? y.ex[i].sec))
        built.routines.forEach(r => {
          const have = st.routines.find(x => x.name === r.name && same(x, r))
          if (have) idOf[r.id] = have.id
          else { st.routines.push(r); idOf[r.id] = r.id }
        })
        built.schedule.forEach(({ day, routineId }) => { st.week[day] = [idOf[routineId]] })
        // Someone who set Experienced by hand keeps it; every other profile takes the answer.
        if (!(experienceOf(st) === 'advanced' && plan.level === 'intermediate')) applyExperience(st, plan.level)
        st.quiz = { goal: a.goal, days: a.days, minutes: a.minutes, equipment: a.equipment, experience: a.experience }
      })
      forgetQuizDraft()
      useUI.getState().toast(t('{0} loaded', name))
      nav('/home', { replace: true })
    }
    const taken = day => [].concat(S.week?.[day] || []).some(id => S.routines.some(r => r.id === id))
    if (!plan.weekdays.some(taken)) { load(); return }
    const days = new Intl.ListFormat(dateLocale()).format(plan.weekdays.map(d => t(DAYN[d])))
    confirmSheet({
      title: t('Load {0}?', name),
      message: t('The new plan goes on {0}. Your existing routines stay; only those days of the weekly plan change.', days),
      confirmText: t('Load plan'),
      onConfirm: load,
    })
  }

  const header = <div className="hdr">
    <button className="iconbtn" data-back="/home" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Find my plan')}</h1>
      <div className="sub">{done ? t('Your plan') : t('Question {0} of {1}', step + 1, QUESTIONS.length)}</div></div>
  </div>

  if (!done) {
    const key = QUESTIONS[step]
    const title = {
      goal: () => t('What do you want most?'),
      days: () => t('How many days a week can you train?'),
      minutes: () => t('How long can one session be?'),
      equipment: () => t('What can you train with?'),
      experience: () => t('How much have you lifted before?'),
      limits: () => t('Anything to be careful with?'),
    }[key]()
    return <div className="iv-quiz narrow">
      {header}
      <div className="iv-quiz-bar" aria-hidden="true"><span style={{ width: ((step + 1) / QUESTIONS.length) * 100 + '%' }} /></div>
      <h2 className="iv-quiz-q" id={'iv-quiz-q-' + key} tabIndex={-1} ref={heading}>{title}</h2>
      {key === 'goal' && <Options name={key} value={a.goal} onPick={v => answer('goal', v)}
        options={GOALS.map(g => ({ value: g, ...GOAL_COPY[g]() }))} />}
      {key === 'days' && <Options name={key} value={a.days} onPick={v => answer('days', v)}
        options={DAYS.map(d => ({ value: d, label: t('{0} days per week', d) }))} />}
      {key === 'minutes' && <Options name={key} value={a.minutes} onPick={v => answer('minutes', v)}
        options={MINUTES.map(m => ({ value: m, label: t('{0} min', m) }))} />}
      {key === 'equipment' && <Options name={key} value={a.equipment} onPick={v => answer('equipment', v)}
        options={EQUIPMENT.map(e => ({ value: e, ...EQUIPMENT_COPY[e]() }))} />}
      {key === 'experience' && <Options name={key} value={a.experience} onPick={v => answer('experience', v)}
        options={EXPERIENCE.map(e => ({ value: e, ...EXPERIENCE_COPY[e]() }))} />}
      {key === 'limits' && <>
        <p className="muted small iv-quiz-note">{t('Optional. Ticking something only makes the plan gentler. It is not saved anywhere.')}</p>
        <div className="iv-quiz-options" role="group" aria-labelledby={'iv-quiz-q-' + key}>
          {LIMITS.map(l => <button key={l} type="button" role="checkbox" aria-checked={a.limits.includes(l)} data-option={l}
            className={'iv-quiz-option' + (a.limits.includes(l) ? ' on' : '')} onClick={() => toggleLimit(l)}>
            <span className="iv-quiz-option-t">{LIMIT_COPY[l]()}</span>
            {a.limits.includes(l) && <Icon name="check" className="chev" />}
          </button>)}
        </div>
        <Button variant="primary" className="iv-quiz-next" onClick={() => setStep(s => s + 1)}>{t('Show my plan')}</Button>
      </>}
    </div>
  }

  const name = starterPlanName(plan.planId)
  const byKey = Object.fromEntries(plan.routines.map(r => [r[0], r]))
  return <div className="iv-quiz narrow">
    {header}
    <div className="card iv-quiz-plan" data-plan={plan.planId}>
      <CardHead icon="clipboard" tint="var(--green)" eyebrow={levelName(plan.level)} title={<span tabIndex={-1} ref={heading} className="iv-quiz-focus">{name}</span>}
        sub={<>{t('{0} days per week', plan.days)} · {t('about {0} min', plan.minutes)}</>} />
      <p className="iv-quiz-dose">
        {plan.dose
          ? <>{t('{0} sets of {1} reps to start.', plan.dose.sets, plan.dose.reps)} {t('Rest about {0} between sets.', fmtRest(plan.rest))}</>
          : t('Sets and reps as the plan is written.')}
        {' '}<Term id="set">{t('What is a set?')}</Term>
      </p>
    </div>

    {plan.askFirst && <div className="card iv-quiz-ask" role="note">
      <CardHead icon="warning" tint="var(--orange)" title={t('Please check with a doctor or physiotherapist before you start.')}
        sub={t('The plan below is a gentle one, but they know your situation and this app does not.')} />
    </div>}

    <h2 className="sec">{t('Why this plan')}</h2>
    <ul className="iv-quiz-why">
      {plan.why.map(code => <li key={code} data-why={code}><Icon name="check" aria-hidden="true" /><span>{WHY_COPY[code]()}</span></li>)}
    </ul>

    <h2 className="sec">{t('Your week')}</h2>
    <div className="list iv-quiz-week">
      {plan.schedule.map(([day, key]) => {
        const [, rname, , list] = byKey[key]
        return <div key={day} className="item iv-quiz-day">
          <div className="grow">
            <div className="tt">{t(DAYN[day])} · {rname}</div>
            {/* each name in its own span: the catalogue's names are stored lower-case and take the
                app's title-casing rule (lib/i18n-core.js exerciseNameClass), one name at a time */}
            <div className="ss">{list.map((line, i) => {
              const ex = exOr(line[0])
              return <span key={line[0]}>{i > 0 && ' · '}<span className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</span></span>
            })}</div>
          </div>
        </div>
      })}
    </div>

    <Button variant="primary" icon="check" className="iv-quiz-use" onClick={use}>{t('Use this plan')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => setStep(0)}>{t('Change my answers')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon="lightbulb" onClick={() => nav('/learn')}>{t('Learn the basics')}</Button>
    <p className="small dim iv-quiz-foot">{t('General training information for healthy adults, not medical advice.')}</p>
  </div>
}
