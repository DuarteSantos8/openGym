// Which Home and Stats cards draw anything right now (1.4.6, owner 2026-11-23: "only show options
// that really make sense … 'your week' is not appearing even though I'm pressing Show").
// Many cards decide for themselves whether they have something to show (Your week only after a
// week ended, Deload only in a deload week). <Arranged> reports what each one drew after every
// render; the Customize sheet reads it to leave out cards that would show nothing today, and to
// say so for one the person turns on that has nothing yet.
//
//   true   the card drew something on its last render
//   false  it drew nothing, or its view did not offer it at all
//   undefined  not seen yet (hidden, or the page was not open since the app started)
const live = { home: new Map(), stats: new Map() }
const subs = new Set()
let version = 0

export function reportCard(page, id, has) {
  const m = live[page]
  if (!m || m.get(id) === has) return
  m.set(id, has)
  version++
  for (const f of subs) f()
}

export const cardLive = (page, id) => live[page]?.get(id)
export const liveVersion = () => version
export function subscribeLive(f) { subs.add(f); return () => subs.delete(f) }
/** Tests: forget everything. */
export function resetLive() { for (const m of Object.values(live)) m.clear(); version++ }
