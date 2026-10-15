import { supersetUnits } from './history.js'

function moveTarget(active, index, direction) {
  if (!active || !Array.isArray(active.entries) || (direction !== -1 && direction !== 1)) return null
  const units = supersetUnits(active.entries)
  const source = units.findIndex(unit => unit.includes(index))
  const target = source + direction
  if (source < 0 || target < 0 || target >= units.length) return null
  return { units, source, target }
}

export function canMoveActiveWorkoutUnit(active, index, direction) {
  return moveTarget(active, index, direction) !== null
}

export function moveActiveWorkoutUnit(active, index, direction) {
  const move = moveTarget(active, index, direction)
  if (!move) return null

  const selected = active.entries[index]
  const reorderedUnits = [...move.units]
  const sourceUnit = reorderedUnits[move.source]
  reorderedUnits[move.source] = reorderedUnits[move.target]
  reorderedUnits[move.target] = sourceUnit
  const indices = reorderedUnits.flat()
  const reorderedEntries = indices.map(entryIndex => active.entries[entryIndex])

  active.entries.splice(0, active.entries.length, ...reorderedEntries)
  active.cur = active.entries.indexOf(selected)
  return { indices }
}

// The exercise ⋯ menu's Move up/down. Moving a hanging leg raise away from the pull-ups next to
// it used to move the whole superset past the main lift. A member of a superset moves inside it:
// it swaps places with the member next to it and keeps its sg, so the superset stays one block
// under the same id (its layout choice and groupMeta are keyed by that id). At the superset's
// first or last member there is nobody to swap with, and the move takes the whole superset past
// its neighbouring block, as moveActiveWorkoutUnit always has. The routine editor's arrows
// (moveRoutineEntry, #377) take a member at the edge out of its superset instead; during a
// workout that would change a superset whose round is under way, so here the edge keeps the
// whole-superset move. A lone exercise moves exactly as before.
//
// The round-robin through a superset is positional (supersetFlowStep): the members before the
// marker have done the round in progress, the marker's member and those after it still owe it.
// So the marker keeps its position through a swap and points at whichever member now sits there.
// A swap may not carry a member across it, because the one moved behind the marker would be
// skipped this round and the one moved in front of it would run twice. A swap with both members
// on one side of the marker is safe, and so is any swap while the marker is outside the superset.
function memberSwapTarget(active, index, direction) {
  if (!active || !Array.isArray(active.entries) || (direction !== -1 && direction !== 1)) return null
  const unit = supersetUnits(active.entries).find(members => members.includes(index))
  if (!unit || unit.length < 2) return null
  const target = index + direction
  return unit.includes(target) ? { unit, target } : null
}

function crossesMarker(active, unit, index, target) {
  const cur = active.cur
  if (!unit.includes(cur)) return false
  return Math.min(index, target) < cur && Math.max(index, target) >= cur
}

export function canMoveActiveWorkoutEntry(active, index, direction) {
  const swap = memberSwapTarget(active, index, direction)
  if (swap) return !crossesMarker(active, swap.unit, index, swap.target)
  return canMoveActiveWorkoutUnit(active, index, direction)
}

// Returns the same { indices } permutation as moveActiveWorkoutUnit (new position -> old index),
// so the caller remaps per-entry state the same way; null when the move is refused.
export function moveActiveWorkoutEntry(active, index, direction) {
  const swap = memberSwapTarget(active, index, direction)
  if (!swap) return moveActiveWorkoutUnit(active, index, direction)
  if (crossesMarker(active, swap.unit, index, swap.target)) return null
  const indices = active.entries.map((_, i) => i)
  indices[index] = swap.target
  indices[swap.target] = index
  const reorderedEntries = indices.map(entryIndex => active.entries[entryIndex])
  active.entries.splice(0, active.entries.length, ...reorderedEntries)
  return { indices }
}
