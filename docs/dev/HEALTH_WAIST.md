# Waist and Apple Health

Short design, agreed 2026-11-17. iPhone app only.

## Intent

The waist is already a built-in Body measurements field (`waist`, stored in cm, one check-in per
day, its own chart and trend). It never reaches Apple Health, and a waist measured elsewhere (the
Health app, a smart tape measure) never reaches openGym. This connects that one field to Apple
Health, both ways, so a waist taken anywhere ends up in the same history.

## Goals

- **Write:** each check-in's waist goes to Apple Health as a Waist Circumference sample. Changing
  or clearing it in openGym updates or removes the sample; deleting the check-in removes it.
- **Read:** waist samples other apps saved in Apple Health fill the existing `waist` field of that
  day's check-in.

## Non-goals

- No other measurement: not body fat, blood pressure, pulse, or any circumference.
- No Android: Health Connect has no waist type. The Health Connect page does not change.
- No new stat or read-only line on Body measurements: Health feeds the field that is already there.

## Approaches considered

- Direction: to Apple Health only, or both ways. **Picked: both ways** (owner).
- Where a read waist lands: (1) in the log, as that day's check-in, like weigh-ins; or (2) beside
  the log in the phone's health file, shown read-only, like body fat. **Picked: 1** (owner). Option 2
  would put a second waist next to the one that exists, and keep it out of charts, export and the
  owner's other devices.

## Decided

- **Writing** rides on the existing "Write to Apple Health" switch, as body weight does: no new
  switch. Same records pipeline (`lib/health-connect.js` `healthRecords` / `planSync`, a new
  record kind next to `weights`), same per-record sync identifier (`opengym-…`,
  `HKMetadataKeySyncIdentifier` + version), so an edit replaces and a removal deletes.
- **The sample** is the check-in's waist in metres (Apple Health's length unit), at the check-in's
  time `t`. Only check-ins with a waist write one.
- **Permission:** turning Health on asks for waist write with the rest. Someone who already has it
  on is asked once, while the app is on screen, like calories in v1.4.5 (`kcalAllowed`, a
  `waistAsked` flag). Refused: nothing is written, nothing else changes.
- **Reading** gets its own switch on the Apple Health page, "Read waist", next to the other read
  switches, off by default, asking only the waist read permission (`enableRead('waist')`). It reads
  while the app is open, on the same rhythm and cursor rules as weigh-ins (30 days the first time,
  then since the last read).
- **Merge rule** (a pure helper in `lib/health-read.js`, with a unit test), per sample:
  - openGym's own samples are skipped (`isOwnRecord`), so what it wrote never comes back.
  - Outside the waist's valid range (`inMeasurementRange`): skipped.
  - A day with a check-in whose waist is empty: the waist is filled (cm, one decimal).
  - A day with no check-in: a new check-in holding only the waist, at the sample's time.
  - A day whose check-in already has a waist: left alone. **What is typed in openGym wins.**
  - A day deleted in openGym after the sample was taken: skipped, as weigh-ins do.
  - A sample already brought in once (a memo of seen ids in the phone's health file) is not
    brought in again, so a waist cleared in openGym stays cleared.
- Filled or created check-ins are stamped as edited, so the normal sync carries them to the server
  and other devices.
- New strings ("Read waist" and its one-line footer) in all 25 locale packs, no em dashes.

## Left to the builder

- The exact names of the record kind, the flags and the native method parameters.
- How the Swift plugin batches the waist write next to `weights`.
- The footer wording, kept to one short line.
- Tests: the merge helper's cases above; `healthRecords` / `planSync` emitting, replacing and
  removing a waist; the read switch on the Settings page (iPhone only, hidden on Android).
