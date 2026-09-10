# Changelog

## Unreleased

What the Discord and GitLab reports after v1.3.5 had in common: the Coach failed and nobody could
see why. Web bundle and APK; the API image only for the payload change.

- 🔍 **A failed Coach run on the phone says what the provider said.** With your own API key there
  is no admin card and no instance owner, so "the instance owner needs to check its setup" was the
  wrong sentence and hid the one thing that mattered — OpenAI's "you exceeded your current quota",
  Gemini's "model not found", the validator's "unknown exercise id". The chat line and the toast
  now carry that reason, and the phone wording no longer points at an owner who does not exist.
  (issue #58; Discord reports of "the OpenAI API is bugging")
- 🔁 **You can no longer get stuck after a plan fails.** A message typed with no plan on the board
  used to become a review, which answered "there is no workout to look at" forever. It now asks
  for a fresh plan with your message as the brief, and the Coach menu has **Start a new plan**
  — a new plan from your intake answers; workouts, history and body weight stay.
  (Discord "Coach reset" thread; install-help reports)
- 💬 **The Coach remembers the last few lines of the chat.** "Shorter, like you said" and "the same
  thing as before" had nothing to point at: every message was a fresh request. The last six lines
  — what you wrote and what the Coach concluded, never proposals or errors — now travel with the
  request as context (`conversation`, documented in the prompt as data, not instruction).
- 🏗️ CI: every push to `main` now builds the signed APK as well, not only tags (the project
  runner pays for it, not shared minutes), so a broken Android build shows up before the release
  tag and the newest build is always downloadable from the `build:apk` job. A `build:ios` job
  (unsigned `.ipa` for AltStore/Sideloadly) is in the pipeline too, waiting for a Mac runner
  — `docs/MOBILE.md` says what to register.
- ⬇️ **Updates are the last thing in Settings.** On Android a permanent row checks gitlab.com on
  demand and installs a newer release with one tap (the download is verified against its checksum
  first); on the web the same spot links to the APK. The row no longer hides inside "Data" and no
  longer disappears when there is nothing new.
- 🧩 **Combine routines** (HenryByte, !102, #59): a weekday can hold several routines, and a running
  session can pull another routine in from the header ⋮ — a rehab routine on top of push day. The
  layout switch moved into that menu. Older data with one routine per day reads unchanged.
- 📐 **Compact layout** (HenryByte, !100, #57): a third workout view with only the sets you are
  logging, and a per-session ⋮ switcher between cards, list and compact.
- 🦵 **One-sided exercises log each side** (ErrorUsernameAlreadyTaken, !107, #60): weight, reps,
  effort and the done tick per side, drop-sets and rest-pause per side too; history reads
  "L 15×8 · R 15×7". Totals, volume, PRs and progression keep reading the combined row.
- ✅ **Rating a set completes it** (ErrorUsernameAlreadyTaken, !106, #64): picking RIR/RPE ticks the
  set and starts the rest timer.
- 🎫 **Check-in cards** (ErrorUsernameAlreadyTaken, !105): edit a card's photo and label, the last
  card used opens first, manual code entry removed.
- 📉 **Deloads aim at an estimated 1RM** (mflova, !103): linear and double progression deload to
  90 % of the Epley estimate of the target, on the exercise's weight grid, never above the load
  that stalled — a 5 kg lift keeps 5 kg and drops reps instead of falling to 2.5 kg. The factor is
  per exercise.
- 📈 **A climb through the rep range is progress, not a stall** (arhx91, !101): under double
  progression a session that beat its best at the current weight no longer counts toward a deload.
- 👈 **Swipe to remove** (surohsusej, !73): swipe a routine exercise or warm-up set left to remove it.
- 🧹 **The OpenAI model list only shows models this request shape can use.** The account's full
  list — speech, embeddings, image models, realtime and Responses-only variants — made it easy to
  pick one Chat Completions refuses with a 400 or a 404. Compatible endpoints (Ollama, LM Studio,
  OpenRouter) stay unfiltered. The Gemini key field also names the new `AQ.` key prefix.

## v1.3.5 — 2026-09-06

One bug, and the one everybody with the Android app and their own API key ran into. Web bundle and
APK; the API only carries the version number.

- 🔑 **"Bring my own API key" works on the phone.** Since v1.3.0 every key-store call on Android
  hung before it started: the secure-storage plugin was handed to the app as the value of a promise,
  and a Capacitor plugin object answers *any* property name with a native method — `then`
  included — so the promise took it for a thenable, called a native `SecureStorage.then()` that does
  not exist, and never settled. That one stuck `await` was all three reports at once: "Save and use
  the Coach" greyed out forever, the key "not saved" when you came back, and a Coach that sat on
  "thinking…" without end because the job read the key first. The plugin now travels inside a plain
  object, a test drives the store through a Capacitor-style proxy so it cannot come back, and the
  whole flow — save, intake, plan, restart with the key still there — was run on an emulator before
  tagging. The web app and the "use my self-hosted openGym" mode were never affected.
  (issues #42, #58; reported by many on Discord)

## v1.3.4 — 2026-09-05

Two things noticed on the phone right after v1.3.3. Web bundle and APK; the API only carries the
version number.

- 🎨 **The effort picker looks like the rest of the app.** The v1.3.3 sheet was a grid of colour-edged
  tiles that matched nothing else on screen. It is now the same list the ⋯ menus use: a tinted
  square with the value where the icon sits, the sentence as the row, a tick on the current one, and
  an "Exact RIR" row carrying the app's own stepper, tinted like the logged cell. Same six levels, same
  colours, same free value.
- 🖼️ **Animations that fail to load fall back instead of breaking.** If the animation cannot be
  fetched (dropped connection, CDN hiccup, an instance that gates media behind a session) the still
  picture takes its place; if that fails too, a neutral tile does, and a tap tries again. No more
  broken-image glyph on a white block.

## v1.3.3 — 2026-09-05

The workout screen gets out of the way, and the bug round from the board. Same day as v1.3.2 on
purpose: that one is the contributors' batch, this one is the redesign and the fixes on top of it.
Self-hosters need the new web bundle and images; the API is unchanged. This is the release to
install on Android — it is the first APK that can update itself.

### The workout screen

- ⋯ **One menu per exercise.** Note, details, progression settings, bar weight, add a warm-up set,
  make a superset with the previous or next exercise, swap, move up, move down, remove — all behind
  one button next to the exercise name, acting on exactly that exercise, also inside a superset. The
  rows of buttons that used to sit in the header, under the sets and under the card are gone; a
  pencil still appears once an exercise has a note. (issue #20)
- 🔢 **The set number is the set's menu**: drop set, rest-pause burst, remove this set. No more
  "+ Drop / + Burst" chips on every row and no per-row X on warm-ups.
- 📌 **List view keeps the header pinned** — name, clock, set counter, discard and finish stay at the
  top while the session scrolls.
- 🎛️ **Settings → During a workout → Workout controls.** Four switches bring any of the old groups
  back: weight and reps +/− buttons (off: tap the number and type it), drop/burst shortcuts on every
  set, superset buttons in the header, move/swap/remove buttons below the exercise. Existing profiles
  read as the lean default.
- 🌈 **Colour-coded RIR / RPE.** An unrated set shows one "RIR" (or "RPE") button; tapping it opens
  a picker with six levels, each with a sentence — "Nothing left, went to failure" through "Easy,
  warm-up territory" — and a field for an exact value. A logged rating tints its cell by how close
  to failure it was, the same colour whether you think in RIR or RPE; the +/− on it follow the
  Workout-controls switch. (ErrorUsernameAlreadyTaken, !91 — issue #32)
- 📖 **History without leaving the workout.** ⋯ → History: a line of your best set (or estimated
  1RM, longest hold, minutes) over time and the last ten sessions with every set, the volume and a
  PR marker. Also reachable from an exercise's details in the library. (issue #43)
- ▶️ On the workout screen the centre tab button reads "Workout" and stays lit instead of an idle
  "Resume"; Resume from anywhere else returns to the exercise you marked, which no longer moves on
  its own. (issues #29, #21)

### Planning and library

- ⭐ **Favourite exercises.** Star an exercise in its details; favourites sort first in the picker,
  the library and the muscle explorer, and the picker gets a Favourites chip. (issue #6)
- ⚖️ **Switching kg ↔ lb converts your numbers** — or keeps them and only changes the label, your
  choice in a sheet: logged sets and drops, working weights, routine targets and increments, warm-up
  configs, body weight, goal and bar weights; lb rounded to 0.5, kg to 0.25. (issue #22)
- 🪢 **Resistance bands count as bodyweight equipment**: one reps stepper and the reps-then-sets
  progression, unless you switch Bodyweight off for that exercise. (issue #39)
- 🔥 Warm-up ramps snap to the exercise's own increment (1.25 kg plates) instead of the unit default.
- 📄 Copying a copy of a routine gives "Name (Copy 2)"; the swap picker's "+" quick-adds like every
  other picker; a weekday whose routine no longer exists no longer triggers the starter-plan prompt.

### Android

- 🔄 **In-app update.** Settings → Data shows "openGym vX available" when a newer release exists; one
  tap downloads the signed APK, verifies its SHA-256 against the published checksum and opens the
  installer. No checksum, no install. Needs the "install unknown apps" permission the first time.
  (ErrorUsernameAlreadyTaken, !40 — issues #38, #9)
- 🧠 **Saving the Coach with your own API key** no longer hangs on a greyed-out button: the mode is
  written before the key, the secure store gets a timeout, and every failure says what went wrong
  in a toast. (issue #42)
- 🔢 The APK carries version code 17 (v1.3.2: 16). Two releases had reused 15; the update check
  compares the version name, so nothing changes for you, but Android's own "newer" check is honest again.

## v1.3.2 — 2026-09-05

Seventeen community merge requests from twelve contributors, each read, rebased onto a staging
instance and put through a tester round before landing, plus the fixes that round turned up. The
web bundle and the images change; the API only gains the Coach schema tightening. The Android APK
ships with a real version code again (16 — the last two releases had reused 15).

### Active workout

- 📋 **List view.** Settings → During a workout → Workout view: Cards (as before) or List, the
  whole session stacked and scrollable, the current exercise outlined, "Set current" to move the
  marker, supersets grouped with their own Unpair. (dpatrongomez, !96 — issues #28, #44, #50)
- ⚖️ **The working weight is captured, not asked.** Finishing an exercise no longer opens the
  "confirm your working weight" sheet: the heaviest completed work set becomes the working weight,
  for both members of a superset, and the current marker stays where you are until you press Next.
  Working weights are stored when the workout is finished, so a typo corrected before that, or a
  discarded session, never becomes your "Best". (mflova, !92 — issue #18)
- 🔢 **One tap, one step — in supersets too.** The +/− on weight, reps and RIR moved two steps
  per tap on the second member of a superset. (ErrorUsernameAlreadyTaken, !97 — issue #41)
- ➕ **The weight stepper uses the exercise's own increment** (1.25 kg plates, 5 lb, whatever you
  set), with progression's rounding, on set rows and drop-set rows; timed sets keep their seconds.
  A value off the increment grid steps by exactly one increment rather than snapping. (mflova, !84)
- 🎯 **Routines with progression off keep their targets.** The same exercise as 2×15 in one routine
  and 4×8 in another no longer opens the second with the first's reps — also when adding or swapping
  an exercise mid-session and when saving the progression sheet. (mflova, !71)
- 📉 **No deload spiral.** A weight change starts a new stall streak, so one bad day at the lighter
  weight after a deload cannot trigger the next one. (arhx91, !93)
- 🛡️ **The progression sheet cannot save into the wrong exercise** after the list shifted under it
  or the workout was replaced. (Space-Hermes, !77)
- ⏱️ **Timer flash blinks the theme** instead of a black/white overlay and settles back on your
  theme. A timer that ended while the app was in the background no longer replays the beep and
  flash when you come back; a quiet toast still says the rest is over. (mzspicoli, !89)

### Planning and library

- ✨ **Four starter plans.** Home, Plan and Settings → Load starter plan open a chooser: Push/Pull/Legs,
  Upper/Lower, Full Body, 5×5. Free weekdays load at once, occupied ones ask first; existing
  routines are never touched. (lordlukem, !94)
- 💪 **Muscle explorer.** Library → "By muscle" (and "By muscle" inside Add exercise): tap a muscle
  on the body map or its chip, filter by search, body part and equipment, open details or plan it.
  Follows your equipment profile like the library does. (prasad_gade05, !87)
- 📄 **Copy routine** at the bottom of the routine editor. (ErrorUsernameAlreadyTaken, !85)
- ➕ **The "+" in the exercise picker adds immediately** with the default config (freestyle: last
  session's) and says so in a toast; tapping the row still opens the config sheet. (surohsusej, !72)
- 📐 Stats → Exercise progress: long exercise names use the full width. (mflova, !80)

### MCP and Coach

- 🔍 **`preview_session`** — a ninth MCP tool: what a routine will actually open with after the
  progression policy, the confirmed weight and history have had their say, with the source of every
  number and a list of exercises where plan and screen disagree. Built on the app's own session
  builder, so progression-off and deload routines preview exactly what the screen shows.
  (koyosan, !90)
- ⏲️ `get_routine` reports each exercise's own rest as `rest_sec`. (TheophileDiot, !81 — issue #36)
- 🧠 The Coach's create schema requires a routine id and a week and caps the arrays, so a small
  local model cannot answer with a plan the validator can only reject. (subdee, !99)
- 🧪 BodyMap tests import the geometry before the first render — no more one-off failures on a
  slow runner. (TheophileDiot, !82 — issue #35)

### Self-hosting and infrastructure

- 🔁 **nginx re-resolves the api container per request.** Recreating only `api` (new IP) no longer
  leaves `web` answering 502 until it is restarted too. (issue #16)
- 🔒 The published `api` image drops npm and both images take alpine's package fixes at build time;
  the image scan reports nothing.
- 🏗️ CI: JUnit and coverage in every merge request, a bundle-size diff against main, a compose smoke
  test of the pushed images, a Trivy scan with SBOMs attached to the release, a tag preflight
  (versions and changelog checked before anything builds), and pipelines for contributors' fork MRs
  started automatically for returning contributors.
- 🤖 Renovate runs again: its configuration had two unknown keys and had stopped opening MRs. (issue #37)

## v1.3.1 — 2026-09-04

- 📱 **"Use my self-hosted openGym" works on a paired phone.** The phone app never fetched the
  server's `/api/config` after boot or after pairing, so the Coach setup screen told everyone
  "your server has no Coach enabled" — while the admin was looking at a passed test. The screen
  now asks the server afresh every time it opens, and the boot and pairing paths load the config
  like the web app always did. Reported on Discord.

## v1.3.0 — 2026-09-03

The AI Coach gets the version number it deserves. v1.2.16, earlier today, was the release that
got it out of the door; v1.3.0 is the same app with one more fix, and the number that says
"something new is in here" to everyone who reads a changelog. If you are on v1.2.16, this is
a small update. If you are on anything older, read the v1.2.15/v1.2.16 notes below — the Coach,
bar weights, the rest-day line and the rewritten admin dashboard are all new to you.

- 🗺️ **The Strength map's list makes sense again.** Below the map, every detrained muscle
  showed its set count of the last 90 days — which, for a muscle that is on that list precisely
  because it has not been trained lately, was a column of "0 sets", and where it was not zero it
  printed as `1.2000000000000002`. Each row now says how many weeks ago the muscle was last
  trained (or "not trained"), with the rounded 90-day sets on top only when there are any.

## v1.2.16 — 2026-09-03

- 🐳 **The web image builds again.** v1.2.15's tag pipeline published the API image and the APK
  but the web image failed to build: the frontend imports the Coach's core from `api/coach/core`,
  and `web/Dockerfile` copied only `frontend/`. The image now carries that directory at the same
  relative position it has in the repository, and a new `build:web-check` job builds the web
  image on every merge request that touches the frontend, the Dockerfile or the core — the API
  image had that check, the web image did not. Nothing else changed; v1.2.15's notes below are
  this release's notes.

## v1.2.15 — 2026-09-03

The AI Coach. An optional coach that designs a training plan from a few answers and reviews
what you actually log — off by default, switched on by the admin, consented to by each user,
and driven by whatever AI you bring: an Anthropic, OpenAI or Gemini API key, any
OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, OpenRouter), or a Claude Code / Codex
runtime inside the container. Nothing it proposes is applied on its own; every change carries
its reason and can be undone. Details in [docs/AI_COACH.md](docs/AI_COACH.md). Also in this
release: per-exercise bar weight, a rest-day line on the home screen, and the admin dashboard
rewritten in plain language — those three shipped to main earlier and are here for everyone.

### AI Coach

- 🔑 **One API key serves the whole instance.** A pasted Anthropic, OpenAI, Gemini or
  OpenAI-compatible key is shared by every profile, bounded by the daily limits in the admin
  card — it is metered and issued for exactly this use. Only a *personal* credential (a Claude
  Code setup token) still binds to the first profile that spends it, and that binding now
  actually happens when a job runs rather than only existing in the tests.
- 🔁 **A rate limit or an overloaded provider is not a failed job.** 429, 529 and 5xx get two
  more tries a few seconds apart before the status becomes the job's failure; a 4xx that means
  the request is wrong is never retried.
- 🔥 **Warm-up sets no longer read as work.** They were counted into stalls (a light ramp set
  below the rep target looked like a miss), into done/planned sets and into the top set of a
  session. They are now filtered the way the app's own progression engine filters them, and
  the few that still travel in full sessions are flagged `warmup: true` so the model reads
  them as prep.
- ✍️ **Admin card fields are visible again.** The base-URL and model fields shared the card's
  background and the two daily-limit numbers were the browser's white default box; both are
  real fields now, sized so a phone does not zoom into them.
- 🧪 **An API key is proven end to end in CI**: a local stand-in for each provider's API
  receives the pasted key on the right header, the cached rules block, the schema, and answers
  a review that lands as a proposal — the test that says "paste a key and it works".

- ⚡ **A local model answers in a fraction of the time.** The prompt is split so the rules —
  identical for every job of a task — ride as the system message and only the payload changes:
  a llama.cpp/Ollama endpoint reuses its KV prefix cache instead of re-reading ~2.7k tokens of
  rules per job, and Anthropic caches the same block server-side at a tenth of the input price.
  The payload itself shrank by more than half: compact JSON, full set-by-set detail only for
  the five most recent sessions (older ones become one line per exercise — `aggregates`
  already counts stalls over the whole window), and a library slice of `{id, name, bodypart}`.
  ~14,600 tokens processed per review before; ~5,900 now, plus a cached prefix.
- 🎯 **The answer cannot leave its shape.** Providers that support schema-constrained decoding
  (Ollama, LM Studio, vLLM, OpenAI) get a JSON schema with the request; the repair round is
  for content now, not syntax. Endpoints that reject it fall back to JSON mode, then to plain
  text, exactly as before — and the validator stays the only judge either way. The
  OpenAI-compatible endpoint also runs at temperature 0: a plan diff wants determinism.

- 🏁 **A debrief of one workout.** "Review my last workout" hands the Coach a single session —
  with the last three of the same routine, the stall picture and four weeks of weigh-ins — and
  gets back a score out of ten, what went well, what to watch and what to do next time, each
  item citing the session's own numbers. It cannot carry a plan change: the validator refuses
  one rather than trimming it. Kept in the Coach history like everything else.
- 👥 **Compare with others on your instance — if the admin allows it.** A new switch under
  Advanced turns on anonymous medians across profiles that opt in (each person flips *Include
  me* in the chat; a profile that does not share sees nothing). Sessions per week and the best
  estimated 1RM per exercise, you against the median, plus a rank — only where three or more
  people train it, and nothing at all until three people share. The same medians (in kg) go to
  the model on a review or a debrief, for perspective only. The opt-in lives server-side, not in
  synced state, so a stale device cannot flip it back on.
- 💬 **The Coach is a conversation now.** The first visit is an intake in the style of a phone
  setup — one question per screen, 1–7 days a week, session length as hours:minutes, the consent
  text with room to read it. After that it is a chat: your answers are the first message, a
  typing bubble counts the seconds while the job runs, the plan lands as a card with a tab per
  routine and the reason under every change, free text asks for a refinement, one button
  applies it. Coming back, asking for a review, changing an answer — same chat. The per-user
  off switch is gone; only the admin turns the Coach off.
- 🧭 **Admin card in numbered steps** — provider → endpoint → access → model → test — with a
  status pill and plain-language state; limits, account and isolation under *Advanced*, the job
  log under *Activity*.
- ⏱️ **A local model gets the time it needs.** `COACH_JOB_TIMEOUT_MS` raises the five-minute job
  budget for a CPU-bound Ollama or LM Studio; the api's HTTP client now waits as long as the job
  does instead of hanging up after undici's 300 s while the model was still typing; the phone's
  own-key mode gives a local endpoint 25 minutes and never lets the native transport cut first;
  and the chat stops promising "a minute or two" when the endpoint is local.
- 📚 **The exercise catalogue in the payload is capped at 160** — round-robin across body
  parts, deterministic, with everything in your plan and your history always included so a
  review can name what it is talking about. All 1,324 used to go along: 10k+ tokens a job
  against a metered API, and more than a small local model's context holds.
- 🧪 **A single session is not a trend.** The review prompt now refuses structural changes on
  fewer than three sessions or less than a week of data — a small model used to remove a leg
  exercise because "the one session had no leg work".
- 🔑 **Four providers that only need an API key.** Anthropic, OpenAI, Google Gemini, and any
  OpenAI-compatible endpoint — Ollama, LM Studio, vLLM, OpenRouter, a gateway of your own — can
  now drive the Coach. They speak plain HTTPS from the api process, so they need no AI runtime
  in the image and no unprivileged user: **they work on the default `api` image.** The `coach`
  image is now only for the Claude Agent SDK and the Codex CLI. Setup is a chip and a pasted key
  in Settings → Admin → AI Coach; **List models** fills the model picker from what the endpoint
  actually serves. A model on your LAN is the compatible endpoint with no key.
- 🗝️ **Keys, models and account bindings are kept per provider.** Switching chips used to clear
  the stored credential; now each provider keeps its own, and the chip shows when one is held.
  `./data/coach.json` changed shape for this: an existing file's one flat credential, model and
  binding are lifted onto the provider they belonged to on first load. **One-way** — downgrading
  to an earlier build will not read them back, which costs one paste of the key.
- 🔓 **The Anthropic API-key path was unreachable.** The admin card hid "Use an API key" for
  any provider that also took a setup token, which was exactly the Claude one. Both buttons
  render now.
- 📱 **The Coach on the App-Store build**, chosen in Settings → AI Coach: pair the phone with
  your self-hosted instance and the Coach runs there, or bring your own API key and the phone
  calls the provider directly with the same allowlist, validator and repair round as the server.
  Nothing AI-related is loaded until one of the two is chosen; a BYOK key lives in the
  platform's secure storage, never in the app's state; a local daily cap bounds what you spend.
- 🧱 The Coach's core — payload builder, validator, parser, prompts, plan fingerprint and the
  invoke → parse → validate → repair loop — moved to `api/coach/core/`, runtime-neutral, so the
  phone imports the same code the server runs. The exercise catalogue and the prompts are
  generated ES modules (`scripts/build-coach-assets.mjs --check` in CI), and
  `api/scripts/check-core-loadable.mjs` proves the core still loads under bare node.
- 🛡️ Validator hardening: the lifter's own custom exercises are now accepted when the model
  names them (they were offered to it and then refused, burning the one repair round); ids that
  are object keys downstream (`__proto__`, `constructor`) are refused; weight and speed have
  ceilings; an exercise cannot be added twice to a routine; two changes cannot share an id; a
  weight for an exercise never lifted is dropped rather than guessed.

## v1.2.14 — 2026-08-30

The largest community release so far: twenty merge requests from ten contributors, read and
tried one by one on a staging instance, plus two features of our own and a pass over how the
app feels under a thumb. Nothing changes on the server — a self-hosted instance only needs the
new web bundle; the APK carries the new reminder scheduling.

### New

- 📝 **Log a past workout.** History → "Log a past workout": pick date, start time, duration
  and a routine (or freestyle), then log it on the normal workout screen — weights, reps,
  RIR/RPE, timed sets, everything. A day that already has a workout asks: replace it, add a
  second one, or cancel. Backfilled sessions are filed in chronological order, claim no PRs
  against later history, and don't touch the weights your next session starts from.
- 📥 **Import straight from Hevy.** Settings → Import from Hevy with a Hevy Pro API key pulls
  workouts, routines and weigh-ins directly — no CSV export needed. The key is used for the
  one import and never stored; importing again updates the routines it created instead of
  duplicating them. (JuliusHaring, !30)
- ⏲️ **Rest per exercise.** Any exercise can carry its own rest time; a superset rests once,
  with the longest of the group. The global timer stays the default, and "Off" is overridden
  only by an explicit per-exercise rest. Shared plans carry it. (trapy, !34 — issue #10)
- 🧘 **Planned deloads.** A routine can be excluded from automatic progression: its sessions
  open on the routine's own targets, stay in history and statistics, and are skipped when the
  next regular session computes its prescription — reps and durations included.
  (tokyo_underworld, !28)
- 📳 **Timer flash.** Opt-in screen flash when a rest or work timer ends — for loud gyms and
  headphones. (mzspicoli, !29)
- 🌍 **Thai and Hungarian.** Full UI translation in both; Hungarian also localizes all 1,326
  exercise names and instructions. That makes 14 languages. (tomzt, !64 · kecskemethy, !68)

### Active workout

- ➕ Adding an exercise mid-session now also **moves and swaps** cleanly: move the current
  exercise or superset up/down (the rest countdown follows it), or swap it for another —
  logged sets stay with the original, the replacement arrives with your usual weights, and a
  grouped exercise asks whether the replacement stays in the group. (Space-Hermes, !41, !43)
- 👉 **Swipe between exercises** on the workout card — left/right moves through the session,
  buttons and inputs stay untouched. (Space-Hermes, !48)
- 🎯 **Supersets keep the next set centered** on screen, not just in view. (Space-Hermes, !52)
- 📖 **The progression line is now a button**: tap "Linear · +2.5 kg…" mid-workout to open the
  exercise's settings; changed rules rebuild the open rows and keep everything you already
  logged. (Space-Hermes, !54)

### Routines and progression

- ✋ **Reorder by long-press.** Hold a routine row and drag it; superset groups move as one
  block. The arrow buttons stay, now group-aware and disabled at the ends.
  (Space-Hermes, !45, !47)
- 🔢 **The double-progression rep range is visible**: "Reps from" and "Reps up to" side by
  side, per-side exercises stepping in twos — and a progression step of zero can no longer be
  saved by accident. (mflova, !69 and !60 follow-up)

### Stats and the rest

- 🔍 **The Stats exercise picker is searchable**, and the results stay above the mobile
  keyboard. (mflova, !27)
- 🗺️ **The muscle map works from the keyboard** and ranks ties in body order. (Space-Hermes, !46)
- 🔕 **Android reminders follow the calendar**: scheduled per date instead of per weekday, so
  a rescheduled day reminds you and a day you already trained stays quiet. (mflova, !66)
- 🤖 **The MCP coach reads what the app shows**: custom exercises resolve in every tool,
  warm-ups no longer count as PRs, and progression policies report the value the UI uses.
  (TheophileDiot, !38)
- 📚 **A self-hosting HTTPS guide** for valid certificates on a LAN-only address — wildcard
  cert via DNS challenge, Caddy in front, no ports opened. (andi242, !67)

### Feel

A pass over touch, scroll and tap across the whole app: chip rows keep a slightly diagonal
swipe instead of handing it to the page; sheets decide an axis before following the finger,
snap back cleanly and close on a quick flick; the body-weight slider drags relative to the
knob instead of jumping to it; steppers repeat while held; going back restores your scroll
position; a just-dropped routine row is tappable immediately; the exercise picker's search
stays above the keyboard; set-row inputs, checkboxes and small icon buttons all got bigger
touch targets; and rows everywhere can be driven from a keyboard.

With thanks to Space-Hermes, mflova, JuliusHaring, trapy, tokyo_underworld, mzspicoli,
TheophileDiot, tomzt, kecskemethy and andi242 — ten contributors in one release.

## v1.2.13 — 2026-08-30

One follow-up that arrived on !60 minutes after v1.2.12 was tagged, and belongs with it.

- 🔢 **An empty or zero progression step can no longer be saved.** With a progression rule on,
  leaving the step field empty or at `0` marks it red, explains why, and holds the save — a step
  that cannot progress anything is no longer stored by accident. Nothing else changed; a
  self-hosted instance only needs the new web bundle. (mflova, !60)

## v1.2.12 — 2026-08-30

Six small fixes from the community, each read and tried on staging before it went in. All of
them are in the active workout or the exercise settings; nothing changes on the server, so a
self-hosted instance only needs the new web bundle.

### Active workout

- ➕ **Adding an exercise mid-session puts it right after the one you are on**, not at the end
  of the list, and the flow carries on from there: "next" takes you to the next *unfinished*
  exercise and the finish prompt only appears once nothing is left open. Before, a set added
  late could leave you looking at a completion prompt with work still pending.
  (Space-Hermes, !42)
- ⏱️ **Removing an exercise no longer leaves a timer behind.** A rest countdown that belonged to
  the removed exercise stops with it — but a rest you are in the middle of for a *different*
  exercise keeps running and simply follows that exercise. (Space-Hermes, !51, narrowed here)
- ⏹️ **Discarding a workout stops a running timed set.** The countdown used to keep going, and
  beep, on a session that no longer existed. Cancelling the confirmation leaves it running.
  (Space-Hermes, !59)
- 🗺️ **A custom exercise you delete still counts in recovery.** The muscle map and the recovery
  view read the snapshot saved with each finished workout, so deleting the exercise afterwards
  no longer blanks the muscles it trained. (Space-Hermes, !58)

### Exercise settings

- 🔢 **Progression steps below one can be typed.** Entering `0.5` used to snap back to the
  default halfway through, because the field rejected the intermediate `0`. A cleared field
  still means "use the default". (mflova, !60)
- 📐 **Long values in routine rows no longer squash the title.** The value column is capped
  instead of reserving space, so a "3 × 12 @ 102.5 kg" row keeps its exercise name readable on a
  narrow phone. (MokshManral, !37)

With thanks to Space-Hermes, mflova and MokshManral.

## v1.2.11 — 2026-08-25

A correction release. v1.2.10 landed planned warm-ups and notes, and reviewing that release
afterwards turned up six defects it had either introduced or made matter — three of them in the
warm-up work itself. None of them broke a test, which is the point: they were gaps beside the
tests rather than failures in them.

### Warm-ups

- ⚖️ **Warm-ups were counted in your session volume.** Every other part of the app leaves them
  out — records, progression, the muscle map — and the routine screen says so in as many words
  ("left out of volume, records and progression"). Volume was the one place it was not true.
  Three planned warm-ups on a 3×5 at 100 kg reported 2562.5 instead of 1500, and that number is
  written into the finished workout, so it would have stayed wrong for good.
- 📉 **On a deload, the last warm-up came out heavier than the work sets.** The ramp was built
  before progression had its say and nothing recalculated it, so a plan dropping from 100 kg to
  50 kg gave you warm-ups of 50 and 75 under work sets of 50. The ramp is now derived after the
  prescription, so it always aims at the weight you are actually about to lift. A warm-up you
  have already logged keeps its weight — it happened.
- 🧱 **One too-heavy warm-up spread to the rest.** Editing a warm-up above the working weight
  made every warm-up added after it inherit that number. Your own edit stays as you typed it;
  what stops is the inheritance.

### Notes

- 📝 **The session note now exists.** v1.2.10 described three kinds of note and shipped two: the
  code that saves a whole-session note was there, and tested, but nothing in the app ever wrote
  one. There is a note field next to the finish button now — wrapping up is when you know how
  the session went.
- 💾 **The session note stopped being thrown away.** In a past workout it only saved when the
  field lost focus, and Escape, the Android back gesture and swipe-to-dismiss all close a sheet
  without that ever happening. Type a note, press Escape, gone. It now saves on the way out too.

### Sharing, stats and settings

- 🔗 **Shared plans carry drop-sets and rest-pause.** A routine built as "3×5 with a double
  drop" arrived at the other end as a plain 3×5, silently. Both the intensifier and the planned
  warm-up count are now clamped in both directions, so a hand-edited plan file cannot put a
  nonsense number in front of you either.
- 🔢 **The version is visible again**, at the bottom of Settings — which is where the support
  template has been telling people to look for it. On the phone there is no address bar, so
  there was no way to tell which build you had or whether an update installed. (issue #7)
- ⏹️ **The rest timer can be turned off.** v1.2.10 made this worse before it made it better: it
  started resting after every set instead of finishing an exercise quietly, and there was still
  no way out. "Off" now sits with the other durations.
- 📊 **The exercise picker in Stats no longer runs long names into the label** (mflova, !24), and
  **a chart tooltip no longer lingers from the previous exercise** (mflova, !25). The estimated-1RM
  series is memoised as well, so the tooltip stops vanishing under your finger while you read it.

### Website

- 🌐 **opengym.duarte-santos.ch has been rebuilt** — a bento layout with real device frames, a
  mobile menu that opens instead of hiding, scroll reveals that respect `prefers-reduced-motion`,
  and a section collecting where the project actually lives. It had been live for a while without
  ever being committed, so the repository and the site had drifted apart.

## v1.2.10 — 2026-08-25

The first release since the move to GitLab that is mostly **other people's work**. Nine
contributors, thirteen merge requests: Brazilian Portuguese in full — interface, all 1,324
exercise names and all 7,710 instruction steps — equipment profiles for people who train in more
than one gym, drop-sets and rest-pause, a way to pair the mobile app with your own server, and a
round of security hardening on the API and the reverse proxy.

Alongside that, the bugs you reported in #bugs-and-ideas and on the issue tracker, several of
which turned out to be worse than they looked from the outside.

### Training

- 🔥 **"Add warm-up set" gave you a warm-up at your full working weight.** It looked for the row
  to ramp from at the position *before* the first work set — which for the first warm-up is
  index −1, so it fell through to the last row instead: your heaviest set. Every warm-up you
  added had to be corrected by hand. Warm-ups now ramp toward the work weight, each one closing
  half the remaining gap (50% → 75% → 87.5%), rounded down to what you can actually load.
- 🏋️ **Warm-ups can be planned in the routine.** Set how many an exercise gets and the session
  starts with them already in place, ramped, instead of you adding them every time. They stay
  out of volume, records and progression, and they travel with a shared plan.
- ⏱️ **The rest timer skipped the last set of every exercise.** It was written as "final sets
  finish quietly", but another exercise follows that set and you rest before it too — so a
  two-set exercise timed one rest instead of two. It now rests after every completed set except
  the last one of the session. (issue #3, and zkssyth arrived at the same rule independently)
- 📝 **Notes you can write during a workout**, in three kinds, because they have three different
  lifetimes: what happened today, on the exercise; what is always true about the movement (seat
  height, pin position); and how the session went as a whole. The per-session note carries a
  **pin** — the app cannot know whether "shoulder twinged" is a diary line or "go narrower" is a
  message to your next self, but you do, at the moment you write it. Pinned notes come back the
  next time that exercise comes up.
- 💥 **Drop-sets and rest-pause / myo-reps**, planned per exercise and extending the set row
  itself rather than adding new sets.

### Equipment, and training in more than one gym

- 🎒 **Equipment profiles.** Build a "Home" and a "Gym" list of what you actually own, and the
  library, the exercise picker and your routines filter to it — with a warning on any routine
  exercise that needs something the active profile does not have. Body-weight exercises are
  always available.

### Brazilian Portuguese

- 🇧🇷 **pt-BR is complete**: the interface, every built-in exercise name, and every instruction
  step. It is defined as a layer over pt-PT rather than a copy, so a string added to Portuguese
  can never silently go missing here — with tests that fingerprint every inherited entry and
  refuse European vocabulary (*ficheiro*, *telemóvel*, *ecrã*, «guillemets»).
- 🔔 Server-sent notifications — rest-timer alerts, test pushes, workout-day reminders — follow
  the profile's language instead of always arriving in English.

### Fixes

- ✅ **Home kept asking you to do the workout you had just done.** The week strip knew the day was
  finished; the row underneath did not, and went on showing the routine behind a green Start tag.
  (issue #4)
- 📈 **"Exercise progress" was empty for bodyweight exercises.** Pull-ups and push-ups carry no
  weight, and every point without one was dropped, so a full history read as "No data yet". When
  nothing in an exercise's history was ever loaded, the reps are the progress — so that is what
  is plotted now. Add a weighted set later and it switches back to weight. (issue #5)
- 🫥 **The tab bar was see-through.** At 72% opacity the page read straight through it and the
  labels competed with whatever was scrolling behind them — nobody needs to read the content
  under a navigation bar. It is 94% now in both themes, and blurs less, which is also faster on
  Android, where a blur behind a fixed element is recomposited on every scroll frame. Where
  `backdrop-filter` is unavailable at all — old Android WebViews, "reduce transparency" — the
  blurred surfaces now go fully opaque instead of leaving just the alpha, which was the worst of
  both. (reported by mflova, seconded by seals187)
- 📥 **No Smith-machine exercise could ever match on import.** The `machine → lever` rule ran
  before `smith machine → smith`, so the generic one ate the word first. Hevy's vocabulary is
  now mapped as well, and exercises it cannot match take their body part from the name instead of
  defaulting to "upper legs" — which had been attributing a third of an imported history to the
  legs. (diagnosed by rubik_97, fixed by koyosan)
- 🗓️ **Charts show the calendar year** when the data spans more than one, so a point from
  November 2025 is not confused with February 2026. (mflova)
- 🔤 **Exercise search matches whole words in any order**, ignores accents, and searches the
  translated names too — "bench barbell" finds the barbell bench press, "elevacao" finds
  "elevação". The haystack is now built once per exercise instead of on every keystroke.
- 🔑 **Passkeys work in Chrome on iOS**, which was excluded by a user-agent test rather than by
  asking the browser what it supports.
- 📱 The reps field in a superset is no longer squeezed on narrow phones, and secondary muscles
  are visible while building a plan, not only in the Exercises tab.

### Self-hosting

- 🔐 **Security hardening on the API and the proxy**: SSRF and an unbounded handler in push
  delivery, CSRF from a sibling subdomain, session-cookie shadowing, and non-forgeable proxy
  headers. Details in SECURITY.md.
- 🧭 **When a passkey fails, the error now says what is misconfigured.** "Unexpected RP ID hash"
  told you nothing about your own `.env`; it now names the `RP_ID` and `ORIGIN` the server is
  actually running with. `docs/SELF_HOSTING.md` gained a section that works through the usual
  causes in order — including that `docker compose restart` does not re-read `.env`, and that on
  a LAN without certificates there is nothing you can configure to make passkeys work.
- 📲 **"Connect to my server"** pairs the standalone mobile app to a self-hosted instance with a
  one-time code, no passkey ceremony needed inside the app's WebView.
- 💾 **Optional local auto-backup** on the mobile app after finishing a workout or editing a
  routine, and a **System** theme option that follows the OS.

With thanks to mzspicoli, Josevi, andi242, Space_Hermes, Horus Gonzalez, wagenheimer, koyosan,
mflova and Aaron Sachs — and to everyone who reported one of the bugs above.

## v1.2.9 — 2026-08-23

If you run openGym for other people, you have had no way to answer "who signed in, and when?" —
the server kept no record of anything. It does now: an **activity log** in the admin dashboard,
covering sign-ins, sign-outs, the attempts that failed, and every admin action. The other half of
this release is that **the live demo is back**, self-hosted this time, after two months offline.
And the project has a working home again: openGym now lives on **GitLab**, where CI builds the
container images and the signed Android APK for every release — the thing that has been missing
since the GitHub account went.

### Activity log

- 🧾 **The admin dashboard has an activity log.** Successful and failed sign-ins, profile
  creations and refused signups, sign-outs (including "sign out everywhere"), and every admin
  action: disabling or re-enabling an account, creating or revoking an invite code, and clearing
  the log itself. Filter it by sign-ins, admin actions or failures, and page back through it.
- 📄 **It is a plain file.** `./data/audit.log`, one JSON object per line — `tail -f` and `jq`
  read it directly, which also means it is its own export format. Deliberately *not* part of
  `db.json`: that file is rewritten in full on every save, and the sign-in handshake is
  unauthenticated, so a log living in there would have turned one junk request into a full
  rewrite. Retention is a cap rather than an archive — the last `AUDIT_MAX` events (5,000) or
  `AUDIT_DAYS` days (90), whichever runs out first.
- 🔒 **It records less than you might expect, on purpose.** No IP addresses unless you turn them
  on (`AUDIT_IP=net` keeps only the network, `full` keeps the address); never the browser's
  user-agent; and never the passkey id behind a failed sign-in, because that id is a stable handle
  for one device and storing it would let an admin follow an unknown device from one attempt to
  the next. A rejected invite code is not stored either — a near-miss guess sitting in a log file
  helps nobody.
- 🧹 **Clearing it is itself logged**, and the event ids keep counting, so an erased stretch always
  leaves a visible gap.
- ⚙️ **On by default when you update, and one variable turns it off.** It records strictly less
  than your instance already holds — every profile is in `db.json`, every workout is in
  `state-<uid>.json`, and any admin can already read both — and a log that ships switched off
  tells you nothing on the day you need it. `AUDIT_LOG=0` disables it completely; no file is
  written. Nothing leaves your server either way: this is a local file, not telemetry.
- Guests still never appear anywhere — guest mode does not talk to the server at all.

### The live demo is back

- ▶️ **<https://opengym.duarte-santos.ch/demo/>** — the in-browser demo, running on the project's
  own site instead of GitHub Pages, which went down in August with the suspended account. Same
  build as before: no backend, no account, seeded example history, and a reset button in its
  settings. The embedded demo on the landing page works again too.

### openGym moved to GitLab

- 🏠 **<https://gitlab.com/DuarteSantos8/opengym>** is the home of the project. Same history,
  same tags, same AGPL. gitea.com was the stopgap after the GitHub suspension and stays as a
  mirror; it never had a CI runner, which is why releases there had no images.
- 🐳 **Prebuilt images are back.** `docker compose pull` now fetches
  `registry.gitlab.com/duartesantos8/opengym/api` and `/web`, built for **amd64 and arm64** on
  every release. Pulling is anonymous — the project is public, no login, no token.
- 🤖 **The APK is built by CI now, not by hand.** Every `vX.Y.Z` tag produces a `zipalign`ed,
  signed APK, attached to the GitLab release and mirrored onto the download page. The signing
  key sits in protected CI variables, so it exists only on `main` and on version tags — a
  merge request from a fork builds an unsigned APK and never touches the key.
- ✅ **Every merge request is tested again.** The frontend suite (346 tests), the locale checks,
  the fatigue probe and the MCP suite all run on GitLab CI. The GitHub Actions workflows stay
  in `.github/` for the day that account comes back.
- 🌐 The in-browser demo also builds to GitLab Pages
  (<https://opengym-bc111a.gitlab.io/>, which <https://duartesantos8.gitlab.io/opengym/>
  redirects to); <https://opengym.duarte-santos.ch/demo/> remains the copy the landing page
  embeds.
- 📄 Security reports have a private channel again: a **confidential issue** on GitLab. See
  `SECURITY.md`.
- 🔁 **Dependency updates continue.** GitLab has no Dependabot, so Renovate runs from a monthly
  scheduled pipeline with the same deliberately quiet policy the Dependabot config had:
  grouped per ecosystem, majors on their own, odd-numbered Node images skipped, and the
  generated `android/`/`ios/` projects left to follow their `@capacitor/*` packages. Security
  advisories ignore the schedule and land on their own.

### Housekeeping

- The self-hosting docs, `SECURITY.md` and `.env.example` cover the activity log, and the
  `api/server.js` line references in `SECURITY.md` are accurate again.
- Every repository link in the README, the docs, the app and the website points at GitLab, and
  the website's live star/release numbers come from GitLab's API.

## v1.2.8 — 2026-08-22

A housekeeping release, and two things worth reading even if you skip the rest. openGym has moved
to **gitea.com** — the GitHub account it lived on was suspended, and everything you click to
self-host pointed there. And the exercise media's licence is now stated correctly: the images and
animations are © Gym visual, not CC, which matters if you redistribute them.

### The project moved to gitea.com

- 🏠 **openGym now lives at <https://gitea.com/DuarteSantos/openGym>.** The GitHub account
  was suspended on 2026-08-19 and took the repository, the GHCR images, the Pages demo and
  Discussions with it. `docker compose` now pulls `gitea.com/duartesantos/opengym-{api,web}`; the
  README, `SECURITY.md`, `CONTRIBUTING.md` and the self-hosting docs point at the new home; issue
  forms, tests and the image publish run as Gitea Actions. **If you self-host, re-pull:** the old
  `ghcr.io` images are gone and will not update again.
- Gitea has no Discussions, so questions and ideas are labelled issues — or the Discord, which
  is where most of it happens now: <https://discord.gg/e62jY6fwVb>.
- Old issue and PR numbers in the entries below stay as plain text. They point at a dead repo and
  do not match the numbering here.

### The exercise media is © Gym visual — not CC

- ⚖️ **openGym described the exercise dataset as "CC". That was wrong**, and it is now
  corrected everywhere it appeared (README, `NOTICE.md`, the website, the in-app credit, the
  compose file and `scripts/fetch-media.sh`). Upstream
  [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) licenses its two
  halves differently: the exercise **metadata and instruction text are MIT**, while the **images and
  animations are © [Gym visual](https://gymvisual.com/)**, used under that dataset's terms with
  permission that is not transferable.
- **Nothing changes for using openGym.** It never shipped that media — not in the repository,
  not in its history, not in the images or the APK; your instance downloads it from upstream on
  first run, and the media step now prints where it comes from and under what terms.
- **It does change what you may do with the media.** Reusing the images or animations — in
  openGym or anywhere else, commercially or not — needs your own licence from Gym visual. See
  [NOTICE.md](NOTICE.md).

### Features

- 🇧🇷 **Brazilian Portuguese UI** — Portuguese now has separate Portugal and
  Brazil options, with Brazilian terminology, date formatting and localized
  instructions for all 1,324 exercises. Built-in exercise titles show the
  Brazilian Portuguese name followed by the canonical English name, so both
  vocabularies remain recognizable and searchable.

### Fixes

- 🔔 **Server-generated notifications follow Brazilian Portuguese** — rest-timer
  alerts, test notifications and workout-day reminders now use the profile's
  `pt-BR` language instead of always arriving in English.

- ⬅️ **The back gesture no longer quits the app** (Android). The packaged app never listened for
  the system back event at all — Capacitor leaves that to `@capacitor/app`, which was not
  installed — so a back swipe went straight past the WebView and finished the activity from
  wherever you were. The per-sheet history entries added in [#63] only ever did anything in a
  browser tab. Back now dismisses the open sheet, then walks back through the screens you came
  from, and only leaves the app after a second press at the root ("Press back again to exit").
  A sheet that is locked mid-task still swallows back, as it does in the browser.

### The website counts visits; the app still counts nothing

- 📊 **<https://opengym.duarte-santos.ch> now runs self-hosted, cookieless
  [Umami](https://umami.is/)** — page views for the landing, about and docs pages, no cookies,
  no third-party service.
- 🔒 **Your instance does not.** The frontend only gets an analytics tag when
  `VITE_UMAMI_SRC` *and* `VITE_UMAMI_ID` are set at build time, which they are not in any published
  image or in a plain `npm run build`. A self-hosted openGym remains telemetry-free, as advertised.

## v1.2.7 — 2026-08-18

The muscle map answers a third question. Balance showed where the volume went and Fatigue what was
still recovering; Strength now names the exercises behind a muscle and what each one is worth in
estimated 1RM. Fatigue itself got harder to fool — a set counts for more the closer it is to your
maximum, and it can no longer creep upward across a rest week. In a session, supersets finally
behave: pair them as you go, rest once per round, and drop an exercise you have decided against.

### The muscle map, read as strength

- **A per-muscle exercise breakdown** behind the muscle card — estimated 1RM per exercise, decay
  bars, and primary/secondary tags, with a best-weight fallback for holds and carries that have no
  reps to work from. Contributed by [@Space-Hermes](https://github.com/Space-Hermes) in
  [#92](https://github.com/DuarteSantos8/openGym/pull/92),
  [#93](https://github.com/DuarteSantos8/openGym/pull/93) and
  [#94](https://github.com/DuarteSantos8/openGym/pull/94).
- **Fatigue is now intensity-weighted**, not volume alone: a set counts for more the closer it is
  to your estimated maximum. It also reads against a stable historical reference, so fatigue can no
  longer *rise* across a rest week, and bodyweight movements no longer register as zero load. A
  property probe over 108,000 comparisons runs in CI to keep it that way. Contributed by
  [@Space-Hermes](https://github.com/Space-Hermes) in
  [#55](https://github.com/DuarteSantos8/openGym/pull/55).

### In a session

- 🔗 **Supersets advance properly.** Completing a set moves to the next member of the group, the
  active exercise scrolls into view, and rest starts once the whole round is done rather than after
  each set. Contributed by [@Space-Hermes](https://github.com/Space-Hermes) in
  [#80](https://github.com/DuarteSantos8/openGym/pull/80).
- ➖ **Remove an exercise from a running session**, with a superset-aware picker and a confirmation.
  Contributed by [@Space-Hermes](https://github.com/Space-Hermes) in
  [#83](https://github.com/DuarteSantos8/openGym/pull/83).
- ⬅️ **The Android back button closes the open sheet** instead of leaving the screen or the app
  ([#63]). Each open sheet gets its own history entry, so stacked sheets unwind one at a time.
  Contributed by [@Space-Hermes](https://github.com/Space-Hermes) in
  [#85](https://github.com/DuarteSantos8/openGym/pull/85).

### Self-hosting

- 🐳 **The API service no longer has to be called `api`** ([#99]). The web image builds its nginx
  config at startup from `BACKEND`, `PORT` and `NGINX_PORT`, all defaulted to today's values, so
  existing compose files are unaffected. Reported and fixed by
  [@GAS85](https://github.com/GAS85) in [#100](https://github.com/DuarteSantos8/openGym/pull/100).
- **…and the shipped `docker-compose.yml` now actually passes those through.** The `web` service
  had no environment of its own and published a hardcoded `:80`, so setting `BACKEND` or
  `NGINX_PORT` in `.env` did nothing at all on the stock stack — the setting existed, the wiring
  did not. Both services now read `PORT` from the same place, so nginx cannot end up proxying to a
  port the API is not listening on. Defaults are unchanged, so an existing `.env` behaves exactly
  as before.
- 🏷️ **Health checks and OCI image labels** on both images — source, licence, version, revision and
  build date, so image tooling can tell what it is holding. Contributed by
  [@GAS85](https://github.com/GAS85) in [#98](https://github.com/DuarteSantos8/openGym/pull/98).
- **Images are published from a release, not from any tag** ([#87]). A tag that gets consolidated
  away before it becomes a release used to leave its image tags behind in the registry, where
  dependency bots read them as newer versions.

### Fixes

- **Imported warm-up sets were counted as work.** The importer marks them with `phase`, but several
  places still read the older boolean, so warm-ups from FitNotes/Strong/Hevy history inflated set
  counts, progression and the fatigue map.

[#63]: https://github.com/DuarteSantos8/openGym/issues/63
[#87]: https://github.com/DuarteSantos8/openGym/issues/87
[#99]: https://github.com/DuarteSantos8/openGym/issues/99

## v1.2.6 — 2026-08-11

The muscle map learned to answer a second question — not just where the volume went, but what is
still recovering from it. Plus: a freestyle session no longer starts from blanks, the rest timer
can reach you in another app, and a self-hosted instance can insist that everyone using it has an
account.

### The muscle map, read as recovery (#44)

- 🔥 **A `Balance | Fatigue | Strength` switch on the Stats muscle card.** Balance is the map you
  already had and is untouched. Fatigue shades each muscle by how much of the recent training it
  is still carrying; Strength shades it by how long it has been since you trained it at all, with
  the weeks-since count spelled out underneath.
- **Fatigue is volume-sensitive and fades smoothly.** A hard twelve-set chest day starts near the
  top and takes about six days to read ready again; a single set barely registers and is gone in
  two. It decays continuously on a 36-hour half-life rather than expiring at a window edge, so the
  map never flips from "fatigued" to "ready" between one look and the next.
- **Strength holds for two weeks, then decays toward a floor.** A muscle you have not trained in
  months reads detrained rather than absent, which is the state that actually tells you something.
- Both views are pure functions over your existing history — no new stored data, no schema change,
  nothing sent anywhere.

### The rest timer can reach you in another app (#49)

- ⏰ **A system notification when rest is over**, on top of the beep, for when you have switched to
  another tab or app mid-session. Permission is asked the first time a rest starts, and everything
  degrades quietly where notifications are unsupported or refused.
- It goes through the service worker where the browser requires that — which is most phones — and
  falls back to the direct API elsewhere. No new dependencies; the existing server push path is
  untouched.

### Rows now strain the rear delts (#51)

- **Four row variations gained rear-deltoid secondaries** — barbell, dumbbell, inverted and cable
  seated rows — so the muscle map spreads their load the way the lift actually does. The overrides
  live in a small table that survives a regeneration of the exercise dataset rather than being
  edited into the generated data.

### An instance can require an account (#42)

- 🔒 **`ALLOW_GUEST=0` removes the "Continue without account" button.** Guest mode keeps everything
  in the browser and never touches the server — no account, no sync, nothing the admin dashboard
  can see — so on an instance meant for a known set of people it was a door leading nowhere
  useful, and until now there was no way to close it.
- **It also ends guest sessions that already exist.** Guests never authenticate, so there is no
  request for the server to start refusing; the switch reaches someone already inside on their
  next visit, when the app checks the config and returns them to the login screen. Their data is
  not deleted — it stays in that browser, and moves into a real profile if they create one on the
  same device.
- **A server it cannot reach is not a server that said no.** The button is only withdrawn on an
  explicit `allow_guest: false`; a failed config request, or a server too old to send the flag at
  all, leaves guest mode exactly as it was. An instance that is merely offline for a moment does
  not lock out everyone who never made an account.
- **Default is on, so nothing changes for existing instances.** Set it alongside `INVITE_ONLY=1`:
  invite-only governs who may *create a profile* and says nothing about the guest button, which
  never creates one.

### Freestyle sessions start where you left off

- 🏋️ **Adding an exercise to an empty workout now prefills it from the last time you trained
  it** — the same number of sets, with each row's reps and weight carried across by position.
  Cardio brings its duration and speed, a hold brings its seconds. Until now every row opened on
  the config-sheet defaults, so the first thing a freestyle session asked of you was to retype
  what you already did last week.
- **The config sheet agrees with the rows it is about to create.** It opens on the last target you
  actually trained rather than the generic default, so the set count you confirm is the set count
  you get.
- **Planned sessions are untouched.** A routine-driven workout still runs the progression logic and
  still applies its prescription; only the freestyle path — which has no prescription to apply —
  reads from history instead.

Contributed by [@Space-Hermes](https://github.com/Space-Hermes) in
[#50](https://github.com/DuarteSantos8/openGym/pull/50).

### Pair exercises into a superset mid-session (#64)

- 🔗 **"Make superset with previous / next" on each exercise card.** Two exercises paired in the
  session collapse into a single *Superset* card — do them back-to-back, rest once at the end —
  with an **Unpair** button in the header. No planning ahead required; pair them when you decide
  to, in the workout.
- **Groups are any size.** Pairing the end of one group to the start of another merges them, and
  the header wording stays correct past two exercises.
- **Unpairing cleans up after itself.** A group reduced to one exercise is dissolved rather than
  left as a superset of one, and the pairing helpers never mutate the running session.
- Session-only by design: pairings drive the workout, and history stores the sets.

Contributed by [@Space-Hermes](https://github.com/Space-Hermes) in
[#64](https://github.com/DuarteSantos8/openGym/pull/64).

### The muscle map stops rewriting the catalogue (#67)

- **The curated secondary-muscle additions are now an overlay, not a mutation.** The four row
  exercises that strain the rear delts used to get that written into the shared exercise dataset
  at import time, which meant export, print and import saw a catalogue that had been edited
  underneath them. They are derived at the read points instead, so the dataset stays pristine.
- The detail sheet's tag row reads through the same overlay, so those muscles still show where
  they always did.

Contributed by [@Space-Hermes](https://github.com/Space-Hermes) in
[#67](https://github.com/DuarteSantos8/openGym/pull/67).

### Fixes

- 🖼️ **Exercise images and animations were blank on the routine screen** ([#79]). The media paths
  were relative, and `/plan/r/:id` is the app's only two-segment route — so the browser asked for
  `/plan/r/img/…` and got a 404 with nothing in the console to say why. Every other screen was
  fine, which is what made it look like a one-screen mystery. Reported with the root cause already
  found, by [@lemi1000](https://github.com/lemi1000).
- 📥 **Imports mapped more of what other apps export** ([#74]). Treadmill, Goblet Squat, Cycling and
  Cable Core Pallof Press arrived as *custom* exercises rather than catalogue ones — no word
  overlap could reach the names openGym stores them under. Those and their neighbours are now in
  the alias table. Already-imported history stays custom; new imports resolve. Reported by
  [@KiloOscarSix](https://github.com/KiloOscarSix).
- **A progression edge case that could loop forever** ([#60]). An entry left with nothing but
  warm-up rows seeded the set-growth loop from a warm-up, which could never satisfy its own exit
  condition. It leaves the entry alone instead. Contributed by
  [@Space-Hermes](https://github.com/Space-Hermes).
- Documented that `VITE_IMG_BASE` / `VITE_GIF_BASE` are build-time values, so setting them next to
  `docker compose` does nothing on a prebuilt image.

[#79]: https://github.com/DuarteSantos8/openGym/issues/79
[#74]: https://github.com/DuarteSantos8/openGym/issues/74
[#60]: https://github.com/DuarteSantos8/openGym/pull/60

## v1.2.5 — 2026-08-04

Nothing in the app itself changed. This release adds an optional side door: a small server that
lets an AI assistant you already run — Claude Desktop, Cursor, Cline — answer questions about
your own training, off the same files your instance already writes. If you don't use one, this
release is invisible to you.

### Ask an AI about your training, without the data leaving your box (#19)

- 🤖 **An MCP server (`mcp/`)** — opt-in, read-only, and not part of the Docker build. Your LLM
  client spawns it as a local process, it reads `./data` directly, and it exits when the client
  disconnects. No new container, no extra auth on the api, no third-party service, nothing over
  the network. *"What did I bench last week?", "what's my estimated 1RM on deadlift?", "which
  muscles have I been neglecting?"*
- **The answers match the Stats screen because they are the same numbers.** The server calls the
  very functions in `frontend/src/lib/` the app already computes with, rather than reimplementing
  them. Eight tools: routines, the week plan, workouts, one session in detail, body weight,
  estimated 1RM and muscle balance.
- **Read-only on purpose.** Logging a workout from an assistant needs a long-lived token the api
  does not have yet, plus a lock against the web UI's read-modify-write. Until both exist, the
  server answers questions and does nothing else. It never reads passkey material, VAPID keys or
  session state — only the profile it was pointed at.
- `docker-compose.yml` is untouched and nothing new enters the image, so an instance that ignores
  this ships exactly what it shipped before. Setup is in [mcp/README.md](mcp/README.md).

### Under the hood

- The pure half of `i18n.js` — the language state, the constants, the readers — moved into
  `i18n-core.js`, so the helpers under `frontend/src/lib/` can be loaded by a plain Node process
  and not only by Vite. `i18n.js` keeps the Vite-only parts (the locale-pack loader, the React
  hook) and re-exports the rest, so nothing that imports it had to change.
- The shared lib modules that only need `t` now take it from the core directly. A Vite-only
  import inside a shared module is invisible under vitest, which transforms it, and fatal to the
  MCP server, which does not — so the shared half stays clear of the bundler half by
  construction rather than by remembering to.
- `npm run check:node-loadable` in `mcp/` walks the server's import graph under a bare `node`,
  which is the one thing the test suite cannot do from inside Vite. CI runs it, alongside the
  MCP tests — neither had ever run there before.

The MCP server was contributed by [@Pengboi](https://github.com/Pengboi) — the first feature in
openGym written by someone other than me. Thank you.

## v1.2.4 — 2026-08-01

The effort ratings you have been recording since v1.2.3 now answer questions, and bodyweight
training stops being treated as barbell training with the weight left at zero. Plus: creating a
profile from Settings works on an invite-only instance, which it never has.

### The effort ratings, read back as statistics

v1.2.3 let you rate how hard a set was. Nothing then read that rating back — it lived in the set
label and nowhere else. Stats now answers the question the number was recorded for.

- 📊 **An Effort card in Stats** over 30d / 90d / 1Y / all time: average effort, the share of sets
  taken close to failure, and — always alongside them — how much of your training was rated at
  all. Rating is optional and off by default, so a partly rated history is normal; an average
  without its denominator would quietly speak for sets you never rated.
- **Week by week.** The weekly average with that week's set count in the tooltip, because the
  pair is the reading: volume up with effort up is fatigue accumulating, volume up with effort
  flat is the adaptation you were training for. Weeks resting on a single rated set are dropped
  rather than drawn.
- **Where the sets land.** The spread across the scale, not just the middle of it. Half your sets
  at failure and half in warm-up territory average out to a healthy-looking number; this is the
  chart that shows it.
- 🔥 **Hard-sets mode on the muscle map.** The same body diagram, counting only sets taken near
  failure — "where did the stimulus go" rather than "where did the volume go". A muscle can lead
  on set count and still never be trained hard.
- **Effort on the exercise curve.** Each session's dot on the top-set chart fills in as less is
  left in the tank, so the same weight moved with more in reserve stops reading as a flat line.
  Exercises with enough ratings also get an Effort curve of their own.
- **One history, whichever scale you use.** Everything aggregates internally in RIR and converts
  back for display, so a history that mixes your own RIR logs with imported RPE averages as one
  series instead of two half-empty ones. RIR charts count downward on the axis, so harder sets
  sit higher.
- Translated into all 12 UI languages.

### Bodyweight training, logged the way it is done

A push-up has no weight to type, and the app asked for one anyway — every set, on a quarter of
the catalogue. Three reports (#31, #32, #33) turned out to be the same gap: the app assumed
progress lived in the load. It doesn't, for the exercises most people actually start with.

- 💪 **Exercises know they are bodyweight.** Seeded from the equipment the dataset already
  records, so push-ups, pull-ups, dips and 300-odd others arrive marked. The weight column is
  not shown, the set row is one stepper instead of two, and the "confirm your working weight"
  prompt at the end of an exercise stops asking about a weight that was never there. (#32)
- **Added weight when there is any.** A dip belt or a weighted vest is entered once in the
  exercise settings and reads as an addition — "+10 × 8", not "10×8" — everywhere it is shown
  back. With load on the belt the normal progression rules take over again, because now there
  is something to add.
- 📈 **Reps and sets are the progression.** Clean session, one more rep. Set a top of the range
  and reaching it adds a set and starts the reps over instead of climbing forever; at six sets
  it says what it should have said all along, which is that it is time for weight or a harder
  variation. No ceiling set keeps the old behaviour exactly. (#33)
- ↔️ **Reps per side.** For lunges, single-arm rows and every other unilateral movement. You
  log what you did — 16, the total — and the app shows the split, "8 per side", so the set in
  front of you is unambiguous without the rep count meaning one thing here and another there.
  The target steps in twos, 16 → 18 → 20, because half of an odd total is a rep one side never
  gets. (#31)
- Both settings travel with a shared plan, and are written to a plan file only when they
  disagree with the catalogue — every existing plan, workout and backup is read unchanged and
  none of it needs migrating.
- Translated into all 12 UI languages.

### Fixed

- **Creating a profile from Settings on an invite-only instance.** The sign-in screen asks for
  the invite code when the server needs one; the same registration reached from Settings never
  did, so it was refused with nothing on screen explaining why. It now asks on the same terms.
- **A long value no longer runs through its own label** in a settings row — "Follow the routine
  (Linear progression)" overlapped "Rule" rather than shortening itself.

## v1.2.3 — 2026-07-31

How hard a set was, in whichever of the two scales you already think in — and the ratings your
old app recorded come across with the rest of your history. Plus: the phone stops locking itself
mid-workout, the rest timer can hand time back as well as take it, and Settings is grouped by
what each thing actually affects.

### The screen stays on while you train

- ☀️ **Keep screen awake — Settings → *During a workout*, on by default.** Locking, unlocking
  and finding your place again between every set was the single most annoying thing about
  logging on a phone. The screen now stays lit for as long as a workout is running and lets go
  the moment you finish it, so nothing is held while you are not training.
- **It survives a tab switch.** Browsers release the lock whenever the page stops being visible,
  which is exactly what happens when you glance at a message. The lock is taken again each time
  the app comes back, rather than dying the first time you look away.
- **It follows the workout, not the screen you are on.** Checking Stats mid-session keeps the
  screen awake.
- **Where it isn't available, it says so.** iOS grants no wake lock in Low Power Mode, and older
  browsers have no Wake Lock API at all — the first is silent, the second shows the row disabled
  rather than offering a switch that does nothing. Needs HTTPS, like every other modern browser
  capability.

### Rest timer: take 15 seconds off, too

- ⏳ **A −15s button next to +15s.** The timer could only ever be extended or skipped outright;
  now it goes both ways. Taking off more than is left finishes the rest rather than counting
  into the negative — the same thing Skip does.
- **Rearranged so three controls fit.** The clock and the progress bar take the top row and the
  controls sit underneath: −15 and +15 together in number-line order, Skip pushed to the far
  edge so the button that ends the rest is not next to the one you tap to buy more time. On a
  wide screen it stays on one line. Tap targets are bigger than they were.
- **The bar is nearly opaque.** The set rows underneath were reading through it and making the
  clock hard to pick out.

### Settings, grouped by what it affects

- **General** (language, units) · **During a workout** (rest timer, keep screen awake, sounds,
  effort per set) · **Notifications** · **Appearance** (theme, body diagram, accent) · **Data**.
- The old grouping mixed axes: "Units & timer" put a display preference next to two workout
  behaviours, language sat under Appearance, and *Load starter plan* was buried between the
  backup actions and the destructive reset. Data now reads in the order you would use it — fill
  the plan, bring history over from another app, restore a backup, export one, wipe everything.
- Nothing was removed and no setting changed its meaning.

### Effort per set: RIR or RPE (#21)

- 🎯 **A third column on a working set, off by default.** Settings → *Effort per set* switches
  it between **Off**, **RIR** and **RPE**. It only appears on weighted rep sets: a plank or a
  treadmill row has nowhere to put it.
- **Two names for the same judgement.** RIR counts the reps you left in the tank; RPE reads the
  same effort off a 10-point scale, so RPE ≈ 10 − RIR. The setting has an (i) that lays the two
  scales side by side in a conversion table rather than explaining them in a paragraph.
- **Each set keeps the scale it was logged with.** Switching the setting changes what new sets
  ask for and nothing else — history is never silently rewritten, and a set logged as RIR 2
  still reads back as RIR 2 years later.
- **An unrated set stays unrated.** Blank and 0 are different things: RIR 0 says the set went to
  failure. So `−` on an untouched cell leaves it empty, `+` starts at the bottom of the scale
  and walks up in even steps, and stepping back off the bottom clears the cell again — a mistap
  is always undoable.
- **Nothing else reads the value.** Progression rules and estimated 1RM are unaffected; the
  rating is yours to look at, not an input to the maths.
- Upgrading keeps the column you had: a profile still carrying the old `showRir` flag — from
  this device, a sync, or a backup restored later — comes across as RIR.

### Import brings your ratings with it

- 📥 **The RPE Hevy and Strong export is no longer dropped.** An `RPE` column is read into the
  set, as is an `RIR` column if a file has one, and the import summary says how many sets
  arrived with a rating — plus where to switch the column on if it's off.
- A blank cell stays unrated rather than becoming 0. A written-out `0` counts as a rating on the
  RIR scale (a set to failure) but not on RPE, which starts at 1 — apps write 0 there to mean
  "nothing here", and reading it as an effort would stamp one on every unrated set in the file.
- Ratings above the scale are capped instead of thrown away, and junk in the column is ignored
  without losing the set.
- Backups already carried both fields and the setting, since a backup is the whole state — there
  are now tests pinning that, so it can't quietly stop being true.

## v1.2.2 — 2026-07-25

Training that moves on its own: an exercise can now be logged by time instead of reps, the
next weight follows a progression rule you choose rather than a single hard-coded hint, and
every lift carries an estimated 1RM. Plus a standalone mobile app, a shareable plan, and an
importer for your history from other apps.

### Timed sets and a timer for the set itself (#16)

- ⏱️ **Reps or time, per exercise.** Planks, hangs, wall sits, dead hangs and loaded
  carries no longer have to be filed under cardio to be timed. Each exercise in a routine
  picks its own mode, and a timed set can still carry weight for a weighted plank or a
  farmer's walk.
- ▶️ **A work timer, separate from the rest timer.** Start a timed set and it counts the
  hold down, beeping and buzzing at zero exactly as the rest timer does, then checks the
  set off itself. The two timers can never run at once — they mean opposite things.
- Finishing a hold early logs **the time you actually held**, not the target. A 38-second
  hold against a 45-second target is recorded as 38 seconds.
- The mode travels everywhere it should: routine editor, workout, history, exercise
  statistics (timed exercises chart their longest hold), the printable plan and the shared
  plan file.
- Plans made before this release are read exactly as they always were — nothing to migrate.

### Progression rules you can read (#17)

- 📈 **Pick a rule per routine, override it per exercise.** Linear progression, **Greyskull
  LP** (two straight sets plus an AMRAP final set, with double jumps and a 10 % reset),
  double progression through a rep range, or adding time for timed work. Or none at all.
- 🧾 **Every target explains itself.** "Every rep last time — 2.5 kg more." "Missed reps
  3 sessions running — reset to 55 kg and work back up." The rule is visible before you
  train, not after.
- The session opens with the right weights already in the rows, instead of suggesting them
  once you are standing at the bar.
- 🚫 **A bad session can't look like a good one.** Short reps count as a miss even when you
  checked the set off; a set you never checked counts as a miss because you did not do it.
  Nothing advances the load on a session that fell apart.
- Stalls and deloads are worked out from your log every time they are needed. Nothing is
  written back into a finished workout and no counters are stored, so fixing a mistyped set
  immediately produces the right next target.
- Lower-body lifts step up in larger jumps than upper-body ones by default, and any
  exercise can set its own step.
- Bodyweight exercises progress in **reps**, because there is no load to add to a push-up
  and no load to take off it either.

### Estimated 1RM (#18)

- 💪 **An estimated one-rep max for every lift**, in the exercise progress card (with its
  own curve you can switch to) and in the exercise detail sheet.
- It always names the set it came from — "from 90 kg × 5 on 15 Jul" — because an estimate
  off a heavy triple and one off a set of ten are very different claims.
- 🧮 **A calculator** for a set you have not done yet, so the number is reachable before
  there is any history.
- Epley by default, and it **refuses to guess above 12 reps**, where the common formulas
  disagree by double digits.
- A new best estimate is reported at the end of a workout separately from a weight PR —
  same weight for more reps is real progress, but it is not a heavier lift.

### Share a plan

- 📤 **Send someone your plan.** Plan → *Share your plan* writes a small file with your
  routines, the week schedule and any custom exercises they use — and nothing else. No
  workouts, no weigh-ins, no settings.
- Importing **merges**: shared routines arrive as new ones with fresh ids, custom exercises
  are matched by name so they are not duplicated, and your own plan is never overwritten.
  Taking the week schedule with it is optional.
- 🖨️ **A printable plan** (Save as PDF) laid out so a single exercise never breaks across
  a page.

### Fixes

- A shared plan file naming an exercise this build doesn't have can no longer take the app
  down. Unknown ids are dropped on import, anything that slips through renders as a
  placeholder you can delete, and an error boundary around the screens means a bad state is
  recoverable by switching tabs instead of reloading.
- Importing from another app converts weights **per row**, not per file. FitNotes writes the
  unit on each set, so a mixed export used to land 185 lb as 185 kg.
- Numbers follow the UI language instead of a hardcoded locale, which was putting Swiss
  apostrophes ("7'535 kg") in front of everyone. Volume stays in your own unit rather than
  switching to tonnes, which was wrong for pound profiles.
- Taking over a week schedule from a shared plan now really replaces Monday–Sunday instead
  of only the days the shared file happened to fill.
- The body-weight slider's ceiling follows your unit (300 kg / 660 lb).
- "Best: 85 Kg" is capitalised correctly again.

### One codebase, two flavors

openGym is also a standalone mobile app — and it ships as a direct APK download, not
through app stores.

- 📱 **Standalone mobile app.** The same frontend now also builds as a native iPhone /
  Android app (Capacitor) — the install-and-done flavor of openGym: no account, no server,
  no sync. Everything stays on the phone.
  - State is mirrored into a file in the app's private storage on every change, so your
    log survives even when the OS evicts WebView storage (iOS does).
  - The workout-day reminder becomes a **native notification** scheduled on the weekdays
    your plan actually has a routine — no push server involved.
  - Backups go out through the OS **share sheet** (Files, AirDrop, mail…).
  - Exercise images/animations load from the same CDN as the live demo.
  - `npm run build:mobile`, then open `android/` in Android Studio or `ios/` in Xcode —
    see **docs/MOBILE.md**. `NOTICE.md` now carries an AGPL §7 app-store exception.
- 🤖 **Android APK, no Play Store.** The official build is a signed, sideloadable APK
  (~4.5 MB) from [opengym.duarte-santos.ch](https://opengym.duarte-santos.ch) — deliberately
  store-free. docs/MOBILE.md covers building and signing your own.
- 🍎 **iOS reality check.** Apple permits no installs outside the App Store, so there is no
  iOS download; the docs explain the free options (self-hosted PWA on the home screen, or
  running the native app onto your own iPhone from Xcode).

- 📥 **Import your history from another app.** Settings → Data → *Import from another app*
  reads an export from **FitNotes** (both the Android and the FitNotes 2 iOS format),
  **Strong** and **Hevy**, and pulls body-weight history out of an **Apple Health** export.
  Anything else with a date, an exercise name and weight/reps columns is read too.
  - Every row becomes a set, grouped into workouts by date, so your history arrives with
    its real dates rather than as one lump. Hevy and Strong also carry session length, so
    the activity heatmap fills in properly.
  - Exercise names are matched against the 1,324-exercise library — parenthetical
    qualifiers like "(Barbell)" and shorthand like BB/DB are normalised, and a curated
    table covers the plain names people actually log ("Bench Press", "Squat", "RDL").
    Where a name is genuinely ambiguous it is *not* guessed at: it becomes one of your own
    exercises instead, because filing years of training under the wrong lift is worse than
    an unmatched name you can see and fix.
  - A summary shows what will happen — workouts, sets, how many exercises matched, which
    ones didn't, and whether weights need converting — before anything is written.
  - Importing is idempotent: days you already have data for are left alone, so running it
    twice, or importing from two apps, never duplicates a workout.

## v1.2.1 — 2026-07-23

A muscle map across the app, and a live demo you can try without installing anything.

- 💪 **Muscle map.** Three places now show which muscles your training actually reaches, drawn on a
  front-and-back body diagram shaded like the activity heatmap — more accent means more work.
  - **Stats → Muscle balance** aggregates a week, 30 days, 90 days or everything, lists your
    hardest-worked muscles with their set counts, and names the ones that got *nothing* in that
    period. That last list is the point of the card: the gaps are what you'd otherwise never notice.
    Tap any muscle to read its name and volume.
  - **Routine editor** previews what a session hits as you build it, so a hole in the plan shows up
    before you train around it for a month.
  - **The finish screen** shows what you just trained.
  - Load is counted in *effective sets* — a set counts fully for the exercise's target muscle and
    partially for its supporting ones — not in kilograms, because 100 kg of leg press and 12 kg of
    lateral raise say nothing about which muscle worked harder. Shading is relative within the
    period you're looking at, so the map always reads as a balance rather than an absolute.
  - Settings → Appearance → **Body diagram** switches between a male and female figure.
  - The exercise dataset spells muscles inconsistently ("delts", "deltoids" and "shoulders" are one
    muscle); all 50 spellings it uses are normalised onto the 18 the diagram can draw. Custom
    exercises, which only carry a body part, fall back to it. The geometry is ~90 kB and loads on
    demand, so the initial bundle is unchanged.
- 🐛 **Fixed: finishing a workout from its last exercise could blank the whole app.** The
  per-exercise weight sheet read the running workout without checking it was still there, and
  finishing clears it while that sheet is still on screen.
- ▶️ **Live demo** at [duartesantos8.github.io/openGym](https://duartesantos8.github.io/openGym/) —
  a browser-only build (`VITE_DEMO=1`) published to GitHub Pages on every push to `main`. It boots
  into guest mode with a seeded example profile (12 weeks of Push/Pull/Legs, weigh-ins, PRs) so
  every screen has something to show, and it never talks to a server. Passkeys, sync and the admin
  dashboard stay exclusive to self-hosted instances, which is where the backend lives.
- 🖼️ Builds can point the exercise media elsewhere via `VITE_IMG_BASE` / `VITE_GIF_BASE` — the demo
  serves the ~140 MB dataset from a CDN instead of shipping it. The default (`img/` and `gif/` next
  to the app) is unchanged.

## v1.2.0 — 2026-07-23

A complete visual redesign. Same app, same data — every screen redrawn.

### A designed interface, not an assembled one

- 🎨 **Rebuilt design system.** One type scale carrying hierarchy through size instead of making
  everything bold, a neutral surface ramp instead of saturated blue-greys, hairline separators
  instead of outlined boxes, and motion that acknowledges a press rather than animating for
  decoration. Light and dark are both first-class, and the eight accent colours now pick their
  label colour by measured contrast — the default green in light mode was failing WCAG AA on
  every primary button before.
- ✏️ **A hand-drawn icon set** (77 icons, single stroke weight, drawn on one 24×24 grid) replaces
  every emoji in the interface. Emoji render differently on each platform, sit on their own
  baseline and can't take a theme colour, which is what made the old UI feel stitched together.
  Icons inherit the surrounding text colour and optical size.
- 🏋️ **Routine icons.** Picking an icon for a routine now offers a grouped set — strength,
  equipment, cardio, recovery — instead of an emoji keyboard. Routines you already made keep
  their look: the old emoji are mapped forward automatically, so nothing to migrate and nothing
  to redo.
- ▶️ **New tab bar** with a raised Start button that turns into a pulsing orange Resume while a
  workout is running.
- 🏠 **Home reads as a plan for today** — week strip, today's session as one tappable row, body
  weight, and your streak.

### Charts

- 📈 **Axis labels, gridlines and the target-weight line are visible again** in dark mode. They
  were painted with colour variables that no longer existed, which silently fell back to black
  on black — and to no stroke at all for the lines.
- 💬 **The hover readout stays on screen.** It used to be positioned with a fixed offset that
  assumed one label width, so the first and last point pushed it under the chart's clip; it's now
  placed from its measured size and kept inside the frame, dropping below the point when the
  point sits high enough that the label would cover the value it reports.
- 🖱️ **It also goes away again** — moving off the chart now clears the readout, crosshair and
  marker, which previously stayed until you hovered somewhere else.

## v1.1.3 — 2026-07-22

Admin dashboard for self-hosters (opt-in — off by default), equipment filtering, and
workout-screen fixes.

### Admin dashboard

- 🛠️ **Admin dashboard** (Settings → Admin dashboard) for whoever runs the instance: a users
  overview with workout counts and last-active times, plus a per-user drill-down into their full
  workout history and body-weight log.
- 🟢 **Live "training now"** — see who's mid-workout in real time, with their current exercise and
  set progress, updated by a lightweight heartbeat while a workout is on screen.
- 🚫 **Disable / enable accounts** — a disabled account is signed out and locked out everywhere
  until you re-enable it.
- 🔑 **Invite-only signup** (optional) — require an invite code to create a profile; generate and
  revoke codes from the dashboard. Existing accounts are unaffected.
- ⚙️ Configured via environment: `ADMIN_UIDS` (comma-separated user ids who are admins) and
  `INVITE_ONLY=1`; both default off, so a fresh instance stays open with no admin. See
  `.env.example`. Admin access is gated by your passkey and enforced server-side.

### Exercises & workout

- 🏋️ **Filter exercises by equipment** (#6). A second filter row under the body parts lets you
  narrow the list to what you actually have — body weight, dumbbell, barbell, cable, band, and so
  on — in both the Exercises library and the exercise picker. The options adapt to what you've
  already selected and are ordered by how many exercises use them, so every combination on screen
  has results behind it and the row stays short. Building a bodyweight-only plan is now two taps
  per body part.
- 🔎 **Minimize the exercise animation during a workout** (#12). A ⤡ Minimize / ⤢ Expand button
  on the animation shrinks it to a thin strip so the set rows sit right under your thumb — no more
  scrolling past a big GIF to tick off a set. Your choice is remembered and applied to every
  exercise and future workout until you change it, so you set it once. Tapping the animation still
  pauses/plays it as before.
- ⏱️ **Fixed: the rest timer froze at 0:01** (#14) instead of counting down to the end. It also
  meant the timer could only be cleared with Skip, and a redundant "rest over" push notification
  could still fire.

## v1.1.2 — 2026-07-22

Custom exercises, full localization, and input fixes.

### Custom exercises (#11)

- ✨ **Create your own exercise** from the exercise picker or the Exercises tab: a name and a
  body part is all it takes. Your search text is pre-filled as the name, so "no match" flows
  straight into "create it".
- 📝 **Optional description** — setup, cues, anything you want to remember. It shows on the
  exercise's detail and config sheets (where a built-in exercise would show its animation),
  and it's searchable, so you can find your own exercises by their cues too.
- 🏋️ Custom exercises behave like built-in ones everywhere — routines, supersets, workout
  logging, weight suggestions, PRs, stats and history. The animation stays blank by design.
- 🏃 Pick the *cardio* body part and it logs time + speed instead of weight × reps, like the
  built-in cardio exercises.
- ✏️ Edit (rename, change body part or description) or delete your custom exercises — from
  their detail sheet in the Exercises tab, or straight from the exercise inside a routine via
  "Edit or delete this exercise". Deleting removes them from your routines; already-logged
  workouts keep their sets and still show the exercise name. (The routine sheet's old "Remove
  exercise" button is now labelled "Remove from routine", so the two are no longer confusable.)

### Localization (#7)

- 🌍 **12 UI languages**: English, Deutsch, Español, Français, Italiano, Português, Polski,
  Türkçe, Русский, 中文, 한국어, हिन्दी. Pick yours under Settings → Appearance → Language;
  the choice syncs with your profile like the theme does.
- 📖 **Localized exercise instructions** for 10 of those languages (all except German and
  Portuguese, which the upstream dataset doesn't cover yet — those fall back to English),
  covering all 1,324 exercises. Body-part filters, equipment and muscle tags are translated
  too; exercise *names* stay English (upstream limitation). Custom exercises are translated too.
- 📅 Dates, weekday and month labels follow the selected language.
- ⚡ Zero cost when unused: the app still ships English-only by default. Each UI language is a
  ~7 kB chunk and each instruction pack ~80–120 kB (gzipped), downloaded only when you switch —
  the initial bundle size is unchanged.
- 🛠️ New `scripts/build-instructions.mjs` regenerates the instruction packs from the upstream
  dataset; translations live in `frontend/src/locales/` (PRs welcome — it's one flat
  English-string → translation map per language).
- Known gaps: push notification texts (sent by the server) and plural forms in some languages
  are approximated; happy to take corrections from native speakers.

### Fixes

- ⌨️ Weight and other numeric fields now accept a comma as decimal separator ("33,5") — iOS
  decimal keyboards in many locales only offer a comma, which previously reset the field to 0.
  Partial input like "33," no longer snaps to 0 while typing. (#13)
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
