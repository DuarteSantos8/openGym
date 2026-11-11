# The watch sync protocol

How the Apple Watch, Wear OS and Garmin apps stay in step with the phone (since v1.4.5). The phone
is the source of truth for the workout; the watch runs the session on its own while the phone sleeps
and must never lose what was logged on it.

| Where | Code |
| --- | --- |
| Phone page (all watches) | `frontend/src/lib/watch-sync.js` |
| iPhone native | `ios/App/App/WatchBridgePlugin.swift` (`WatchLink`: the session and the queue file) |
| Apple Watch | `ios/App/WatchCore` (pure logic: `SessionCore`, `Outbox`, `SnapshotOrder`, `RestMath`), `ios/App/Watch/SessionStore.swift` (WatchConnectivity), `WorkoutManager.swift` (Apple Health) |
| Wear OS | `android/wear`, `android/app/.../WatchBridgePlugin.java` (WEAR_OS.md) |
| Tests | `watch-sync*.test.js`, the simulator `lib/watch-sim.js`, `WatchCore/Tests` (`swift test` in CI) |

## The two directions at a glance

```
            snapshot (whole state, newest wins)
 phone  ─────────────────────────────────────────▶  watch
 page  ◀── drain / ack ── native queue file ◀────── outbox (every event until applied)
            events (small, numbered, each applied once)
```

- **Phone → watch** is state: one snapshot of the running workout, replaced by the next. Losing one
  does not matter, the next carries everything.
- **Watch → phone** is a log: events, each with an id, kept on the watch until the phone says it
  applied them. Sending one twice does not matter, it is applied once.

## Watch → phone: events

| Event | Fields | What the phone does |
| --- | --- | --- |
| `start` | `wid` (`watch-<uuid>`), `routineIds`, `at`, `bw?` | starts that session with the watch's id and start time |
| `setDone` | `wid`, `exId`, `entryIdx`, `setIdx`, `w?`, `r?`, `sec?`, `side?`, `at`, `hr?`, `rpe?`/`rir?` | the workout screen's own tick; of two ticks of one set the later `at` wins |
| `setHr` | `wid`, `exId`, `entryIdx`, `setIdx`, `hr?`, `restHr?` | heart rate onto that set, running or saved |
| `finish` | `wid`, `at`, `idle?`, `left?` | Finish and save, ending at `at`; an idle finish is checked against the phone's own log first |
| `discard` | `wid`, `at` | the workout screen's Discard |
| `stillHere` | `wid`, `at` | "Keep going" on the forgotten-workout question |
| `weighIn` | `w`, `at` | a body weight entry |
| `healthDeleted` | `ids` | the phone's own Apple Health removal runs again |
| `watchStatus` | `health`, `version`, `at` | Settings → Apple Watch; an older one never replaces a newer one |

Every event has a unique `id` and a per-watch `seq` (its order on that watch).

1. **Outbox.** The event goes into the watch's outbox (saved) before it is sent (`Outbox.swift` /
   `OutboxCore` in `SessionCore.kt`). It leaves the outbox only once the phone has *applied* it.
   Of the watch's status only the newest waits (one is made at every launch).
2. **Transport.** Apple Watch: one `sendMessage` with the waiting events while the phone is in
   reach (the iPhone stores them and answers with the ids stored), else, or when that fails,
   `transferUserInfo` (queued by the system, in order, survives either app being killed).
   Wear OS: one Data Layer item per event (`/opengym/event/<id>`); the phone deletes it once stored.
   Either signal marks the event *delivered*.
3. **Resend.** Not delivered: again after 20 s (Wear OS: then 40 s, 80 s … up to 10 min).
   Delivered but not applied: again after 10 min. Back in reach and at launch: everything not
   delivered. Copies are harmless (step 5). On the Apple Watch there is no timer: what is due goes
   out when a snapshot arrives, the phone comes back in reach, the app launches or a transfer
   fails. Wear OS also checks every 30 s during a workout.
4. **Phone native side.** Stores each event in its queue file (on disk before it answers; an event
   that could not be written is not answered as stored), even with the app closed: the iPhone's
   WatchConnectivity session is activated at launch (`WatchLink`, AppDelegate), so background
   launches receive too. The page does not have to exist: the file waits for it.
5. **Phone page.** Drains the queue, sorts by `seq`, applies each id once (the applied list
   survives restarts), saves, then acknowledges to the native queue. Killed between applying and
   acknowledging, it finds the events again and applies nothing twice.

### What the page does with an event that does not fit

