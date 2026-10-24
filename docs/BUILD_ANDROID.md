# Build the Android app yourself

The short version of building openGym for your own Android phone from a fresh clone. The full
story (signing, release flavours, the iPhone side) is in [MOBILE.md](MOBILE.md).

You only need this if you want to build from source. The ready-made APK is on
[the GitHub releases page](https://github.com/DuarteSantos8/openGym/releases).

## 1. Install the tools (once)

| Tool | Version | Check it with |
|---|---|---|
| [Node.js](https://nodejs.org) | 20 or newer | `node -v` |
| [JDK](https://adoptium.net) | 21 | `java -version` |
| [Android Studio](https://developer.android.com/studio) | any recent | it installs the Android SDK |

On Windows you can install Android Studio with `winget install Google.AndroidStudio`.

Then:

1. Start Android Studio once and let the setup wizard install the Android SDK. The project
   needs **Android 36** (SDK Platform 36); add it under *Settings → Android SDK* if it's missing.
2. Set two environment variables so the command-line build finds Java and the SDK:
   - `JAVA_HOME` → your JDK 21 folder, e.g. `C:\Program Files\Java\jdk-21`
   - `ANDROID_HOME` → the SDK folder, by default `C:\Users\<you>\AppData\Local\Android\Sdk`
     (macOS: `~/Library/Android/sdk`, Linux: `~/Android/Sdk`)

   On Windows (PowerShell), for your user:

   ```powershell
   [Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Java\jdk-21", "User")
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
   ```

   Open a **new** terminal afterwards so it sees them.

## 2. Build the app

Run everything from the `frontend` folder.

**macOS / Linux / Git Bash:**

```sh
cd frontend
npm install
npm run build:mobile
cd android
./gradlew assembleDebug
```

**Windows PowerShell** (`npm run build:mobile` uses Unix syntax, so run its steps one by one):

```powershell
cd frontend
npm install
$env:VITE_MOBILE = "1"; npx vite build
node ..\scripts\catalogue\stage-media.mjs dist
npx cap sync
node scripts\check-mobile-bundle.mjs
cd android
.\gradlew.bat assembleDebug
```

The first Gradle build downloads its dependencies and can take 10–15 minutes; later builds
are much faster.

The APK lands in:

```
frontend/android/app/build/outputs/apk/sideload/debug/app-sideload-debug.apk
```

(There is also a `play` one next to it; use `sideload` for your own phone.)

## 3. Put it on your phone

1. On the phone, turn on *Developer options* (tap *Build number* seven times in
   *Settings → About phone*), then turn on **USB debugging**.
2. Plug the phone in and tap **Allow** on the "Allow USB debugging?" prompt.
3. Check the phone is seen, then install:

   ```sh
   adb devices                 # should list your phone as "device", not "unauthorized"
   adb install -r android/app/build/outputs/apk/sideload/debug/app-sideload-debug.apk
   ```

   (`adb` is in the SDK's `platform-tools` folder.)

No cable? Copy the APK to the phone and open it there; Android asks you to allow installs
from that app the first time.

Prefer clicking? Instead of Gradle, run `npx cap open android` from `frontend` and press
the green ▶ Run button in Android Studio with your phone selected.

## After you change the code

Repeat step 2: every web-code change needs the mobile build and `cap sync` again before the
native build picks it up.

`frontend/dist` now holds the *mobile* bundle. Run a plain `npm run build` before deploying
`dist` to a server.

## When something goes wrong

| Problem | Fix |
|---|---|
| `SDK location not found` | `ANDROID_HOME` isn't set, or the terminal was opened before you set it |
| `Unsupported class file major version` / Gradle complains about Java | `JAVA_HOME` points to an older JDK; point it at JDK 21 |
| `adb devices` shows `unauthorized` | unlock the phone and accept the USB debugging prompt |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | the phone has openGym from a release (different signing key); uninstall it first. This deletes the app's local data, so export a backup in the app before |
| The app opens the web login screen | the web build overwrote the mobile one; redo step 2 from `vite build` |
