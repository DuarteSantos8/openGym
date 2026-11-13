// The "That's the whole workout!" sheet (sheets.jsx WorkoutComplete), when the last set of a live
// session is ticked, and the header's Finish: a line that cheers you on to one more exercise, and
// the exercises you most often add to your routines' sessions on top of the plan, one tap from
// joining this one. Finish and Continue stay as they were.
import { t } from './i18n.js'
import { isWarmupRow } from './workout-model.js'

/** The lines, one picked each time the sheet opens. A function so they follow the language. */
export const keepGoingLines = () => [
  t('Come on, keep going!'),
  t('You’ve still got something in the tank.'),
  t('Finish strong: one more exercise?'),
  t('One more and today really counts double.'),
  t('Since you’re here, why not one more?'),
  t('The last sets are the ones that build you.'),
  t('You came this far. Don’t stop now.'),
  t('Your future self says thanks for one more.'),
  t('Tired is not the same as done.'),
  t('One more exercise, then you’ve earned the rest.'),
  t('Strong people do one more.'),
  t('The workout isn’t over until you say so.'),
  t('Good sets today, great ones tomorrow.'),
  t('Still warm? Perfect time for one more.'),
  t('A little extra goes a long way.'),
  t('Push a bit more: that’s where progress lives.'),
  t('Every extra set is a step forward.'),
  t('You’re on a roll. Keep it rolling!'),
  t('Make today the one you remember.'),
  t('Champions finish with one more.'),
  t('Your muscles are ready for another round.'),
  t('Ten more minutes, a better you.'),
  t('Don’t leave anything on the table.'),
  t('You’re stronger than you think.'),
  t('The hard part is behind you. Add one more?'),
  t('Consistency today, results tomorrow.'),
  t('Feeling good? Ride that wave.'),
  t('One more for the progress chart.'),
  t('You showed up. Now finish in style.'),
  t('Small extras add up to big changes.'),
  t('Champions are made in the extra minutes.'),
  t('Your body can do more than your mind thinks.'),
  t('Keep the fire burning.'),
  t('You didn’t come here to do the minimum.'),
  t('Earn your rest with one more.'),
  t('Progress loves people who push a little further.'),
  t('One more step toward your goal.'),
  t('Make your routine jealous.'),
  t('Who said the workout was over?'),
  t('Your energy says yes. Listen to it.'),
  t('Great job. Ready for a bonus round?'),
  t('Bonus round unlocked.'),
  t('Extra effort, extra results.'),
  t('Turn a good workout into a great one.'),
  t('The gym is yours. Use it a bit longer.'),
  t('Discipline is doing one more when you could stop.'),
  t('You’re building something. Add a brick.'),
  t('Every rep counts. So does this one.'),
  t('Your best version is one exercise away.'),
  t('Keep the momentum going.'),
  t('Sweat now, shine later.'),
  t('Be proud, then do one more.'),
  t('Nothing great ever came from stopping early.'),
  t('The bar is waiting for you.'),
  t('Strength is built one extra set at a time.'),
  t('You’re warmed up and ready. Go!'),
  t('Let’s see what else you’ve got.'),
  t('A strong finish starts with one more exercise.'),
  t('Go on, surprise yourself.'),
  t('Five more minutes won’t hurt. They’ll help.'),
  t('You’re doing amazing. Keep it up!'),
  t('Today’s extra is tomorrow’s strength.'),
  t('Leave the gym knowing you gave it all.'),
  t('Your muscles called. They want more.'),
  t('Every champion was once tired too.'),
  t('Make it a workout to brag about.'),
  t('Raise the bar, then raise it again.'),
  t('More reps, more pride.'),
  t('Go the extra mile.'),
  t('Why stop when you’re feeling this good?'),
  t('You’re not done until you’re proud.'),
  t('One more set of courage.'),
  t('Progress is a choice. Choose one more.'),
  t('Your future PR is watching.'),
  t('Stay a little longer. It’s worth it.'),
  t('Good things come to those who add one more.'),
  t('You’ve got this. One more!'),
  t('The finish line can wait a little.'),
  t('Keep showing up for yourself.'),
  t('Today you, tomorrow a stronger you.'),
  t('This is where the magic happens.'),
  t('Fatigue is temporary, pride is forever.'),
  t('Go for it. No regrets.'),
  t('Add one more and own the day.'),
  t('Strong today, stronger with one more.'),
  t('You’re one exercise from a perfect session.'),
  t('A few more minutes for your goals.'),
  t('Give your workout a strong last chapter.'),
  t('Comfort zone? Not today.'),
  t('Push past the easy part.'),
  t('Show today what you’re made of.'),
  t('Every drop of sweat is a deposit.'),
  t('Do it for the you who started.'),
  t('One more, then a well-earned shower.'),
  t('You’re unstoppable today.'),
  t('Finish what you started, then a little more.'),
  t('Great work. Want to make it legendary?'),
  t('Your strength grows when you choose more.'),
  t('Keep going, the results are coming.'),
  t('One last push. You’ll thank yourself.'),
]
/** One of them, `r` in [0, 1) (Math.random by default). */
export function keepGoingLine(r = Math.random()) {
  const lines = keepGoingLines()
  const i = Math.floor(Number(r) * lines.length)
  return lines[Math.min(lines.length - 1, Math.max(0, Number.isFinite(i) ? i : 0))]
}

