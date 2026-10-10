# The phone app (Android and iOS)

**Just want the app?** Download the APK from the
[latest release](https://github.com/DuarteSantos8/openGym/releases/latest) and read
[how the phone app works](#how-the-phone-app-works) and
[connecting it to your server](#connecting-the-app-to-your-own-server). On an iPhone, install it
with AltStore: see [iPhone — AltStore](#iphone--altstore). Everything from
[Prerequisites](#prerequisites) on is for building the app yourself.

## How the phone app works

openGym ships in two flavors from the same codebase:

| | **Self-hosted** (this repo's default) | **Mobile app** (`VITE_MOBILE=1`) |
|---|---|---|
| Runs | in any browser, against your own server | natively on iPhone / Android (Capacitor shell) |
| Accounts | passkey sign-in, one profile per person | none — the phone *is* the account |
| Data | synced to your server, readable on desktop | stays on the device (file in the app's private storage) |
| Reminders | Web Push from your server | native local notifications, no server involved |
| Exercise media | served by your server (`exercise-media/`) | packed into the app (`exercise-media/`) |

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
- `https://` is best: it keeps the pairing code and the bearer token (the connection carries one
  instead of a cookie) off the network in plain text. A plain `http://` server on your home
  network works too since v1.3.11 (Android; #428): type the address with `http://` in front, for
  example `http://192.168.1.20:8080`. An address without a scheme is tried as `https://`, and when
  that gets nowhere on a home address, pairing tells you to add `http://`. The app also reminds
  you that http is not encrypted, so keep it to your own network. Your browser still needs a
  password to sign in there and make the code: passkeys only work over https (or `localhost`).
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

### A server behind Cloudflare Access

If your server sits behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
(Zero Trust), the app can't do Access's interactive sign-in from inside its WebView. Use a
**service token** instead:

1. In Zero Trust → Access → Service Auth, create a service token and note its Client ID and
   Client Secret.
2. In the Access application for your openGym host, add a policy with the **Service Auth**
   action that includes that token.
3. In the application's **CORS settings**, enable **Bypass OPTIONS requests to origin**. The
   app runs on its own origin, so every request is preceded by a CORS preflight, and a
   preflight never carries the token — without the bypass, Access refuses it and nothing
   gets through. The openGym API answers the preflight itself and allows both headers.
4. In the app, before connecting: first-launch screen → **Connection settings** (or the
   **Cloudflare Access** button in the Connect sheet), enter your server's address and the two
   values, then pair as usual. They can be changed later under Settings → **Server & sync** →
   **Cloudflare Access**.

The app then sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` with every request to
the server address they were entered for (scheme, host and port), including the pairing itself,
and with nothing else: a pairing with any other address goes without them. Disconnecting from
the server removes them. Both are kept in the phone's secure storage (Android Keystore / iOS
Keychain), never in synced data or backups.

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
  (`NSCameraUsageDescription`, now also for photos and videos of exercises and for the QR codes
  on the machines) and, to record a video with sound from the picker, the microphone
  (`NSMicrophoneUsageDescription`).

Worth checking on a real device after changes here, since no test runs a WebView: a short
video autoplays muted in the Android WebView; a long video seeks from its `_capacitor_file_`
URL on both platforms; an iPhone photo arrives as JPEG and an iPhone video (HEVC or H.264 MOV)
plays; the zip export opens the share sheet.

### Health Connect (Android)

Settings → **Health Connect** writes finished workouts and weigh-ins to Health Connect, Android's
on-device store for health data, where other apps (Google Fit, Samsung Health, a smartwatch app…)
can read them. It is off until the user turns it on, and nothing is asked of Health Connect before
that.

- **What is written:** each finished workout as an exercise session — its start and end, its name
  as the title, the exercises and sets as "Copy as text" writes them as the notes, and a type
  (strength training as soon as one exercise is not cardio; walking, running, stationary bike,
  elliptical or stair machine for a cardio-only workout on a catalogue machine; "other" otherwise).
  Each weigh-in as a weight record, in kilograms. A workout without a real start and end is left
  out rather than given made-up times. `src/lib/health-connect.js` works this out; its tests
  pin it.
- **Write-only.** The manifest declares `WRITE_EXERCISE` and `WRITE_WEIGHT` and nothing else, and
  openGym reads nothing back.
- **No duplicates.** Every record carries openGym's own id as its `clientRecordId`
  (`opengym-w-<workout id>`, `opengym-bw-<day>`), so writing it again replaces it. An edited workout
  or weigh-in is written again; a deleted one is removed from Health Connect.
- **This phone only.** Whether it is on, and a fingerprint of each record already written, live in
  `opengym-health.json` in the app's data directory, never in the synced state: it does not travel
  to a server, into a backup export, or to a second phone. It works the same in local mode and
  paired with a server, because the writing happens on the phone.
- **When it writes:** after each save (finishing a workout, a weigh-in, an edit), when the app comes
  back to the foreground, and once at launch. While it is off, a save costs nothing: the file is
  read once at launch and kept in memory.
- **Turning it off** asks whether to keep what openGym wrote in Health Connect, as the user's own
  data, or to remove exactly those records.
- **Where it shows:** Android 14 and later have Health Connect built in. On Android 9–13 it is an
  app of its own, and the card offers its store page until it is installed. Below Android 9 (the
  app supports Android 6) Health Connect does not exist and the card is not shown.
- **The library:** `androidx.health.connect:connect-client` 1.1.0-alpha12, called from Java
  (`HealthConnectPlugin.java`) through `runBlocking` on a worker thread, so the Android project stays
  Java-only. 1.1.0 stable needs compileSdk 36 and AGP 8.9.1, a toolchain bump left for its own
  change. The library asks for minSdk 26; `tools:overrideLibrary` keeps the app at 23 and the plugin
  checks the version before touching it.

Worth checking on a real device after changes here: turning it on shows Health Connect's own
permission screen; a finished workout appears in Health Connect within a few seconds; deleting it
in openGym removes it there; turning it off with "remove" leaves no openGym record behind.

### Apple Health (iOS)

The same card on the iPhone writes to Apple Health instead: Settings → **Apple Health**. Everything
said above about Health Connect holds — what is written (`src/lib/health-connect.js`, one piece of
JS for both phones), when, no duplicates, this phone only (`opengym-health.json`), and turning it
off asking whether to keep or remove what was written. The differences:

- **The native side** is `ios/App/App/AppleHealthPlugin.swift`. A workout is written with
  `HKWorkoutBuilder` (strength training, walking, running, indoor cycling, elliptical or stair
  climbing, "other" otherwise; indoor), its name and its exercises and sets in openGym's own metadata
  keys `OpenGymTitle` / `OpenGymNotes` — HealthKit has no title or notes of its own. A weigh-in is a
  body-mass sample in kilograms. Each carries openGym's id as `HKMetadataKeySyncIdentifier` and the
  time of the write as `HKMetadataKeySyncVersion`, so writing it again replaces it, and removing
  finds exactly what openGym wrote.
- **Reading weigh-ins back** — a second switch, **Take weigh-ins from Apple Health**, which Health
  Connect does not have. It takes the weigh-ins a scale or another app wrote into the body-weight
  log, where a day openGym already has keeps its own (like an import). An anchored query hands each
  one over once (the anchor is kept in `opengym-health.json`), so one deleted in openGym does not
  come back; what openGym wrote itself is left out. Taken entries carry `src: 'apple-health'` and are
  not written back as openGym's own — that would put every scale reading in Health twice — until one
  is edited in openGym. It reads when switched on, at launch and back in the foreground.
- **It needs the HealthKit entitlement**, and Apple gives that only to an app signed by a paid
  Apple Developer Program account. An app signed with a free Apple ID (Xcode, AltStore, SideStore,
  Sideloadly) does not have it. So:
  - the Xcode project asks for it only with the build setting **`OPENGYM_HEALTHKIT=YES`** (target
    App → Build Settings → User-Defined, or on the `xcodebuild` command line). It sets the
    entitlements file (`App/App.healthkit.entitlements`) and the `OpenGymHealthKit` key in
    Info.plist together. Off by default, so a free Apple ID can still build and run the app from
    Xcode;
  - the AltStore `.ipa` (`scripts/build-ipa.sh`) always asks for it; AltStore drops it when the
    Apple ID cannot have it;
  - the plugin answers "unsupported" unless the provisioning profile the app was finally signed
    with (`embedded.mobileprovision`) grants HealthKit, and the card is then not shown at all.
- **Permissions:** `NSHealthUpdateUsageDescription` (writing) and `NSHealthShareUsageDescription`
  (reading weigh-ins) in Info.plist. HealthKit never tells an app whether reading was allowed: a
  refusal simply reads as no weigh-ins.

Worth checking on a real device (paid Apple ID, `OPENGYM_HEALTHKIT=YES`): turning it on shows the
Health permission sheet; a finished workout appears in Health → Browse → Activity → Workouts with
openGym as its source; editing it replaces it; deleting it in openGym removes it; a weigh-in from a
scale app shows up in the body-weight log after switching on reading; with a free Apple ID the card
is not there.

### Rest timer on the iPhone

The iOS app announces the end of a rest with a local notification booked when the rest starts
(`src/lib/rest-alert.js`): it arrives on time with the screen locked, is called off by Skip, Pause
or a new rest, and is kept off the screen while the app is in front, where the page beeps itself.
With **Sound** off in Settings it arrives silently. It needs the notification permission, asked at
the first rest. With the iPhone locked, iOS shows it on a paired Apple Watch too — a tap on the
wrist at the end of every rest, with or without the watch app below. There is no countdown in the
notification as on Android: iOS has nothing like Android's ongoing notification without a Live
Activity, which would need a widget extension.

### Apple Watch

The iOS app comes with a watch app (`ios/App/OpenGymWatch`, SwiftUI, watchOS 9 or later), installed
on the paired watch with the phone app. It keeps no log of its own; while a workout runs on the
phone it shows:

- **the set to do next** — the exercise, "Set 2 / 4", the reps (turn the Digital Crown), the
  weight (− and +, in steps of 2.5 kg or 5 lb) and **Done**, which ticks the set on the phone
  exactly as a tap there would: the reps and weight go on the row, the rest starts, a superset
  moves on, the last set opens the finish sheet. A timed, cardio or per-side set is shown with
  "Log this set on your iPhone";
- **the rest** — counting down on the watch, with **+15**, **Pause** / **Resume** and **Skip**, and a
  tap on the wrist at the end while the watch app is in front.

How it works: the phone sends one small JSON snapshot whenever the workout or the rest changes
(`src/lib/watch-model.js` builds it, `src/lib/watch-sync.js` sends it through
`ios/App/App/WatchPlugin.swift` and WatchConnectivity), with every word the watch prints in the
app's language. The watch answers with an action. A set done is checked again on the phone against
the workout as it is then: one the phone has moved past meanwhile (ticked there, the exercise
swapped) is dropped rather than ticking the wrong row. With the workout screen not open on the
phone, it waits there (at most 10 minutes) until it is.

Things to know:

- The phone app does the work. A tap on the watch wakes it in the background long enough to tick
  the set and answer; if iOS has closed the app entirely, the action waits until it is opened.
- watchOS goes back to the watch face after a while (Settings → General → Return to Clock on the
  watch can keep the app up longer). The end-of-rest notification still arrives either way.
- The watch app is a second app with a bundle id of its own
  (`ch.duartesantos.opengym.watchkitapp`). With a free Apple ID that is a second App ID out of the
  ten a week; `scripts/build-ipa.sh --no-watch` builds an `.ipa` without it. Building it yourself
  under another bundle id, change both targets and `WKCompanionAppBundleIdentifier` (target
  OpenGymWatch → Build Settings) to match.

Worth checking on a real device after changes here: the watch app installs with the phone app;
starting a workout on the phone shows its first set on the watch within a second or two; Done on the
watch ticks the row on the phone and starts the rest on both; Skip on the watch ends it on the
phone; with the phone locked, Done still ticks the set and the rest notification reaches the watch.

## Prerequisites

- Node 20+
- **Android:** Android Studio (bundles the SDK). Java 21 for Gradle.
- **iOS:** a Mac with Xcode 15+ (with the watchOS SDK, for the watch app) and CocoaPods
  (`brew install cocoapods`). A free Apple ID is enough to run the app on your own iPhone (see
  below); Apple Health needs a paid Apple Developer Program membership ([Apple Health](#apple-health-ios)).

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

- **[opengym.ch](https://opengym.ch)** — the download page.
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

### iPhone — AltStore

Apple does not allow installing apps outside the App Store, but it does let anyone sign an app for
their own iPhone with their Apple ID. [AltStore](https://altstore.io) (or SideStore) does that for
you, and renews the signature before it runs out:

1. Install AltStore on the iPhone (AltServer on a Mac or PC does it once; on iOS 16 and later
   switch on Developer Mode when asked).
2. In AltStore → Sources → **+**, add **`https://opengym.ch/altstore.json`**.
3. Install openGym from that source. AltStore offers new versions there as updates.

That source is published by CI once a Mac runner builds the app (below). Until then — or for your
own fork — build the `.ipa` and the source yourself with `scripts/build-ipa.sh`, host both over
https, and add your `altstore.json` instead; or install the `.ipa` file directly in AltStore
(**+** on the My Apps tab).

What to know about the Apple ID AltStore signs with:

- **A free Apple ID:** the app runs, with sync, the rest notification and the Apple Watch app.
  The signature lasts 7 days; AltStore renews it in the background while AltServer is reachable on
  your network (or with SideStore, on the phone itself). At most 3 sideloaded apps at a time
  (AltStore is one) and 10 App IDs a week — openGym takes two with its watch app. **Apple Health is
  not available**: Apple gives HealthKit only to paid accounts, and the app then shows no Apple
  Health card.
- **A paid Apple Developer account:** everything, Apple Health included, and a signature that lasts
  a year.

The other ways stay open:

- **Self-hosted PWA:** open your instance in Safari → Share → *Add to Home Screen*. No expiry, sync
  and passkeys — but no watch app, no Apple Health and no notification at the end of a rest unless
  your server sends Web Push.
- **Sideloadly:** take `openGym-<version>.ipa` from the package registry
  (`opengym-ios/<version>/`) and sign it with your Apple ID, as AltStore would.
- **Xcode:** open `ios/App/App.xcworkspace`, set your team on both targets (App and OpenGymWatch),
  run. Add `OPENGYM_HEALTHKIT=YES` to the App target's build settings only with a paid account.

#### Building the .ipa and the source

`frontend/scripts/build-ipa.sh` (on a Mac: Xcode, CocoaPods, Node) does all of it:
`npm run build:mobile`, an unsigned `xcodebuild archive` with `OPENGYM_HEALTHKIT=YES`, then an
*ad hoc* signature with the entitlements the app asks for — the watch app and the frameworks first,
the app last. AltStore and Sideloadly read the entitlements from that signature to know what to ask
Apple for; a completely unsigned `.ipa` would never get HealthKit. Then it zips
`openGym-<version>.ipa` (+ `.sha256`) and writes `altstore.json` with
`scripts/altstore-source.mjs`: the app, its versions newest first (an `altstore.json` already in the
output folder keeps its versions, at most 10), each with its download URL, size and SHA-256, and the
entitlements and privacy texts AltStore shows before installing.

```sh
cd frontend
scripts/build-ipa.sh --out ../ipa                                    # → ../ipa/openGym-X.Y.Z.ipa, altstore.json
scripts/build-ipa.sh --out ../ipa --url 'https://example.org/ios/%v/%f'   # your own download URL
scripts/build-ipa.sh --out ../ipa --no-watch                         # without the watch app (altstore-nowatch.json)
```

`--url` says where the `.ipa` will be downloaded from (`%v` the version, `%f` the file name); without
it, the upstream package registry. For your own fork, host the `.ipa` and `altstore.json` anywhere
reachable over https and add that `altstore.json` URL as the source.

The `build:ios` job in [`.gitlab-ci.yml`](../.gitlab-ci.yml) runs the same script. It needs a Mac:
Xcode does not run on the Linux project runner, and gitlab.com's hosted macOS runners are not on the
free tier. To switch it on, register a Mac as a project runner (shell executor; Xcode, CocoaPods and
Node installed; give it a tag such as `macos`) and set the CI/CD variable `IOS_RUNNER_TAG` to that
tag — the job then appears in every `main` and tag pipeline, and on a tag uploads the `.ipa`, its
`.sha256` and `altstore.json` under `opengym-ios/<version>/` in the package registry; the website
deploy puts that `altstore.json` at `opengym.ch/altstore.json` (`website/README.md`). Until that
variable exists the job is not part of any pipeline, and it has not run yet, so expect a first round
of fixes. A TestFlight or App Store build would additionally need an Apple Developer Program
membership, the distribution certificate and profile, and an `-exportArchive` step — none of that is
set up.

Local plugins of the iOS app (`PrintPlugin`, `AppleHealthPlugin`, `WatchPlugin`) are registered by
hand in `ios/App/App/OpenGymViewController.swift`: Capacitor only loads the npm plugins `cap sync`
lists. A new one goes there, or JS gets "not implemented on ios".

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
