# Scoped API tokens

A token is a key you make for **one program**: an AI assistant over [MCP](MCP_REMOTE.md), a
planner that writes your next week, a script that reads your weigh-ins. It sees, and if you allow
it changes, only the categories you tick, never more than your own profile can, and never another
profile.

Make them in **Settings → Integrations → API tokens**. A token is shown once; the server keeps
only its SHA-256.

## What a token can hold

Each category is **Off**, **See** or **Change directly**:

| Category | Covers in your profile | Most it can get |
|---|---|---|
| Workouts | the workout history, confirmed weights, your own exercises | Change directly |
| Plans & routines | routines, the weekly plan, the floating week (`queue`), rotations, programmes, date targets, your own exercises | Change directly |
| Body weight | weigh-ins, goal weight, weekly rate | Change directly |
| Body measurements | check-ins and your own fields | Change directly |
| Notes | day notes, standing exercise notes | See |

Settings such as units, the week start and progression defaults ride along with any token that
sees anything (they are needed to read the rest the way the app does) and are never writable.
Never in any token's read: progress photos, the profile picture, the Coach's conversation, the
workout in progress, linked services and the server's sync bookkeeping. Workouts may name a photo
or video by its hash; the file itself needs a signed-in session.

## The routes

All under `Authorization: Bearer ogt_…`. No other route accepts a token: not `/api/me`, not
`/api/data`, no admin, trainer or account route.

| Route | What it does |
|---|---|
| `GET /api/token/me` | whose profile, and the token's name, scopes and expiry |
| `GET /api/token/data` | the part of the profile the token may read, with `rev` and `wid` |
| `GET /api/token/data/rev` | just the revision, to read again only when it moved |
| `PUT /api/token/data` | `{ state, baseRev, baseWid? }`: the keys it may change, over the exact revision read |

A write takes every key the token holds at Change directly. A key it may only see has to come back
unchanged (send back the document you were given) and is ignored; any other key is `403 scope`.
The rest of the profile stays as stored, and the change is stamped like any API client's
(`api/sync-stamps.js`), so every device merges it. `baseRev` is required: a write over a revision
that moved is a `409` with the current scoped document, never a blind overwrite.

A planner that writes your week (#566) holds Plans at Change directly, reads `/api/token/data`,
changes `queue` or `routines`, and PUTs it back with the revision it read.

## Limits and logs

- Per token: `TOKEN_READS_PER_MIN` (120) and `TOKEN_WRITES_PER_HOUR` (60); past them, `429` with
  `Retry-After`. A refused token is not counted against an address (256 random bits are nothing
  to guess), only its audit lines are throttled.
- At most 10 tokens per profile. Each ends after 7, 30, 90 (default) or 365 days, or when revoked.
- Making and revoking one, every write and every refused change are in the admin activity log
  (never the token). Your sharing log (when trainers are on) shows each token's looks, once a day
  per category, and each change.

## When a token stops working

Revoked in Settings, expired, **Sign out everywhere**, a new password or an admin reset (the
session version moves), a disabled account, a deleted account. Each counts from the next request.

## Server settings

| Variable | Default | |
|---|---|---|
| `API_TOKENS` | on | `off` removes the routes and the Settings page (404) |
| `TOKEN_READS_PER_MIN` | 120 | reads per token per minute |
| `TOKEN_WRITES_PER_HOUR` | 60 | writes per token per hour |
| `MCP` | off | `on` when the mcp container runs: Settings shows its address |
