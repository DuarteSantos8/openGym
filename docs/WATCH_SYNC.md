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

**Protocol 2** (the watch-sync round, 1.4.5): one rest for the phone and every watch, the two
clocks, and an id for every set. All of it is additive: a watch app that does not know a field
ignores it, and the phone treats an event without the new fields as before. The sections marked
*(protocol 2)* say what each watch app must do; `lib/watch-sim.js` runs a port of exactly that
(`protocol: 2`, the default) and of the first builds (`protocol: 1`) against the real page.

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
| `setDone` | `wid`, `exId`, `entryIdx`, `setIdx`, `sid?`, `w?`, `r?`, `sec?`, `side?`, `at`, `hr?`, `rpe?`/`rir?`, `restEnd?` | the workout screen's own tick; of two changes of one set the later wins (`at` against the set's stamp, below); `restEnd`: the end of the rest the watch started for this tick (watch clock, ms), `0` for none (protocol 2) |
| `setHr` | `wid`, `exId`, `entryIdx`, `setIdx`, `sid?`, `hr?`, `restHr?` | heart rate onto that set, running or saved |
| `rest` | `wid`, `endsAt` (ms, watch clock) or `null`, `at` | +15, −15 or Skip on the watch (`null`: Skip, or −15 to nothing): the phone's rest follows when `at` is newer than its own last change (protocol 2) |
| `addSet` | `wid`, `exId`, `entryIdx`, `sid` (the watch's own, e.g. `w-<uuid>`), `after?` (a set's id), `w?`, `r?`, `sec?`, `at` | a row like the exercise's last, after `after` or at the end, with that id; once only (#1139, #1185) |
| `removeSet` | `wid`, `exId`, `entryIdx`, `setIdx`, `sid`, `at` | that row out, unless it is done (or the exercise's only row): then nothing, and the next snapshot shows it again |
| `finish` | `wid`, `at`, `idle?`, `left?` | Finish and save, ending at `at`; an idle finish is checked against the phone's own log first |
| `discard` | `wid`, `at` | the workout screen's Discard |
| `stillHere` | `wid`, `at` | "Keep going" on the forgotten-workout question |
| `weighIn` | `w`, `at` | a body weight entry |
| `healthDeleted` | `ids` | the phone's own Apple Health removal runs again |
| `watchStatus` | `health`, `version`, `at` | Settings → Apple Watch; an older one never replaces a newer one |

Every event has a unique `id` and a per-watch `seq` (its order on that watch). With protocol 2
every event also carries `off`: the watch's clock minus the phone's, in ms, as the watch works it
out (Clocks, below); the phone takes it off `at`, `restEnd` and `endsAt` before anything else.

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

The rest the phone starts for a set ticked on the watch ends when the watch's rest for it ends
(`restEnd`), or there is none when the watch started none (`restEnd: 0`). From a watch that does
not say, it counts from the tick (`at`), not from when the phone heard of it (`restLagSec`). Either
way a set done long ago starts no rest, and a rest changed on the phone after the tick stands
(`watchTickRest`; the rest is decided by its own stamp, whoever's numbers win the set).

## Phone → watch: snapshot

The running workout plus `acked`: the last 80 applied event ids. A change goes at once (in the
next turn, so a tick and the rest it starts go as one) when nothing went in the last 400 ms, else
at the end of those 400 ms; what waits goes at once when the app goes to the background or is
locked (a Finish followed by the lock button, #882 and the mail about finishing on the phone).
The snapshot also carries `now`, the phone's clock when it was made (protocol 2). iPhone: sent as the application context (the watch gets the newest whenever it next can) and
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

Each set row carries its id (`sid`) and, as `at`, the later of its tick and the last change of its
numbers on the phone (`setStamp`: a done set edited on the phone is stamped `eat`), so a weight
corrected on the phone after the tick is not undone by an older fix from the wrist.

The running workout may carry `pausedAt` (ms) while it is paused on the phone (#976): the watch's
clock stands at that moment. On resume the field goes and `start` moves on by the pause, so the
watch needs nothing else. The rest screen's "Next" shows the next set's weight and reps from the
set rows the snapshot already holds (#911); nothing new is sent for it.

## One rest (protocol 2)

The snapshot's `active` says:

| Field | Meaning |
| --- | --- |
| `rest` | `{ endsAt, total? }` while a rest runs on the phone (ms, phone clock; `total` in s), else `null` |
| `restPaused`, `restLeft` | the rest is paused on the phone (#1149, #1165, a circuit's too), holding `restLeft` s; `rest` is `null` then |
| `restAt` | when the rest was last changed on purpose (ms, phone clock): a start, ±15, Skip, a pause, a resume, here or by a watch's event. Not sent before the first change in that workout |

Every change of the rest made on purpose has a time on the phone's clock. The phone keeps the time
of the newest change it applied (`restAt`, kept on disk with its workout, `gym_watch_rest`), and so
does each watch. **A side follows a change that is newer than its own newest, and ignores every
other.** The rest running out by itself is no change.

- The phone stamps its own changes (`noteRestChange`) and those a watch's event made with that
  event's time (`applyRestStep`): a tick's `at`, a `rest` event's `at`.
- A watch, on a snapshot of its own workout with `restAt` newer than its own: `rest` → its rest ends
  at `rest.endsAt + off` (restarted only when that differs by more than 250 ms); `restPaused` → it
  holds at `restLeft`; neither → its rest ends as a Skip ends it (the rest's heart rate closed on
  its set, the next hold counted in). Then its own newest is that `restAt`.
- A watch, on its own change at `t` (its clock): a tick sends `restEnd` (or `0`), ±15 and Skip send
  a `rest` event; its own newest becomes `t − off` (the same `off` it sends). Kept on disk.
- A snapshot of another workout than the one it ran: the watch's rest ends, its newest goes to 0.
- A snapshot without `restAt` (a phone from before this): the first rules below.

So a late snapshot, a late event, the watch app relaunched with an old context, and the phone app
coming to the front or being cold-launched (its restored rest has the stamp it had) never restart
a rest; a Skip on the phone ends the watch's (#1149); +15 and Skip from the watch reach the phone;
a tick from a watch that was away does not take away a rest started on the phone since.

**Protocol 1** (and a phone without `restAt`): a rest end in a snapshot is followed once
(`RestMath.phoneRest`); the first snapshot that acks the watch's own latest tick carries the
phone's copy of the rest the watch already runs and is remembered, not followed, so a +15 or Skip
pressed right after Done stands.

## A set's identity (#1162, protocol 2)

Every row of the running workout has an id (`sid`), given by the phone the moment the row exists
(a copied row gets a new one; of two rows with one id the first keeps it) and saved with the
workout. A watch names a set by it in `setDone`, `setHr`, `addSet` (`after`) and `removeSet`, and
makes one up for a set it adds. The phone applies an event to the row with that id, wherever it is
now; a row with that id that is gone gets a row of its own (at its old place when that is past the
last row, else at the end), never the place another set holds. Without `sid`, as before: by
position (`entryIdx`, then the first entry of `exId`), so an older watch still works.

On the watch: pending ticks are keyed by `sid` (with the side for a per-side set), else by entry,
exercise and set (`e<entryIdx>:<exId>#<setIdx>`), so the same exercise twice in a workout is two
exercises; sets it added or took out wait like ticks (replayed over each snapshot in the watch's
order, before the ticks, until acked). #1162's four cases, settled:

1. A tick after a refused Remove lands on its own set: it names the set by id.
2. A held removal (the 4 s Undo) is replayed over every snapshot like a pending tick, so a snapshot
   no longer has to end the Undo window early; it is sent when the window closes.
3. One exercise twice no longer shares marks: keys are ids (or include the entry).
4. A mark made before a tick does not vanish for one sync: edits and ticks replay in the watch's
   order over every snapshot until acked.

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

- **The same set on both sides:** the later change wins, on both sides: a tick's `at` (on the
  phone's clock) against the set's stamp (`setStamp`: its tick, or a later edit of its numbers on
  the phone).
- **The plan changed on the phone mid-workout:** the snapshot is the plan; a set the watch logged
  for something that is gone is kept (see the table above).
- **The server sync (`/api/data`, 409 merge):** the running workout is this phone's own and a merge
  leaves it alone; a watch set written into a saved workout stamps that workout, so the merge keeps
  it (`useStore.watch-drain-sync.test.jsx`).
- **Two watches** (an Apple Watch and a Garmin share the native queue; a Zepp watch has its own
  link): each numbers its events from 1; the page sorts them together, which keeps each watch's own
  order. A second watch's own workout waits for the first to end. Both follow the one rest: a +15
  on one is a newer `restAt` for the other.
- **Clocks:** times are milliseconds since 1970, so a time zone change does nothing. With protocol 2
  each watch works out how far its clock is off the phone's: for every snapshot that came **as a
  message** (never the application context, which can wait for minutes), `its clock on arrival −
  snapshot.now`; its offset `off` is the smallest of those of the last five minutes (at most 8),
  the newest alone when none is that recent (the transport only ever adds delay, and a clock set
  meanwhile is followed within five minutes). It sends `off` with every event and adds it to the
  phone's times it shows (`rest.endsAt + off`; a set's `at + off` against its own pending ticks).
  The phone moves the event's times onto its own clock (`phoneClock`), so the rest agrees to the
  second and "later wins" goes by real time across a watch some seconds or minutes off. An offset
  over 12 h is a clock that is wrong, not off, and is left alone. Without `off` (protocol 1) "later
  wins" follows the watch's clock, as before.

## Last heard (#1151)

Settings → Apple Watch and Settings → Wear OS watch say when the watch was last heard from: the
later of its status (sent at each launch) and its newest event applied here, by the time it was
made at the wrist (`noteWatchHeard`, never later than that and never in the future). A sign during
the workout needs a signal the page does not have (the native side's own receive times and
reachability while the app sleeps): left to the native sides for 1.4.6.

## Testing it without a watch

`lib/watch-sim.js` is a phone and its watches in one process: the real page over a fake WatchBridge,
a rest timer with store/useUI.js's rules, the iPhone's queue file, WatchConnectivity as documented
(messages that fail, transfers that queue, a context that only keeps the newest, one link per
watch) and a port of the watch apps (protocol 1 or 2, a clock `skew`, `W.addWatch()` for a second
one, `W.coldLaunch` for a phone app woken by a watch's message). `watch-sync.sim.test.js` and
`watch-sync.sim2.test.js` play gym situations on it (the rest from either side, clocks off, Finish
and Discard with the other side away, edits, set ids and the set menu, supersets, two watches);
`watch-sync.rest.test.js` tests the phone's pieces one by one. `watch-sync.property.test.js` plays
seeded random ones (rests, edits, the set menu, discards, skew, a second watch, protocol 1) and
checks that every set logged anywhere is saved exactly once, that phone and watch show the same
sets, and (protocol 2) the same rest to within a second (`RUN_SEED=<n>` replays one,
`WATCH_SIM_RUNS=<n>` runs more, `SEED_FROM=<k>` starts at seed k, `WATCH_SIM_DUMP=1` prints the
saved workouts). When a watch app changes, the port changes with it.
