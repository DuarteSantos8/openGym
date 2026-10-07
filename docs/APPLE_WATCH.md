# Apple Watch companion

The native iPhone app includes a SwiftUI companion for watchOS 10 or later. The web and
Android apps do not communicate with a Watch. No server API or additional dependency is needed.

## Using it

Open openGym on your iPhone to send your routines to the paired Watch. The Watch caches these
routines and their static exercise thumbnails. Start a routine on either device; edit weights,
repetitions or timed sets on the Watch and check or uncheck completed sets. Left/right entries
keep their separate values. Completing a set focuses the next unfinished exercise; ordinary
scrolling is preserved until another completion.

A running rest timer opens a full-screen countdown with pause/resume, +15 seconds and skip.
Back returns to the exercise list, where a small timer opens the countdown again. A horizontal
swipe also returns: toward the right for a left wrist and toward the left for a right wrist.
Rest completion uses the system notification haptic/sound and follows Watch silent mode.
Finishing and discarding each require confirmation; discarding does not save the workout.
Choose the countdown font and color in the iPhone app's Settings → Workout → Apple Watch.

Starting on the iPhone requests launch of the paired Watch app through HealthKit. Starting on
the Watch notifies the iPhone while it is inactive; tapping the notification opens openGym.
It does not force the iPhone app to the foreground. Notification permission is requested on the
phone, and the Watch requests permission for rest alerts.

## Offline sessions and profiles

The Watch can start cached routines without a reachable iPhone. It persists its active session,
finished-session outbox and discard markers locally. Finished payloads remain in the outbox
when another routine starts; WatchConnectivity delivers them when the devices reconnect.
Each payload carries the phone's server/account namespace. A different profile's payload is
kept pending rather than imported into the current account. Publishing another profile clears
the Watch's current routine list and displayed session; pending finished sessions remain queued.

If a different workout is active on the phone, that session is preserved and the Watch shows
a conflict. Finish the phone session to allow reconciliation. Session identifiers and sequence
numbers prevent duplicate imports and stale set edits. Changing the exercise in a slot on the
phone prevents old Watch edits from modifying its replacement.

The queue belongs to the paired devices, not the server. Unpairing, deleting the app or clearing
its local storage can remove unsynced workouts. Open the phone app after reconnecting to apply
queued sessions. Background delivery timing is controlled by the operating system.

## Health data

The Watch asks HealthKit for heart rate and active energy access and workout authorization.
It displays live pulse and estimated active kcal during the session. The measurement builder
is discarded at completion, so this contribution does not independently save a second Health
workout. The optional Apple Health integration on the phone owns the finished-workout export;
the displayed Watch metrics are not added to that export by this contribution.

## Building and signing

Follow [the native mobile guide](MOBILE.md) for the Capacitor build and CocoaPods installation.
Open `frontend/ios/App/App.xcworkspace` in Xcode. The App target embeds WatchApp. Select your own
team for both targets and use a matching bundle identifier pair, for example
`com.example.opengym` and `com.example.opengym.watchkitapp`. Update
`WatchApp/Info.plist`'s `WKCompanionAppBundleIdentifier` to the phone identifier too. Both targets
have HealthKit entitlements. Personal teams, signing profiles and certificates are not committed.

A generic unsigned build can check both targets without installing over an existing app:

```sh
cd frontend
VITE_MOBILE=1 npm run build
npx cap copy ios
pod install --project-directory=ios/App
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

Do not override `-sdk iphoneos` for this combined build: the embedded target needs its watchOS SDK.
Watch controls have an English fallback and Spanish localization. Exercise names use the phone
app's selected language; countdown settings are translated in every frontend locale.

## Checks

```sh
cd frontend
npx vitest run src/lib/watch-display.test.js src/lib/watch-protocol.test.js
sh scripts/test-watch-native.sh
node scripts/check-locales.mjs
node scripts/check-source-strings.mjs --strict
npm test
```

Before releasing, verify on paired physical devices: start in both directions, edit and undo
sets, rest controls/alerts, finish/discard, offline finish followed by another routine,
reconnect/relaunch and account switching with pending sessions. Browser checks validate the
phone settings and ordinary workout flow; they cannot validate WatchConnectivity or HealthKit.
