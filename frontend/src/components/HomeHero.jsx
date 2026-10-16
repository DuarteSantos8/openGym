import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { durPart, exCount, fmtDate, todayISO, yesterdayISO, DAYN } from '../lib/format.js'
import { workoutDuration } from '../lib/history.js'
import { glyphOf } from '../lib/glyphs.js'
import { nameOf, trainingDay, workoutLabel } from '../lib/training-day.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { loadErrorText } from '../lib/nutrition/log-feedback.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { dayHasLog, hasLogged, markLogged } from '../lib/nutrition/first-log.js'
import { dayOverrideSheet, menuSheet, workoutDetailSheet } from '../sheets.jsx'
import Elapsed from './Elapsed.jsx'
import Icon from './Icon.jsx'
import { HeroStatus } from './tab-kit.jsx'

const EMPTY = '–'
const grams = n => Math.round(n || 0).toLocaleString(dateLocale())
const MACROS = [
  { id: 'proteins', cls: 'p', label: () => t('Protein') },
  { id: 'carbohydrates', cls: 'c', label: () => t('Carbs') },
  { id: 'fat', cls: 'f', label: () => t('Fat') },
]

// A workout's line: how long it took and its PRs, whichever it has.
const workoutLine = w => [...durPart(workoutDuration(w)), ...(w.prs?.length ? [tn('{0} PR', '{0} PRs', w.prs.length)] : [])].join(' · ') || null

// The training half of the hero for the selected day (ux-redesign-tabs §1.1): what it says, and
// the link to the day's workout where there is one.
function statusOf(day, date) {
  const past = date < todayISO() ? fmtDate(date, true) : undefined
  switch (day.kind) {
    case 'editing': return { glyph: 'pencil', title: day.active.name, caption: t('Editing a saved workout') }
    case 'running': return { glyph: 'play', eyebrow: t('In progress'), title: day.active.name, caption: day.live ? <Elapsed start={day.active.start} /> : null }
    case 'done': return {
      glyph: 'checkCircle', eyebrow: t('Done'), title: day.workout.name || t('Workout done'), caption: workoutLine(day.workout),
      link: { label: t('See workout'), onClick: () => workoutDetailSheet(day.workout) },
    }
    case 'planned': return {
      glyph: glyphOf(day.routines[0].emoji), title: day.name,
      caption: [exCount(day.routines.reduce((n, r) => n + (r.ex?.length || 0), 0)), day.rescheduled && t('rescheduled')].filter(Boolean).join(' · '),
    }
    case 'rest': return {
      glyph: 'moon', title: t('Rest day'),
      caption: day.next ? t('Next session: {0}, {1}', t(DAYN[day.next.weekday]), nameOf(day.next.routines)) : null,
    }
    case 'past-logged': {
      const one = day.workouts.length === 1 ? day.workouts[0] : null
      return {
        glyph: 'checkCircle', eyebrow: past,
        title: one ? one.name || t('Workout done') : tn('{0} workout', '{0} workouts', day.workouts.length),
        caption: one ? workoutLine(one) : null,
        link: one
          ? { label: t('See workout'), onClick: () => workoutDetailSheet(one) }
          : { label: t('See workouts'), onClick: () => menuSheet({ title: past, items: day.workouts.map(w => ({ icon: 'checkCircle', label: workoutLabel(w), sub: workoutLine(w), onClick: () => workoutDetailSheet(w) })) }) },
      }
    }
    case 'past-missed': return { glyph: 'calendar', eyebrow: past, title: day.name, caption: t('Planned, not logged') }
    default: return { glyph: 'moon', eyebrow: past, title: t('Rest day') }
  }
}

// Home's hero for the selected day: its training status with ⋯ (a different workout, change this
// day), then, with nutrition, `kcal left (eaten) | water` (eaten against the target on a past
// day), the compact protein, carbs and fat line, and on first run the line that says the numbers
// count from the first log. `day` is useDiaryDay's.
export default function HomeHero({ date, day }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const units = useUnits()
  const today = todayISO()
  const training = statusOf(trainingDay(S, date, today), date)
  // "First log" is read off every day loaded so far, not just the selected one: yesterday (which
  // Home's live row loads) or a day opened in the calendar with a log means this person has one.
  // The caption waits for yesterday's read so an existing user never sees it flash.
  const yesterday = yesterdayISO()
  const logged = useNutrition(s => Object.values(s.days).some(d => d?.status === 'ready' && dayHasLog(d.entry)))
  const yesterdayRead = useNutrition(s => s.days[yesterday]?.status === 'ready' || s.days[yesterday]?.status === 'error')
  useEffect(() => { if (logged) markLogged() }, [logged])
  useEffect(() => { if (day.on) useNutrition.getState().loadDay(yesterday) }, [day.on, yesterday])

  const more = () => menuSheet({
    title: date === today ? t('Today') : fmtDate(date, true),
    items: [
      date === today && !S.active && { icon: 'swap', label: t('Choose a different workout'), onClick: () => nav('/train/workout') },
      { icon: 'calendar', label: t('Change this day'), onClick: () => dayOverrideSheet(date) },
    ],
  })
  const action = <button type="button" className="iconbtn hero-more" aria-haspopup="dialog" aria-label={t('Day options')} onClick={more}><Icon name="more" /></button>

  if (!day.on) return <HeroStatus {...training} action={action} />

  const ready = day.status === 'ready'
  const value = v => (ready ? v : EMPTY)
  const water = units.waterParts(day.water.total)
  const energy = date === today
    ? { label: day.left < 0 ? t('{0} over', units.energyUnit) : t('{0} left', units.energyUnit), value: value(units.energyValue(Math.abs(day.left))), sub: ready ? t('{0} eaten', units.energy(day.totals.calories)) : null }
    : { label: t('Eaten'), value: value(units.energyValue(day.totals.calories)), unit: ready ? units.energyUnit : undefined, sub: ready ? t('of {0}', units.energy(day.target.target)) : null }
  const metrics = [
    energy,
    { label: t('Water'), value: day.dayReady ? water.value : EMPTY, unit: day.dayReady ? water.unit : undefined, sub: day.dayReady ? t('of {0}', units.water(day.water.goal)) : null },
  ]
  return <HeroStatus {...training} action={action} metrics={metrics} status={day.status === 'error' ? 'error' : 'ready'} onRetry={day.reload}>
    {day.status === 'error' && <p className="hero-c" role="alert">{loadErrorText(day.error)}</p>}
    {ready && <p className="hero-macros">
      {MACROS.map(m => <span key={m.id}>
        <i className={'mdot ' + m.cls} aria-hidden="true" /><span className="sr-only">{m.label()} </span>
        {grams(day.totals[m.id])}{day.macros[m.id] != null && '/' + grams(day.macros[m.id])} g
      </span>)}
    </p>}
    {ready && date === today && yesterdayRead && !logged && !hasLogged() && <p className="hero-c">{t('Counts from your first log')}</p>}
  </HeroStatus>
}
