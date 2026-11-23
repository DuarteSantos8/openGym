# My openGym fork: AI Coach on Claude and a local model

This fork of [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym) runs the AI Coach
on two models side by side:

- **Claude** (Anthropic API) for the best plans and reviews, billed to my own API key.
- **A local model on Ollama** for everyday use, free, and nothing leaves my network.

Both are built into openGym already (`api/coach/core/providers.js`). This fork adds a one-file
Ollama add-on (`docker-compose.ollama.yml`) and this guide.

---

## Why run it yourself instead of just downloading the app?

| | App Store / Play download | This fork, self-hosted |
|---|---|---|
| **Cost** | Free app; the Coach needs your own provider key either way | Free. The local model costs nothing per request |
| **Which AI** | Whatever you set up on the phone | Any provider openGym supports, switched per week if I like: Claude, Ollama, OpenAI, Gemini, OpenRouter… |
| **Privacy** | Data on the phone; Coach requests go to the provider you pick | With Ollama, Coach requests are answered by a model on my own server, so no AI provider sees my training data. Workouts and heart rate still sync from a paired phone to my server, including over the internet if I make the server reachable from outside |
| **Sync** | One device, or someone else's server | My own server: phone, Watch and browser all synced, data in a `./data` folder I back up |
| **Change it** | No | Edit the Coach's prompts (`api/coach/prompts`), progression rules (`frontend/src/lib/progression.js`), fatigue model (`frontend/src/lib/recovery.js`), rest timers, exercises |
| **Verify it** | Trust the binary | Read every line (AGPL-3.0) |
| **Updates** | Automatic | I pull from upstream when I choose (see the end of this page) |

The honest downside: I run a small server (any PC, NAS or Raspberry Pi with Docker), and I
update it myself.

---

## 1. Start the server

```bash
git clone https://github.com/Reaper1994/openGym.git
cd openGym
cp .env.example .env
```

In `.env`, set `FIRST_USER_ADMIN=1` **before** creating your first profile, so you can open the
admin dashboard where the Coach is switched on.

```bash
docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d --build
```

`--build` builds the api and web containers from this checkout, so the fork's own code runs
instead of the upstream images.

Open http://localhost:8080 and create your profile.

## 2. Add the local model (Ollama)

Pull a model that fits the machine. On a 4–6 GB box without a GPU, a small one is faster than a
big one that thrashes:

```bash
docker compose -f docker-compose.yml -f docker-compose.ollama.yml exec ollama ollama pull qwen2.5:3b
```

With a GPU or more memory, try a bigger model such as `qwen2.5:14b` or `llama3.1:8b`.

In the app: **Settings → Account → Admin dashboard → AI Coach → Set up the Coach**

1. Pick **OpenAI-compatible endpoint**.
2. Press **Find Ollama or LM Studio** (or type `http://ollama:11434`). No API key.
3. **List models**, pick the one you pulled, then **Test the Coach**.

## 3. Add Claude

1. Create a key at https://platform.claude.com/settings/keys.
2. On the same AI Coach card, pick **Anthropic API** and paste the key. It is stored encrypted
   in `./data/coach.json`, never in `.env` or git.
3. **List models**, pick one (Sonnet is a good price/quality balance), then **Test the Coach**.

## 4. Switch between them

Each chip on the card keeps its own key and model, so switching never loses a setting:

- **Ollama** for day-to-day reviews: free and private.
- **Claude** when you want a new programme designed or a deeper review.

Turn the master switch on, then open **Plan → menu (top right) → Coach**.

To use the server's Coach on the iPhone (and so on the Apple Watch), pair the phone first:

1. In a browser signed in to the server: **Settings → Account → Pair the mobile app**. It shows a
   one-time code, valid for 5 minutes.
2. On the phone: **Settings → Account → Connect to my server**, then enter the server's address
   and the code. Use `https://` where you can; on your home network a plain `http://` address
   with the computer's IP and port works too, for example `http://192.168.1.20:8080`.
3. On the phone: **Settings → AI Coach → Use my self-hosted openGym.** The iPhone and Apple Watch
   now get whichever model the server is set to.

Details and troubleshooting: [MOBILE.md, "Connecting the app to your own server"](MOBILE.md#connecting-the-app-to-your-own-server).

## 5. Customise

| What | Where |
|---|---|
| The Coach's instructions and tone | `api/coach/prompts/`, `api/coach/core/system-prompt.js` |
| What the Coach is allowed to see | In the app: **Coach menu → What the Coach sees** |
| How weights go up | `frontend/src/lib/progression.js` (tests next to it) |
| Muscle fatigue and recovery | `frontend/src/lib/recovery.js` |
| Warm-ups | `frontend/src/lib/warmup-ramp.js` |
| Apple Watch app | `frontend/ios/` (Watch, WatchCore, WatchWidgets) |

After a code change, run the same `up -d --build` command again.
For the iPhone/Watch app, see `docs/MOBILE.md` (needs a Mac with Xcode).

## What about Jev (TypeSafe)?

Jev doesn't fit the Coach. It is a *decision* model: it answers typed yes/no, choice and score
questions with a confidence, and has no chat endpoint. The Coach needs a model that writes a
full training plan, so it can't be one of the Coach providers.

It could later handle small, quick decisions, such as "is this muscle group recovered enough to
train today?" with a confidence score. That would be a new feature with its own code, not a
setting.

## Keeping up with the original project

```bash
git remote add upstream https://github.com/DuarteSantos8/openGym.git
git fetch upstream
git merge upstream/main
```
