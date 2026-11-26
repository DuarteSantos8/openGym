# Voice quality: the best voice on the phone, by default (issue #1390)

Status: iPhone part built (ranking, the automatic voice, the voice sheet, the download hint).
Android (quality from `Voice.getQuality()`, the "Get more voices" row) is a later step: until it
lands, Android reports no quality, so the automatic choice there is today's default voice.
Base: `release-1.4.6`. Sibling: #1393 (AI trainer voice) speaks through the same path and needs
nothing extra from this spec. Adrián answered the open questions on 2026-11-22 and 2026-11-26;
his decisions are folded in below and listed under "Decisions".

## Why (the lifter's reason)

Spoken cues let you leave the phone in your pocket. Today they often sound like a robot, so people
switch them off after a week. Most iPhones and many Android phones already have a far better voice
installed, or one free download away. openGym just does not use it unless you dig through
Settings → Timer alerts → Voice and pick it by hand. On iOS 26 it is worse: the phone's own voice
choice is ignored (see Findings, F3).

The bar Adrián set is Siri: on an iPhone it is the best voice there is. Apps cannot use it. Siri
voices are not offered to apps at all (F1, checked again on 2026-11-22). The closest an app can get
is the best voice the person has downloaded: one marked Premium, else Enhanced. On a phone with one,
that sounds close to Siri; on a phone without, a short hint shows where to get one.

The fix: the person picks the voice, and the sheet makes the best one easy to find. People who never
picked one get the best voice their phone has in their own accent, automatically. No new dependency,
nothing sent anywhere, works offline.

## Goals

1. **The person picks the voice.** The voice sheet lists the best voices at the top, each with its
   quality and accent, so picking a good one takes one tap. A pick is never changed by the app.
2. **Best voice for people who never picked.** When no voice was picked by hand, speak with the best
   installed voice for the app's language in the person's own accent: Premium, then Enhanced, then
   today's default. Same rule on Android with its own quality values. This includes everyone
   upgrading who never picked a voice (decided, with a release-note line).
3. **Show the way to a better voice.** On an iPhone with only basic voices for the language, say
   where to download a better one. On Android, offer a button to the phone's voice download screen.
4. **Pick it up on return.** Coming back to openGym after a download, the new voice is used and
   listed without a restart.

## Non-goals (left out, and when to add them)

| Left out | Why | Add it when |
|---|---|---|
| Siri voices | Not reachable by any app (F1). The best downloaded Premium voice is the closest. | Apple opens them. |
| Personal Voice (iOS 17+) | Decided: no (Adrián, 2026-11-22). Apple says it is meant for speech-aid apps (F5); 3 languages only; iPhone 12+; a long setup. Your own recorded clips (v1.4.5) already cover "my own voice". | Not planned. |
| A bundled voice engine (Piper, Kokoro) | 60 to 170 MB per voice, per language, 25 languages (F11). A hard sell on size and dependencies. | Never, unless phones stop shipping good voices. |
| Cloud voices (ElevenLabs, OpenAI, Google Cloud) | Sends text to a third party and needs an account. Breaks privacy-first and offline. | Never as a default. #1393 may revisit as an opt-in. |
| Recorded voice packs | Fixed lines cannot say "80 kilos, 8 reps" naturally, and #1393's lines are new every session. | Never. |
| Browser ranking | Browsers do not report voice quality (F7). | A browser starts reporting it. |
| Speaking on the watches | Decided: the watches never speak. When a watch is in use, the words come from the phone. | Not planned. Speech through AirPods paired to a watch is a later idea in #1393. |

## Anti-goals (must stay true)

- A voice someone picked by hand stays picked. The automatic choice only fills the "no pick" case.
- The automatic choice never changes the accent. A better voice in another accent is shown in the
  sheet for the person to pick; the app does not pick it for them.
- The automatic choice never uses a voice that needs the internet. A gym basement has no signal,
  and openGym Offline has no network at all. A network voice is still there to pick by hand, as now.
- The text never leaves the phone to be spoken.
- No new dependency, frontend or native.
- Nothing imitates a real person (the rule in `lib/voice-styles.js` stays).

## Constraints

