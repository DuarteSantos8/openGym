# Integrations

Settings → **Integrations** is one page for everything openGym can talk to. It is short on purpose:
a card only shows where it can do something on your device, and nothing on it does anything until
you switch it on.

| Card | Where it works | What it does |
|---|---|---|
| **Apple Health** | iPhone app | Finished workouts and weigh-ins go to Apple Health; heart rate from your watch and weigh-ins from your scale come back. |
| **Health Connect** | Android app | The same, with Health Connect. |
| **Hevy** | everywhere | A one-off import of your Hevy history with a Hevy Pro API key. |
| **Import a file** | everywhere | Strong, FitNotes, Hevy CSV, GymMane or an Apple Health export, once ([details](DATA_IMPORTS.md)). |
| **Spreadsheet (CSV)** | everywhere | Every set, weigh-in and measurement as a CSV openGym can read back. |
| **Webhooks** | needs your own server | A signed message to Home Assistant, n8n, ntfy, Node-RED and friends when you finish a workout, set a record or weigh in. |
| **AI Coach** | phone app, or a server with the Coach on | A link to the Coach's own setup ([AI coach](AI_COACH.md)). |
| **MCP server** | needs your own server | A link to setting up the MCP server ([mcp/README.md](../mcp/README.md)). |

Apple Health and Health Connect keep their switches on their own page (Settings → Integrations →
Apple Health / Health Connect; Data & backup has a way there too). The imports and the CSV export
are the same sheets Data & backup opens.

## Works with: Garmin, COROS, Polar, Fitbit, Samsung Health, Oura, Withings, Renpho

None of these has a direct line to openGym, and none needs one. Their own apps save to Apple Health
on iPhone or Health Connect on Android, and openGym reads from there:

- **Heart rate** during your workouts (Settings → Integrations → Apple Health / Health Connect →
  *Heart rate from your watch*): each set gets the heart rate your watch saved.
- **Weigh-ins** from a smart scale (*Weigh-ins from other apps*). One you type in yourself always
  wins.

Make sure the watch or scale app is allowed to write heart rate or weight to the phone's health
store. What openGym writes goes to the health store, not back into the watch's own app.

## Webhooks

A webhook is a URL your other tool gives you. openGym's server sends it an HTTPS `POST` with a
small JSON body when something happens, from whichever device you logged it on (the phone, the web
app, the watch, the MCP server). The phone app without a server has no way to send them, so the
card says *Needs your server* there.

### Setting one up

1. Settings → Integrations → Webhooks → **Connect**.
2. Paste the URL, give it a name if you like, and pick what to send:
   - **Workout finished** (`workout.finished`)
   - **New personal record** (`workout.pr`)
   - **Weigh-in logged** (`weighin.logged`)
3. **Add webhook**. The next screen shows the **signing secret** once. Paste it into your tool if it
   checks signatures (below); openGym never shows it again. Lost it? Disconnect and add the URL
   again for a new one.
4. **Send test event** from the webhook's sheet. The sheet also shows the last delivery, the last
   error with a **Retry**, the activity log (the last 50 deliveries), a switch to pause it, and
   **Disconnect**.

Up to 10 webhooks a profile. Only events from the last seven days that happened after you added the
webhook are sent, so restoring a backup or importing from another app does not replay your history.

### Examples

**Home Assistant.** Create an automation with a *Webhook* trigger (allowed methods: POST, local
only off if openGym reaches Home Assistant over the internet). Its URL looks like
`https://ha.example.com/api/webhook/opengym-workout-7f3a`. Use the payload in the action, for
example a notification with `{{ trigger.json.data.workout.name }}` and
`{{ trigger.json.data.workout.durationMin }}` minutes. Home Assistant on your home network, at
`http://192.168.1.20:8123`, needs your server admin to set `INTEGRATIONS_ALLOW_LAN=1` (below).

**ntfy.** Use your topic URL, `https://ntfy.sh/your-secret-topic`. ntfy shows the JSON as the
message; with ntfy's templating (`?tpl=yes&m=...`) you can shape it into a sentence.

**n8n / Node-RED / Zapier-style tools.** A *Webhook* node or trigger with method POST; the body
arrives as JSON.

