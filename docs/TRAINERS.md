# Trainers, gym leads and gyms

openGym can connect members with human trainers on the same server. The member decides, the
server enforces, and the admin dashboard looks away. Off unless the server runs with
`TRAINERS=on` (see [SELF_HOSTING.md](SELF_HOSTING.md)).

This page covers the foundation (roles, consent, the permission check, the sharing log, the
budgets) and what is built on it: the trainer dashboard, the gym lead's view, a trainer's changes
and suggestions, the member's inbox and Undo, gym join codes, and the nutrition hook.

## Roles

| Level | Role | Who gives it | What it means |
|---|---|---|---|
| Instance | Owner, Admin | as before | Run the server. Create gyms, give gym roles, allow free trainers. Never read members' training data in the app (see [Admin data view](#admin-data-view)). |
| Gym | Gym lead | an admin | Sees the gym's trainers and the names of members who joined, and only what each member shares with the lead row. Never writes. Adds and removes trainers in their own gym by account id (`gym:staff`) and hands out the gym's join code (`gym:invite`). |
| Gym | Trainer | an admin (or a lead) | Sees only members who connected to them, only what each shares. |
| none | Free trainer | an admin | A trainer without a gym (a personal trainer). |
| Gym | Member | the member, by connecting to a gym's trainer or using the gym's join code | Trains, decides who sees what. |

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
| Nutrition (see [Nutrition](#nutrition)) | `nutrition` | See |

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

**A gym's join code** (`GY-XXXXX-XXXXX`, `POST /api/gym/code`, leads only, 50 uses and 30 days by
default) joins the gym without a trainer: the same two routes answer `kind: 'gym'`, the member
ticks their lead row under the `lead` consent text, and it counts at once (there is no trainer to
confirm). Joining twice is a 409 `already-member`.

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

### A trainer or member leaves a gym: "stay connected privately?"

When a trainer stops working at a gym (an admin or the lead takes the role, or the trainer leaves
with `POST /api/trainer/leave-gym`), their gym grants pause and get `offerUntil` (30 days). If the
trainer may train freely (an admin's switch), each member gets an `offer` in their inbox and a push:
keep training with them privately. A trainer who may not gets no offers; the grants just wait paused
for the 30 days. An offer taken after the trainer lost that switch lapses with 409 `not-free`. Taking it
(`POST /api/sharing/inbox/answer` with `accept` and the current consent) makes a new private grant
with the same levels and a fresh consent record; the gym lead row stays, as it belongs to the
membership. Declining ends the paused grant; no answer ends it after 30 days (`expireOffers`, run
hourly and on every inbox read). A private grant only works while the trainer may train freely
(an admin's switch), and says `paused: 'not-trainer'` until then. If the trainer comes back to the
gym first, the offers lapse and everything simply works again.

A member leaving a gym gets the same offer for every trainer of that gym who still works there.

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

## The trainer dashboard

Settings → Account → Trainer dashboard (and `#/trainer`), shown when `/api/config` says
`trainers.roles.trainer` or `.lead`. Member data fetched there stays in the screen's memory, never
in the store, localStorage or a file.

| Route | Who | What |
|---|---|---|
| `GET /api/trainer/members` | trainer | Every connected member with their levels and a summary: last workout, streak (weeks, with the member's freeze rule), this week's sessions against the plan, sessions a week, and flags: `missed` (planned days without a workout or a day note in the last 7), `pr` (records in the last 7 days), `inactive` (no workout for 7 days, `?inactive=` changes it), `weight` (1 or more up or down in two weeks), `pending` (suggestions not answered). A flag only shows when its category is shared: no key numbers, no streak. Budget `trainer.list`. |
| `GET /api/trainer/member?id=` | trainer, gym lead | One member's projection (`api/trainers/projections.js`): only shared categories are in the answer at all. Workouts come without media and photos, and without notes unless notes are shared, paged by `before`. Plans with the week, the next 28 days of day plans, queue and rotation. Body weight, measurements, day notes of 90 days, the progress photos (count, newest date and the newest 60 as references). Plus this person's own comments, suggestions and changes. Each category shown is one line per day in the member's sharing log. Budget `trainer.detail`. |
| `GET /api/trainer/member/photo?id=&hash=` | trainer, gym lead | One progress photo (a still filed under a day or on a workout), only while `photos` is shared with this person, checked for every file. 403 `level` without the grant. Form videos, custom exercise pictures, sounds and the profile picture are never served. Logged like any other look. Budget `trainer.photo`. |
| `POST /api/trainer/ops` | trainer | Changes, see below. Budget `trainer.ops`. |
| `POST /api/trainer/assign` | trainer | One of the trainer's own routines to up to 50 members, optionally onto a weekday. Per member `applied`, `suggested` or `skipped` (with the reason). Each member spends one `trainer.ops`. |
| `POST /api/trainer/comment` | trainer | A comment on a workout (needs workouts at See). It goes to the member's inbox and a push, never into their data. Budget `trainer.comment`. |
| `POST /api/trainer/leave-gym` | trainer | See above. |
| `GET /api/gym?id=` | gym lead | The gym: trainers with member counts, every member who joined with their trainers, whether they share anything with the lead and, where the lead row shares key numbers, the same summary. |
| `POST /api/gym/code`, `POST /api/gym/staff` | gym lead | The join code; add or remove a trainer by account id. Removing one starts the offers above. |

**No access** answers 404 to someone who was never connected to that member (a trainer cannot
probe who exists), and 403 `not-shared` to someone who was and is not any more.

## Changes, suggestions and Undo

A trainer never sends a document. `POST /api/trainer/ops` carries up to 20 whitelisted ops
(`api/trainers/ops.js`): `routine.put` (new or an existing routine), `routine.remove` (also takes it
off the week), `week.set`, `bodyweight.put`, `measurement.put`, `workout.add`, `workout.edit` (a
correction of a logged workout: its name and the weight, reps or tick of sets it already has, each
addressed by position with its exercise id, so a workout that changed shape since is refused with
409 `changed-since`; the workout keeps its owner and gets `_edit` with the trainer's name). Assigning adds two
the server makes itself: the custom exercises the routine needs (`custom.put`, without media; one
the member already has stays theirs) and `week.add`. Each op is checked against its category, for
this member, in the moment of the write:

- **Change directly** (`apply`): applied on the server to a copy of the member's document, every
  change stamped the way the app stamps its own (`stampEntry`, the `deleted` and `edited` records)
  at a time later than any stamp in it, then written through `stampPut` and the same steps as
  `PUT /api/data` (`writeStateAs` in server.js: `_rev` + 1, a new `_wid`, temp-then-rename, the
  stat cache dropped), all in one synchronous step. The member's devices see the new revision on
  their next check and merge it field by field, like a change from a second device: an offline
  edit of the same routine's name on the phone still wins its field. A member who never synced
  gets a 409 `not-synced`.
- **Suggest**: one inbox item with what it would do, worked out on a copy (so a bad op fails now,
  not at accept). The member takes it (applied the same way, labelled with the trainer) or leaves
  it. When the connection ends, open suggestions lapse.
- Anything else is refused (403 `level`, or 404 for a stranger).

Every entry a trainer writes carries `_by: { kind: 'trainer', id, name, at }`. It syncs as an
ordinary field (an older app keeps it, `sync-merge.js` merges it like any other), and the app shows
"from Marco" on the routine. An assigned routine also carries `origin` (`api/origin.js`,
`kind: 'trainer'`, `sourceId`): assigning the same routine again replaces that copy instead of
adding a second one.

**Undo.** Each change keeps its inverse (what every touched entry was before) for 30 days in the
member's sharing file. `POST /api/sharing/undo` puts it back as the member's own newest change, so
it wins on every device. When the member changed one of those entries since, it answers 409
`changed-since` and the app asks before sending it again with `force`.

## The member's inbox and notices

`GET /api/sharing/inbox`: suggestions, comments, offers and notices, newest first, plus every
change a trainer made with `canUndo`. `POST /api/sharing/inbox/answer` takes or leaves a suggestion
or an offer, or dismisses a notice; `POST /api/sharing/inbox/seen` marks them seen (opening
Trainer & gym does). Home shows one line for the newest unseen item.

The member gets a notice and a push (`api/trainers/notify.js`, in their language,
`api/trainers/push-copy.js` generated from `frontend/src/lib/trainer-notices.js` by
`api/scripts/build-trainer-copy.mjs`) when a trainer confirms a connection, when their sharing
changes (on a hijacked account this is how the owner finds out), when they join a gym, when a
trainer changes or suggests something, leaves a comment, or leaves the gym.

`GET /api/sharing/preview?grant=` is "See what Marco sees": the same projection the trainer of
that grant gets, rendered by the same component, so it cannot drift from the truth.

## Nutrition

`api/sources/nutrition.js` is the interface (`status(memberId)`, `getSummary(memberId, { from, to })`).
The default source knows nothing, so the category reads "no nutrition app linked yet". With
`NUTRITION_SOURCE=opennutrition` and `NUTRITION_URL`, the server asks openNutrition's
`/api/v1/integration/summary` on the member's behalf with their `summary:read` token, only when a
trainer with nutrition at See opens the member, and caches the answer for 15 minutes. The trainer
never sees the token. Linking an openNutrition account in openGym (and sealing the token in
`DATA_DIR/integrations/`) comes with openNutrition's public release; until then `tokenFor` returns
nothing and the source reports `not-linked`.

## Storage

`DATA_DIR/org.json` (plus `org.json.bak`), written temp-then-rename like `db.json`:

```
gyms[]         { id, name, contact, created, disabled }
staff[]        { gymId, userId, role: 'lead'|'trainer', since, until, source? }
trainers[]     { userId, since, until, source? }          free trainers
memberships[]  { gymId, userId, since, until }
grants[]       { id, memberId, kind: 'trainer'|'lead', granteeId, gymId, scopes, status, pairId?, consentId, created, updated, endedAt?, endedBy? }
consents[]     consent records
codes[]        { id, hash, kind: 'trainer'|'gym', ownerId, gymId, uses, maxUses, expires, created, revokedAt }
```

A grant whose trainer left the gym carries `offerUntil`; a private grant made from it, `from`.
`DATA_DIR/share/<uid>.json` holds the member's `log`, `inbox` (kept a year once answered) and
`undo` (30 days). All three are in "Download my sharing record" and go with the account.

A damaged `org.json` is kept aside and the `.bak` is used; with neither, nothing is shared until
it is restored, which is the safe way to fail.

## Building on this

**More trainer routes.** `api/trainers/dashboard-routes.js` gets the helpers of `routes.js`
(`guard`, `pausedWhy`, `consentBody`, the offer helpers) and `state: { read, write }` from server.js.
Read with `access(actor, memberId)` and `project()`, write with `applyFor()` (which keeps the Undo),
and add the op to the whitelist in `ops.js` with its category and inverse.

**Shared library.** See [dev/SHARED-LIBRARY-API.md](dev/SHARED-LIBRARY-API.md): `library:*`
actions are in `can()`, a gym is a visibility scope (`gymId` on an item), consent records use
`consentRecord({ kind: 'library', … })`, budgets `library.*` exist, provenance is `origin`.

**OIDC.** `api/role-claims.js`: `parseRoleMap(process.env.OIDC_ROLE_MAP)` once, then at each
sign-in `rolesFromGroups(idToken.groups, rules)` gives `{ access, admin, freeTrainer, staff, memberOf }`.
Hand `staff`, `freeTrainer` and `memberOf` to `org.syncClaimRoles(uid, roles)`: it only adds and
removes rows marked `source: 'oidc'`, so roles an admin gave by hand stay. `access` decides whether
a sign-in may create an account; `admin` maps onto `user.admin` (owner rules unchanged).
This is wired up in `api/oidc/` (1.4.5): `OIDC_ROLE_MAP` is read at boot and applied at every
provider sign-in; docs/SELF_HOSTING.md has the operator's side.