const workedOn = entry => (Array.isArray(entry?.sets) ? entry.sets : []).some(s => s && s.done === true && !isWarmupRow(s))
const when = w => Number(w?.end) || Number(w?.start) || 0

// A saved workout's routines, by id: `routineIds`, or the older single `routineId`.
const routineIdsOf = w => (Array.isArray(w?.routineIds) && w.routineIds.length ? w.routineIds : w?.routineId != null ? [w.routineId] : [])

/**
 * Whether a saved workout's entry was done on top of its plan: marked so (`extra: true`, where the
 * app keeps the mark), or, in a session built from routines, an exercise none of them has. The
 * routines are read as they are now, so one since added to its routine counts no more. A freestyle
 * session has no plan to be extra to.
 */
export function extraIn(w, entry, routinesById = new Map()) {
  if (entry?.extra === true) return true
  const ids = routineIdsOf(w)
  if (!ids.length || entry?.id == null) return false
  const routines = ids.map(id => routinesById.get(id)).filter(r => Array.isArray(r?.ex))
  return routines.length > 0 && !routines.some(r => r.ex.some(x => x?.id === entry.id))
}

/**
 * The exercises you add most often as extras (extraIn), most sessions first, then the most recent:
 * each saved workout counts an exercise once, and only with a work set done. Those already in
 * `active` are left out, as is anything `keep` (an id → boolean) turns down. At most `n` ids.
 */
export function frequentExtras(workouts, active, { n = 3, keep = () => true, routines = [] } = {}) {
  const here = new Set((Array.isArray(active?.entries) ? active.entries : []).map(e => e?.id))
  const byId = new Map((Array.isArray(routines) ? routines : []).filter(r => r?.id != null).map(r => [r.id, r]))
  const tally = new Map()
  for (const w of Array.isArray(workouts) ? workouts : []) {
    const seen = new Set()
    for (const e of Array.isArray(w?.entries) ? w.entries : []) {
      if (e?.id == null || seen.has(e.id) || here.has(e.id) || !extraIn(w, e, byId) || !workedOn(e)) continue
      seen.add(e.id)
      const c = tally.get(e.id) || { id: e.id, times: 0, last: 0 }
      c.times++
      c.last = Math.max(c.last, when(w))
      tally.set(e.id, c)
    }
  }
  return [...tally.values()]
    .filter(c => keep(c.id))
    .sort((a, b) => b.times - a.times || b.last - a.last)
    .slice(0, Math.max(0, n))
    .map(c => ({ id: c.id, times: c.times }))
}
