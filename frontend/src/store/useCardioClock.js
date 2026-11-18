// The count-up clock on a cardio set (lib/cardio-clock.js decides, this runs it): one at a time.
// Its own store, like the circuit player's, since it is neither a rest nor a hold: it stops
// neither, and neither stops it. The run is only where it started and for which set, kept in
// localStorage and never on the set or in the synced state, so it counts on in the background
// and across a reload, and the row's face reads the time off Date.now().
import { create } from 'zustand'
import { useStore } from './useStore.js'
import { elapsedSec, minutesFor, parseRun, runAt } from '../lib/cardio-clock.js'
import { settleSpeed } from '../lib/distance.js'

export const CARDIO_CLOCK_KEY = 'gym_cardio_clock'
const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const save = run => { try { if (run) store()?.setItem(CARDIO_CLOCK_KEY, JSON.stringify(run)); else store()?.removeItem(CARDIO_CLOCK_KEY) } catch { /* the clock just does not outlive a reload */ } }
const load = () => { try { return parseRun(store()?.getItem(CARDIO_CLOCK_KEY) || 'null') } catch { return null } }

export const useCardioClock = create((set, get) => ({
  run: null,   // { wid, idx, i, id, startedAt }: the workout, entry and set being timed
  // Starting one stops the one running, which writes its time to its own row.
  start(idx, i, now = Date.now()) {
    const A = useStore.getState().S?.active
    const e = A?.entries?.[idx]
    if (!e || !e.sets?.[i] || e.sets[i].done) return
    get().stop(now)
    set({ run: { wid: A.id, idx, i, id: e.id, startedAt: now } })
  },
  // Stopped (■, a tick, Finish): the minutes go to the row, as if typed there.
  stop(now = Date.now()) {
    const run = get().run
    if (!run) return
    set({ run: null })
    const min = minutesFor(elapsedSec(run.startedAt, now))
    if (min == null) return
    useStore.getState().update(s => {
      const at = runAt(s.active, run)
      if (!at) return
      const st = s.active.entries[at.idx].sets[at.i]
      st.min = min
      // A row logged by distance keeps its speed in step with the minutes (Workout setField).
      if (Number(st.km) > 0) settleSpeed(st)
    }, true)
  },
  // Gone with its set, its exercise or its workout: nothing to write.
  drop() { if (get().run) set({ run: null }) },
}))
useCardioClock.subscribe((s, prev) => { if (s.run !== prev.run) save(s.run) })

/** The run kept from before a reload. Whether it still belongs to the workout on screen is the
 *  screen's to check (runAt), since the workout may load after this. */
export function restoreCardioClock() {
  const run = load()
  if (run) useCardioClock.setState({ run })
  return !!run
}
restoreCardioClock()