### What gets sent

Every delivery has the same envelope:

```json
{
  "version": 1,
  "id": "evt_x8Kq2mL0pZ9a",
  "type": "workout.finished",
  "createdAt": "2026-10-26T18:42:10.000Z",
  "data": { }
}
```

- `version` is the payload format, `1` today. A change that breaks a receiver gets a new number.
- `id` is the delivery's own id, the same on every retry of it. Store it if you must never act
  twice: openGym sends each event once, but a crash at the wrong moment can mean one more try
  (at least once, not exactly once).
- `test: true` is added to a test event.

Headers: `Content-Type: application/json`, `User-Agent: openGym-Webhook/1`,
`X-OpenGym-Event` (the type), `X-OpenGym-Delivery` (the id) and `X-OpenGym-Signature`.

**`workout.finished`**

```json
{
  "workout": {
    "id": "w_1729967000000",
    "name": "Push",
    "date": "2026-10-26",
    "startedAt": "2026-10-26T17:30:00.000Z",
    "endedAt": "2026-10-26T18:31:00.000Z",
    "durationMin": 61,
    "unit": "kg",
    "bodyweight": 80.4,
    "totals": { "exercises": 5, "sets": 17, "reps": 140, "volume": 8420 },
    "exercises": [
      { "id": "0025", "name": "barbell bench press", "sets": [
        { "weight": 40, "reps": 10, "warmup": true },
        { "weight": 80, "reps": 6, "rir": 2 }
      ] }
    ],
    "records": [{ "id": "0025", "name": "barbell bench press" }],
    "note": "Felt strong."
  }
}
```

Only completed sets are listed. A set can carry `weight`, `reps`, `seconds` (a timed set),
`minutes`, `speedKmh` and `incline` (cardio), `rpe` or `rir`, `warmup: true`, or `sides` with
`left` and `right` for per-side sets. `totals` counts work sets only. Weights are in `unit`.
Exercise names are the catalogue's English names, or your own for custom exercises. At most 60
exercises with 50 sets each; `note` is cut at 500 characters.

**`workout.pr`**

```json
{
  "workout": { "id": "w_1729967000000", "name": "Push", "date": "2026-10-26" },
  "unit": "kg",
  "records": [{ "id": "0025", "name": "barbell bench press", "weight": 82.5, "reps": 5 }]
}
```

`weight` and `reps` are the heaviest work set of that exercise in the workout.

**`weighin.logged`**

```json
{ "weighin": { "date": "2026-10-26", "weight": 80.4, "unit": "kg" } }
```

Sent for a new weigh-in and for a changed one (a second weigh-in on the same day replaces the first).
Weigh-ins read in from Apple Health or Health Connect count too.

### Checking the signature

`X-OpenGym-Signature` is `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of
`<t>.<raw body>` with your webhook's secret. Check it against the raw body, before parsing, and
refuse a timestamp more than five minutes off:

```js
import crypto from 'node:crypto'

function verify(secret, rawBody, header) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header || '')
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false
  const want = crypto.createHmac('sha256', secret).update(`${m[1]}.${rawBody}`).digest()
  const got = Buffer.from(m[2], 'hex')
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}
```

```python
import hmac, hashlib, re, time

def verify(secret: str, raw_body: bytes, header: str) -> bool:
    m = re.fullmatch(r"t=(\d+),v1=([0-9a-f]{64})", header or "")
    if not m or abs(time.time() - int(m[1])) > 300:
        return False
    want = hmac.new(secret.encode(), m[1].encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, m[2])
