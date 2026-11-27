# AI trainer voice: research notes

Background for [`AI_TRAINER_VOICE.md`](AI_TRAINER_VOICE.md) (issue #1393). Gathered 2026-11-19.
Every claim the design leans on carries its source. "Unverified" means it could not be confirmed
from a primary source, and the design does not depend on it.

Studies were checked in PubMed and Consensus from their abstracts, not full texts. Most of them
are small (12 to 30 people), each person tries every condition, and they measure one session,
not months of training.

## 1. Verbal encouragement

| Study | What was tested | Result | Link |
|---|---|---|---|
| Andreacci 2002, J Sports Sci (n=28) | encouragement every 20 s, 60 s or 180 s in a treadmill VO2max test | every 20 or 60 s raised VO2max, test time and effort felt; every 180 s did nothing | https://doi.org/10.1080/026404102753576125 |
| McNair 1996, BJSM (n=20) | isometric elbow flexion | peak force +5 % | https://doi.org/10.1136/bjsm.30.3.243 |
| Belkhiria 2018, J Sports Med Phys Fitness (n=23) | handgrip | max force +11.7 % | https://doi.org/10.23736/S0022-4707.17.07282-6 |
| Weakley 2020, JSCR (n=12) | back squat | encouragement raised bar speed about as much as telling the lifter the speed | https://doi.org/10.1519/JSC.0000000000002887 |
| Engel 2019, Front Physiol (n=19) | 1RM squat and a 12 min AMRAP | about +2 kg on the 1RM (d=0.06, inside day-to-day noise); no change on the AMRAP | https://doi.org/10.3389/fphys.2019.00460 |
| Rendos 2019, JSCR (n=23) | wording of the cue | "as fast as you can" beat "as hard as you can" | https://doi.org/10.1519/JSC.0000000000002998 |
| Edwards 2018, BMJ Open SEM (n=12) | cycling | more motivation to exercise the next day | https://doi.org/10.1136/bmjsem-2018-000368 |
| Moffatt 1994 (n=28) | running | untrained people gained, trained runners mostly did not | PMID 7934010 |
| Midgley 2018, Clin Physiol Funct Imaging (review) | how people feel about encouragement | about a third feel neutral or negative | https://doi.org/10.1111/cpf.12454 |
| Ketelhut 2025, IJSPP (scoping review, 49 studies) | encouragement in general | frequent, personal encouragement helps | https://doi.org/10.1123/ijspp.2025-0086 |

No meta-analysis of encouragement in resistance training was found.

**Conflict:** a few percent more force on isometric and grip tests, close to nothing on a real
squat 1RM (Engel). The honest promise is "a little more effort and a better mood", not "more
strength".

## 2. Where to point attention

- Chua 2021, Psychol Bull, meta-analysis of 73 studies (n=1,824): a cue outside the body (the bar,
  the floor, the result) beats a cue on the muscle, g=0.26 for performance and 0.58 for learning.
  https://doi.org/10.1037/bul0000335
- Marchant 2009, JSCR (n=25), and Halperin 2016, JSCR (n=18): outside cues gave more force.
  https://doi.org/10.1519/JSC.0b013e3181b8d1e5 , https://doi.org/10.1519/JSC.0000000000001194
- Schoenfeld 2018, Eur J Sport Sci (n=30, 8 weeks, untrained): a muscle focus gave more biceps
  growth, none at the quads. https://doi.org/10.1080/17461391.2018.1447020
- Calatayud 2016, EJAP (n=18, trained): a muscle focus raised muscle activity only up to 60 % of
  1RM, not at 80 %. https://doi.org/10.1007/s00421-015-3305-7

**Conflict:** outside cues win for performance on strong evidence; muscle cues may help growth on
light isolation work, on one small study.

## 3. Telling lifters their results

- Weakley 2023, Sports Med, meta-analysis of 20 studies: feedback raised bar speed about 8 %
  (g=0.63); seen on a screen (g=1.11) beat spoken (g=0.47).
  https://doi.org/10.1007/s40279-023-01877-2
- Pacholek 2024, Front Physiol (n=48, 8 weeks): live feedback and encouragement each raised the
  bench 1RM about 5 kg. https://doi.org/10.3389/fphys.2024.1329432
- McKay 2022, Psych Sport Exerc, meta-analysis: giving less feedback on purpose showed no robust
  benefit (unverified: DOI not checked).

## 4. Self-talk and wording

- Hatzigeorgiadis 2011, Perspect Psychol Sci, 32 studies: self-talk has a moderate effect
  (ES=0.48); "push" style words are fine for strength tasks.
  https://doi.org/10.1177/1745691611413136
- Hardy 2019, J Sports Sci (n=16): "you can" beat "I can" in a cycling time trial.
  https://doi.org/10.1080/02640414.2019.1622240
- Hooyman 2014, Hum Mov Sci: choice-giving wording ("you might try") beat orders ("you must") on
  mood, confidence and learning. https://doi.org/10.1016/j.humov.2014.04.005
- St Germain 2024, Psychol Res (n=156, preregistered): more sense of choice, no better
  performance. https://doi.org/10.1007/s00426-024-02059-z

**Conflict:** choice-giving wording helps how people feel; whether it helps performance is open.
It costs nothing, so the lines use it.

## 5. How often a voice may talk

No study measures how often spoken prompts are acceptable during a workout. This is a real gap.
The nearest evidence is phone notifications (Bidargaddi 2018 JMIR mHealth, n=1,255; Bell 2023
JMIR mHealth, n=350; Nahum-Shani 2018 Ann Behav Med, https://doi.org/10.1007/s12160-016-9830-8),
which flag burden but give no number for a workout. The talk budget in the spec is therefore a
design choice, checked against what products ship (section 7), not a research finding.

## 6. On-device models

The question: could a model on the phone write or pick a line live, in a second or two, with no
network?

**Apple Foundation Models (iOS 26 and later)**

- Devices: the ones that run Apple Intelligence: iPhone 15 Pro and later, M1 and later iPads.
  Apple Intelligence must be switched on and the model downloaded; the API reports
  `appleIntelligenceNotEnabled`, `deviceNotEligible`, `modelNotReady`.
  https://support.apple.com/en-us/121115 ,
  https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason
- Languages: 16 on iOS 27 (English, Danish, Dutch, French, German, Italian, Norwegian, Portuguese,
  Spanish, Swedish, Turkish, Vietnamese, Chinese, Japanese, Korean); read `supportedLanguages` at
  run time. openGym ships more languages than that (Arabic, Bengali, Czech, Persian...).
  https://support.apple.com/en-us/121115
- Model: about 3 billion parameters; iOS 27 brings a rebuilt model.
  https://machinelearning.apple.com/research/apple-foundation-models-2025-updates ,
  https://developer.apple.com/videos/play/wwdc2026/241/
- Context: 4096 tokens per session, prompt and answer together.
  https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window ,
  https://developer.apple.com/forums/thread/833642 . A write-up of WWDC26 mentions 8192:
  conflict, read `contextSize` on the device.
- Structured output with `@Generable`: the app gets typed fields back, not free text.
  https://developer.apple.com/documentation/foundationmodels/generable
- Free and offline.
  https://www.apple.com/newsroom/2025/09/apples-foundation-models-framework-unlocks-new-intelligent-app-experiences/
- Speed: no current figure. Apple's 2024 figure for iPhone 15 Pro was about 0.6 ms per prompt
  token, then 30 tokens per second
  (https://machinelearning.apple.com/research/introducing-apple-foundation-models), so a 20-word
  line is roughly 1 to 1.5 s once warm. Unverified on iOS 26 and 27.
- **Background:** calls from a backgrounded app are rate limited, by an undocumented limit, and
  "might be throttled or canceled".
  https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror/ratelimited(_:) ,
  https://developer.apple.com/forums/thread/787737 , https://developer.apple.com/forums/thread/833642
- Apple Watch: no on-device model. From watchOS 27 only Apple's server model (Private Cloud
  Compute), with a network and a quota.
  https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel
- It is a Swift API: it needs a native plugin (one exists on npm, `capacitor-foundation-models`,
  quality unchecked).

**Android: Gemini Nano through ML Kit GenAI (Prompt API)**

- Beta, "not subject to any SLA or deprecation policy".
  https://developers.google.com/ml-kit/genai/prompt/android
- Devices: Pixel 9 and later, Galaxy S25 and later, some other flagships; varies by RAM and AICore
  updates. https://developers.google.com/ml-kit/genai
- Input under 4000 tokens; a per-app quota (`BUSY`) and a daily battery quota.
  https://developers.google.com/ml-kit/genai/prompt/android/get-started
- **Background: blocked.** Inference works "only when the app is the top foreground
  application"; a foreground service gets `BACKGROUND_USE_BLOCKED`.
  https://developers.google.com/ml-kit/genai
- Wear OS: no on-device model for apps.
  https://developers.googleblog.com/on-device-genai-in-chrome-chromebook-plus-and-pixel-watch-with-litert-lm/

**Bundling a small open model (Gemma 3 via LiteRT-LM)**

- Gemma 3 1B (4-bit): a 529 MB download, 1.7 to 4.5 s before the first word, about 1 GB of
  memory on a Galaxy S24 Ultra.
  https://developers.googleblog.com/en/gemma-3-on-mobile-and-web-with-google-ai-edge/
- Gemma 3 270M: small and frugal, writes noticeably worse text.
  https://developers.googleblog.com/en/introducing-gemma-3-270m/
- Either one is a large new dependency and a heavy download, against the project's
  dependency-light rule.

**Bottom line:** live on-device lines would reach only recent iPhones with Apple Intelligence on,
in 16 languages, and could be throttled with the app in the background. Android's model is
blocked in the background, and no watch has one. It is not a base the feature can stand on. It
could later be one more way to *prepare* the script, on the phone, free and private.

## 7. How other products do it

No product found gives spoken, set-by-set strength coaching built from the lifter's own log.
Apple's Workout Buddy comes closest, and its documented examples are all cardio.

| Product | Voice | Personal? | When it talks | Offline? | Sources |
|---|---|---|---|---|---|
| Apple Workout Buddy (watchOS 26, upgraded in 27) | generated speech from a model built on Fitness+ trainer recordings; two voices; positive-only wording | yes: heart rate, pace, rings, streaks, records | a pep talk at the start, milestones and records during, a recap at the end; can be muted mid-workout and switched off per workout type | no: watchOS 26 needs an Apple Intelligence iPhone nearby and internet; 27 works over Wi-Fi or cellular; Bluetooth headphones; English and Spanish | https://support.apple.com/guide/watch/apd65c7938e6/watchos , https://www.dcrainmaker.com/2025/06/apple-watchos-26-announced-workout-buddy-and-more-explained.html , https://www.dcrainmaker.com/2025/07/apple-watchos-26-workout-beta-real-world.html , https://www.macrumors.com/2026/06/08/watchos-27-workout-buddy-upgrades-better-sleep-tracking/ |
| Peloton IQ (Oct 2025) | visual and audio form cues (recorded or synthetic: unverified) | yes: a camera counts reps, suggests weights | during sets; only on the camera hardware | unverified | https://www.onepeloton.com/blog/peloton-iq-strength-training-features |
| Future | a real human coach records clips ahead of time | yes, by hand | a clip at the start, form tips during | unverified | https://connectthewatts.com/2021/09/27/future-app-review |
| Nike Run Club | recorded coaches on guided runs, synthetic voice for stats | stats only | coaches at set points; stats at a frequency the runner picks | guided runs download | https://www.nike.com/help/a/nrc-settings |
| Ladder (strength) | in-ear coaching (recorded voice likely, unverified) | no, scripted per programme | before each set: form and effort cues; music turns down while it talks | unverified | https://www.garagegymreviews.com/ladder-app-review |
| Fitbod | no voice coach; the rest timer beeps | n/a | end of rest | n/a | https://help.fitbod.me/hc/en-us/articles/360006499194-Apple-Watch |
| ChatGPT voice, ChatGPT Health (Jan 2026) | live generated voice | reads Apple Health and Peloton data | only when spoken to; cannot follow sets | no | https://openai.com/index/health-in-chatgpt/ |
| Strava Athlete Intelligence, WHOOP Coach, Garmin Active Intelligence, Fitbit Gemini coach | AI-written text, no spoken coaching during the workout | yes | after the workout or on demand | no | https://support.strava.com/hc/en-us/articles/26786795557005 , https://openai.com/index/whoop , https://blog.google/products/fitbit/personal-health-coach-public-preview/ |
| Runna, Garmin audio prompts | synthetic voice | plan targets | splits, too fast or too slow; frequency set by the user | yes | https://support.runna.com/en/articles/8159780-setting-up-and-managing-your-audio-cues |

Lessons:

- **Three moments carry it:** a short opener tied to real context, rare milestone calls, a recap
  at the end (Apple, Future).
- **Wrong numbers kill trust.** Workout Buddy said a 16-day streak when it was 307, and 47
  minutes when the timer read 62 (DC Rainmaker, beta test above). Numbers must come from the log.
- **Constant cheer annoys.** A TechRadar writer switched Buddy off over its "hyper-enthusiasm"
  (https://www.techradar.com/health-fitness/i-tried-watchos-26s-workout-buddy-but-had-to-turn-it-off-heres-why).
  A study of 297 Reddit threads on Strava's AI found it upbeat whatever happened, and patronising
  to experienced athletes; it recommends describing what happened and letting the athlete judge
  (https://arxiv.org/pdf/2604.23830).
- **Real controls:** a mute mid-workout and an off switch; people complain that Apple's is per
  workout type only (https://discussions.apple.com/thread/256255727).
- **Music:** talking over music is a named complaint; Ladder and NRC turn it down. openGym
  already ducks music for a line (`lib/speech.js`).
- **The cloud breaks it:** with no signal Buddy says nothing at all. Downloaded or on-device
  audio keeps working.
- **Strength is mostly unserved.** Between-set talk from the lifter's own history is a real gap.

Unverified: what Workout Buddy says in a strength workout; NRC's and Runna's default frequency;
whether Peloton IQ's voice is synthetic; Ladder's voice and offline details.

## 8. Speaking with the screen off

Added 2026-11-22, after Adrián asked for speech with the screen off, like Apple's Workout app.

- **iPhone apps cannot use Siri voices**, on iOS 26 too: no public API, no Apple statement opening
  them. The closest is the best downloaded voice, `AVSpeechSynthesisVoice.speechVoices()` filtered
  to `.premium`, then `.enhanced`. One developer reports some formerly preinstalled voices were
  dropped around iOS 18.6 / 26. Details and more sources in `VOICE_QUALITY.md` (F1, F2).
  [Apple forums 829725](https://developer.apple.com/forums/thread/829725),
  [Apple forums 804648](https://developer.apple.com/forums/thread/804648).
- **Background modes.** Apple lists "Audio, AirPlay, and Picture in Picture" for iOS ("The app
  plays audible content in the background") and "Workout processing" for Apple Watch only ("The
  app uses a workout session to track a user's activity on Apple Watch").
  [Apple: Configuring background execution modes](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)
- **iPhone workout sessions (iOS 26).** WWDC25 session 322 covers locked-phone data access, Live
  Activities and Siri on the lock screen, and crash relaunch; it says nothing on background run
  time or audio. Unverified (U): whether a running iPhone session keeps an app awake to speak.
  [WWDC25 322](https://developer.apple.com/videos/play/wwdc2025/322/)
- **App Review.** Guideline 2.5.4: "Multitasking apps may only use background services for their
  intended purposes: VoIP, audio playback, location, task completion, local notifications, etc."
  A local notification's sound is within that; an audio session kept alive with silence is not.
  In an April 2026 forum thread on workout audio cues in the background, Apple DTS said a session
  type must match its documented use and would not speak for App Review.
  [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
  [Apple forums 821905](https://developer.apple.com/forums/thread/821905)
- **Speech into a file.** `AVSpeechSynthesizer.write(_:toBufferCallback:)` (iOS 13+) renders an
  utterance to audio buffers instead of the speaker; `UNNotificationSound` plays a file from
  Library/Sounds, under 30 s. openGym already writes its end tones there (`RestTone.swift`).
  [AVSpeechSynthesizer.write](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:)),
  [UNNotificationSound](https://developer.apple.com/documentation/usernotifications/unnotificationsound)
- **Android.** `TextToSpeech` needs no visible activity; openGym's `SpeechCue` already uses it with
  audio focus, and the rest's foreground service and exact alarm already run with the screen off.
