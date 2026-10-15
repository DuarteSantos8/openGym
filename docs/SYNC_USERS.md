# Sync: listing the profiles (`GET /api/sync/users`)

The hub (the gateway's sync worker) syncs one profile at a time through `/api/sync/*`, each call
carrying a short-lived hub token for that profile (`api/hub-token.js`). Until this route the hub had
no way to ask openGym who exists. It learned about a person only after they opened the app and the
frontend called the hub's `sync/now`, so someone who logged a workout on another device, or came
back after a while, was never polled.

`GET /api/sync/users` answers that. This page records how it is authorised and why, because that is
the part that is easy to get wrong.

## What it returns

```
GET /api/sync/users?after=<id>&limit=<1..64, default 64>
Authorization: Bearer <listing token>

200 {
  "users": [
    { "id": "Vh3kQ9w2ZbYc0aLm", "state": "active",   "rev": 412, "wid": "9f2c41ab07d3e856" },
    { "id": "Wk8pD1x4NfR7sTq2", "state": "disabled", "rev": 37,  "wid": "3be07a91c4d2f6a8" },
    { "id": "Xp5nB2v8KdJ1wQr6", "state": "active",   "rev": 0 },
    { "id": "Zr2mC6y0LgH3vBn9", "state": "gone",     "rev": 0, "gone_at": 1760430999000 }
  ],
  "next_after": null
}
```

| Field | Type | Meaning |
|---|---|---|
| `users` | array | One row per profile, ordered by `id` (code unit order), at most `limit`. |
| `users[].id` | string | The profile id; what the hub signs per-profile tokens with as `sub`. |
| `users[].state` | `active` \| `disabled` \| `gone` | `disabled`: stop syncing, keep the data (the per-profile routes answer `401 disabled`). `gone`: deleted (they answer `404 user-gone`). |
| `users[].rev` | integer | The profile's stored revision, as `GET /api/sync/rev` gives it. `0` when it has no state yet, and always `0` for `gone`. |
| `users[].wid` | string, optional | The write id of the stored state, as `GET /api/sync/rev` gives it. Absent before the profile's first write, and for `gone`. |
| `users[].gone_at` | integer, only when `gone` | When it was deleted, in ms. `null` if the record has no usable time. |
| `next_after` | string \| null | The `after` for the next page; `null` on the last. |

- **Compare `rev` and `wid` together.** A restored backup can bring a revision back with other
  contents; only the write id tells the two apart (it is why `If-Match` on the write routes carries
  both). A profile has changed when either differs from what the hub last saw.
- Only these fields. No name, e-mail, passkey, device or anything from a profile's data. The id is
  what the hub already signs per-profile tokens with.
- Deleted profiles are remembered as `{ id, at }` in `db.json` (`gone`) for 90 days, at most 1000, so
  the hub can tell "stop syncing this person" from "never heard of them". A record older than that
  is dropped the next time the listing is read (and at the next deletion), so it stops appearing and
  stops taking space even on an instance that deletes nobody for months. A hub that has not listed
  for more than 90 days can therefore miss a deletion; that is what its own per-profile `user-gone`
  is for.

### Cost, page size and rate limit

- A page costs a `stat` per profile on it. `rev` and `wid` are read from a small index of their own
  (`stateVersion` in `api/server.js`), keyed by the state file's mtime and size, and a file is parsed
  only when it has changed since. The index is separate from the cache the reminder tick and the rev
  polls use (`STATE_CACHE_MAX = 64` parsed states), so a listing cannot evict what they keep warm.
- Reading the revision does need the document parsed once (a state file has no header to read it
  from, and `_rev` can sit anywhere in it), so the first listing after a start, or after a profile
  changed, parses that profile's file. `limit` is therefore capped at 64, the same number as the
  parsed-state cache: it bounds the synchronous parsing one cold request can do, and the hub walks
  a larger instance in more pages instead.
- At most 120 listings a minute are answered. Past that: `429`, `code: rate-limited`, `retryAfter`
  seconds and a `Retry-After` header. Only calls that carry a valid, unspent listing token count, so
  junk from elsewhere cannot spend the hub's allowance. A scheduler makes one call per page, so this
  is far above any real use.

### Paging

Paged by key, not by position: ordered by id, and `after` is the last id of the page before
(`next_after`, `null` at the end). A profile created, disabled or deleted between two pages never
makes another one repeat or go missing, which an offset into a list that has just changed would. One
created behind the cursor after the pass went by is in the next pass. The list is one entry per
profile on the instance and is meant to be walked in full each time; the hub compares each `rev` with
the one it last saw.

## How it is authorised

The route is about no single profile, so it cannot take a per-profile token (`sub` is a profile id,
and the route would have to ignore it). Three ways to give it a credential were considered:

| Option | Verdict |
|---|---|
| A. A per-profile-style token with `sub` set to a service principal and `scope=sync-list`, same audience | Works, but the only thing keeping it off the per-profile routes (and them off it) is the scope check. One mistaken `scopes: ['sync', 'sync-list']` on any route and a listing token reads profiles. |
| **B. Its own audience (`opengym-sync-users`), scope `sync-list`, and `sub` = `hub`** | **Chosen.** Refused on every other route on audience *and* scope, and refused here on both too. No single mistake in a route's scope list lets one kind of token in as the other. |
| C. A static API key in the environment | Rejected: no expiry, no one-use rule, nothing to rotate except by redeploying, and a second secret to leak. A hub token is already short-lived, single-use and signed with a key openGym holds only the public half of. |

The decision is option B. The listing token, claim by claim:

| Claim | Value | Notes |
|---|---|---|
| header `alg` / `kid` | `ES256` / a key in `HUB_JWKS` | The same key as the per-profile tokens. No other algorithm is accepted. |
| `iss` | `HUB_ISSUER` | As every hub token. |
| `aud` | `opengym-sync-users` | A string, never an array. A per-profile token's `opengym-sync` is refused here, and this one on every per-profile route. |
| `scope` | `sync-list` | Exactly this; `sync` is refused here and `sync-list` on the per-profile routes. |
| `sub` | `hub` | The hub acting as a service, never a profile id. A token whose `sub` names anyone else is refused with `token-invalid` (audited as `sync.token.fail`, reason `sub`): it was minted for something else, and does not become a listing credential by being re-aimed. |
| `iat` / `exp` | now / at most 60 s later | `iat` at most 30 s ahead of this server's clock, `exp` in the future, `exp - iat <= 60`. |
| `jti` | a **fresh** value per call | At least 128 random bits, base64url. **One use**: a second request with the same `jti` is `401 replay`. Every page of a pass is a call of its own and needs its own token. |

- The replay cache is shared with the per-profile routes, so a `jti` cannot be reused across routes
  either.
- Refused everywhere else, and it refuses everything else: a per-profile token here gets `401
  token-invalid`, a listing token on any per-profile route gets `401 token-invalid`, a cookie or a
  paired token here is the same as no credential (`401 not signed in`).
- Like the rest of `/api/sync/*`, it does not exist unless `HUB_JWKS` is set: an instance with no hub
  answers the plain `404 not found`.

Failures are audited as `sync.token.fail` with a reason code (`malformed`, `kid`, `replay`, `sub`, ...),
folded into one counted row per reason per hour (`api/audit-aggregate.js`), so a misconfigured hub
cannot fill the log. A successful listing is not audited (it is called on a schedule); the token
itself is never logged.

## What the hub has to change

openGym's side is this route and nothing else; the hub is a separate repo.

1. **Mint a listing token** for `GET /api/sync/users`: the same ES256 key and issuer it uses now, with
   `aud: "opengym-sync-users"`, `scope: "sync-list"`, `sub: "hub"`, `iat`/`exp` (`exp - iat <= 60`) and
   a fresh `jti` of at least 128 random bits, per call (including every page).
2. **Poll the listing** on a schedule (and on `sync/now`), walking `next_after` until it is `null`
   (pages of at most 64, one freshly signed token per page; stay well under 120 calls a minute and
   honour `Retry-After` on a `429`).
3. **Diff `rev` and `wid` together** against the pair it last saw for each `active` profile (a profile
   it has never seen counts as changed; `rev: 0` with no `wid` is "no state yet", nothing to read).
   Only a profile whose pair differs gets its normal per-profile pass, with a per-profile token
   (`aud: "opengym-sync"`, `scope: "sync"`, `sub` = the id). Keep the pair after that pass, not the
   one the listing showed before it, so a write landing in between is not missed.
4. **Handle `disabled`**: stop syncing the profile and keep its data, the same as the per-profile
   `disabled` answer; sync it again when it is `active` again. **Handle `gone`**: stop syncing, same
   as `user-gone` (hold deletes behind the same guard it uses for a `reset_at`), and forget the
   stored pair. A `gone` row stays for 90 days, so list at least that often.
5. Do not rely on a profile's absence from a page as deletion: a profile created or restored behind
   the cursor mid-pass is simply for the next pass.
