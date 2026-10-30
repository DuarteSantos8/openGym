# Code Review Report: openGym
Generated: 2026-10-31

# Code Review Report: openGym
Date: 2026-10-31

## Claude Code Analysis

I read all ten files in full. Here is the report.

# Review: openGym API (`api/server.js`, `password.js`, `rate-limit.js`, `media.js`, `admin-socket.js`, `passkeys-store.js`, `device-link.js`, `durable.js`, `queue.js`, `recover.js`)

## 1. CRITICAL issues (must fix)

**1. `api/server.js:116-118` — an empty or truncated `SECRET` turns the session cookie into a forgeable token**

```js
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();
```

The secret is written with a plain `writeFileSync` (not `atomicWrite`), so a crash/power cut during boot can leave a zero-length file. On the next boot `SECRET` is `''` and every cookie becomes attacker-computable: `sign(payload)` is an HMAC over an empty key, so anyone can mint `uid:expiry:0:c` for any user id and become that user. There is no length/format check on the value read back.

*Fix:* validate the secret on load — `if (!/^[0-9a-f]{64}$/.test(SECRET))` → refuse to start (or regenerate and log loudly); write it with `atomicWrite(secretFile, hex, 0o600)` so it is never observed half-written.

**2. `api/server.js:120-146` (`loadDb`) — a partially written `db.json` can still be accepted**

`loadDb` catches a JSON parse error and falls back to `db.json.bak`, but a *truncated-but-valid* JSON (e.g. `{"users":[]}` written by a partial write) parses cleanly and is accepted as the real database, silently dropping every profile. Only the `parse` shape check (`is an object`) is applied.

*Fix:* validate that `db.json` has the expected collections (`users`, `creds`) and that the file length matches the byte count in a checksum written alongside it; otherwise treat it as unreadable and fall back to the `.bak`.

## 2. HIGH issues (should fix)

**3. `api/server.js:1104-1119` — the sign-in throttle address is client-controlled when `TRUST_PROXY` is on**

```js
raw = String(req.headers['cf-connecting-ip'] || '').trim() || xff[xff.length - 1] || ...
```

`cf-connecting-ip` is checked **first** and nginx does not set or strip it, so a client-supplied `CF-Connecting-IP` header passes straight through the bundled proxy and becomes the throttle key. An attacker sends a different value per request and gets a fresh `AUTH_BURST` window and a fresh `ADDR_FAILS` bucket every time — the per-address protection the whole password story rests on is bypassed. The `X-Forwarded-For` fallback is correct (last entry), the header before it is not.

*Fix:* drop `cf-connecting-ip` from `limitAddress` (or only trust it when the request came through a proxy that is known to overwrite it), and rely on the rightmost `X-Forwarded-For` entry plus the socket address.

**4. `api/server.js:2972-2973` — `Access-Control-Allow-Origin` reflects any origin**

```js
if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
```

Every origin in the world may read the API's responses cross-origin. `Allow-Credentials` is correctly absent, so cookies are not exposed, but: any page can read `POST /api/pair/redeem`'s answer (it carries a bearer token in the body) as long as it holds a pairing code, and every JSON endpoint becomes a cross-origin read API. Combined with `Access-Control-Allow-Headers: Authorization` (line 2985) the CORS surface is much wider than the API needs.

*Fix:* answer only with `ORIGIN` and the `APP_ORIGINS` set (plus `null` only if a flow needs it); reflect nothing else.

**5. `api/server.js:1071-1075` + `api/rate-limit.js:37-58` — `keep` is O(users) per key scanned, making eviction O(users × maxKeys)**

```js
keep: k => k.startsWith('acct:') && hasPassword(db.users.find(u => u.id === k.slice(5)))
```

`boundedMap.set` scans the whole map looking for an eviction victim and calls `keep(key)` for every candidate. With `maxKeys = 10000` and N users this is up to `10000 × N` `db.users.find` calls on a single eviction — i.e. a request that fills the map triggers minutes of event-loop blocking. It is reachable by an attacker who sends varied identifiers to the password routes.

*Fix:* keep the password-holder ids in a `Set` rebuilt on change (`db.users` is small and changed rarely), or give `boundedMap` a `keep` that is a set lookup.

**6. `api/server.js:175-180` + `api/durable.js:28-38` — every mutation rewrites `db.json` twice, in full**

```js
function saveDb() {
  const text = JSON.stringify(db, null, 2);
  atomicWrite(dbFile, text, 0o600);
  try { atomicWrite(dbFile + '.bak', text, 0o600); } catch ...
}
```

Every login, push subscription, passkey rename and admin action serialises the whole database (users, creds, subs, invites, device links) and writes it twice with an `fsync` each. On an open instance (`INVITE_ONLY` off) registration is unthrottled beyond 60 requests/minute/address, so the user list — and therefore every write — grows without bound. The cost per login is O(total users), so the instance degrades quadratically.

