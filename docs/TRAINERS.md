# Trainers, gym leads and gyms

openGym can connect members with human trainers on the same server. The member decides, the
server enforces, and the admin dashboard looks away. Off unless the server runs with
`TRAINERS=on` (see [SELF_HOSTING.md](SELF_HOSTING.md)).

This page is the foundation: roles, consent, the permission check, the sharing log and the
budgets. The trainer dashboard, the gym lead dashboard and trainer writes into a member's plan
build on it.

## Roles

| Level | Role | Who gives it | What it means |
|---|---|---|---|
| Instance | Owner, Admin | as before | Run the server. Create gyms, give gym roles, allow free trainers. Never read members' training data in the app (see [Admin data view](#admin-data-view)). |
| Gym | Gym lead | an admin | Sees the gym's trainers and the names of members who joined, and only what each member shares with the lead row. Never writes. Can add and remove trainers in their own gym (permission `gym:staff`, UI later). |
| Gym | Trainer | an admin (or a lead) | Sees only members who connected to them, only what each shares. |
| none | Free trainer | an admin | A trainer without a gym (a personal trainer). |
| Gym | Member | the member, by connecting to a gym's trainer | Trains, decides who sees what. |

A person can be several things at once (admin and member, trainer in gym A and member of gym B).
Rights are always checked per relationship, never "you are a trainer, so".

## Categories and levels

Levels: **Off**, **See**, **Suggest**, **Change directly** (`off`, `view`, `suggest`, `apply`). Each
includes the ones before it.

| Category | id | Highest level |
|---|---|---|
| Key numbers (streak, last workout, sessions a week) | `metrics` | See |
| Workouts | `workouts` | Change directly |
| Plans & routines | `plans` | Change directly |
| Body weight | `bodyweight` | Change directly |
| Body measurements | `measurements` | Change directly |
| Progress photos | `photos` | See |
| Notes | `notes` | See |
| Nutrition (openNutrition, later) | `nutrition` | See |

The consent screen starts at: key numbers, workouts and body weight on See, plans on Suggest, the
rest off. The catalog lives in `api/trainers/scopes.js`, with a hand copy in
`frontend/src/lib/sharing-scopes.js` (parity test).

## Connecting

1. The trainer makes a code (`POST /api/trainer/codes`): `TR-XXXXX-XXXXX`, 50 random bits, 7 days,
   one use by default (up to 200, for a class). Only its hash is stored. The answer has a `link`
   (`ORIGIN/#/settings/trainer?code=…`) for a QR.
