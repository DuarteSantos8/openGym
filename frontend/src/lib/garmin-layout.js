// Which Garmin cards each account sees, in what order, and where else Garmin shows up. Kept on
// the server with the account's Garmin record (PUT /api/garmin/prefs), so it follows the person
// to every device and stays out of the synced app state that upstream owns.

/** The Garmin screen's cards, in their default order. `off`: hidden until switched on. */
export const CARDS = [
  { id: 'sick', label: 'Getting-sick warning' },
  { id: 'ready', label: "Today's readiness" },
  { id: 'tiles', label: 'Today at a glance' },
  { id: 'partners', label: 'Shared with you' },
  { id: 'team', label: 'Together this week' },
  { id: 'trends', label: 'Trends (sleep, HRV, resting HR, steps)' },
  { id: 'bbcurve', label: 'Body battery through the day' },
  { id: 'sleep', label: 'Sleep rhythm and bedtime' },
  { id: 'zones', label: 'Heart rate zones' },
  { id: 'load', label: 'Training load' },
  { id: 'cost', label: 'What each routine costs you' },
  { id: 'sleeplift', label: 'Sleep and your lifts' },
  { id: 'run', label: 'Running economy' },
  { id: 'fitness', label: 'Fitness age' },
  { id: 'acts', label: 'Activities' },
]

/** Garmin in the rest of the app. */
export const PLACES = [
  { id: 'place-home', label: 'Card on Home' },
  { id: 'place-stats', label: 'Last 7 days in Stats' },
  { id: 'place-food', label: 'Calories burned in Food' },
  { id: 'place-workout', label: 'Watch data in a saved workout' },
]

/** What the Home card's line can hold, in order. `on`: shown by default. */
export const HOME_ITEMS = [
  { id: 'bb', label: 'Body battery', on: true },
  { id: 'sleep', label: 'Sleep', on: true },
  { id: 'hrv', label: 'HRV status', on: true },
  { id: 'steps', label: 'Steps' },
  { id: 'rhr', label: 'Resting heart rate' },
  { id: 'stress', label: 'Stress' },
  { id: 'need', label: 'Bedtime tonight' },
]

/** The cards in this account's order: its own order first, then any card it has not placed yet. */
export function cardOrder(prefs) {
  const known = new Set(CARDS.map(c => c.id))
  const mine = (prefs?.cards || []).filter(id => known.has(id))
  return [...new Set([...mine, ...CARDS.map(c => c.id)])]
}

export const isShown = (prefs, id) => !(prefs?.hidden || []).includes(id)

/** The prefs patch that shows or hides `id`. */
export const toggle = (prefs, id, on) => ({ hidden: on ? (prefs?.hidden || []).filter(x => x !== id) : [...new Set([...(prefs?.hidden || []), id])] })

/** The prefs patch that moves card `id` one step up (-1) or down (+1). */
export function move(prefs, id, dir) {
  const list = cardOrder(prefs), i = list.indexOf(id), j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return { cards: list };
  [list[i], list[j]] = [list[j], list[i]]
  return { cards: list }
}

/** The Home card's items for this account. */
export const homeItems = prefs => (Array.isArray(prefs?.home) ? prefs.home : HOME_ITEMS.filter(x => x.on).map(x => x.id))
