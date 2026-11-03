# The watch sync protocol

How the Apple Watch and Wear OS apps stay in step with the phone (since v1.4.5). The phone is the
source of truth for the workout; the watch runs the session on its own while the phone sleeps and
must never lose what was logged on it. Code: `frontend/src/lib/watch-sync.js` (phone page),
`ios/App/WatchCore` + `ios/App/Watch/SessionStore.swift` + `ios/App/App/WatchBridgePlugin.swift`
(Apple), `android/wear` + `android/app/.../WatchBridgePlugin.java` (Wear OS, see WEAR_OS.md).

## Watch → phone: events

Every event (`start`, `setDone`, `setHr`, `finish`, `discard`, `weighIn`, `healthDeleted`,
`watchStatus`) has a unique `id` and a per-watch `seq` (its order).

1. **Outbox.** The event goes into the watch's outbox (saved) before it is sent
   (`Outbox.swift` / `OutboxCore` in `SessionCore.kt`). It leaves the outbox only once the phone
   has *applied* it.
2. **Transport.** Apple Watch: one `sendMessage` with the waiting events while the phone is in
   reach (the iPhone stores them and answers with the ids stored), else `transferUserInfo`.
   Wear OS: one Data Layer item per event (`/opengym/event/<id>`); the phone deletes it once stored.
   Either signal marks the event *delivered*.
3. **Resend.** Not delivered: again after 20 s. Delivered but not applied: again after 10 min. Back
   in reach and at launch: everything not delivered. Copies are harmless (step 5).
4. **Phone native side.** Stores each event in its queue file (on disk before it answers), even
   with the app closed: the iPhone's WatchConnectivity session is activated at launch
   (`WatchLink`, AppDelegate), so background launches receive too.
5. **Phone page.** Drains the queue, sorts by `seq`, applies each id once (the applied list
   survives restarts), saves, then acknowledges to the native queue. An event of a watch-started
   workout whose `start` has not arrived waits for it (up to 48 h). A `start` for a workout the
   phone already had (saved, discarded) starts nothing; one that comes while another workout runs
   on the phone waits until that one ends. A `setDone` for a workout already saved goes into the
   saved workout, recreating the exercise if the phone saved it without one.

## Phone → watch: snapshot

The running workout (debounced 400 ms after each change) plus `acked`: the last 80 applied event
ids. On the watch, `acked`:

- removes those events from the outbox;
- drops the watch's pending copy of a set it ticked, so the phone's version wins from then on
  (an untick or edit on the phone sticks);
- confirms a workout started on the watch (`startId` acked), so if the phone already ended it, it
  ends on the watch too instead of running on.

## End of a workout

- Finished or discarded on the watch: the event goes through the outbox; the watch never brings
  the workout back from a stale snapshot (`finishedHere`).
- Finished or discarded on the phone: the next snapshot has no workout (and names discarded ones);
  the watch ends it, and its events still in the outbox are delivered and merged afterwards.
