# The phone app (Android and iOS)

**Just want the app?** Download the APK from the
[latest release](https://github.com/DuarteSantos8/openGym/releases/latest) and read
[how the phone app works](#how-the-phone-app-works) and
[connecting it to your server](#connecting-the-app-to-your-own-server). On an iPhone, see
[what's possible](#iphone--whats-actually-possible). Everything from [Prerequisites](#prerequisites)
on is for building the app yourself.

## How the phone app works

openGym ships in two flavors from the same codebase:

| | **Self-hosted** (this repo's default) | **Mobile app** (`VITE_MOBILE=1`) |
|---|---|---|
| Runs | in any browser, against your own server | natively on iPhone / Android (Capacitor shell) |
| Accounts | passkey sign-in, one profile per person | none — the phone *is* the account |
| Data | synced to your server, readable on desktop | stays on the device (file in the app's private storage) |
| Reminders | Web Push from your server | native local notifications, no server involved |
| Exercise media | served by your server (`img/`, `gif/`) | loaded from the jsDelivr CDN |

The mobile flavor never talks to a backend by default: no sign-in screen, no sync, no
telemetry. State is mirrored from `localStorage` into `opengym-state.json` in the app's
private data directory on every change (iOS is allowed to evict WebView storage under
pressure — the file mirror is the durable copy and is restored on launch). Backups go out
through the OS share sheet instead of a browser download.

### Connecting the app to your own server

On first launch the app asks how you want to use it. Alongside the fully local mode above,
you can instead **connect it to a self-hosted openGym server** — your data then lives there,
synced the same way the browser PWA does, instead of only on the phone. This is a mode of the
same app, not a different build or download.

Passkeys can't be used for this: the app's WebView runs at its own origin, which never
matches the real hostname WebAuthn needs. Instead you *pair* the device from a browser
that's already signed in: Settings → Account → **"Pair the mobile app"** shows a one-time code (valid
5 minutes); enter your server's address and that code in the app (same first-launch screen,
or Settings → Account → **"Connect to my server"** later) to finish. Notes:

- Works offline too: the phone keeps its copy (and the file mirror) while connected, and
  changes made without a network go to the server as soon as it is reachable again.
- Use an `https://` address. The app's WebView is an https page, so the phone blocks a plain
  `http://` server before anything is sent, and pairing says so. It also keeps the bearer token
  (the connection carries one instead of a cookie) off the network in plain text.
- Pairing says your server "refused the app's request (CORS)", or that "a login page or proxy
  rule replied instead of openGym", or fails with "Failed to fetch" on an older version, while
  the browser works? Something in front of openGym is answering the app instead: a reverse proxy
  handling the CORS preflight itself, adding a second `Access-Control-Allow-Origin`, or SSO /
  forward-auth on `/api/`. openGym answers the preflight and does its own sign-in; see
  [Phone app and CORS](SELF_HOSTING.md#phone-app-and-cors) for the fixes and a `curl` self-check.
- The token lasts `SESSION_DAYS` (90 by default, see `docs/SELF_HOSTING.md`) and renews
  itself: every time the app starts, a token past half its life is swapped for a fresh one.
  A phone that is used at all never runs out; one left unopened for longer than
  `SESSION_DAYS` has to be paired again.
- "Sign out everywhere" (Settings → Account, in the browser) revokes a paired app's access
  too — it's the same signed session token either way, just delivered over a header instead
  of a cookie. The phone has no passkey to sign back in with, so it has to be **paired
  again**; nothing on it is lost meanwhile (see below). See `/api/pair/create` and
  `/api/pair/redeem` in `api/server.js` for the exchange itself.
- Settings → Account → "Disconnect" first checks that your server has every change. If it has, the
  phone drops cleanly back to local mode. If not, it says how many changes are missing and
  offers **Try again**, **Export backup**, or **Disconnect anyway** — which keeps those
  changes on the phone and adds them back the next time it is paired with the same server
  and account.

### Connection states

Settings → Account → **Server & sync** shows the server, the account, how things stand, when the phone
last held exactly what the server holds, how many changes are still waiting, and a **Sync
now** button that says how it went. Whenever the app is *not* connected, a line under the
status bar says so on every screen, and stays until the condition is gone:

| The line says | What it means | What to do |
|---|---|---|
| *Offline — your changes are saved on this device…* | No answer at all: no network, the server is down, or it did not answer within 20 s (60 s for an upload). | Nothing — it syncs by itself once the server is reachable. **Try again** checks at once. |
| *Your server answered with an error (HTTP 502)…* | The server (or the proxy in front of it) answered with an error. The code is the one the server sent. | Check the server and its proxy logs; **Try again** once it is back. A 413 means the proxy's upload limit is too small (`client_max_body_size`). |
| *Your server's address answered with something other than openGym (HTTP 200)…* | Something else answered in the server's place — typically a proxy's sign-in page or a catch-all that serves the web app for `/api/*`. | Let `/api/*` through to the openGym API unchanged, including the `Authorization` header. |
| *Your server no longer accepts this phone…* | The server refused the phone's token (401): "sign out everywhere", the account disabled, a `data/secret` that was replaced, a token older than `SESSION_DAYS`, or a proxy with its own login that rejects `Authorization: Bearer`. | **Pair again**: in a signed-in browser open Settings → "Pair the mobile app" and enter the new code. The address is already filled in. |
| *This phone is no longer paired with your server…* | A phone that an earlier version of the app unpaired by itself after its token was refused. The address is gone. | **Pair again**, typing the address. |
| *On this phone only, not connected to a server* | Local mode, chosen at first launch or after Disconnect. Said quietly. | Nothing, or **Connect** to pair with a server. |

Don't want the line? Settings → Look & Home → **Show connection status** turns it off (it is on
by default, and the setting travels with your profile). A phone kept local on purpose then shows
nothing at all. On a phone with a server, a problem — offline, an error, a refused phone, or
changes still waiting after a few seconds — puts a small orange dot on the **Home** tab and on
the Settings gear instead; Settings → Account → Server & sync says what it is.

In every one of these states the phone keeps its data and every change you make. Pairing
again with the **same account** merges what the phone kept with what the server has — new
workouts from both sides, the later edit of each routine, the newer copy's settings — and
nothing needs to be exported first. Pairing with a *different* account keeps the first
account's unsent changes aside on the phone until that account comes back.

Where the phone keeps things, in case you ever need them by hand:

- `opengym-state.json` in the app's private data directory — the durable copy of everything
  on the phone, written after every change (not reachable without a rooted phone or `adb`
  on a debug build). `opengym-state-owner.json` beside it says which account that copy
  belongs to: a paired phone only ever takes the file back for that account.
- `opengym-stash.json`, same directory — changes kept by "Disconnect anyway" or by another
  account pairing, waiting for their server and account.
- `Documents/openGym/opengym-backup-YYYY-MM-DD.json` — only with Settings → Data & backup → **Auto-backup on
  changes** switched on: a dated copy after every finished workout or edited routine, in a
  folder of its own under the phone's Documents folder, where a file manager or a sync app
  (Syncthing, a cloud folder) can reach it without taking the rest of Documents along. One
  file per day; each new copy deletes all but the newest 14 of these dated files in that
  folder. Nothing else is deleted, in that folder or anywhere: other files you keep there, and
  the copies versions before 1.3.9 wrote straight into `Documents/`, stay until you remove
  them yourself. Settings → Data & backup → **Import backup** reads any of them back, wherever it is.
  On Android, Settings → Data & backup → **Backup folder** (under Auto-backup) picks another folder with the
  system folder picker — a sync app's folder, an SD card — and the copies go there instead,
  pruned to the same 14. The choice belongs to this phone and does not sync. If the folder
  stops accepting copies (the permission revoked, the folder deleted), they go to
  `Documents/openGym` again and Settings says so until you choose the folder again or tap
  **Use default folder**.

### Photos and videos of your own exercises

An exercise you create can carry one photo, GIF or short video, and a link to a video or guide.
The file is prepared on the phone before it is kept anywhere: a photo is re-encoded (at most
1600 px, WebP or JPEG — the location and camera data a phone writes into a photo do not
survive), a GIF loses its comment and metadata blocks, and an MP4/MOV keeps its picture and
sound while its metadata and any GPS or sensor track are zeroed. The original file name is
never stored.

- **Where it lives:** `Library/opengym-media/` in the app's own storage (iOS's Library folder,
  Android's files directory), one file per photo or video named by its SHA-256, plus a small
  `index.json`. The state keeps only a reference of a few hundred bytes. A MOV is stored with
  an `.mp4` name so the WebView plays it.
- **Local mode:** that folder is the only copy. **Export with photos & videos (.zip)** in
  Settings → Data & backup writes a zip with the usual JSON backup and every file, through the share
  sheet; **Import backup** takes that zip back. The daily auto-backup stays JSON only.
- **Paired with a server:** files go up to the server (`PUT /api/media/{hash}`) and come down
  with the phone's token into the same folder, so they show offline too. A file that has not
  reached the server yet is owed like an unsynced change: **Disconnect** says so and keeps it.
  Big files wait for Wi-Fi unless you tap Settings → Data & backup → **Photos & videos**.
- **Backups:** Android's cloud backup leaves `opengym-media/` out
  (`res/xml/backup_rules.xml`, `res/xml/data_extraction_rules.xml`) — Auto Backup drops an
  app's whole backup past 25 MB, and a few videos would take the state file down with them. A
  device-to-device transfer keeps it. iOS includes Library in iCloud and computer backups.
- **Permissions:** Android already has the camera. iOS asks for the camera
  (`NSCameraUsageDescription`, now also for photos and videos of exercises) and, to record a
  video with sound from the picker, the microphone (`NSMicrophoneUsageDescription`).

Worth checking on a real device after changes here, since no test runs a WebView: a short
video autoplays muted in the Android WebView; a long video seeks from its `_capacitor_file_`
URL on both platforms; an iPhone photo arrives as JPEG and an iPhone video (HEVC or H.264 MOV)
plays; the zip export opens the share sheet.

## Apple Health (native iPhone app)

Open **Settings → Data & backup → Sync with Apple Health** in the native iPhone app. Turning the
switch on opens Apple's permission sheet. Allow body weight reads and writes and workout
writes. The bridge also requests workout reads to recognize previously exported sessions.
This setting is absent from the web/PWA and Android builds.

- **Weight:** the latest external reading for each day is imported in the profile's kg/lb
  unit. A reading only replaces a local entry when its timestamp is newer. Locally entered
  weights are exported in kilograms. Existing history is included on first sync.
- **Workouts:** finished sessions are exported as strength training with their name, start
  and end time. Active or discarded sessions are not exported. This integration does not
  estimate energy expenditure or heart rate, and does not import workouts from Health.
- **Deleting a workout:** confirming Delete workout also removes the matching session
  exported by this app to Health when sync is enabled. Only that exact identifier, app
  source and saved time range are eligible. Other apps' workouts and weigh-ins are never
  selected. Failed deletions remain in a local queue for retry; restoring the record
  before retry cancels the request. Logout, reset and backup restoration never infer
  Health deletions from missing history. Previously removed sessions are not purged
  retroactively.
- **Timing:** sync runs after local changes and when the app returns to the foreground.
  **Sync Apple Health now** retries immediately. It does not promise execution while iOS
  has suspended the app.
- **Opt-in:** the choice and duplicate markers stay on this device, scoped to the server
  and account (or the local profile). Other accounts or servers do not inherit the choice.
  Turning the switch off does not delete records already saved in either app.
- **Privacy:** imported weights become ordinary openGym profile entries. They follow the
  profile's existing backup/export and, if paired, server sync settings. Health permission
  choices themselves are never sent to the server.

Apple controls each permission separately. Completing the permission sheet does not mean
all permissions were granted: denied reads appear as no accessible data; denied writes
report an error. Review permissions in the Health app if sync brings in no readings.
Disabling and enabling the switch requests authorization again, but iOS may require
changing a previous denial in Health rather than showing a new prompt.

For developers, the iOS target includes the HealthKit entitlement, both usage descriptions,
and the app-local `HealthSync` Capacitor plugin. `AppBridgeViewController` explicitly
registers it alongside the existing print plugin; the storyboard must use this controller.
Keep your own signing team and bundle identifier local when building for a physical phone.
No extra JavaScript or CocoaPods dependency is needed for HealthKit.

HealthKit sync identifiers and versions make retries idempotent, including when workout
read access is denied. Weight replacement uses HealthKit's versioned save rather than
removing the previous sample before its replacement succeeds. See Apple's
[sync identifier documentation](https://developer.apple.com/documentation/healthkit/hkmetadatakeysyncidentifier).


## Prerequisites

- Node 20+
- **Android:** Android Studio (bundles the SDK). Java 21 for Gradle.
- **iOS:** a Mac with Xcode 15+ and CocoaPods (`brew install cocoapods`). A free Apple ID
  is enough to run the app on your own iPhone (see below); paid membership is only needed
  for App Store distribution, which openGym doesn't do.

## Build & run

```sh
cd frontend
npm install
npm run build:mobile        # VITE_MOBILE build + `cap sync` into android/ and ios/

npx cap open android        # opens Android Studio → run on emulator or device
npx cap open ios            # opens Xcode (Mac only) → set your signing team, then run
```

`npm run build:mobile` bakes the CDN media base into the bundle and copies the web build
into both native projects — re-run it after every web-code change before building natively.

> **Heads-up:** after `build:mobile`, `frontend/dist` contains the *mobile* bundle.
> Run a plain `npm run build` again before deploying `dist` to a server.

## App icons & splash screens

`frontend/resources/icon.svg` is the 1024×1024 source (the app's dumbbell glyph on the
app background). Generate all platform assets from it on a machine with the tooling:

```sh
cd frontend
npx @capacitor/assets generate --iconBackgroundColor '#0c0e12' --splashBackgroundColor '#0c0e12'
```

(If the generator won't take the SVG directly, export it to `resources/icon.png` at
1024×1024 first — any image tool can do it.)

## Distribution — deliberately no app stores

openGym's mobile app is not on the Play Store or App Store, and that's a choice: no store
accounts, no store rules, no yearly fees between you and an open-source app.

### Android — sideload the APK

The official signed APK is in four places, all the same file:

- **[opengym.duarte-santos.ch](https://opengym.duarte-santos.ch)** — the download page.
- **[GitLab's package registry](https://gitlab.com/DuarteSantos8/opengym/-/packages)** — every
  build under `opengym-android/<version>/`, with a `.sha256` beside it. Direct link, no login:
  `https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/<version>/openGym-<version>.apk`
- **[The GitHub release](https://github.com/DuarteSantos8/openGym/releases)** for that version,
  with the APK and its `.sha256` attached as release assets.
- **[The GitLab release](https://gitlab.com/DuarteSantos8/opengym/-/releases)** on the mirror,
  where the file is built; it links to the package registry above.

Android asks you to allow installs from the browser the first time — that's standard for any
app outside the Play Store. Check the `.sha256` if you got the file from anywhere else.

Both come out of CI: the `build:apk` job in [`.gitlab-ci.yml`](../.gitlab-ci.yml) runs
`npm run build:mobile` and `./gradlew assembleRelease`, then `zipalign`s and signs the result
with the release key. The job runs on every push to `main` too, so the newest unreleased
build is always one click away (signed with the same key, installs over a release):
`https://gitlab.com/DuarteSantos8/opengym/-/jobs/artifacts/main/browse?job=build:apk`
— a 30-day job artifact, not a package, and not what the in-app updater offers. The key lives in *protected* CI variables (`ANDROID_KEYSTORE_B64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`), so it only exists on `main` and on `v*`
tags — a merge request from a fork can build an APK, but gets an unsigned one and never sees
the key. On a `v*` tag the signed APK is also pushed to the generic package registry, which is
what the release links to.

The release APK carries native code for ARM only (`arm64-v8a`, `armeabi-v7a`), which is every
phone; the x86 builds of the barcode scanner's library would add about 12 MB for emulators
alone. A debug build (`./gradlew assembleDebug`) keeps all four, so it still runs on an x86_64
emulator.

To build and sign your own:

```sh
cd frontend && npm run build:mobile
cd android && ./gradlew assembleRelease            # → app/build/outputs/apk/release/app-release-unsigned.apk

# one-time: create a keystore. KEEP IT — updates must be signed with the same key,
# or Android refuses to install the new version over the old one.
keytool -genkeypair -keystore my.keystore -alias opengym -keyalg RSA -validity 10950

# align + sign (zipalign/apksigner ship with the Android SDK build-tools)
zipalign -f -p 4 app-release-unsigned.apk aligned.apk
apksigner sign --ks my.keystore --ks-key-alias opengym --out openGym.apk aligned.apk
```

### iPhone — what's actually possible

Apple does not allow installing apps outside the App Store, so there is no `.ipa` download
that would simply install. Your free options:

- **Self-host + PWA** (recommended): open your instance in Safari → Share → *Add to Home
  Screen*. Full-screen app, no expiry, plus sync and passkeys.
- **Xcode free signing:** open `ios/` in Xcode with a free Apple ID as the team and run it
  onto your own iPhone. Apple expires the signature after 7 days; re-run from Xcode to renew.
- **AltStore:** automates that 7-day re-signing over Wi-Fi via a Mac companion app.

There is a `build:ios` job in [`.gitlab-ci.yml`](../.gitlab-ci.yml) for exactly that path: the
same mobile bundle, `xcodebuild archive` without a signing identity, and an *unsigned* `.ipa`
(plus `.sha256`) as job artifact — on a tag also under `opengym-ios/<version>/` in the package
registry — for AltStore/Sideloadly users to sign with their own Apple ID. It needs a Mac: Xcode
does not run on the Linux project runner, and gitlab.com's hosted macOS runners are not on the
free tier. To switch it on, register a Mac as a project runner (shell executor; Xcode, CocoaPods
and Node installed; give it a tag such as `macos`) and set the CI/CD variable `IOS_RUNNER_TAG`
to that tag — the job then appears in every `main` and tag pipeline. Until that variable exists
the job is not part of any pipeline, and it has not run yet, so expect a first round of fixes.
A signed build (TestFlight, App Store) would additionally need an Apple Developer Program
membership, the distribution certificate and profile as protected file variables, and an
`-exportArchive` step — none of that is set up.

### Release notes for maintainers

- Bump `versionName`/`versionCode` in `android/app/build.gradle` per release; keep them in
  step with `frontend/package.json`. `versionCode` must strictly increase or updates won't
  install over an existing APK. The APK is *named* from `frontend/package.json` (the CI job
  reads `version` out of it), so the two drifting apart shows up as a misnamed file.
- Tagging `vX.Y.Z` is what ships everything: images, APK, release notes. Don't push a version
  tag you don't mean to release — `v*` tags are protected for that reason.
- **License:** openGym is AGPL-3.0, which by itself sits badly with app-store terms of
  service. `NOTICE.md` carries an app-store exception (an additional permission under
  AGPL §7) granted by the copyright holder — relevant only if store distribution ever happens.
- The app requests notification permission when the workout-day reminder is switched on,
  and again at the first rest if it is still unanswered. On Android it declares
  `SCHEDULE_EXACT_ALARM` so the reminder fires to the minute where the user allows exact
  alarms (Android 14 no longer grants it at install). The opt-in missed-workout nudge is
  scheduled the same way, beside the reminder: one notification on the evening (20:00–21:30) of
  each upcoming planned day, at most 3 past the last workout, rescheduled whenever a workout is
  logged. The rest countdown does not depend on
  it: a foreground service (`specialUse`) keeps the countdown in the notification and holds a
  wake lock until the end, so the end of a rest sounds on time with the screen locked; the
  rest-over alarm is only its fallback.

### Apple Watch companion

For cached routines, offline sessions, rest controls, live vitals, signing and validation,
see [the Apple Watch guide](APPLE_WATCH.md).
