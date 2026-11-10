// Food diary reminders as real notifications: breakfast, lunch or dinner with nothing logged by
// its time. The rule is the frontend's (lib/food.js MEAL_DUE, mealsOwed), hand-copied like
// nudge.js, so the server can tell without the page open. Kept out of server.js so it can be
// unit-tested; the tick there adds the push subscription and the once-a-meal mark in db.json.
//
// Opt-in: S.foodPush (the switch in the diary's settings) with the zone it was set in,
// S.foodTz. A reminder is owed from the meal's hour for an hour, so a tick or a woken server
// anywhere in that hour still sends it, and never later than that.
export const MEAL_DUE = { breakfast: 10, lunch: 14, dinner: 20 };
export const WINDOW_MIN = 60;
const LABEL = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner' };

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const minutesOf = hhmm => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Whether the switch is on: the module, the in-app nudges and the push itself. */
export const foodPushOn = S => S?.foodPush === true && S?.foodNudge !== false && !(isMap(S?.modules) && S.modules.food === false);

/** Whether `hhmm` is inside any meal's window: the tick reads a whole state only then. */
export const anyFoodWindow = hhmm => Object.values(MEAL_DUE).some(h => {
  const late = minutesOf(hhmm) - h * 60;
  return late >= 0 && late < WINDOW_MIN;
});

/**
 * The meal owed a reminder now, or null: its window open, nothing logged under it on `now.date`,
 * and not already sent today (`sent` is user.foodPushSent, { meal: date }).
 */
export function foodPushOwed(S, now, sent = {}) {
  if (!foodPushOn(S)) return null;
  const at = minutesOf(now.hhmm);
  const log = isMap(S.foodLog) ? Object.values(S.foodLog) : [];
  for (const [meal, h] of Object.entries(MEAL_DUE)) {
    const late = at - h * 60;
    if (late < 0 || late >= WINDOW_MIN || sent?.[meal] === now.date) continue;
    if (log.some(e => isMap(e) && e.n && e.d === now.date && e.m === meal)) continue;
    return meal;
  }
  return null;
}

// ponytail: English only; the frontend packs have the words, generate them in like nudge-copy.js
// if anyone needs another language here.
export const foodPush = meal => ({
  title: 'Food diary',
  body: `Nothing logged for ${LABEL[meal]} yet. Tap to log it.`,
  tag: 'food-reminder',
});
