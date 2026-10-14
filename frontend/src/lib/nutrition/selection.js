import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { todayISO } from '../format.js'
import { defaultMeal } from './diary.js'

// Where a log goes: the date Home shows (its date strip and calendar) and the meal the + sheet
// names in "Logging to <date> · <meal>". One copy for Home, the + sheet and the Nutrition pages.
//
// `date` null means today, whichever day that is by now, so an app left open overnight logs to
// the new day. `meal` null means "by time of day" (diary.js defaultMeal, a Gains rule: NutriTrace
// has none); a meal picked by hand holds for MEAL_PICK_MS, then the clock decides again. Picking
// a date clears it.
//
// In components use useDiaryTarget(settings): it re-renders when the selection changes, at
// midnight and when the clock moves the meal. getState().target() is for code outside React.

export const MEAL_PICK_MS = 30 * 60 * 1000
const TICK_MS = 30 * 1000

function targetOf(state, settings, now = new Date()) {
  const m = state.meal
  const meal = m && now.getTime() - m.at < MEAL_PICK_MS ? m.slot : defaultMeal(settings, now)
  return { date: state.date || todayISO(), meal }
}

export const useDiarySelection = create((set, get) => ({
  date: null,
  meal: null,

  /** The date to show and log to (YYYY-MM-DD), as of now. */
  day: () => get().date || todayISO(),
  setDate: iso => set({ date: !iso || iso === todayISO() ? null : iso, meal: null }),
  /** Pick the meal by hand (slot index), or null to go back to the clock. */
  setMeal: (slot, now = Date.now()) => set({ meal: slot == null ? null : { slot: Number(slot), at: now } }),
  /** The meal slot to log to, as of `now`, given NutriTrace's settings. */
  mealFor: (settings, now = new Date()) => targetOf(get(), settings, now).meal,
  /** { date, meal } as of `now`. */
  target: (settings, now = new Date()) => targetOf(get(), settings, now),
  reset: () => set({ date: null, meal: null }),
}))

/** { date, meal } for components, kept current: on a selection change, and every 30 s for the
 *  date rolling over at midnight, a hand pick expiring and the time of day moving the meal.
 *  A sheet that logs (the + sheet, a picker) takes this once when it opens and keeps it, so
 *  what it says it logs to does not change under the person's finger. */
export function useDiaryTarget(settings) {
  const date = useDiarySelection(s => s.date)
  const meal = useDiarySelection(s => s.meal)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  return targetOf({ date, meal }, settings, new Date(now))
}
