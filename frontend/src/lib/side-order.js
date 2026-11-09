// Which side of a per-side set comes first. Left then right unless the exercise's settings say
// right first (`sideOrder: 'RL'` on its target, written only when chosen, so a config that never
// touched it keeps its exact shape). Only the order the sides are drawn and ticked in changes:
// what is logged stays `sides.L` and `sides.R`.

/** The two sides in the order this exercise does them: ['L', 'R'] or ['R', 'L']. */
export const sidesInOrder = cfg => (cfg?.sideOrder === 'RL' ? ['R', 'L'] : ['L', 'R'])

/** The side of a per-side set to do next: the first one in order that is not done yet. */
export function nextSide(set, cfg) {
  const [first, second] = sidesInOrder(cfg)
  return set?.sides?.[first]?.done ? second : first
}
