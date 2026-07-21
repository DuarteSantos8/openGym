# Changelog

## v1.1.2 — 2026-07-21

- 📱 Fixed the exercise-config sheet (Sets / Reps / Weight, and the cardio variant) overflowing the
  screen edge on narrow phones — the Weight stepper was clipped and could make the whole page pan
  sideways in iOS Safari. Steppers now shrink to fit the viewport. (#10)
- 🛡️ Added a global horizontal-overflow guard so a single too-wide element can no longer knock the
  page layout off-scale.

## v1.1.1 — 2026-07-21

Reliability fixes for the push notifications shipped in v1.1.0, found through live testing:

- 🌍 Workout day reminder now fires by each user's own browser-detected timezone instead of a
  single server-wide one — works correctly regardless of where the server runs, and follows you
  automatically if you travel.
- 💾 Settings changes (like the reminder time) are flushed to the server immediately when the tab
  backgrounds or closes, instead of relying solely on a 1.5s debounce that could get cut short.
- ⏱️ Reminder check tightened from a 60s to a 10s interval, and pushes are now marked
  `urgency: 'high'` — cuts avoidable delay on top of it, though delivery time is ultimately up to
  Apple/Google's push relay.
- 🪵 Push send failures are now logged instead of silently swallowed.

## v1.1.0 — 2026-07-21

- 🐳 Prebuilt Docker images published to `ghcr.io/duartesantos8/opengym-{api,web}` (amd64 + arm64)
  via GitHub Actions, so self-hosting no longer requires building from source. `docker compose pull`
  grabs them; `docker compose up -d --build` still builds locally if you'd rather.
- 🔔 Push notifications: rest-timer-over alert (fires even if the app is closed) and an optional
  daily reminder on days you have a workout planned but haven't logged one yet. Opt in per-profile
  in Settings — requires a signed-in passkey profile. Backend gains one dependency (`web-push`);
  VAPID keys are generated on first run.
- 🐛 Fixed the rest timer stalling when the tab/app is backgrounded — it's now anchored to a real
  timestamp instead of a plain per-second counter, so it stays accurate after you come back.

## v1.0.0 — 2026-07-20

First public release. A complete, self-hostable gym & body-weight tracker.

**Highlights**
- ⚖️ Body-weight tracking with an interactive chart + goal line
- 🏋️ Weekly routine planner over 1,324 exercises with animated demos
- ▶️ Guided workouts: body-weight check-in, pre-filled weights, rest timer, PR detection, per-exercise weight tracking
- 🔗 Supersets and 🏃 cardio (time + speed) logging
- 🗓️ Per-day rescheduling without touching your weekly plan
- 🟩 GitHub-style activity heatmap (by time trained)
- 🔑 Passkey (WebAuthn) login with per-profile data that syncs across devices
- 🎨 Light/dark themes + 8 accent colors, synced to your profile
- 📦 JSON export/import, guest mode, PWA install, no telemetry

**Stack**
- React 19 + Vite (React Router, Zustand)
- Node backend, no framework, single dependency (`@simplewebauthn/server`), JSON-file storage
- nginx + multi-stage Docker so `docker compose up` builds and serves everything

**Notes**
- Exercise media (~140 MB) is fetched from [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) on first run.
- Licensed under GNU AGPL v3.0.