*Fix:* (a) write the `.bak` only when the content actually changed or on a timer, not on every save; (b) keep `db.json` compact (no `null, 2` pretty-printing); (c) cap or rate-limit account creation on open instances.

**7. `api/server.js:2553` + `api/durable.js:29-35` — state files are created world-readable (0644)**

```js
atomicWrite(stateFile(user.id), text);   // no mode
```

`durable.js` passes `mode` straight to `fs.openSync`, and with `mode === undefined` the file is created `0666 & ~umask` → `0644` on a default umask. `state-<uid>.json` holds every workout, weigh-in and body measurement of every profile. The header comment in `server.js` explains the deliberate decision to lock down only the four secret files, but a state file is exactly the kind of data the Coach runtime's unprivileged user was meant not to read.

*Fix:* `atomicWrite(stateFile(user.id), text, 0o600)`.

**8. `api/server.js:2567` — the answer reports a revision the file does not have**

```js
if (report.changed) body.state._rev = curRev + 2;   // line 2544
...
json(res, 200, { ok: true, ts: ..., rev: curRev + 1, wid: ... });   // line 2567
```

When the server had to stamp the writer's own changes, the document on disk is `curRev + 2` but the client is told `curRev + 1`. The client stores that number and pushes with it as `baseRev`, which no longer matches the server → an unconditional `409 conflict` and a merge on the next write, even though nothing else changed. The behaviour is intentional per the comment, but the *answer* is wrong; the client should be told the revision that was actually written.

*Fix:* respond with `rev: body.state._rev` (i.e. `curRev + (report.changed ? 2 : 1)`), or keep the client-visible revision consistent with the stored `_rev`.

## 3. MEDIUM issues (consider fixing)

**9. `api/server.js:1021` — the audit log is written with a synchronous `appendFileSync` on every audited event**

Login, register, admin actions and failed proofs all block the event loop on a disk write. Combined with `auditFail`'s own window (line 1144) the volume is bounded, but a burst of admin actions or a login storm still serialises I/O into the request path.

*Fix:* buffer audit lines and flush them on a short timer / `setImmediate`, with an fsync policy of your choosing.

**10. `api/server.js:2886` — `GET /api/admin/audit` reads and parses the whole log on every request**

`auditKeep(auditLines())` re-reads the file, splits it, JSON-parses every line and filters it, then reverses and pages. With `AUDIT_MAX = 5000` that is 5000 `JSON.parse` calls per dashboard poll.

*Fix:* keep an in-memory ring of the parsed rows (the file is already compacted hourly) and page from that.

**11. `api/server.js:2704` — `GET /api/admin/users` reads every profile's state file synchronously**

```js
const S = readState(u.id) || {};
```

A megabyte-sized state per user, parsed with `JSON.parse` on the main thread, on every dashboard open. The server already has a stat-based cache (`readStateCached`, line 505) — use it here.

**12. `api/server.js:2168` and `api/server.js:1436` — profile names are not sanitised**

`passkeys-store.js:25` goes to real trouble to strip control characters and right-to-left overrides from a passkey label, but the profile name — typed by a user, shown to an admin, used in the pairing and recovery screens — is only `.trim().slice(0, 40)`. A name containing `U+202E` renders reversed in every dashboard that shows it, and control characters land in `db.json`, the audit log and `console.log` lines.

*Fix:* apply the same filter as `passkeyName` to the profile name (and to `body.note`, invite names, etc.).

**13. `api/media.js:737-741` and `464-471` — `POST /api/media/missing` does up to 1000 synchronous `statSync` calls**

`intact()` stats the file for every hash in the request. The route accepts up to 1000 hashes, so a single request performs 1000 blocking syscalls.

*Fix:* trust the in-memory `e.hashes` map for the presence check and stat only the candidate that misses, or batch the check behind one `readdir`.

**14. `api/server.js:2116` — `GET /api/health` discloses the number of profiles to anyone unauthenticated**

```js
json(res, 200, { ok: true, users: db.users.length, writable: true });
```

An unauthenticated, unrate-limited endpoint that tells an outsider how many accounts exist. Minor on its own, but it is free reconnaissance on an instance that is invite-only or private.

*Fix:* drop `users` from the public answer, or gate it behind an admin check / `AUDIT`-style flag.

**15. `api/rate-limit.js:44-52` — a fully locked map evicts locked keys**

The rank puts locked keys last (`1e9`), but when *every* key in the map is locked, `victim` is still chosen and a locked key is deleted — exactly what the file's own header comment says must not happen ("Evicting a *locked* key … would hand an attacker a way to reset a count"). Reaching that state needs `maxKeys` locked keys, but the path exists.

*Fix:* when no unlocked candidate exists, refuse the insert (or grow the map) rather than dropping a locked entry.

**16. `api/device-link.js:39-41, 56-64` — `prune()` mutates `db.deviceLinks` without ever saving**

`prune` reassigns `db.deviceLinks` to a filtered array, but nothing calls `saveDb()` after it. Expired links therefore stay on disk until some unrelated write flushes them. Harmless in memory, but the persisted `db.json` keeps dead recovery codes for longer than their TTL, and `recoveryLinkOf` (line 79) is the only place that filters by expiry.

