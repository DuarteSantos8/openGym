// Which layout a navigation unit asks for, decided from the unit's own shape.
//
// No entry carries a block label (warm-up, skill, main lift, accessory, cool-down), so the app
// cannot read one. It does not need to, because the one block that wants a different screen
// announces itself by shape: a warm-up and a cool-down are several timed movements sharing one
// superset on a rest far shorter than anything you would take between working sets, about 15 s
// for a warm-up and 10 s for a cool-down. Skill work, accessories and main lifts rest 30 s or
// more (a skill pair at 30, accessories at 30-60, main lifts at 90-150), so the threshold sits in
// an empty gap rather than between neighbours. A superset of timed holds on a 15 s rest is a flow
// whoever wrote it, and a block whose members rest 45 s is not.
import { modeOf, setSpanAt, supersetUnits, unitOf } from './history.js'

export const FLOW_MAX_REST = 20

// The get-ready counts Settings offers before each flow hold, besides Off. Anything else
// stored — a hand edit, an import, a value a later build offers — reads as Off, on the Settings
// screen and in the chain alike.
export const GET_READY_SEC = [3, 5, 10]
export const getReadyOf = S => (GET_READY_SEC.includes(S?.flowGetReady) ? S.flowGetReady : 0)

// Active-workout entries keep their target under `target` and their superset id on the entry;
// routine exercises are one flat config. Both answer the same three questions.
const cfgOf = item => (item && item.target ? { ...item.target, id: item.id } : item)

// The rest this member asks for itself (issue #10). A member carrying none inherits the global
// rest timer — 90 s out of the box — which is not a flow block whatever its movements look
// like, so an absent rest disqualifies the unit rather than being filled in from the default.
const ownRest = item => {
  const r = Number(cfgOf(item)?.restSec)
  return r > 0 ? r : 0
}

/**
 * Whether this unit is a flow block: two or more movements in one superset, every one of them
 * held rather than counted, every one asking for a rest short enough that the gap between
 * rounds is a breath and not a recovery.
 *
 * `items` are active-workout entries or a routine's exercises; `unit` is one group of indices
 * from history.supersetUnits.
 */
export function isFlowUnit(items, unit) {
  if (!Array.isArray(items) || !Array.isArray(unit) || unit.length < 2) return false
  return unit.every(i => {
    const item = items[i]
    if (!item || modeOf(cfgOf(item)) !== 'time') return false
    const rest = ownRest(item)
    return rest > 0 && rest <= FLOW_MAX_REST
  })
}

/**
 * What to call a flow block, from where it sits in the session: the first unit is the warm-up,
 * the last is the cool-down. Only the two ends are named. A flow block in the middle of a
 * session is a real thing — a circuit someone built by hand — but nothing in its shape says
 * what it is, and naming it anyway would be the app claiming to know something it does not.
 * Null for a unit that is not a flow block at all.
 */
export function blockOf(items, units, unitIdx) {
  if (!Array.isArray(units) || !isFlowUnit(items, units[unitIdx])) return null
  if (unitIdx === 0) return 'warmup'
  if (unitIdx === units.length - 1) return 'cooldown'
  return 'flow'
}

/**
 * The sets one member asks for, the way its set rows number them: a timed per-side hold is a left
 * row and a right row that read as one set (history.setSpanAt), done once both sides are. Counted
 * row by row, a two-set side stretch said "Round 1 of 4" and its first side finished a round.
 */
export function flowSetsOf(entry) {
  const rows = Array.isArray(entry?.sets) ? entry.sets : []
  const out = []
  for (let i = 0; i < rows.length;) {
    const [start, n] = setSpanAt(rows, i)
    out.push({ done: rows.slice(start, start + n).every(r => r?.done) })
    i = start + n
  }
  return out
}

/**
 * Where a superset is in its rounds, for the flow screen's "Round 2 of 2".
 *
 * A superset is one pass through its members, repeated. Members can run out at different times
 * — a block holding one movement twice and the others once — so the number of rounds is the most
 * any member asks for, and the round in progress is the furthest any member with work left still
 * has to reach: the least-advanced of them, plus one. A per-side hold's left and right rows are
 * one set (flowSetsOf), so a cool-down of one set of each stretch is one round.
 *
 * `at` is the movement that comes next, and it is NOT simply the first member with work. That
 * answer is right at a round boundary and wrong everywhere else: half way through round one of
 * a warm-up, the movement you have just held still has its round-two set, so "first with work"
 * sends you back to it and the block holds the same movement forever. What comes next is the
 * first member that has not yet finished the round in progress.
 */
