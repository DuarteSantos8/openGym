// Which optional control groups the workout screen shows besides the sets themselves
// (Settings → During a workout → Workout controls). The lean default keeps the sets and one
// "more" button per exercise; each flag brings one of the old always-visible groups back.
// Lives in its own module so views can read it without the store — the store's DEF only
// references it.
export const WC_DEFAULT = Object.freeze({
  steppers: true,         // +/- buttons on every weight/reps/effort field
  setShortcuts: false,    // "+ Drop" / "+ Burst" chips on every set and the warm-up/remove/add row
  pairButtons: false,     // "Make superset with previous/next" in the exercise header
  exerciseButtons: false, // Move up/down, Swap, Remove exercise below the exercise
  exerciseChips: true,    // the numbered chip per exercise at the top of the workout (#323); one row
                          // of fixed height that replaces the "Exercise 2 / 5" line in Cards and Focus
  swipeSets: true,        // swipe actions: a set row (start deletes with Undo, end copies) and, despite the
                          // name, Plan's routines, loop and routine exercises too (Settings: "Swipe actions")
})

export function workoutControls(S) {
  return { ...WC_DEFAULT, ...((S && S.wc) || {}) }
}