*Fix:* make `prune` pure (return the filtered list) and let the caller decide to save, or save after pruning.

**17. `api/media.js:537-562` + `api/server.js:2072` — `POST /api/media/sweep` can delete a file that was just uploaded but not yet referenced**

The sweep runs with `graceMs: 0`, so a blob uploaded a second ago and not yet named by a pushed state is deleted. The client then references a missing file and re-uploads it.

*Fix:* keep a short grace (at least a few minutes) even for the manual sweep, or skip hashes newer than the last state push.

**18. `api/admin-socket.js:68-77` — the handler can run twice for one connection**

`buf.indexOf('\n')` finds the *first* newline; if a client sends two lines the second `data` event re-finds the same newline and calls `handle()` again — issuing two recovery codes for one request.

*Fix:* slice the buffer after consuming a line (`buf = buf.slice(nl + 1)`) and refuse a second line.

**19. `api/server.js:2215, 2223, 2240` — some audit events bypass the `auditFail` rate limit**

`auth.register.fail` for `credential-exists` and `invite-invalid` uses `audit()`, not `auditFail()`. An attacker looping `/api/register/options` → `/api/register/verify` writes unbounded rows to `audit.log` (the file is capped, but compaction rewrites the whole thing).

*Fix:* route every unauthenticated failure through `auditFail`.

**20. `api/server.js:96` + `2553` — `MAX_BODY` (5 MB) applies to a JSON body, but the state push is written with `JSON.stringify` and `atomicWrite` on the main thread**

A 5 MB document is serialised and fsynced synchronously inside the request handler, blocking the event loop for every other user.

*Fix:* cap the state size more tightly, or move the write off the request path.

## 4. MINOR suggestions (nice to have)

- **`api/durable.js:29`** — `atomicWrite` uses a fixed `<file>.tmp` name. Two processes writing the same file (e.g. an admin script plus the API) interleave on the same temp file and can publish a partial file. Use a unique temp name (`<file>.<pid>.<rand>.tmp`).
- **`api/server.js:231-236`** — a corrupt or truncated `vapid.json` silently regenerates the VAPID keys, invalidating every push subscription on the instance with no warning beyond a fresh key. Log loudly and refuse to start instead, or keep the old key under a `.bak`.
- **`api/media.js:439-461`** — the `users` cache is never evicted, so it holds one entry per profile for the process lifetime. Bounded by the number of profiles, so acceptable, but an LRU would be tidier on an instance with churn.
- **`api/media.js:566-585`** — `cleanTmpOf(userDir, HOUR)` can delete the temp file of an upload that has been running for over an hour (the mtime of an actively written file is current, so this is safe in practice; a comment saying so would help).
- **`api/server.js:906`** — `text()` silently maps an object to `''`, so a body like `{"name":{}}` is treated as "missing" rather than "invalid". Prefer an explicit 400 for non-scalar fields where the distinction matters.
- **`api/server.js:193-197` (`notePull`)** — the pull timestamp is written to `db.json` (a full rewrite) every 10 minutes per profile, purely to show "last sync" in the admin dashboard. A per-user file or a separate small file would avoid a full db write for a display value.
- **`api/password.js:139-142` (`maskEmail`)** — masks the first character of the local part and of the domain. That is enough to distinguish two addresses in the same domain in some cases; masking all but the domain suffix would be tighter.
- **`api/password.js:177-191` (`passwordProblem`)** — the common-password list and the stem list are hand-maintained and small. The comment explains why a leaked list is not bundled; that reasoning is sound, but the two lists are the only defence against `Password123!`-style choices and are now visibly out of date relative to public breach lists.
- **`api/server.js:2442-2447` (`GET /api/data/rev`)** — `readStateCached` parses the whole document to read `_rev` when the stat cache misses; a client polling every 30 s on a 2.4 MB state pays a full parse on every write. Reading `_rev` from the file with a small streaming scan would avoid it.
- **`api/queue.js:51`** — `S.queue.since` and `S.queue.strict` are read directly while `queueOf()` returns a normalised copy; `doneIds` would be safer taking the normalised queue object (defensive only, every caller checks `queueOf` first).
- **`api/recover.js:27-30`** — `--help` exits 0 and prints usage; a missing argument exits 2. Consistent enough, but the usage text does not mention that the command must run inside the API container.
- **`api/admin-socket.js:70`** — the `MAX_LINE` check happens after the chunk is appended, so the buffer can exceed the limit by up to one socket chunk. Trivial, but `buf.length > MAX_LINE` before parsing is one byte tighter.
- **`api/admin-socket.js:38-45` (`privateDir`)** — if another user pre-creates the socket directory with `0700` on a shared host, `privateDir` throws and the admin socket silently does not start (recovery CLI unavailable) with only a console error. Consider a clearer message telling the operator to remove the stale directory.