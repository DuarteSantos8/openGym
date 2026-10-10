# openGym in Google Play and the App Store

openGym ships to phones three ways, all from the same code and the same version number:

| | Where | Who installs updates | Built where |
|---|---|---|---|
| Android APK | GitHub release, opengym.ch | the app itself (Settings → About) | release machine |
| Android, Google Play | Play Store | Google Play | release machine |
| iPhone | App Store | the App Store | Mac runner (compile) + release machine (finish, sign) |

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
  31 August 2026 (Capacitor 8). Native libraries are 16 KB page aligned. The bundle is about
  290 MB, under Play's 500 MB limit for the base module, so the animations stay in the base
  module and no asset packs are needed.
- **App Store:** built with Xcode 26 (the `macos-26` runner). Privacy manifest
  (`ios/App/App/PrivacyInfo.xcprivacy`): no tracking, no data collected. No non-exempt
  encryption (`ITSAppUsesNonExemptEncryption = NO`, HTTPS only). The Coach asks before anything
  is sent to an AI provider and names it (App Review Guideline 5.1.2(i), November 2025).
- **Both:** no account, no ads, no analytics in the app. Donations are only linked from the
  website, never from inside the app: both stores require their own payment system for that.

## Every release

Bump the version in the usual places, plus the iPhone app's
`MARKETING_VERSION` (= `versionName`) and `CURRENT_PROJECT_VERSION` (= `versionCode`) in
`frontend/ios/App/App.xcodeproj/project.pbxproj`.

### Android

```sh
cd gym-app        # the release checkout, at the release tag
export ANDROID_HOME=/opt/android-sdk
K=/root/.config/opengym
scripts/android/build-release.sh $K/opengym-release.keystore $K/keystore.pass $K/key.alias ~/release
#  → openGym-X.Y.Z.apk (+ .sha256) for the GitHub release, openGym-X.Y.Z.aab for Google Play
```

Upload the `.aab` in Play Console → Test and release → Production (or a testing track first),
with the release notes from the changelog.

### iPhone

1. Push the tag; the `iOS` workflow (`.github/workflows/ios.yml`) builds `ios-unsigned-ipa` for it.
   Download that artifact (`gh run download <run> -n ios-unsigned-ipa`).
2. Build the phone bundle with the app's animations, from the same commit:
   `cd frontend && VITE_CLIP_EXT=webp APP_MEDIA_DIR=/mnt/backup-hdd/opengym-media/build-appwebp npm run build:mobile`
3. Finish and sign it:
   `scripts/ios/finish-ipa.sh App-unsigned.ipa dist.p12 dist.pass openGym_AppStore.mobileprovision`
   It refuses an IPA from another commit or a bundle without the animations.
4. Upload: `iTMSTransporter -m upload -assetFile openGym-X.Y.Z.ipa -apiKey <KEY_ID> -apiIssuer <ISSUER_ID>`
   (Apple's Transporter for Linux, with an App Store Connect API key in `~/.appstoreconnect/private_keys/`).
   The build shows up in TestFlight after Apple's processing; submit it for review from there.

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
2. App Store Connect → new app, bundle id `ch.duartesantos.opengym`. If "openGym" is taken as an
   App Store name, "openGym: Workout Tracker" keeps the brand.
3. Signing material, all doable from Linux:
   - `openssl req -new -newkey rsa:2048 -nodes -keyout dist.key -out dist.csr -subj "/CN=Duarte Santos/emailAddress=…"`,
     upload the CSR under Certificates → Apple Distribution, download `distribution.cer`, then
     `openssl x509 -inform der -in distribution.cer -out dist.pem && openssl pkcs12 -export -legacy -inkey dist.key -in dist.pem -out dist.p12`.
   - Profiles → App Store Connect profile for `ch.duartesantos.opengym` → `openGym_AppStore.mobileprovision`.
   - Users and Access → Integrations → App Store Connect API key (App Manager) for uploads.
   - Keep all of it next to the Android keystore (`/root/.config/opengym/`, never in a repo).
4. App Privacy: "Data Not Collected". Age rating: 4+. Category: Health & Fitness.
5. Review notes: no sign-in needed ("Use on this device"). The Coach is optional and needs the
   user's own AI provider key; give the reviewer a key with a small spending limit, or say so.

## Licensing

The repository's `NOTICE.md` carries an app-store exception to the AGPL (an additional
permission under AGPL §7, since July 2026). The Contributor License Agreement in preparation
covers the rest: it lets the project keep publishing and updating the store apps long term,
contributions included.
