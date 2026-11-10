// What the "Choose your session" sheet lists (sheets.jsx sessionPickerSheet): the session planned
// for today first when there is one (a weekday can combine several routines, started as one), then
// every routine of the plan, each with how many exercises it holds and the day it was last done,
// so picking another one than the day's is a tap. Freestyle is the sheet's own last row.

/** The latest day (ISO) a saved workout ran this routine, or null. */
export function lastDoneOf(workouts, routineId) {
  let last = null
  for (const w of workouts || []) {
    const ids = [].concat(w.routineIds ?? (w.routineId ? [w.routineId] : []))
    if (ids.includes(routineId) && w.d && (!last || w.d > last)) last = w.d
  }
  return last
}

/** `suggested`: the ids the Start came with (today's plan, or a routine tapped on Home). Ids of
 *  routines that no longer exist are dropped. A single suggested routine is not listed twice. */
export function sessionPickerRows(st, suggested) {
  const routines = st.routines || []
  const ids = [].concat(suggested ?? []).filter(id => routines.some(r => r.id === id))
  const picked = ids.map(id => routines.find(r => r.id === id))
  const today = picked.length
    ? { ids, routines: picked, exN: picked.reduce((n, r) => n + (r.ex?.length || 0), 0) }
    : null
  const rest = routines
    .filter(r => !(ids.length === 1 && r.id === ids[0]))
    .map(r => ({ id: r.id, name: r.name, emoji: r.emoji, exN: r.ex?.length || 0, last: lastDoneOf(st.workouts, r.id) }))
  return { today, routines: rest }
}
