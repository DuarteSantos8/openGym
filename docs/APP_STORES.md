# openGym in Google Play and the App Store

openGym ships to phones three ways, all from the same code and the same version number:

| | Where | Who installs updates | Built where |
|---|---|---|---|
| Android APK | GitHub release, opengym.ch | the app itself (Settings → About) | release machine |
| Android, Google Play | Play Store | Google Play | release machine |
| iPhone (+ Apple Watch) | App Store, TestFlight beta | the App Store | Mac runner (compile) + release machine (finish, sign, upload) |

The two Android builds are flavours of one Gradle project (`frontend/android/app/build.gradle`):
`sideload` keeps the updater (InstallPlugin, `REQUEST_INSTALL_PACKAGES`), `play` leaves both out,
since Google Play does not allow an app to update itself. Same application id, same key, so a
phone can move from the APK to Play without losing its data. The page asks which build it runs in
(`ChannelPlugin`, `lib/channel.js`) and shows the update row only in the APK.

**Why the release machine:** the full-quality exercise animations may only ever be inside the
app package itself (Gym visual licence, Part B), never in a repository, a CI run or a file anyone
can download. So the store packages are put together and signed locally, like the APK. CI only
ever sees the repo's 180 px media.

## Requirements the builds meet

- **Google Play:** targets Android 16 (API 36), required for new apps and updates since
  31 August 2026 (Capacitor 8). Native libraries are 16 KB page aligned. The base module carries
  the 180 px animations like the App Store app (well under Play's 500 MB; build-release.sh checks
  it). The sharper qualities, 240 included, are on-demand **Play asset packs** (Play Asset
  Delivery), one per quality and figure like the iPhone's, each under Play's 1.5 GB per pack (a bigger one is split into parts),
  far under the 30 GB for all on-demand packs together. Google Play delivers them; the sideloaded
  APKs have none and keep what they have built in (Standard 180 px, Plus 240 px, HD 360 px).
- **App Store:** built with Xcode 26 (the `macos-26` runner). Privacy manifest
  (`ios/App/App/PrivacyInfo.xcprivacy`): no tracking, no data collected. No non-exempt
  encryption (`ITSAppUsesNonExemptEncryption = NO`, HTTPS only). The Coach asks before anything
  is sent to an AI provider and names it (App Review Guideline 5.1.2(i), November 2025).
- **Both:** no account, no ads, no analytics in the app, and nothing to buy. Settings → About &
  updates links to Buy Me a Coffee, Ko-fi and GitHub Sponsors: plain links that open in the
  browser, unlock nothing, and never pop up on their own. On the iPhone the same section has a
  link to writing an App Store review (no review prompt, App Review 5.6.1).

## Every release

Bump the version in the usual places, plus the iPhone app's `MARKETING_VERSION` (= `versionName`)
and `CURRENT_PROJECT_VERSION` in `frontend/ios/App/App.xcodeproj/project.pbxproj`. The iPhone build
number counts on its own (every TestFlight build takes the next one, App Store Connect refuses a
number it has seen), so it runs ahead of the Android `versionCode`. The extensions and the watch
app take both numbers from the app target.

### Android

```sh
cd gym-app        # the release checkout, at the release tag
export ANDROID_HOME=/opt/android-sdk
K=/root/.config/opengym
scripts/android/build-release.sh $K/opengym-release.keystore $K/keystore.pass $K/key.alias ~/release
#  → openGym-X.Y.Z.apk, openGym-Plus-X.Y.Z.apk, openGym-HD-X.Y.Z.apk (each + .sha256, and
#    SHA256SUMS) for the GitHub release (APK_ONLY=1: only these),
#    openGym-X.Y.Z.aab for Google Play
```

