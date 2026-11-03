// Which cards Home shows under the week, and in which order (the pencil in Home's header).
// The week and today's session stay on top, always; the cards below are the user's to arrange.
// Two of them already had their own switch in Settings → Look & Home (the gym check-in, which also
// turns the check-in screen off, and the body weight card), and those stay the switches here, so
// the two places never disagree. The order is a setting like any other (S.homeOrder): null is the
// default order, and a card a newer version adds that an older order does not name goes last.
import { isOn } from './modules.js'

// `module` (lib/modules.js, Settings → Modules) is the feature area a card belongs to: switched off,
// the card is gone from Home and from the pencil's list, whatever its own switch says. The streak
// card goes with Motivation inside Home itself, since without it the weekly sets line keeps a card.
// The check-in card's own switch is `showCheckinCard`: `checkIn` became the module's old switch.
export const HOME_CARDS = [
  { id: 'checkin', label: 'Gym check-in', icon: 'qr', flag: 'showCheckinCard', module: 'checkin' },
  { id: 'weight', label: 'Body weight', icon: 'scale', flag: 'showWeightCard', module: 'body' },
  { id: 'health', label: 'Health', icon: 'heart', flag: 'showHealthCard', module: 'health' },
  { id: 'streak', label: 'Week streak', icon: 'flame', flag: 'showStreakCard', module: null },
]
const IDS = HOME_CARDS.map(c => c.id)

/** The cards in the order the profile chose, every known card once. */
export function homeOrderOf(S) {
  const chosen = Array.isArray(S?.homeOrder) ? S.homeOrder.filter(id => IDS.includes(id)) : []
  return [...new Set([...chosen, ...IDS])]
}

/** Whether the card's module is on (a card of no module always is). */
export function cardAvailable(S, id) {
  const card = HOME_CARDS.find(c => c.id === id)
  return !!card && (!card.module || isOn(S, card.module))
}

/** Whether a card is shown: its module on, and its switch on unless set to false (older profiles have none). */
export const cardShown = (S, id) => cardAvailable(S, id) && S?.[HOME_CARDS.find(c => c.id === id)?.flag] !== false

/** The order with `id` moved one place up (-1) or down (+1). */
export function moveCard(order, id, dir) {
  const i = order.indexOf(id), j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return order
  const out = order.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/**
 * The order with `id` moved one place up or down among the cards `listed` (those the pencil shows),
 * the hidden ones keeping their places: a step past a card whose module is off would show nothing.
 */
export function moveListed(order, listed, id, dir) {
  const moved = moveCard(listed, id, dir)
  if (moved === listed) return order
  const at = new Set(listed)
  let k = 0
  return order.map(x => (at.has(x) ? moved[k++] : x))
}