export function flowProgress(entries, unit) {
  const idxs = Array.isArray(unit) ? unit : []
  const setsOf = i => flowSetsOf(entries?.[i])
  const doneOn = i => setsOf(i).filter(s => s.done).length
  const rounds = idxs.reduce((n, i) => Math.max(n, setsOf(i).length), 0)
  const left = idxs.filter(i => setsOf(i).some(s => !s.done))
  if (!left.length) return { round: rounds, rounds, done: true, at: null }
  const round = Math.min(...left.map(doneOn)) + 1
  return { round, rounds, done: false, at: left.find(i => doneOn(i) < round) }
}

/**
 * The key a per-block layout override is stored under: the superset's own id, which is what
 * survives exercises being added, removed and moved around it (indices do not). Null for a
 * lone exercise — there is no flow to turn on or off for one movement, so there is nothing to
 * remember about it.
 */
export function unitKey(entries, unit) {
  return Array.isArray(unit) && unit.length > 1 ? (entries?.[unit[0]]?.sg || null) : null
}

/**
 * The layout one unit renders in. The block's own shape decides by default — that is the whole
 * point: you do not tell the app that the warm-up is a warm-up. A choice the user made for this
 * block from a ⋯ menu wins over the shape, and everything else falls through to the
 * session's layout (s.active.workoutView, seeded from Settings).
 */
export function unitViewOf(entries, units, unitIdx, { workoutView, overrides } = {}) {
  // The Focus view (v1.4.0) shows one exercise at a time and steps on as its sets are ticked, so a
  // block there is the Focus view's rows, whatever its shape or override says (lib/blocks.js
  // flowUnitAt: and nothing runs by itself there).
  if (workoutView === 'focus') return 'focus'
  const unit = (Array.isArray(units) && units[unitIdx]) || []
  const key = unitKey(entries, unit)
  const own = key && overrides ? overrides[key] : null
  // There are two answers a user can give a block, not four: run it as a flow, or don't. 'rows'
  // deliberately names no layout of its own — the block drops back into whatever the session is
  // using, so switching the session between Cards, List and Compact afterwards still moves a
  // block that was taken off the flow screen. Anything else is the shape's call.
  //
  // 'flow' can only KEEP a flow, never manufacture one. A flow screen is a hold and a countdown,
  // so a block of counted sets has nothing for it to run: the card would show 0:00 and a Start
  // that hands a 10-rep bench press to a 45 second hold (views/Workout.jsx startTimed's `|| 45`),
  // while the timer bar offered Cancel because flowUnitAt — which tests the shape — said the
  // block was not in a flow at all. The shape test belongs on both sides or neither; putting it
  // here is what makes flowUnitAt's promise ("one function so the two can never disagree") true.
  if (own === 'flow') return isFlowUnit(entries, unit) ? 'flow' : (workoutView || 'cards')
  if (own === 'rows') return workoutView || 'cards'
  return isFlowUnit(entries, unit) ? 'flow' : (workoutView || 'cards')
}

/**
 * Whether this session runs blocks by themselves at all. A saved workout open in the editor and a
 * past workout being logged were trained on another day: there is nothing to hold now and nobody
 * to count in, so every block shows its set rows and no hold starts the next. Shown in either, the
 * flow card's Start would do nothing in the editor, and in a past workout it would run live holds
 * for a session that was over.
 */
export const runsFlows = active => !!active && !active.editingWorkoutId && !active.backfill

/**
 * The flow block the entry at `idx` belongs to, or null when it is not in one.
 *
 * "In one" means both halves: the block's shape says flow (isFlowUnit), and the user has not put
 * it back into rows from a ⋯ menu. Asked by the timer bar, to decide whether a running hold
 * gets Pause, and by the chain that starts the next movement — one function so the two can never
 * disagree about whether a block is running itself. Never in a session that runs none (runsFlows).
 *
 * `view` is the layout the session is shown in (s.active.workoutView, else the saved one). The
 * Focus view shows a block as its own rows and steps on as their sets are ticked (FocusView's
 * onProgress), so no block runs itself there: a chained hold would start a movement the view is
 * not showing, and the view would step on top of the chain.
 */
export function flowUnitAt(active, idx, view) {
  if (!runsFlows(active) || idx == null || view === 'focus') return null
  const entries = Array.isArray(active.entries) ? active.entries : []
  if (!entries[idx]) return null
  const unit = unitOf(supersetUnits(entries), idx)
  if (!isFlowUnit(entries, unit)) return null
  const key = unitKey(entries, unit)
  if (key && active.unitView?.[key] === 'rows') return null
  return unit
}