Each is built from its own phone build: the **Standard** APK with the box-free 180 px animations
built in (`quality/180`, about 315 MB), the **Plus** APK with 240 px (`quality/240`, about
424 MB; `PLUS_PX=0` none), the **HD** APK with 360 px (`quality/360`, about 760 MB; `HD_PX=0`
none), the bundle with 180 px (`quality/180`, like the App Store app) and an asset
pack for every quality above 180 that has a folder in `/mnt/backup-hdd/opengym-media/quality/`
(`scripts/android/make-asset-packs.mjs`, the same drawings per pack as the iPhone's); the pack
modules are generated into `frontend/android/` for the build and removed after, never committed.
To try packs on an emulator: `make-asset-packs.mjs --px 240 --builtin 180 --limit 30`, then
`./gradlew bundlePlayDebug` and `bundletool build-apks --local-testing` + `install-apks`.

Upload the `.aab` in Play Console → Test and release → Production (or a testing track first),
with the release notes from the changelog.

### iPhone

The IPA carries the app, the asset pack downloader extension (`AnimationPacksDownloader`), the
widget extension (`OpenGymWidgets`: widgets and the Live Activity) and the Apple Watch app with its
own widget. Each is a separate bundle id with its own App Store provisioning profile.

1. **Compile (CI).** The `iOS` workflow (`.github/workflows/ios.yml`, job `device-archive`) runs
   on every push to `main` and `stores` and archives the app for devices, unsigned, without the
   exercise media, and stamps the commit into the zip (`ci-commit.txt`). Download the
   `ios-unsigned-ipa` artifact of the release commit (`gh run download <run> -n ios-unsigned-ipa`).
2. **Phone bundle with the animations**, from the same commit, on the release machine:
   `cd frontend && VITE_CLIP_EXT=webp APP_MEDIA_DIR=/mnt/backup-hdd/opengym-media/build-appwebp npm run build:mobile`
3. **Finish and sign** (`scripts/ios/finish-ipa.sh`, no Mac needed, `rcodesign` signs on Linux):
   ```sh
   EXT_PROFILE=downloader.mobileprovision WIDGETS_PROFILE=widgets.mobileprovision \
   WATCH_PROFILE=watch.mobileprovision WATCH_WIDGET_PROFILE=watch-widget.mobileprovision \
   scripts/ios/finish-ipa.sh App-unsigned.ipa dist.p12 dist.pass openGym_AppStore.mobileprovision
   ```
   It puts the phone bundle into the app, signs every bundle with its own profile's entitlements
   (App Group, HealthKit where the profile and the app ask for it), and refuses an IPA from
   another commit, a version that differs from `frontend/package.json`, a bundle without the
   animations, or an extension in the IPA without its profile.
4. **Upload** through the App Store Connect API (Build Uploads), with an App Store Connect API key
   (a JWT signed with the key, kept next to the signing material, never in the repo). No Mac and
   no Transporter needed:
   1. `POST /v1/buildUploads` with the version, the build number, platform `IOS` and the app;
   2. `POST /v1/buildUploadFiles` for the IPA (file name, size, `uti` `com.apple.ipa`): the answer
      lists `uploadOperations` (URL, method, headers, offset, length);
   3. send each part of the file to its operation;
   4. `PATCH /v1/buildUploadFiles/{id}` with `uploaded: true` and the file's MD5;
   5. poll `GET /v1/buildUploads/{id}` until its state is complete (or failed, with the reason).

   The build shows up in TestFlight after Apple's processing. Internal testers get it at once; the
   public beta (https://testflight.apple.com/join/RKATb61k) after Beta App Review. Submit it for
   App Store review from there.

#### Animation packs (Background Assets)

The sharper animation qualities are Apple-hosted asset packs (iOS 26), one per quality and
figure (`anim-<px>-male`, `anim-<px>-female`), on demand. They change only when the animations
do, not with every release, and are uploaded once per change, separate from the build.

1. `node scripts/media/make-pack-manifests.mjs <out>` writes per pack the drawing ids and the
   manifest (`fileSource` `<px>/<id>.webp`, `fileDestination` `<packId>/<id>.webp`), from the
   catalogue's names only; it never opens a media file.
2. `xcrun ba-package package <packId>/manifest.json -o <packId>.aar` turns each manifest plus the
   private quality folders (its `sourceRoot`, one folder per quality) into the pack's archive.
   This needs Xcode 26 or later: the one release step that needs a Mac of our own.
3. Upload through the App Store Connect API, per pack: find or create it
   (`GET /v1/apps/{id}/backgroundAssets?filter[assetPackIdentifier]=…`, `POST /v1/backgroundAssets`),
   `POST /v1/backgroundAssetVersions` (Apple numbers it), `POST /v1/backgroundAssetUploadFiles`
   (name, size) for the `uploadOperations`, send the parts, `PATCH` it with `uploaded: true` and
   the MD5, then poll the version until it is `COMPLETE`. A complete version is available to
   internal TestFlight by itself; external TestFlight and the App Store take it with their review
   submission.

The full-quality files only ever travel from the release machine to Apple, like the IPA (licence).

## One-time setup (owner)

### Google Play

1. Play Console developer account (25 USD once, identity check). A new *personal* account must
   run a closed test with at least 12 testers for 14 days in a row before it can publish to
   production; the Discord community is the obvious tester pool. An *organisation* account
   (needs a D-U-N-S number) skips that.
2. Create the app: name openGym, default language English, free, no ads.
3. **App signing:** choose to use your own key ("Use existing app signing key", Play's PEPK
   tool exports it encrypted). Then Play signs with the same key as the APK and people can
   switch from the APK to Play keeping their data. With a key Google generates, the two are
   separate apps on a phone. This cannot be changed later.
4. Store listing, content rating questionnaire (no violence, no user content shared with
   others: "Everyone"), target audience 13+ or 16+, Data safety (below).
5. Declarations Play asks for:
   - **Health Connect** (write exercise, write weight): the in-app reason screen exists; the
     form asks what the data is used for: "writes finished workouts and weigh-ins, reads nothing".
   - **Foreground service, special use:** the rest countdown in the notification shade
     (`RestTimerService`). Play may ask for a short screen recording of a rest running.
   - **Exact alarms:** only the user-granted `SCHEDULE_EXACT_ALARM` (reminder to the minute),
     no `USE_EXACT_ALARM`.
   - **Camera:** scanning the gym membership code and photos of your own exercises.

**Data safety answers:** no data collected, no data shared. Data stays on the device; the
optional sync goes to a server the user runs or picks themselves (not the developer's), and
the optional Coach sends training data straight from the phone to the AI provider the user
chose, with the user's own key, after asking. Encryption in transit: yes. Deletion: the data is
on the phone (Settings → Reset, or uninstall).

### App Store

1. Apple Developer Program (99 USD a year, as an individual; the seller name shown is your
   legal name).
2. App Store Connect → new app "openGym: Workout Tracker" (plain "openGym" is taken as an App
   Store name; the home screen still says openGym), bundle id `ch.opengym.app`. The iPhone app
   has its own bundle id because `ch.duartesantos.opengym` is held by another Apple team (an
   Xcode build of the public code reserves it); Android keeps `ch.duartesantos.opengym`.
3. Signing material, all doable from Linux:
   - `openssl req -new -newkey rsa:2048 -nodes -keyout dist.key -out dist.csr -subj "/CN=Duarte Santos/emailAddress=…"`,
     upload the CSR under Certificates → Apple Distribution, download `distribution.cer`, then
     `openssl x509 -inform der -in distribution.cer -out dist.pem && openssl pkcs12 -export -legacy -inkey dist.key -in dist.pem -out dist.p12`.
   - Profiles → an App Store Connect profile for `ch.opengym.app` → `openGym_AppStore.mobileprovision`,
     and one each for `ch.opengym.app.AnimationPacksDownloader`, `ch.opengym.app.widgets`,
     `ch.opengym.app.watchkitapp` and `ch.opengym.app.watchkitapp.widgets`. The app, the downloader,
     the widgets and the watch widget share the App Group `group.ch.opengym.app`; the app and the
     watch app have HealthKit.
   - Users and Access → Integrations → App Store Connect API key (Admin) for uploads; with it the
     bundle id, certificate and profile can also be created through the API instead of the portal.
   - Keep all of it next to the Android keystore (`/root/.config/opengym/`, never in a repo).
4. App Privacy: "Data Not Collected". Age rating: 4+. Category: Health & Fitness.
5. Review notes: no sign-in needed ("Use on this device"). The Coach is optional and needs the
   user's own AI provider key; give the reviewer a key with a small spending limit, or say so.
6. What review sent back on v1.4.2, so it doesn't happen twice: no "free" in the subtitle (price
   words belong to the price field), and no "Not now" on a screen in front of a system permission
   dialog. The first-start permission screens have a single Continue that opens the iOS dialog,
   where the no belongs (Guideline 5.1.1(iv), `views/PermissionSteps.jsx`).

## Licensing

The repository's `NOTICE.md` carries an app-store exception to the AGPL (an additional
permission under AGPL §7, since July 2026). The [Contributor License Agreement](../CLA.md)
(live since October 2026) covers the rest: it lets the project keep publishing and updating the
store apps long term, contributions included.
