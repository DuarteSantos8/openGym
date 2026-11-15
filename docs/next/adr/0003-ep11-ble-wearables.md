# ADR-0003 EP11: direct Bluetooth LE sensors
Timebox: 1 session (used: 0.2) · Decision: **NO-GO now · one gap recorded**
Date: 2026-11-14 · Base: `next/ready-20261114`

## Evidence (upstream 1.4.5)
- Live heart rate during a workout: `components/LiveHeartRate.jsx`, `lib/live-tiles.js` (fresh live bpm from the iPhone workout session, else the watch's last set), HR zones (`hrZone`).
- After-the-fact heart rate per set: `lib/health-read.js`, `lib/heart-rate.js` via Health Connect / Apple Health (`lib/health-sync.js`, permissions `heartRate`, `vitals`, `exercise`).
- Watches: Apple Watch app, Wear OS (beta), Garmin, Android `WatchBridgePlugin`.
- No Web Bluetooth / Capacitor BLE code or dependency anywhere.

## The one real gap
A **chest strap or arm band with no watch** (standard BLE Heart Rate Service 0x180D) cannot give live bpm on Android or desktop browsers today.

## Decision
Do not add a BLE plugin now: it adds a native dependency, permissions and battery testing on real devices for a gap you have not hit.

## GO trigger
You (or users) train with a BLE strap and no watch. Then: one S/M task, Heart Rate Service only (0x180D / 0x2A37), feeding the existing `live.bpm` path in `live-tiles.js` so zones, tiles and per-set HR work unchanged; explicit pair/stop, no background scan.
