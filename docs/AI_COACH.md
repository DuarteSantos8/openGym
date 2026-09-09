# The AI Coach

An optional AI that **designs** a training plan and **revises it from what you actually log**,
running on your own server under your own provider account, off until an admin turns it on.

> This document grows with the feature, which lands across a sequence of PRs. Anything described
> here that has not reached your instance yet is visibly absent rather than broken — the Coach
> only appears at all once an admin has enabled it and a runtime can be reached.

---

## Two kinds of provider

The Coach can be driven by two kinds of thing, and which kind you pick decides how much of the
rest of this document applies to you.

| Provider | What runs | Credential | Image |
| --- | --- | --- | --- |
| **Anthropic API** | plain HTTPS to `api.anthropic.com` | an API key | default |
| **OpenAI API** | plain HTTPS to `api.openai.com` | an API key | default |
| **Google Gemini** | plain HTTPS to `generativelanguage.googleapis.com` | an API key | default |
| **OpenAI-compatible endpoint** | plain HTTPS to a URL you give it — Ollama, LM Studio, vLLM, OpenRouter, a gateway of your own | an API key, optional | default |
| **Claude (Anthropic)** | the Claude Agent SDK, inside the container | a `claude setup-token` | `coach` |
| **Codex (OpenAI)** | the Codex CLI, inside the container | Codex's own device sign-in | `coach` |

The first four spawn nothing. A job is one HTTPS request from the api process, so there is no
child process to drop privileges on, no runtime to carry in the image, and nothing to install:
**they work on the image every instance already has.** The `coach` image, the unprivileged
`coach` user and the `./coach-auth` mount described further down exist for the last two only.

A model on your own LAN is the compatible endpoint with no key: point it at
`http://ollama.lan:11434` and pick a model from the list it serves. That is the whole
configuration.

## Turning it on

Nothing here is an environment variable or a restart — the whole point of the admin card is that
enabling the Coach is a decision you make in the app.

### With an API key (Anthropic, OpenAI, Gemini, compatible)

**1. Get a key** from the provider's own console. For a compatible endpoint, get the URL it
answers on instead, and a key only if it wants one.

**2. Connect it.** In the app: **Settings → Admin → AI Coach**.

- Toggle the card on.
- Pick the provider chip.
- For a compatible endpoint, enter the **Endpoint** — `http://` or `https://`, no username or
  password in it, no query string. The host is written into the job log so you can see where
  jobs went.
- **Use an API key** → paste it. It is encrypted into `./data/coach.json` and is never shown
  again.
- **List models** asks the endpoint what it serves and turns the model field into a picker.
  Each provider has a starting default (it is in `api/coach/core/providers.js`, and it is a
  starting point, not a pin — names go stale, the list does not); the compatible endpoint has
  none, because it serves whatever you put behind it.
- **Test the Coach** — a real round trip with no user data anywhere near it.

The card says two things worth reading: which account is being spent, and — for these
providers — that jobs run no child process at all, so the privilege-drop line reads as not
applicable rather than as a problem.

**3. Use it.** Each person opens **Plan → AI Coach**, agrees to the consent screen — which lists
exactly what leaves the server, generated from the same module that builds payloads — and
answers a short intake, one question per screen: goal, experience, days per week, session
length, equipment, limitations. From then on the Coach is a chat. The answers are its first
message; while a job runs a typing bubble shows the elapsed time; the proposal arrives as a
card with a tab per routine and a reason under every change; free text below it asks for a
refinement, a button applies it. Coming back later, asking for a review of what was logged
since, or changing an answer all happen in the same conversation. Users cannot switch the
Coach off themselves — only the admin can, from the card above.

A key, a model and the account binding described below belong to the provider they were
entered for. Switching chips does not clear them: the Anthropic key is still there when you
come back from trying Gemini, and each chip shows a mark when it holds one.

#### Picking and changing models

The model field is never a guess: **List models** asks the endpoint what it actually serves.
For an Ollama box that means the admin decides what exists — `ollama pull` anything the
hardware can hold and it appears in the picker on the next refresh; nothing in openGym pins
you to a blessed list. The choice is remembered **per provider**, so trying a cloud model for
a week and coming back to the local one restores exactly what was set before.

#### Performance on a small box

