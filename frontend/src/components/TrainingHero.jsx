import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { durPart, exCount, fmtDate, todayISO, DAYN } from '../lib/format.js'
import { workoutDuration } from '../lib/history.js'
import { glyphOf } from '../lib/glyphs.js'
import { nameOf, trainingDay, workoutLabel } from '../lib/training-day.js'
import { dayOverrideSheet, menuSheet, workoutDetailSheet } from '../sheets.jsx'
import Elapsed from './Elapsed.jsx'
import Icon from './Icon.jsx'
import { HeroStatus } from './tab-kit.jsx'

// A workout's line: how long it took and its PRs, whichever it has.
const workoutLine = w => [...durPart(workoutDuration(w)), ...(w.prs?.length ? [tn('{0} PR', '{0} PRs', w.prs.length)] : [])].join(' · ') || null

/** A day's logged workouts: the one's detail, or a list of them to pick from. */
export function workoutsSheet(title, workouts) {
  if (workouts.length === 1) { workoutDetailSheet(workouts[0]); return }
  menuSheet({ title, items: workouts.map(w => ({ icon: 'checkCircle', label: workoutLabel(w), sub: workoutLine(w), onClick: () => workoutDetailSheet(w) })) })
}

// The training status of the selected day (ux-redesign-tabs §1.1): what it says, and the link to
// the day's workout where there is one.
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
        link: { label: one ? t('See workout') : t('See workouts'), onClick: () => workoutsSheet(past, day.workouts) },
      }
    }
    case 'past-missed': return { glyph: 'calendar', eyebrow: past, title: day.name, caption: t('Planned, not logged') }
    default: return { glyph: 'moon', eyebrow: past, title: t('Rest day') }
  }
}

/** The training half of a tab's hero for `date`: HeroStatus's props for the day's session, with
 *  ⋯ holding "Choose a different workout" (today, nothing running) and "Change this day". Home
 *  adds its food metrics to these; Training shows them as they are. */
export function useTrainingHero(date) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const more = () => menuSheet({
    title: date === today ? t('Today') : fmtDate(date, true),
    items: [
      date === today && !S.active && { icon: 'swap', label: t('Choose a different workout'), onClick: () => nav('/train/workout') },
      { icon: 'calendar', label: t('Change this day'), onClick: () => dayOverrideSheet(date) },
    ],
  })
  const action = <button type="button" className="iconbtn hero-more" aria-haspopup="dialog" aria-label={t('Day options')} onClick={more}><Icon name="more" /></button>
  return { ...statusOf(trainingDay(S, date, today), date), action }
}

// Training's hero: the selected day's session, planned, running, done, rest or a past day.
export default function TrainingHero({ date }) {
  return <HeroStatus {...useTrainingHero(date)} />
}
