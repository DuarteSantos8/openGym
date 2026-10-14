// Which cards Home shows under the week, and in which order (the pencil in Home's header).
// The week and today's session stay on top, always; the cards below are the user's to arrange.
// Two of them already had their own switch in Settings → Look & Home (the gym check-in, which also
// turns the check-in screen off, and the body weight card), and those stay the switches here, so
// the two places never disagree. The order is a setting like any other (S.homeOrder): null is the
// default order, and a card a newer version adds that an older order does not name goes last.

export const HOME_CARDS = [
  { id: 'checkin', label: 'Gym check-in', icon: 'qr', flag: 'checkIn' },
  { id: 'weight', label: 'Body weight', icon: 'scale', flag: 'showWeightCard' },
  { id: 'health', label: 'Health', icon: 'heart', flag: 'showHealthCard' },
  { id: 'streak', label: 'Week streak', icon: 'flame', flag: 'showStreakCard' },
]
const IDS = HOME_CARDS.map(c => c.id)

/** The cards in the order the profile chose, every known card once. */
export function homeOrderOf(S) {
  const chosen = Array.isArray(S?.homeOrder) ? S.homeOrder.filter(id => IDS.includes(id)) : []
  return [...new Set([...chosen, ...IDS])]
}

/** Whether a card is shown: its switch, on unless set to false (older profiles have none). */
export const cardShown = (S, id) => S?.[HOME_CARDS.find(c => c.id === id)?.flag] !== false

/** The order with `id` moved one place up (-1) or down (+1). */
export function moveCard(order, id, dir) {
  const i = order.indexOf(id), j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return order
  const out = order.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