The Coach's rules ride as a byte-identical system prompt, so a llama.cpp/Ollama endpoint can
keep them in its prefix cache and only ever re-process the payload — and the api warms that
cache itself at boot and every half hour, so the expensive first read happens off everyone's
clock. Measured on a 4-core, no-GPU VM with `qwen2.5:3b`: a review costs about **a minute**
warm, versus ~8 minutes before the cache and slimmer payload existed. Three things keep it
that way:

- `OLLAMA_KEEP_ALIVE=-1` and `OLLAMA_NUM_PARALLEL=1` on the Ollama side — an unloaded model
  takes its cache with it, and parallel slots split it.
- Give the container room. A ~3B model at Q4 lives happily in 4 GB; a 4B model squeezed into
  the same limit does not fail, it *thrashes* — weights fall out of the page cache and
  generation drops to ~1 token/s. On a 4–6 GB box, smaller and comfortable wins.
- The endpoint is sent a **JSON schema** with each request (structured outputs), so the shape
  of the answer is enforced while it is generated and the repair round is rarely needed.
  Servers that reject schemas get plain JSON mode automatically, then no JSON mode — the
  validator is the gate either way.

### With a runtime in the container (Claude Agent SDK, Codex CLI)

**1. Build the image that has an AI runtime in it.** The default image deliberately has none:

```bash
API_TARGET=coach docker compose up -d --build api
```

`--build` matters. With a prebuilt `image:` also set, compose would otherwise pull the default.

**2. Get a credential.** On a trusted machine where you already use Claude Code:

```bash
claude setup-token
```

Complete its normal browser sign-in and copy the token it prints. openGym never opens or handles
that flow — it only ever receives the finished token. (Claude also accepts an Anthropic API key
here, under the same chip; the setup token is the route for a Claude subscription.)

**3. Connect it.** In the app: **Settings → Admin → AI Coach**.