- iOS minimum 15.5. `.premium` exists from iOS 16, the voices-changed notice from iOS 17 (F4).
- Android minimum SDK 24. `Voice.getQuality()` exists from API 21 (F6).
- The voice pick is kept in `og_speech_voice` and syncs only between devices of the same kind
  (`lib/device-prefs-sync.js`, added after this spec was first written). "Automatic" is stored
  as `''`, so the automatic voice is worked out on each phone and never synced as a pick.
- Every new `t()` string goes into all 25 locale packs (CONTRIBUTING, CLAUDE.md).
- The ranking rule is logic worth a unit test: a pure helper in `frontend/src/lib` with a vitest
  file beside it.
- User-facing text: plain, no em dashes.

## How it works today

- `lib/speech.js` `speak()` hands each line to the native side on the phones (`speakNative`), else
  the Web Speech API. `voiceOpts(S)` passes `voice: pickedVoice()`, which is `''` unless picked.
- iPhone (`frontend/ios/App/App/RestAlertPlugin.swift` `speak`): with no pick it calls
  `AVSpeechSynthesisVoice(language:)`. That is usually the compact voice, the robotic one.
  `voices()` lists `speechVoices()`, tags `enhanced` / `premium`, skips Personal Voice.
- Android (`SpeechCue.java`, `RestAlertPlugin.java` `voices`): with no pick, `setLanguage()` gives
  the engine's default voice. The list skips not-installed voices and reports `online`, but
  **does not report quality**.
- `listVoices()` sorts exact region first, then by name. Quality plays no part.
- `components/VoiceSettings.jsx`: the Voice row shows "Default voice" or the picked name. The sheet
  shows "Default voice" first, then each voice with "Premium" / "Enhanced" / "Needs internet".
  When the language has no voices: "No other voices for this language here. Your device's settings
  can add more."
- The voice list is read once, when the Voice settings screen mounts.

## Findings

Confidence: **V** = two or more independent sources agree, **1** = one source, **U** = not confirmed.

