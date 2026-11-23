# P1 spike: Record with sensor

Status: spike, simulator verified in the browser pane, real Bluetooth NOT yet tested. See `LIFTIQ-FORK.md` for the patch list.

## Flow

```
Workout > set number > menu > "Record with sensor"          (only when the integration is on, reps sets)
  |
  v  one bottom sheet, inline stages
[Connect]  (only if not connected: Connect sensor -> browser chooser, or the simulator)
  v
[Ready check]  ring fills while the weight hangs still (1.5 s)  -> "Ready" -> Start recording
  v                                                               (or "Start without the check")
[Recording]  big live rep estimate (counts the setup pull), elapsed time, STOP; Discard
  v  STOP
[Review]  bars of peak velocity per pull, mean peak velocity, velocity loss,
          "Include setup pull" (default off when flagged), Weight stepper (set's unit),
          Edit count (stepper), "Use N reps" | Discard
  v  Use N reps
onField(r) -> onField(w, only if changed) -> onField(vbt) -> toggle()   = as if the set was ticked
  => done, at stamped, PR check, rest timer starts
```

Before recording Cancel works; while recording only STOP and Discard; a dropped link keeps what was captured and goes to Review.

## Owner checklist (real sensor, Android Chrome)

1. Push `liftiq` (never `main`) and re-run the Pages workflow; open https://louraaaaaaaa.github.io/openGym/ in Chrome.
2. Settings > LiftIQ sensor (bottom of the root list): Connect sensor, choose `LiftIQ-XXXX`. Expect state, battery, firmware.
3. Start a freestyle workout, add Seated cable row, set number > Record with sensor.
4. Hold still until Ready, start, do the set, STOP. Expect the reps and setup pull to match what you did.
5. Use N reps: the set is ticked with reps/weight, the rest timer runs.
6. Reload: the set is still done. Finish: History shows it. Settings > Data & backup > Export backup: the JSON contains `"vbt"`.
7. Walk away from the sensor during a set: Review appears with what was captured.
8. iPhone Safari: Settings > LiftIQ sensor says Bluetooth is unavailable (no crash).

Without hardware: add `?liftiqSim=1&liftiqSpeed=4` to the URL (a localhost dev server or the build).