- Toggle the card on.
- Pick the **Claude (Anthropic)** provider chip.
- **Add CLI token** → paste the token, and optionally label whose account it is (that label is
  what both the admin card and each user's Coach screen show when they name the account).
- **Test the Coach** — a real round trip through the provider with no user data anywhere near it.
  It reports the runtime version on success, and the provider's own error on failure.

The card also states two things worth reading before anyone uses it: whether jobs actually run
unprivileged, and which account is being spent.

**4. Use it** — as above.

> **On a multi-profile instance, read [Whose account pays](#whose-account-pays) first.** An API
> key is shared by every profile under the daily limits. A *personal* credential — a Claude Code
> setup token — binds to the first profile that spends it and **every other profile is refused**,
> by design: that is the right behaviour when one person's personal subscription is behind it.

### A debrief of one workout

**Review my last workout** (in the chat menu, or the chip above the composer) sends the Coach
one session — as logged, with the last three times the same routine was trained, the stall
picture for its exercises and four weeks of weigh-ins — and gets back a reading, not a plan: a
score out of ten, what went well, what to watch, and what to do next time, each item citing the
session's own numbers. A debrief cannot carry a change; an answer that tries is refused by the
validator rather than trimmed. The card is kept in the Coach's history like everything else.

### Comparing with others on the instance

Off unless the admin turns it on (**Settings → Admin → AI Coach → Advanced → Let people compare
with each other**), and then still off for each person until they opt in themselves (**Compare
with others here → Include me** in the Coach chat). The trade is symmetric: a profile that does
not share sees nothing.

What is shown is coarse on purpose — a median across everyone sharing for sessions per week and
for the best estimated 1RM per exercise, next to the person's own number, plus where they rank.
An exercise appears only when three or more people train it, and nothing appears at all until
three people share. Never a name, a body weight, a date or a single session. The same compact
medians (always in kilograms) ride along in the payload of a review or a debrief when both
switches are on, with the prompt told to use them for perspective only. The opt-in lives in the
server's own per-profile record, not in synced state, so a stale device cannot flip it back on;
switching it off removes the person from the next computation immediately.

## Whose account pays

This is the first thing to settle, because it decides what the rest of the feature is allowed
to be. The Coach spends a real provider account, and there are two shapes:

| Mode | Credential | For |
| --- | --- | --- |
| **instance** | one account, stored encrypted in `coach.json` | the single-profile instance most people run |
| **profile** | one account per profile, in its own `coach-auth-<uid>.json` | anything with more than one profile |

In instance mode it depends on what kind of credential was pasted:

- **An API key** (Anthropic, OpenAI, Gemini, an OpenAI-compatible endpoint) is shared by every
  profile on the instance. It is metered, issued for exactly this kind of use, and the daily
  limits in the admin card are what bound what it can spend. This is the shape a household or a
  small gym wants.
- **A personal credential** — a Claude Code setup token or an OAuth login — **binds to the first
  profile that spends it**. Any other profile is refused:

> This instance is configured with a single shared account — ask your admin to enable
> per-profile sign-in.

No job runs. That is a refusal, not a warning, on purpose — a warning moves the decision onto
whoever clicks past it, and the decision is about spending somebody else's personal
subscription. It is the same posture the payload allowlist takes.

**The instance owner is responsible for their provider's terms.** openGym does not interpret
them on a self-hoster's behalf; it makes the shape that doesn't need the interpretation
available, and refuses the shape that does.

A profile credential lives in its own file, `0600`, never in `state-<uid>.json` — profile state
syncs across devices and travels in the user's JSON export, and a credential that rides along in
a backup is the same class of mistake as a token inside the directory the README tells you to
archive.

## What actually leaves your server

`api/coach/payload.js` is built as an allowlist: every field is copied in **by name**, nothing
is spread and nothing is passed through, so a field added to the state blob next year cannot
ride along by accident. The five categories it can send — the same list the consent screen
renders from, so the screen cannot drift from the payload — are:

| Category | What it covers |
| --- | --- |
| `plan` | routines, exercises, sets/reps, schedule, progression settings |
| `training` | logged sets, targets, effort ratings, durations, PRs in the review window |
| `bodyweight` | weigh-ins in the window and your goal weight |
| `profile` | the intake answers you gave the Coach, including any limitations |
| `cohort` (optional) | only with comparison on and your own opt-in: anonymous medians from the other people sharing — never their data, and never yours to them beyond the same medians |
| `prefs` | unit, language, effort scale |

A review reads a training block, not a training career: the window is capped at **12 weeks or 60
sessions**. Your profile is identified by a stable pseudonym that is never the user id and never
reversible.

Excluded on purpose and permanently: **display name and user id, passkey and credential
material, push subscriptions, invite data, theme and appearance settings, and every other
profile's everything.**

## Bodyweight and per-side work

Upstream v1.2.4 taught the app that a push-up carries no load and a lunge is logged as a total
across both sides. The Coach has to know the same things, because on a bodyweight exercise
`weight` means *added* load and is `0` on a perfectly good session — so every load-shaped signal
reads flat. A Coach that couldn't see this would look at a working push-up progression and
propose adding weight to a push-up.

So the payload carries `bodyweight`, `side` and `repsMax`, the session reader carries the set
count (the dimension bodyweight work grows once reps hit their ceiling), and the prompts say
that reps and then sets are the progression, and that per-side targets step in twos.

The server re-implements three reading rules the frontend owns — `modeOf`, `isBw`, `isPerSide` —
because the api image has no build step in common with the frontend. `coach-parity.test.js`
pins them against the originals over a table of configs, so the copies cannot drift silently.

## What comes back, and what it is allowed to do

The prompt asks for a shape and the model usually obliges. `api/coach/validate.js` is where
"usually" stops mattering, and it — not the prompt — is the security boundary. Nothing reaches
you that has not:

- **matched the closed list of change types.** Eighteen of them, each with an apply
  implementation on the client to match. A hostile note in your own free text can talk a model
  into saying anything at all; it cannot invent a change type, and a change type that is not on
  the list does nothing. There is no default case anywhere.
- **resolved against the real exercise library.** An id nobody has invalidates the whole
  proposal rather than being quietly dropped into a plan that renders blank the first time you
  train it.
- **hit something that exists.** Every target names a routine in your plan, and anything about
  an exercise names one that is actually in that routine.
- **cited its evidence.** A change with no `why` is refused.

A rejected answer gets **one** repair round, with the errors handed back verbatim. Two failures
is a provider problem rather than a prompting problem, and a retry loop against a paid account
is a bad way to find that out.

A job is given five minutes by default, which is generous for any hosted API. A model running
on a CPU behind the compatible endpoint can need more — with a warm cache a 3B model answers
in one to a few minutes depending on the CPU (an old 4-core box manages ~12 prompt tokens/s;
a modern one several times that), but the first job after the model loads pays the full
prompt once — so
`COACH_JOB_TIMEOUT_MS` in `.env` raises the budget (never below one minute); the api's own
HTTP client waits as long as the job, and the chat says "this can take a while" rather than
promising minutes when the endpoint is a local one. The phone's BYOK mode does the same on
its own: a local endpoint gets 25 minutes there.

The Coach may only touch **routines and the week**. Your training log, your weigh-ins and your
settings are not reachable from any change type that exists.

Applying happens **on the client**, not the server — ordinary local editing, so it works
offline, syncs like everything else, and stays reversible without the server knowing. Every
apply takes a snapshot of `{routines, week}` first, so one tap puts the plan back; workouts are
deliberately untouched by a revert, because the log is what happened. A change-set is
all-or-nothing: a failure part-way through discards the whole draft rather than leaving a
half-applied proposal.

Proposals carry a fingerprint of the plan they were computed against. If the plan has moved
since — you edited it on another device, or changed by hand the exact thing a change is
about — that change is shown greyed out with the reason, and cannot be applied. Silently
overwriting an edit you made yourself would be the worse failure.

## Isolation

This section is about the two providers that run a runtime inside the container. The HTTPS
providers run nothing: a job is one `fetch` from the api process, the adapter says so
(`spawns: false`), and the gate below asks the adapter rather than assuming — so an instance on
a host with no `coach` user still gets the Coach through an API key, and is only refused the
runtime-backed providers. The admin card reports "this provider runs no child process" in the
place it would otherwise report the drop.

For Claude Agent SDK and Codex jobs run as an unprivileged `coach` user that cannot read the files holding secrets, with an
environment built from nothing rather than filtered from the parent — no `RP_ID`, no
`ADMIN_UIDS`, no VAPID material.

That privilege drop **fails closed**: on Linux, if it cannot be performed, no job is enqueued
and the admin card says so. It used to fail open — it only engaged when the server ran as root,
so adding an ordinary `USER` line to the Dockerfile, for unrelated hardening reasons, would have
quietly left the runtime inheriting the server's uid. A control that switches itself off during
somebody else's refactor is one you find out about late.

The secrets are locked file by file — `secret`, `db.json`, `coach.json` at `0600` — rather than
by sealing `./data` with a blanket `0700`. The directory is a host bind mount and the container
runs as root, so sealing it lands on the host as root-owned and unreadable, and anything else
the owner runs against their own data directory gets `EACCES`.

## You only carry the AI runtime if you ask for it

The HTTPS providers need none, and run on the `default` image below — so as of this release
the `coach` target is only for an owner who specifically wants the Claude Agent SDK or the
Codex CLI. Everything else in this section is about those two.

`api/Dockerfile` builds two targets from one file:

- **`default`** — what every instance has always had. `npm ci --omit=optional` skips the Agent
  SDK and its platform runtime entirely, so an owner who never wanted the Coach ships none of it.
  Around 158 MB.
- **`coach`** — the same image plus `@anthropic-ai/claude-agent-sdk`. Around 455 MB.

```
docker build --target coach ./api          # or:
API_TARGET=coach docker compose up --build api
```

The SDK sits in `optionalDependencies`, and its runtime ships as a per-platform package — this
base is Alpine, so the lockfile resolves `linux-x64-musl` / `linux-arm64-musl`. That resolution
is the sort of thing that only fails on somebody else's machine, so CI builds **and runs** both
targets: the default one has to boot and serve `/api/config` with the SDK genuinely unimportable,
and the coach one has to report a runnable SDK through the same `check()` the admin card renders.

An absent runtime is an ordinary state, not a crash: the adapter imports the SDK lazily, `check()`
says it is missing, `isConnected()` goes false, and `/api/config` carries no `coach` key at all.

Both targets create the unprivileged `coach` user. That is not a Claude-specific detail — the
privilege drop fails closed, so without that user *every* job is refused, including the fixture
provider that exists precisely so the loop can be walked before an account is connected.

## What the model is allowed to do

The Claude provider runs through the Agent SDK rather than a hand-rolled CLI call, because the
SDK exposes the switches that matter and brings its own matching runtime. Four of them are the
reason it can be trusted next to your `./data`:

| Option | Effect |
| --- | --- |
| `tools: []` | Disables **all** built-in tools — no Read, no Bash, no Grep. The model has no filesystem tool at all, however it is prompted. |
| `settingSources: []` | No user/project/local settings file is loaded, so nothing on the host can widen the line above afterwards. |
| `skills: []` | Same, for skills. |
| `strictMcpConfig` | No MCP server can arrive from ambient configuration. |

They are exported as one frozen object and asserted by value in `adapters.test.js`, so
re-enabling one is a red build rather than a quiet capability grant.

The credential reaches the model process as an environment variable and by no other route. The
job environment is built from nothing rather than filtered, and the SDK's `env` option *replaces*
the child environment rather than extending it — so `RP_ID`, `ADMIN_UIDS` and the VAPID keys
cannot reach it by inheritance even by accident.

## Where a credential lives

Everything a provider owns — its credential, its model, and in instance mode the profile its
credential bound to — is stored **per provider** in `coach.json`, so switching providers never
throws a key away. An instance upgraded from an earlier build, where the file held one flat
credential and one model for whichever provider was selected, has them lifted onto that
provider the first time the new server reads the file. This is one-way: a downgrade will not
read the maps back, and costs one paste of the key.

Three shapes, because the providers work differently:

- **The HTTPS providers** hold an API key, encrypted with the instance secret into
  `coach.json`, and hand it to the request as a header — `x-api-key`, `Authorization: Bearer`
  or `x-goog-api-key`, never a query parameter, so it stays out of proxy logs and error
  messages. It is inside `./data`, so it *is* in the documented backup; without `./data/secret`
  the blob is undecryptable, which is the same protection every other credential there has.

- **Claude** takes its credential on the environment, so nothing is written to disk beyond the
  encrypted blob in `coach.json` — it reaches the model process as `CLAUDE_CODE_OAUTH_TOKEN` (or
  `ANTHROPIC_API_KEY`) and by no other route.
- **Codex** keeps a refreshable sign-in cache of its own, so it needs somewhere durable to write.
  That is `./coach-auth`, mounted at `/coach-auth`, owned by the `coach` user, mode `0700`.

`./coach-auth` is a **sibling of `./data`, never a folder inside it**, and that placement is the
whole point. §5 of `docs/SELF_HOSTING.md` tells owners to back up with `tar czf … data/`.
Anything under `./data` is therefore in every backup archive people are instructed to produce —
and unlike workout history, a refresh token keeps working after that archive is copied to a
laptop or a cloud drive. Keeping the cache outside `./data` is what lets the backup instructions
stay true about what they capture.

Per-profile credentials follow the same rule for the same reason: they live in
`coach-auth-<uid>.json` at mode `0600`, never in the synced state blob, so they cannot ride along
in a device sync or in a user's own JSON export.

## On the phone

The App-Store build has no server of its own, so the Coach there is a choice made in
**Settings → AI Coach**, and until it is made nothing AI-related is loaded at all:

- **Use my self-hosted openGym.** Pair the phone with your instance (the same pairing flow as
  syncing — **Settings → Pair the mobile app** on the site, then the address and code on the
  phone). A paired phone is an ordinary profile: the Coach runs on your server with whatever
  provider the admin configured, under the rules above, and nothing on the phone changes.
- **Bring my own API key.** The phone calls Anthropic, OpenAI, Gemini or a compatible endpoint
  directly, with a key you paste. It runs the same payload allowlist, the same validator and
  the same single repair round as the server, in the app. The key is kept in the platform's
  secure storage — Keychain on iOS, the Keystore-backed store on Android — and never in the
  app's state, so it cannot ride along in a backup, an export or a sync. You pay: the screen
  says which host each request goes to and what leaves the device before you choose, and a
  local daily cap stands in for the one an admin would have set.

## Off is really off

`COACH_DISABLED=1` forces the Coach off everywhere regardless of what is stored — the fleet
operator's kill switch. With the Coach off, `/api/config` carries no `coach` key at all, so no
Coach UI exists anywhere in the client.

## Health

The Coach programs training; it does not practise medicine. It is told never to diagnose, to
stay conservative when someone describes pain rather than soreness, and to recommend a
professional. **It is not a doctor or a physiotherapist. If something hurts, ask one.**
