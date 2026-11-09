# Shared library: API contract (P0)

The contract the library packages build against: routes, payloads, the attribution fields, errors,
switches and budgets. The idea and the reasoning are in the library design; the shared pieces
(permissions, gyms as a visibility scope, consent records, provenance, budgets) already exist and
are described in [../TRAINERS.md](../TRAINERS.md). Built in 1.4.5: `api/library/` (server),
`frontend/src/views/Community.jsx`, `lib/shared-api.js` and `lib/shared-items.js` (app),
`views/AdminCommunity.jsx` (moderation). The routes are in `api/openapi.yaml` under the tag `shared`.

Ground rules: private by default, shared per item after a consent, the uploader's name and the date
always shown, importing copies (the copy is the importer's), licensed exercise media never.

## Switches

| Env | Default | Meaning |
|---|---|---|
| `LIBRARY` | off | `on`: the library exists. Off (the default) every route answers 404 `sharing-off` and `/api/config` has no `shared` block. `permissions.js` reads it as `flags.sharing`. |
| `SHARING` | `on` | `off` closes the library even with `LIBRARY=on`. |
| `SHARE_TYPES` | all | `sound,exercise,plan,equipment,tip,look,measures,avatar` (+ `photo,formvideo,progress` with personal media) |
| `SHARE_REVIEW` | off | `on` (or `1`): new items and new versions start `pending` until an admin approves |
| `SHARE_PERSONAL_MEDIA` | off | `on` (or `1`): workout photos, form videos and progress photos can be shared (always reviewed, never taken as a copy) |
| `SHARE_QUOTA_MB` | `50` | per person |
| `SHARE_VIDEO_MAX_MB` | `25` | tighter than private uploads |
| `SHARE_AUTOHIDE_REPORTS` | `3` | reports from different people before an item goes `pending` (1 for the "licensed material" reason); reports before an approval do not count again |
| `SHARE_IMAGE_MAX_MB`, `SHARE_GIF_MAX_MB`, `SHARE_SOUND_MAX_MB`, `SHARE_SOUND_MAX_SEC`, `SHARE_AVATAR_MAX_KB` | 2, 8, 2, 30, 32 | per-file caps for sharing |
| `SHARE_ITEMS_PER_TYPE` | `50` | per person and kind (`409 too-many`) |
| `SHARE_GC_GRACE_DAYS` | `14` | the shared folder's own GC keeps a withdrawn item's files this long |

## What was decided while building it

- Which of your own things an item is: the app sends `src` (`sound:<id>`, `plan:r:<id>`, …) and only the owner gets it back. No `shared` marker goes into the synced state, so nothing new in `sync-merge.js`; a copy carries `origin` on the element (`sounds[]`, `customEx[]`, `routines[]`, `equipProfiles[]`, `customMeasurements[]`), which rides along with the element.
- `media` is derived from the payload's MediaRefs (and posters); the server checks every file in the owner's uploads, takes the stored size as the truth and copies it with a hard link where it can.
- Removing is final: payload dropped, files deleted from `shared/media` and from every importer's folder (`media.dropFile`, only hashes of that item, only its importer list), hashes blocked. A blocked hash is still accepted by `PUT /api/media` (no one learns someone else had it), never shared, served or copied again.
- Tips are not copied into the state as an item: "Add to my note" appends the text to `exNotes[exId]`. `GET /api/shared?type=tip&ex=<id>` feeds the exercise sheet.
- The profile picture is a switch, not a tab: a live `avatar` item puts its hash into `by.avatar` on that person's items. One per person; a new one withdraws the old.
- Personal media can be looked at, never taken (`take: false` in the app, no import button).

Budgets come from `api/budgets.js` (`library.list` 600/h, `library.publish` 20/h, `library.edit`
60/h, `library.report` 10/h, `library.import` 120/h), per account; over budget is `429
rate-limited` with `Retry-After`. Uploads before a publish keep `MEDIA_UPLOADS_PER_HOUR`.

## Config

`GET /api/config`, to a session only:

```json
"shared": { "types": ["sound", "exercise", "plan"], "review": false, "personalMedia": false,
            "limits": { "quotaMB": 50, "videoMB": 25, "title": 60, "desc": 500 },
            "consent": { "kind": "library", "v": 1, "hash": "…" } }
```

An older server says nothing, and the app hides the library.

## The item

```js
SharedItem = {
  id: 's_<16 base32>',
  type: 'sound'|'exercise'|'plan'|'equipment'|'tip'|'look'|'measures'|'avatar'|'photo'|'formvideo'|'progress',
  gymId: null | 'g_…',         // null: everyone on the server; a gym id: that gym's people only
  title, desc, lang,
  payload: { … },              // per type, cleaned on the server (design 2.3)
  media: [sha256, …],
  version: 1,                  // +1 on each new version by the owner
  rev: 7,                      // for If-Match on PATCH
  status: 'live'|'pending'|'hidden'|'withdrawn'|'removed',
  createdAt, updatedAt,
  consentId: 'c_…',            // consent record (below)
  stats: { imports: 0 },
  // server only, never sent: owner, importers[], reports[], mod
}
```

Sent to clients, every item carries the **attribution** block, read fresh from `db.users` at each
answer (a renamed person shows their new name; a deleted one's items are withdrawn anyway):

```json
"by": { "id": "u_…", "name": "Anna", "avatar": "<hash>|null" }, "at": 1730800000000
```

## Provenance: `origin`

A copy made by an import carries, in the importer's own state:

```js
origin: { kind: 'library', id: 's_…', version: 3, by: 'Anna', at: 1730900000000, server: 'https://gym.example' }
```

The same field a trainer's assigned routine carries (`kind: 'trainer'`). Build it with
`originFor()` and clean incoming ones with `cleanOrigin()` from `api/origin.js`; `by` and `at` are a
snapshot at copy time and never looked up again. The original in the owner's state carries
`shared: { id: 's_…', v: 3 }`. Both are plain stamped fields for `sync-merge.js` /
`sync-stamps.js` (parity test), added by the package that writes them.

## Consent

Publishing needs the current library consent:

```json
"consent": { "v": 1, "hash": "…", "own": true }
```

`own` is the "It's mine to share" tick; without it, `400 consent-own`. A stale `v`/`hash` is `409
consent-outdated` with `currentConsent('library')`. The server writes
`consentRecord({ kind: 'library', memberId: owner, subjectId: itemId, lang })` (api/consent.js),
the same record shape as trainer grants, and the person's sharing log gets a line
(`share-log.js`, events `library.publish`, `library.withdraw`, `library.removed`).

## Routes

The dispatcher matches fixed keys plus `/api/media/{hash}`; P1 adds the same kind of template
match for `/api/shared/{id}` and `/api/shared/media/{hash}`, and each route goes into
`openapi.yaml` (tag `shared`, plus a line in `scripts/build-api-docs.mjs` TAGS).

| Method and path | Permission | Budget | Body / answer |
|---|---|---|---|
| `GET /api/shared?type=&q=&lang=&sort=new\|popular&gym=&cursor=` | `library:read` per item | `library.list` | `{ items: [item+by+at], next }`, 50 a page; live items you may see, plus your own in any status |
| `GET /api/shared/{id}` | `library:read` | `library.list` | one item with payload |
| `POST /api/shared` | `library:publish` `{ gymId }` | `library.publish` | `{ type, title, desc, lang, payload, media, gymId?, consent }` → `{ id, status }`; `409 { code: 'media-missing', missing: [hash] }` until the files are uploaded to `/api/media` |
| `PATCH /api/shared/{id}` + `If-Match: <rev>` | `library:edit` | `library.edit` | title, desc, or a new version (payload, media) → `{ rev, version }`; `412 rev-mismatch` |
| `DELETE /api/shared/{id}` | `library:edit` | `library.edit` | withdraw → `{ status: 'withdrawn' }` |
| `POST /api/shared/{id}/import` | `library:import` | `library.import` | `{ payload, media: [hash], origin }`; the files are copied into the importer's own upload folder (their quota) |
| `GET /api/shared/media/{hash}` | `library:read` on an item naming it | `library.list` | the file, same headers as `/api/media` |
| `POST /api/shared/{id}/report` | signed in, not the owner | `library.report` | `{ reason, note }`; once per person and item |
| `GET /api/admin/shared?status=&reported=1` | `library:moderate` | `admin.gyms` | moderation list with reports |
| `POST /api/admin/shared/{id}` | `library:moderate` | `admin.gyms` | `{ action: 'approve'\|'hide'\|'restore'\|'remove', reason }`, audited (`shared.*`) |
| `POST /api/admin/users/{uid}/sharing` | admin | `admin.gyms` | `{ banned, reason }` → `user.share.banned` (which `library:publish` / `library:edit` read) |

`library:moderate` is any admin, and for an item with a `gymId` also that gym's leads.

### Errors

Always `{ error, code }`:

`sharing-off` 404 · `not-found` 404 (also for an item you may not see) · `consent-own` 400 ·
`consent-outdated` 409 · `banned` 403 · `not-in-gym` 403 · `not-owner` 403 · `type-off` 400 ·
`media-missing` 409 · `media-metadata` 422 · `media-blocked` 422 (catalogue hash or removed) ·
`quota` 413 · `rev-mismatch` 412 · `already-reported` 409 · `rate-limited` 429.

## Permission checks (already built)

`permissions.js` answers these today, tested in `api/test/permissions.test.js`:

```js
can(user, 'library:read',     { item })        // studio items: that gym's people (and admins)
can(user, 'library:import',   { item })        // as read, and item.status === 'live'
can(user, 'library:publish',  { gymId })       // not banned; into a gym only its people
can(user, 'library:edit',     { item })        // the owner; 403 for others who can see it, 404 otherwise
can(user, 'library:moderate', { item })        // admins; the gym's leads for a gym item
```

`item` needs `{ owner, status, gymId }` for the check.

## Storage

`DATA_DIR/shared/items.json` (+ `.bak`, durable writes), `DATA_DIR/shared/media/<sha256>.<ext>`,
`DATA_DIR/shared/blocklist.json` (removed hashes plus `catalogue/media-hashes.json`). Account
deletion withdraws every item of the person; their consent records and log go with
`org.removeUser` / `shareLog.remove` already.