```

Tools that cannot check a signature (Home Assistant, ntfy) still work: keep the URL itself secret,
as both of them expect.

### Delivery, retries and errors

- Answer with any `2xx` within 10 seconds. The response body is ignored.
- A timeout, a connection error, `408`, `425`, `429` or any `5xx` is tried again: after about 30 s,
  then 1, 2, 4, 8, 16 and 32 minutes, give or take a quarter, eight tries over about an hour. A
  `Retry-After` header is honoured (up to 6 hours).
- Any other `4xx`, a redirect (`3xx`, never followed: use the final URL) or an address openGym will
  not call is not retried.
- After the last try, or on a refusal, the card says **Needs attention** and the webhook's sheet
  shows the error in plain words. **Retry** sends the failed deliveries again once you fixed it.
- `410 Gone` means "this webhook is gone": openGym pauses it and stops queueing for it.
- Each webhook gets at most 30 deliveries a minute, the whole server 600.

## For self-hosters

Integrations are **off by default**. With nothing set, the server answers exactly as before, the
webhook card is hidden from everyone but admins (who see how to switch it on), and nothing is
written to disk. Switch providers on in `.env`:

```
INTEGRATIONS=webhook
```

Comma-separated; `webhook` is the one provider today (Strava is next, see below). Restart the api
container after changing it.

### Webhooks to your home network (`INTEGRATIONS_ALLOW_LAN`)

A webhook URL is a request your server makes for whoever is signed in, so it follows the same rules
as push notifications: HTTPS only, and never a private, loopback or link-local address. The address
is checked in the connection itself, so a name that resolves to a private address (DNS rebinding)
is refused too, and redirects are never followed.

Home Assistant, Node-RED and n8n often live on the same network as openGym. To let webhooks reach
them:

```
INTEGRATIONS_ALLOW_LAN=1
```

That opens the home network's addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10
for Tailscale and friends, and IPv6 fc00::/7), and plain `http://` **only** towards them. Loopback
(the server itself), link-local (169.254.x.x, where cloud metadata lives), multicast and reserved
blocks stay shut whatever the setting, and `http://` to an internet address is always refused.
Every signed-in user can then make your server send requests into your network, so only turn it on
for an instance whose users you trust. Specific addresses you list in `ALLOWED_PRIVATE_IPS`
(docs/SELF_HOSTING.md) count as allowed too, for example a loopback address you really mean.

`.local` names (mDNS) usually do not resolve inside the api container; use the IP address or a
name your DNS knows.

### What is stored where

- `data/integrations/u-<profile id>.json`: each profile's connections, mode 0600. The webhook URL
  and its signing secret are encrypted (AES-256-GCM) with a key derived from `data/secret`; the
  label, the events, a masked URL and the last 50 log lines are not. Every stored field has a
  length cap.
- `data/integrations/outbox.json`: deliveries waiting or failed, and the ids of the last 45 days'
  deliveries so nothing is sent twice. Written before anything is sent, so a restart neither loses
  nor duplicates a delivery.
- Both are in the documented backup archive. Without `data/secret` the encrypted parts cannot be
  read: replacing `data/secret` signs everyone out **and** turns every webhook to *Needs attention*;
  they have to be added again.
- Deleting a profile deletes its file and its queue. Adding and removing a webhook is in the admin
  activity log (`integration.connect`, `integration.disconnect`).

### The API

The page talks to `/api/integrations` (list, `connect`, `update`, `disconnect`, `test`, `retry`,
`log`), documented in [the HTTP API reference](API.md). Every route needs a signed-in profile and
only ever sees that profile's connections.

## For contributors: adding a provider

Providers live in `api/integrations/providers/`. A provider is a plain object: an `id`, a `kind`
(`webhook`, `apikey` or `oauth`), the `env` it needs and `configured(env)`, a per-profile `max`,
`rate` and `connRate` token buckets, `connect(input)` (validate a form, say what to store and what
to seal), `update(input)` and `deliver(job, reveal)`. The hub (`api/integrations/index.js`) does the
rest: sealed storage, the outbox with idempotency keys, backoff with jitter, rate limits, the log
and the routes. Events come from `api/integrations/events.js`, which reads them off each stored
`PUT /api/data`.

Not in this round, and what the framework leaves room for:

- **Strava** (PR #478) will become the first `oauth` provider: `authorizeUrl` and `callback` for a
  `GET /api/integrations/oauth/callback` route, `refresh` for expired tokens, and its own
  `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`. Every self-hoster registers their own Strava app;
  openGym ships no shared client secret.
- **Scoped API tokens** and **remote MCP** need token scopes first, and come after.

The frontend cards are in `frontend/src/lib/integrations.js` (which card shows where, pure and
tested) and `frontend/src/views/Integrations.jsx`.