| # | Finding | Conf. | Sources |
|---|---|---|---|
| F1 | Third-party apps cannot use Siri voices. They do not appear in `speechVoices()`, and `siri_` identifiers do not play. Apple documents no way in. Checked again 2026-11-22 for iOS 26: still no public API, no Apple statement opening them; one report says some voices that used to come preinstalled were dropped around iOS 18.6 / 26, so fewer good voices are there without a download. | V (no Apple doc either way) | [CoMaps, Aug 2026](https://www.comaps.app/news/ios-hq-voices/); [Apple forums 682438](https://developer.apple.com/forums/thread/682438); [Apple forums 676726](https://developer.apple.com/forums/thread/676726); [Apple forums 829725, Jun 2026](https://developer.apple.com/forums/thread/829725) |
| F2 | Premium (iOS 16+) is "a premium quality voice that you must download". Downloaded Enhanced and Premium voices are usable by apps. All preinstalled voices report `default`, though they vary. | V | [Apple: AVSpeechSynthesisVoiceQuality.premium](https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoicequality/premium); [Ben Dodson, 2024](https://bendodson.com/weblog/2024/04/03/using-your-personal-voice-in-an-ios-app/); [Readium read-aloud best practices](https://github.com/HadrienGardeur/read-aloud-best-practices/blob/main/voice-selection.md) |
| F3 | On iOS 26, `AVSpeechSynthesisVoice(language:)` returns the system default and ignores the voice the person chose in Accessibility settings. Asking for a voice by its identifier still works. | 1 (forum report, bug FB20271264) | [Apple forums 804648](https://developer.apple.com/forums/thread/804648) |
| F4 | `AVSpeechSynthesizer.availableVoicesDidChangeNotification` (iOS 17+) fires when the set of voices changes. | 1 (primary doc) | [Apple docs](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/availablevoicesdidchangenotification) |
| F5 | Personal Voice: apps call `requestPersonalVoiceAuthorization` (iOS 17+); the person must first turn on Settings → Accessibility → Personal Voice → Allow Apps to Request to Use. Apple: usage "is sensitive and should be primarily used for augmentative or alternative communication apps". Languages: English (US), Mandarin (China mainland), Spanish (Mexico). iPhone 12 or later. About 15 minutes of reading, then overnight processing on charge. Can sync to other devices through iCloud. Reported: an app may need a restart after the grant; buffer callbacks do not work with it. | V (main facts), 1 (restart, buffers) | [Apple Support 104993](https://support.apple.com/en-us/104993); [WWDC23 10033](https://developer.apple.com/videos/play/wwdc2023/10033/); [Apple feature availability](https://www.apple.com/ios/feature-availability/); [Ben Dodson](https://bendodson.com/weblog/2024/04/03/using-your-personal-voice-in-an-ios-app/); [forums 764814](https://developer.apple.com/forums/thread/764814), [736148](https://developer.apple.com/forums/thread/736148) |
| F6 | Android `Voice.getQuality()`: 100 very low to 500 "very high, almost human-indistinguishable"; `getLatency()` and `isNetworkConnectionRequired()` exist. One older developer report says real engines top out at 400. | V (constants), U (top out at 400) | [Android Voice reference](https://developer.android.com/reference/android/speech/tts/Voice); [Readium](https://github.com/HadrienGardeur/read-aloud-best-practices/blob/main/voice-selection.md) |
| F7 | Browsers' `getVoices()` gives no quality. | 1 | [Readium](https://github.com/HadrienGardeur/read-aloud-best-practices/blob/main/voice-selection.md) |
| F8 | Download size: Apple says Enhanced voices "can be 100 MB or larger", Wi-Fi needed. Guides put Premium at 100 to 500 MB. | V (100 MB+), U (upper bound) | [Apple Support: adjust voice and speed](https://apple.co/2ArtmmM); [Ben Dodson](https://bendodson.com/weblog/2024/04/03/using-your-personal-voice-in-an-ios-app/) |
| F9 | Where to download on iPhone: Settings → Accessibility → Read & Speak → Voices (the menu was called Spoken Content before; sources disagree on whether the rename came in iOS 18 or 26). | V (path), conflict (version) | [CoMaps](https://www.comaps.app/news/ios-hq-voices/); [AbilityNet iOS 26 guide](https://mcmw.abilitynet.org.uk/how-to-customise-the-voice-used-by-screen-readers-in-ios-26-on-your-iphone-or-ipad); Apple Support 104993 names "Read & Speak" |
| F10 | Android: `TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA` opens the engine's voice install screen (public API). The `<queries>` entry for `TTS_SERVICE` that Android 11+ needs is already in our manifest. Google voice data was ~244 MB for a high quality English voice in an older release. | V (intent), U (size today) | [TextToSpeech.Engine](https://developer.android.com/reference/android/speech/tts/TextToSpeech.Engine); [Android Central](https://androidcentral.com/latest-google-text-speech-update-enables-high-quality-voices-us-and-uk-english) |
| F11 | Offline engines: Piper's active fork is GPL-3.0, 27 to 137 MB per voice; Kokoro-82M is Apache-2.0, 86 to 325 MB. | 1 per figure (secondary) | [PromptQuorum](https://www.promptquorum.com/power-local-llm/piper-vs-kokoro-tts); [soniqo Kokoro guide](https://soniqo.audio/guides/kokoro) |

Prior art:

- **Apple Workout Buddy** (watchOS 26): "a dynamic generative voice built using voice data from
  Fitness+ trainers". Needs Bluetooth headphones and an Apple Intelligence iPhone; English and
  Spanish. No public API for other apps that we could find (U).
  [Apple Newsroom](https://www.apple.com/newsroom/2025/06/watchos-26-delivers-more-personalized-ways-to-stay-active-and-connected/),
  [BikeRadar](https://www.bikeradar.com/news/apple-workout-buddy), feature-availability page.
- **Strava**: phone's own speech engine; its help page tells Android users to check their
  text-to-speech settings. [Strava support](https://support.strava.com/hc/articles/216917237)
- **Runkeeper**: lets you pick the "audio cue voice". [Runkeeper help](https://help.runkeeper.com/en/hc/the-audio-stat-guide)
- **CoMaps** (open-source maps): the same problem; their answer is a how-to post telling iPhone
  users to download a Premium voice. [CoMaps](https://www.comaps.app/news/ios-hq-voices/)
- **Hevy, Strong**: rest timers use sounds, no spoken set cues found (U).
  [Hevy help](https://help.hevyapp.com/hc/en-us/articles/35385404949143)
- Not checked: Peloton, Nike Run Club, Fitbod, Future (coach-recorded audio is their pitch, U).

## Ideas considered

1. **Minimal: best installed voice by default.** Rank by quality, use the top one when nothing is
   picked. Tiny change, fixes F3 as a side effect.
2. **Hint to download a better voice.** Text on iPhone, a button on Android.
3. **Personal Voice.** Hear your own voice. Big wow, real limits (F5).
4. **Bold: bundle an open neural engine.** Same voice on every phone, but hundreds of MB and a
   native dependency per platform (F11).
5. **Cloud voice, made once per line.** Best sound, breaks privacy and offline.
6. **Recorded human voice pack.** Sounds real, cannot say arbitrary numbers or #1393's lines.
7. **Workout Buddy hand-off.** No API (U).

Approaches:

| | What | Cost | Verdict |
|---|---|---|---|
| A | Ideas 1 + 2 | Small: one pure helper, Android reports quality, a hint, a refresh on return | **Picked** |
| B | A + Personal Voice behind a permission | A plus a permission flow, three languages, App Review risk (F5) | Rejected (decided: no Personal Voice) |
| C | A + bundled engine | Large app size, new native dependency | Rejected |

## Design

### 1. The ranking rule (one pure helper)

Add a pure helper in `frontend/src/lib/speech.js` (for example `bestVoice(voices, lang)`), with
cases in `speech.test.js`. `listVoices()` and the automatic choice both use it, so the order in the
list and the automatic pick can never disagree.

Among voices that speak the app's language (`voiceSpeaks`), and are not `online`:

1. Higher quality tier first: `premium`, then `enhanced`, then none.
2. Same tier: exact region first (`en-GB` before `en-US` for a British app).
3. Same tier and region: keep today's order (by name).

That is the order of the list. The **automatic choice** is the first voice in the person's own
region (the region of the app's language, else the phone's) **that has a tier**. With no Enhanced
or Premium voice in that region, the automatic choice is `''`, exactly today's behaviour (the
system's default for the language). This keeps novelty voices, odd defaults and a surprise accent
out, and makes the change zero-risk on phones with nothing better. When no region is known, any
region counts as the person's own.

Accent or quality is the person's call (decided: the user selects the voice). A Premium American
voice still tops the list for a British app, labelled with its accent, but the app never switches
to it on its own.

### 2. Android reports quality

`RestAlertPlugin.java` `voices()` adds `quality` from `Voice.getQuality()`:
500 → `'premium'`, 400 → `'enhanced'`, lower → none. `listVoices()` already keeps those two values.
The builder must log real values on a Pixel (Google engine) and a Samsung (Samsung engine) first;
if an engine gives every voice the same value, the rule above changes nothing there, which is safe.

### 3. Using the automatic choice

When the person picked nothing, `speak()` passes the automatic voice's id instead of `''`. The
native sides need no change: both already speak a voice by id (iOS
`AVSpeechSynthesisVoice(identifier:)`, Android by name). Asking by id also avoids the iOS 26 bug
(F3).

- Work out the automatic voice once per language, cache it in memory, and redo it when the app
  comes back to the front (the `visibilitychange` / `appStateChange` pattern in
  `lib/coach-schedule.js`). On iOS 17+ the builder may also listen for the voices-changed notice
  (F4); the return-to-front refresh alone is enough for a first build.
- If the list is not ready when a line must be said, speak with `''` (today's behaviour). A cue is
  never delayed waiting for the list.
- An id that vanished (voice deleted) already falls back to the default on both platforms.
- Web: unchanged.

### 4. Settings → Timer alerts → Voice

- The first row of the voice sheet, today "Default voice", becomes **Automatic**, with a subtitle
  naming what it uses: "Uses Ava (Premium), the best voice on this phone." With nothing better than
  the basic voice: "Uses your phone's standard voice."
- Each voice row shows its accent next to its quality ("Premium · American"), so a better voice in
  another accent is easy to spot and pick.
- The Voice row's value reads "Automatic" (or "Automatic · Ava" if it fits).
- The list below follows the ranking rule, best first.
- **iPhone hint**, in the sheet's footer, only when no Enhanced or Premium voice exists for the
  language in the person's accent (a better voice in another accent is already at the top of the
  list, labelled):
  > For a voice that sounds more like a person, download one marked Enhanced or Premium. On your
  > iPhone: Settings → Accessibility → Read & Speak → Voices (Spoken Content on older iPhones).
  > Each is 100 MB or more, so use Wi-Fi. openGym uses it as soon as it is there.
  No button: iOS has no public link into Accessibility settings (U), and a private one risks App
  Review.
- **Android**, always at the end of the list, a row **Get more voices**, subtitle "Opens your
  phone's speech settings." It starts `ACTION_INSTALL_TTS_DATA` (F10); if nothing handles it, the
  phone's text-to-speech settings screen. This needs one new plugin method.
- Picking "Automatic" plays the sample line in the automatic voice, like any other row.

The existing footer "No other voices for this language here. Your device's settings can add more."
stays for the empty case.

### 5. Platforms

| | Automatic best voice | Hint | Refresh on return |
|---|---|---|---|
| iPhone | Yes (Premium/Enhanced) | Text, when only basic voices | Yes |
| Android | Yes, where the engine reports quality | "Get more voices" row | Yes |
| Browser | No change | No | No |
| Apple Watch, Wear OS, Garmin | Never: the watches do not speak; the phone says the words | | |

AirPods change nothing: the phone's voice already plays through them like any audio. Workout
Buddy's voice is Apple's own and not offered to apps (U).

### 6. How #1393 benefits

The AI trainer will say longer, varied lines through the same `speak()` path. It gets the
automatic voice for free, and a good voice matters more for a full sentence than for "10 seconds".
#1393 must not add a voice choice of its own. If a Premium voice takes noticeably long to say its
first line of a workout (U, measure it), warming the synthesizer at workout start serves both
features. #1393 also makes cues speak with the screen off (its "Screen off" section); those lines
use the same voice: the picked one, else the automatic one.

### 7. What people will notice

People who never picked a voice will hear a different, better one after the update, if their phone
has one. That is the point. The release note says so, in one line: "Spoken cues now use the best
voice on your phone. Pick another in Settings → Timer alerts → Voice."

## Acceptance checks for the builder

- `bestVoice` unit tests: tier order; region tie-break; network voices never picked; no tier in
  the person's region gives `''` even when another region has a Premium voice; a hand-picked voice
  is untouched.
- iPhone with a Premium voice for the app language and no pick: cues use it (check the voice name
  in the sheet subtitle and by ear).
- iPhone with only basic voices: cues sound as before; the hint shows; after downloading a voice
  in Settings and switching back, the subtitle names the new voice without restarting openGym.
- Android Pixel and Samsung: the quality values seen are written into the PR; "Get more voices"
  opens a voice download or speech settings screen.
- openGym Offline: no network voice is ever chosen automatically.
- All locale checks pass (`check-locales.mjs`, `check-source-strings.mjs --strict`).

## Decisions (Adrián, 2026-11-22)

| Question | Decision |
|---|---|
| What does success sound like? | Siri, on the iPhone. Apps cannot use Siri voices (F1), so the target is the best Premium or Enhanced voice the person downloaded, plus the hint to get one. |
| Personal Voice? | No. |
| Accent or quality? | The person selects the voice. The automatic choice keeps their accent; the list shows better voices in other accents for them to pick. |
| Switch people who never picked a voice? | Yes, to the best voice in their accent, with the release-note line in "What people will notice". |
| Should the watches speak? | No. When a watch is in use, the words come from the phone. |

Scope (2026-11-26): iPhone first; Android follows in its own step; browser unchanged; watches
never speak. Every new string is translated into all 25 languages; the iPhone menu path uses
Apple's own names in each language. The settings say plainly that a better voice only works once
it is downloaded for your language: the Voice row reads "Standard voice" until then.

## Still open (for Duarte)

1. **The switch on update.** People who never picked a voice will hear a different one after
   updating. Adrián wants it, with the release-note line. OK to ship it that way?
2. **iPhone hint without a button.** iOS has no public link into Accessibility settings, so the
   hint names the path in words. OK, or would you rather leave the hint out?