| Situation | What happens |
| --- | --- |
| An event of a watch-started workout arrives before its `start` | waits in the queue (48 h without a start anywhere; as long as it takes while its start is in the queue too) |
| `start` while another workout runs on the phone | waits, its sets with it, until that one ends, however long; then starts with the watch's own times |
| `start` for a workout the phone already had (saved, discarded, running) | starts nothing |
| `setDone` for a workout already saved | written into the saved workout (stamped, so the server sync keeps it), the exercise recreated if the phone saved it without one |
| `setDone` for a row or an exercise the running workout does not have (taken out on the phone meanwhile, or the watch started a routine the phone has changed or deleted since) | the workout gets the row with the set in it (`ensureWatchSet`); only an exercise this phone does not know is let go of |
| `setDone` while the workout screen is not open | the screen opens, the queue drains when it is there |
| `finish` the phone has logged past (`staleWatchFinish`) | the workout keeps running on the phone |
| An action throws | the event stays queued and is tried again shortly; after three tries it is let go of so the sets behind it get through |

The rest the phone starts for a set ticked on the watch counts from the tick (`at`), not from when
the phone heard of it (`restLagSec`): both end together, and a set done long ago starts no rest.

## Phone → watch: snapshot

The running workout (debounced 400 ms after each change) plus `acked`: the last 80 applied event
ids. iPhone: sent as the application context (the watch gets the newest whenever it next can) and
as a message too while the watch app is there. Both carry a stamp `at`; the watch skips a stamp
older than the newest it applied (`SnapshotOrder`: the two travel apart). The stamp always goes up,
whatever the phone's clock does (`WatchBridgePlugin.nextStamp`).

On the watch, `acked`:

- removes those events from the outbox;
- drops the watch's pending copy of a set it ticked, so the phone's version wins from then on
  (an untick or edit on the phone sticks);
- confirms a workout started on the watch (`startId` acked), so if the phone already ended it, it
  ends on the watch too instead of running on.

Until a tick is acked or shown done by a snapshot at its time or later, the watch keeps its own
copy of that set over whatever a snapshot says (`pending`): a snapshot from before the tick cannot
undo it.

The running workout may carry `pausedAt` (ms) while it is paused on the phone (#976): the watch's
clock stands at that moment. On resume the field goes and `start` moves on by the pause, so the
watch needs nothing else. The rest screen's "Next" shows the next set's weight and reps from the
set rows the snapshot already holds (#911); nothing new is sent for it.

**Rest.** A rest end in a snapshot is followed once (`RestMath.phoneRest`); the first snapshot that
acks the watch's own latest tick carries the phone's copy of the rest the watch already runs and is
remembered, not followed, so a +15 or Skip pressed right after Done stands.

## End of a workout

- Finished or discarded on the watch: the event goes through the outbox; the watch never brings
  the workout back from a stale snapshot (`finishedHere`). The phone saves it ending when Finish
  was tapped at the wrist, not when it heard.
- Finished or discarded on the phone: the next snapshot has no workout (and names discarded ones);
  the watch ends it, and its events still in the outbox are delivered and merged afterwards.

## Where each side keeps what

| | Kept | Survives |
| --- | --- | --- |
| Watch | session state (`SessionState`), outbox, both in UserDefaults after every change | app killed, watch restarted |
| System (WatchConnectivity) | queued `transferUserInfo`, the newest application context | either app killed |
| iPhone native | `Application Support/watch-events.json` (at most 1000 events) | app killed, page not loaded |
| Phone page | applied ids (`gym_watch_applied`, 1000), watch workouts met (`gym_watch_wids`, 60), discarded (`gym_watch_discarded`), the workout itself in the store | page reload, app relaunch |

## Conflicts

- **The same set on both sides:** the later tick (`at`) wins, on both sides.
- **The plan changed on the phone mid-workout:** the snapshot is the plan; a set the watch logged
  for something that is gone is kept (see the table above).
- **The server sync (`/api/data`, 409 merge):** the running workout is this phone's own and a merge
  leaves it alone; a watch set written into a saved workout stamps that workout, so the merge keeps
  it (`useStore.watch-drain-sync.test.jsx`).
- **Two watches** (an Apple Watch and a Garmin share the native queue; a Zepp watch has its own
  link): each numbers its events from 1; the page sorts them together, which keeps each watch's own
  order. A second watch's own workout waits for the first to end.
- **Clocks:** times are milliseconds since 1970, so a time zone change does nothing. A watch whose
  clock is off still syncs; only "later wins" on a set both touched follows the clocks.

## Testing it without a watch

`lib/watch-sim.js` is a phone and a watch in one process: the real page over a fake WatchBridge, the
iPhone's queue file, WatchConnectivity as documented (messages that fail, transfers that queue, a
context that only keeps the newest) and a port of the watch's Swift. `watch-sync.sim.test.js` plays
gym situations on it; `watch-sync.property.test.js` plays seeded random ones and checks that every
set logged anywhere is saved exactly once (`RUN_SEED=<n>` replays one, `WATCH_SIM_RUNS=<n>` runs
more). When the Swift changes, the port changes with it.
