// What the exercise picker shows first when it is choosing a replacement for one exercise — a
// workout's Swap or the routine editor's Replace (#473, #110). Most swaps are for the same
// muscle (the machine is taken), so the picker opens on that exercise's body part and puts the
// closest alternatives at the top. Every chip still works: this only decides where it starts.
import { BODYPARTS } from './exercises.js'

/** The body-part chip to open on: the exercise's own, when the picker has a chip for it. */
export const alternativesScope = like =>
  like && BODYPARTS.includes(like.bp) ? like.bp : ''

/**
 * Closest alternatives first: the same target muscle, then the same equipment; the exercise
 * being replaced goes last, since picking it would change nothing. Stable, so within each
 * rank the list keeps the order it came in (by name, or favourites first after this).
 */
export function rankAlternatives(list, like) {
  if (!like) return list
  const rank = e => e.id === like.id ? -1
    : (like.tg && e.tg === like.tg ? 2 : 0) + (like.eq && e.eq === like.eq ? 1 : 0)
  return list.map((e, i) => [rank(e), i, e]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[2])
}
