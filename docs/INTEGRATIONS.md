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
| **Strava** | needs your own server | Every finished workout becomes a Weight Training activity on Strava, with your sets in the description. Upload only. |
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

## Strava

Connect your Strava account once and every workout you finish goes up as a **Weight Training**
activity: its name, when it started, how long it took, and a description that lists what you did.

```
18 sets · 6,240 kg volume · 1 PR

Bench Press: 60kg×10, 60kg×8, 60kg×8
Pull-up: 12, 10, 9
Plank: 45s

Logged with openGym
```

It is **upload only**. openGym asks Strava for one permission, uploading activities
(`activity:write`), and reads nothing from your Strava account.

### Connecting

1. In the web app on your server: Settings → Integrations → Strava → **Connect**.
2. Strava asks whether openGym may upload activities. Leave the box ticked and authorize.
3. You are back on the Integrations page and the card says *Connected*.

From then on the server uploads each workout when it is saved, from whichever device you logged it
on: the phone, the watch, the web app or the MCP server. The phone app cannot do the sign-in
itself, so connect in a browser; a phone paired with your server shows the connection and can
pause or remove it.

Good to know:

- Only workouts finished **after** you connected, and within the last seven days, are uploaded. A
  restored backup or an import from another app does not flood your Strava feed.
- Each workout goes up once, even if two devices sync it or the server restarts in between.
- Editing or deleting a workout in openGym afterwards does not change the activity on Strava.
- The activity's start time is the time openGym recorded, which Strava shows as local time. If your
  server and you are in different time zones the hour can be off.
- The Strava sheet has a switch to pause uploading, the last upload, the last error with a
  **Retry**, the activity log, **Check connection** and **Disconnect**.
- If Strava stops accepting the connection (you revoked openGym on strava.com, or another tool
  that shares the same Strava application replaced its tokens) the card says *Needs attention*.
  **Reconnect** and then **Retry**: what was waiting goes up, nothing twice.
- **Disconnect** makes your server forget its tokens and stop uploading. Activities already on
  Strava stay. It does not revoke the application on Strava's side, because that would also cut
  off any other tool using the same application; to do that, use *Settings → My Apps* on
  strava.com.

### Setting it up on your server

Strava has no shared openGym application: every server brings its own.

1. On [strava.com/settings/api](https://www.strava.com/settings/api), create an API application
   (or open the one you already have, Strava allows one per account). Set its **Authorization
   Callback Domain** to your server's hostname, the one in `ORIGIN`, for example
   `gym.example.com`. A parent domain works too, since Strava accepts its subdomains.
2. Put its keys in `.env` and switch the provider on:

   ```
   INTEGRATIONS=webhook,strava
   STRAVA_CLIENT_ID=12345
   STRAVA_CLIENT_SECRET=...
   ```

3. Restart the api container. Every signed-in profile now has a Strava card and connects its own
   Strava account.

With `strava` named but a key missing, the server logs which one and leaves Strava off. With a key
that is wrong (mistyped, or reset on strava.com):

- Profiles that are already connected stay connected. Their uploads wait and are tried again every
  hour, and the Strava sheet says the server's application keys were refused. Fix the key, restart
  the api container, and what is waiting goes up on its next try.
- An upload is tried eight times, so after about seven hours it stops and is kept as failed. Those
  do not go up on their own once the key is right: each profile opens its Strava sheet and taps
  **Retry**.
- Someone connecting for the first time gets no connection at all, only "Could not connect Strava.
  Try again." back on the Integrations page. After you have fixed the key they tap **Connect**
  again.

An
application you already use elsewhere is fine: openGym registers no Strava webhook (an application
gets only one) and never deauthorizes it. A new Strava application starts with room for a single
athlete; for more people on your server, ask Strava to raise that limit in the application's
settings. Uploads are paced well inside Strava's rate limits, and when Strava says it is busy they
wait a quarter of an hour and go again.

## For self-hosters

Integrations are **off by default**. With nothing set, the server answers exactly as before, the
webhook card is hidden from everyone but admins (who see how to switch it on), and nothing is
written to disk. Switch providers on in `.env`:

```
INTEGRATIONS=webhook
```

Comma-separated: `webhook`, and `strava` (which also needs `STRAVA_CLIENT_ID` and
`STRAVA_CLIENT_SECRET`, see [Strava](#strava)). Restart the api container after changing it.

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
  and its signing secret, and Strava's access and refresh tokens, are encrypted (AES-256-GCM) with
  a key derived from `data/secret`; the label, the events, a masked URL or the Strava athlete's
  name and the last 50 log lines are not. Every stored field has a
  length cap.
- `data/integrations/outbox.json`: deliveries waiting or failed, and the ids of the last 45 days'
  deliveries so nothing is sent twice. Written before anything is sent, so a restart neither loses
  nor duplicates a delivery.
- Both are in the documented backup archive. Without `data/secret` the encrypted parts cannot be
  read: replacing `data/secret` signs everyone out **and** turns every webhook and Strava
  connection to *Needs attention*; they have to be added again.
- Deleting a profile deletes its file and its queue. Adding and removing a webhook is in the admin
  activity log (`integration.connect`, `integration.disconnect`).

### The API

The page talks to `/api/integrations` (list, `connect`, `update`, `disconnect`, `test`, `retry`,
`log`, and `oauth/authorize` plus `oauth/callback` for a provider with a sign-in), documented in
[the HTTP API reference](API.md). Every route needs a signed-in profile and
only ever sees that profile's connections.

## For contributors: adding a provider

Providers live in `api/integrations/providers/`. A provider is a plain object: an `id`, a `kind`
(`webhook`, `apikey` or `oauth`), the `env` it needs and `configured(env)`, a per-profile `max`,
`rate` and `connRate` token buckets, `connect(input)` (validate a form, say what to store and what
to seal), `update(input)` and `deliver(job, reveal, keep)`. An `oauth` provider
(`providers/strava.js`) has `authorizeUrl({ state, redirectUri })` and `callback(query)` instead of
a form, and hands refreshed tokens to `keep(secrets)`. The hub (`api/integrations/index.js`) does the
rest: the signed OAuth state, sealed storage, the outbox with idempotency keys, backoff with jitter, rate limits, the log
and the routes. Events come from `api/integrations/events.js`, which reads them off each stored
`PUT /api/data`.

Not in this round, and what the framework leaves room for:

- **Scoped API tokens** and **remote MCP** need token scopes first, and come after.

The frontend cards are in `frontend/src/lib/integrations.js` (which card shows where, pure and
tested) and `frontend/src/views/Integrations.jsx`.