2. The member types or scans it. `POST /api/sharing/code` says whose code it is, which gym, who is
   responsible for the data (the gym's contact), who the gym lead is, the pre-fill, and the
   current consent text. Nothing is created yet.
3. The member adjusts and taps Connect (`POST /api/sharing/connect`) or Not now
   (`POST /api/sharing/decline`, which only notes it in their own log).
4. The connection is pending until the trainer confirms (`POST /api/trainer/requests/answer`), so
   nobody can pour 400 people onto a trainer's list unasked.

A gym trainer's code also makes the member a member of that gym, and adds the **gym lead row**.

### The gym lead row (owner decision E3)

`TRAINERS_LEAD_ACCESS` picks how the lead sees a member:

- `row` (default, the design's recommendation): a separate grant, pre-filled from the trainer's
  levels capped at See, never more. The member can switch any category off. It follows the
  trainer row down (switching workouts off for the trainer switches it off for the lead) but
  never back up on its own.
- `mirror`: the lead always sees what the trainer sees, capped at See; no separate choice.
- `none`: the lead sees names only.

Switching between them is one env var; `leadScopes()` in `scopes.js` is the only place that knows.

### Changing and ending

`POST /api/sharing/update` changes one grant; `POST /api/sharing/disconnect` (member) or
`POST /api/trainer/disconnect` (trainer) ends it; `POST /api/sharing/leave` leaves a gym and ends
its lead row and every gym trainer grant (private trainers stay). All of it counts from the next
request: nothing about a grant ever goes into a session.

A grant is **paused**, not ended, while its trainer no longer has the trainer role in that gym,
while the gym is switched off, or (free trainers) while the free-trainer permission is taken
away. Give the role back and it works again. `GET /api/sharing` reports `paused`.

## Consent records

`api/consent.js` keeps the canonical (English) consent texts with a version, and
`currentConsent(kind)` gives `{ kind, v, hash, text }`, the hash being SHA-256 over kind, version and
text. The app shows the translation of the text it knows, or the server's own words when the
server has a newer version. Every write that changes what is shared sends `consent: { v, hash }`;
a stale one is `409 consent-outdated` with the current text.

Each grant gets a record, the same shape the shared library uses:

```
{ id, kind: 'trainer'|'lead'|'library', memberId, subjectId, v, hash, lang, scopes?, at, revokedAt }
```

A change closes the old record (`revokedAt`) and writes a new one with the new scopes, so the
history of what was agreed and when stays complete.

## Sharing log

`DATA_DIR/share/<uid>.json`, one per member, only ever appended to (`api/share-log.js`): connected,
confirmed, declined, changed, ended, joined, left, an admin looked (ADMIN_DATA_VIEW), and trainer
looks, folded into one line per day, person and category so a polling dashboard does not write a
thousand. Kept `SHARE_LOG_DAYS` (365) days, at most 5000 lines. Only the member reads it
(`GET /api/sharing/log`).

- **Export:** `GET /api/sharing/export` gives the memberships, grants, consent records and the
  whole log as one file ("Download my sharing record" in the app).
- **Delete:** deleting the account (by the person or an admin) removes every grant, consent,
  membership, role and code of theirs, and their log. A deleted trainer's grants end, and their
  name is taken out of their members' logs (they read "A former trainer").

## Permissions

Every new route asks one function, `api/permissions.js`:

```js
const { can } = createPermissions({ org, userById, isAdmin, isOwner, flags })
can(actor, action, subject, category) // -> { ok, level, reason, status, via }
```

It reads `org.json`'s in-memory copy and `db.users` on every call and caches nothing. `status` is
what the route should answer when `ok` is false: 404 wherever a 403 would tell a stranger a
profile exists (a trainer probing a member they have no grant from gets "not found").

| action | allowed for |
|---|---|
| `view`, `suggest`, `apply` + category | the member themself; a trainer or lead through an active grant at that level |
| `comment` + `workouts` | anyone who may see the member's workouts |
| `admin:data-view` | an admin, only with `ADMIN_DATA_VIEW=on` |
| `gym:create`, `gym:manage` | admins |
| `gym:staff` `{ gymId, role }` | admins; a gym's lead for the trainer role in that gym |
| `gym:view`, `gym:members` | admins and the gym's people / the gym's leads |
| `trainer:invite` `{ gymId? }` | a trainer of that gym, or a free trainer without one |
| `library:read`, `library:import`, `library:publish`, `library:edit`, `library:moderate` | see [dev/SHARED-LIBRARY-API.md](dev/SHARED-LIBRARY-API.md) |

Abuse cases with a test each (`api/test/permissions.test.js`): an ex-trainer after a disconnect
from either side, a trainer removed from the gym, a member with several trainers, a lead of
another gym, an admin without ADMIN_DATA_VIEW, a hand-edited lead grant with write levels, a
disabled member, the switch off.

## Budgets

Per account, one place (`api/budgets.js`), counted with `rate-limit.js`. Over budget: `429
rate-limited` with `Retry-After`.

| Budget | Limit |
|---|---|
| `trainer.code` new codes | 20 a day |
| `trainer.list` overview | 120 an hour |
| `trainer.detail` one member's data (dashboard) | 600 an hour |
| `trainer.ops` writes into members (later) | 300 an hour |
| `trainer.comment` (later) | 100 an hour |
| `trainer.answer` confirm, decline, disconnect, revoke | 300 an hour |
| `sharing.read` / `sharing.write` | 600 / 60 an hour |
| `admin.gyms`, `data.admin` | 300 an hour each |

Wrong codes are counted per address and per account (10 free, then a pause from a minute,
doubling to an hour), like wrong passwords.

## Admin data view

Since 1.4.5 `GET /api/admin/user` answers counts (workouts, weigh-ins, measurements, routines),
storage on disk, last sync, push, gym roles and the number of active grants, and `data_view:
false`. `GET /api/admin/users` drops the last workout date and the routine of a running session.
The data is still on disk for whoever runs the server; the app says so.

`ADMIN_DATA_VIEW=on` brings the old drill-down back (workout history, weigh-ins, routines,
`data_view: true`), and every look is in the activity log (`admin.data-view`) and in the member's
own sharing log.

## Storage

`DATA_DIR/org.json` (plus `org.json.bak`), written temp-then-rename like `db.json`:

```
gyms[]         { id, name, contact, created, disabled }
staff[]        { gymId, userId, role: 'lead'|'trainer', since, until, source? }
trainers[]     { userId, since, until, source? }          free trainers
memberships[]  { gymId, userId, since, until }
grants[]       { id, memberId, kind: 'trainer'|'lead', granteeId, gymId, scopes, status, pairId?, consentId, created, updated, endedAt?, endedBy? }
consents[]     consent records
codes[]        { id, hash, ownerId, gymId, uses, maxUses, expires, created, revokedAt }
```

A damaged `org.json` is kept aside and the `.bak` is used; with neither, nothing is shared until
it is restored, which is the safe way to fail.

## Building on this

**Trainer dashboard.** Add routes to `api/trainers/routes.js` (they get the `guard(budget, fn)`
wrapper, the store, `perms`, `log`). For a member's data: `perms.can(trainer, 'view', { memberId },
cat)` per category, a 404 on `!ok`, read the state, project only allowed categories, then
`log.noteAccess(memberId, { kind: 'trainer', id, name }, cat)`. Spend `trainer.detail`. Writes:
`suggest` goes to an inbox, `apply` through `stampPut` (design 4.2), checked in the same tick as
the write. Copied routines carry `origin` from `api/origin.js` (`originFor({ kind: 'trainer', … })`).
`GET /api/trainer` already lists members with their current levels. The gym lead dashboard uses
`gym:view` / `gym:members` and `gym:staff` for the trainer role.

**Shared library.** See [dev/SHARED-LIBRARY-API.md](dev/SHARED-LIBRARY-API.md): `library:*`
actions are in `can()`, a gym is a visibility scope (`gymId` on an item), consent records use
`consentRecord({ kind: 'library', … })`, budgets `library.*` exist, provenance is `origin`.

**OIDC.** `api/role-claims.js`: `parseRoleMap(process.env.OIDC_ROLE_MAP)` once, then at each
sign-in `rolesFromGroups(idToken.groups, rules)` gives `{ access, admin, freeTrainer, staff, memberOf }`.
Hand `staff`, `freeTrainer` and `memberOf` to `org.syncClaimRoles(uid, roles)`: it only adds and
removes rows marked `source: 'oidc'`, so roles an admin gave by hand stay. `access` decides whether
a sign-in may create an account; `admin` maps onto `user.admin` (owner rules unchanged).
