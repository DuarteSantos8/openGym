# Security policy

openGym is a self-hosted app: you run the server, you hold the data. This file says which
versions get fixes, how to report something privately, and — the part most people actually
need — what the app protects you from and what it doesn't.

## Supported versions

Only the **latest release**. Releases are semver tags (`v1.0.0` → `v1.2.3`, see
[CHANGELOG.md](CHANGELOG.md)); there is no LTS or maintenance branch and older tags are never
patched. A fix ships in the next release and in the `latest` images in GitLab's registry.

Updating a self-hosted instance:

```bash
git pull && docker compose pull && docker compose up -d
```

## Reporting a vulnerability

The project lives on GitLab. It has no security-advisory workflow on the free tier, but it does
have **confidential issues**, and that is the private channel: open an issue at
<https://gitlab.com/DuarteSantos8/opengym/-/issues/new> and tick **"This issue is confidential"**
*before* you submit. A confidential issue is readable only by project members — you'll see it,
I'll see it, nobody else will, and it stays that way if it is later closed.

If you'd rather not put the details in GitLab at all, open a confidential issue saying only
*"I need an address for a security report"* — no details, no repro, no version — and you'll get
one back within a couple of days.

> The GitHub repo and its private vulnerability reporting are gone with the suspended account;
> `github.com/DuarteSantos8/openGym/security/advisories/new` no longer resolves.

Please don't put a working exploit in a *non-confidential* issue if it can be used against other
people's instances — and not in the Discord either, which is a public room. Everything else (a crash you can only trigger on your own box, a scanner warning)
is fine as a normal issue.

Useful in a report: the version or commit, whether you're running the prebuilt images or a
source build, your `RP_ID`/`ORIGIN` and what sits in front of the app, steps to reproduce, and
what an attacker gets out of it.

**On response times:** this is a hobby project maintained by one person alongside school. There
is no SLA and no bounty. Expect days rather than hours, and longer during exam periods. If a
week goes by with no reply, comment on the advisory thread — it's more likely to be a missed
notification than a decision. If a report goes unfixed and you want to disclose publicly, say so
in the thread; there's no objection, and no request to sit on it indefinitely.

## In scope

- **`api/server.js`** — forging or replaying a session cookie, bypassing passkey verification,
  reading or writing another user's data through `/api/data`, reaching `/api/admin/*` without
  being an admin, or creating a profile without a valid code while `INVITE_ONLY=1`. With
  `PASSWORD_LOGIN=1`: getting a password checked past the sign-in throttle, telling which names
  have a password, setting a password on someone else's profile, or using a reset code twice or
  after it expired (`api/password.js`, `api/rate-limit.js`); reading another profile's sign-in
  e-mail without being an admin, setting one without the owner's proof, or dodging the account
  pause by switching between name and e-mail. Adding a passkey to a profile that
  is not yours, removing a profile's last way in, or redeeming a device code twice, after it
  expired, or for a profile it was not made for (`api/passkeys-store.js`, `api/device-link.js`).
- **Frontend** — XSS in the React app, or anything that lets a page on another origin read or
  change a signed-in user's data.
- **Shipped deployment config** — `docker-compose.yml`, `web/nginx.conf`, the two Dockerfiles:
  a default that exposes something a self-hoster wouldn't expect to be exposed.
- **The published images** `registry.gitlab.com/duartesantos8/opengym/api` and `/web`.

## Out of scope

- Anything that already assumes access to the host, to `./data`, or to the Docker socket. The
  operator is trusted by design — see the security model below.
- Admins reading their users' workout history. That is the documented purpose of the admin
  dashboard, not a leak.
- **Missing rate limiting** on anything but password sign-in and device codes, or "I sent 100k
  requests and it got slow". With `PASSWORD_LOGIN=1` the API throttles its password routes —
  sign-in, password signup, reset codes, changing a password — and it always throttles the
  redemption of one-time device codes; nothing else. Volume against the rest, passkey sign-in and
  pairing included, belongs in the reverse proxy you put in front of it. A way past that
  throttle *is* in scope, and so is genuine amplification (one small request causing unbounded
  work).
- **Missing security headers.** `web/nginx.conf.template` sets `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: same-origin`. It deliberately does **not** set HSTS or a full CSP: TLS is the
  reverse proxy's job, and a script/style policy tight enough to be worth having needs testing
  against the built app rather than being asserted here. A concrete attack that a header would
  have stopped is still worth reporting.
- Instances served over plain `http://` on a LAN IP. Passkeys don't work there, and with
  password sign-in the password and the session cookie (not marked `Secure`) cross that network
  in the clear. That is the documented trade of running without TLS, not a finding.
- Scanner output with no working exploit, and `npm audit` findings in build-time
  devDependencies (Vite, Vitest, Capacitor CLI) that never reach a running instance.
- The GitLab Pages demo build — it has no backend at all, everything stays in that browser.
- Third-party content: the exercise image/GIF dataset and the CDN it's fetched from.

## Security model

Read this before hosting openGym for anyone other than yourself.

### What it does

- **Passkeys by default.** No email addresses, no email reset flow. Registration and login are
  verified server-side by `@simplewebauthn/server` against `expectedOrigin: ORIGIN` and
  `expectedRPID: RP_ID`, and the authenticator's signature counter is stored and updated on every
  login.
- **Passwords only if the instance asks for them.** With `PASSWORD_LOGIN=1` a profile may also
  set a password (nobody has one until they do). It is hashed with scrypt (N=2^15, r=8, p=1,
  16-byte random salt, parameters stored with the hash) and compared in constant time; a name
  with no password is checked against a dummy hash, so answer and timing are the same whether or
  not it exists. At most two hashes run at once with a short queue behind them. A first password
  needs a fresh passkey assertion by that profile, a change needs the current password (or that
  assertion), and either ends every other session of the account. Removing it needs the same
  proof — the password itself or a fresh assertion — and it cannot be removed while it is the
  profile's only way in. Password routes keep the origin check below (no login CSRF).
  An admin can issue a one-time reset code — 60 random bits, stored as a SHA-256, 24 hours, single
  use — which also removes the old password and ends every session; admin accounts cannot be
  reset that way (`api/password.js`, the password block in `api/server.js`).
- **More than one passkey, and one-time device codes.** A profile can hold up to 20 passkeys.
  Adding one from Settings, removing one, or making the code that lets another device add its
  own, needs proof that the owner is there right now — a fresh assertion by one of that
  profile's passkeys, made for that one request, or its current password — because an addition
  is a way in that outlives "sign out everywhere", and a removal would let a stolen session
  choose which of the owner's ways in is left. The password counts as proof only while
  `PASSWORD_LOGIN=1`: with the flag off, a password kept from before is not checked at all, so
  an old or reused one cannot be guessed into a new passkey. The code is
  12 characters (60 bits), shown once, stored as a SHA-256, good for ten minutes and one passkey;
  a newer code, signing out everywhere, a new password, an admin reset or a disable voids it. It
  never opens a session by itself: redeeming it registers a passkey on that profile (bound to
  `ORIGIN`/`RP_ID` like any other), and that passkey signs the device in. The redemption routes
  keep the origin check. A profile's last way in — its only passkey, unless a password can sign
  in — cannot be removed. Every addition, removal, code and redemption is audited
  (`api/passkeys-store.js`, `api/device-link.js`, the passkeys block in `api/server.js`).
- **Password sign-in is throttled.** Every password route spends a budget of 60 requests a minute
  per address; wrong passwords, reset codes and (on password signup) invite codes pause the
  address after 20 (30 s, doubling to 15 min); wrong passwords pause the *account* after 5 (1 min,
  doubling to 1 h) — keyed by the account the name or sign-in e-mail resolves to, so switching
  between the two does not reset it, and by the identifier as typed when it resolves to nobody. A password check is counted the moment it starts, so guesses
  sent all at once get no more checks than guesses sent one by one. The two routes that redeem a
  device code share that budget, and wrong codes pause the address the same way, for code
  redemption only. Passkey sign-in, passkey signup and pairing are not throttled at all, so nobody
  can pause them — not even behind a proxy that shows the API one address for every visitor. The address is the socket peer unless
  `TRUST_PROXY=1` (set by the bundled compose file, where only the web container reaches the
  API), and IPv6 is counted per /64 (`api/rate-limit.js`).
- **A sign-in e-mail is an identifier, never a channel.** With `PASSWORD_LOGIN=1` a profile may add
  an e-mail address to type at the password sign-in instead of its name. Nothing is ever sent to it
  (there is no mail server): no verification, no reset mail, so it is not proven to be anyone's
  and grants nothing on its own — the password still does. Adding, changing and removing it take
  the same proof as a password (`proveOwner`). It is folded like a name (NFKC, trimmed,
  lower-cased; at most 254 characters), unique across profiles and never another password
  holder's name, so an identifier never points at two accounts. Taking one in use answers `409
  email-taken`. In Settings that answer comes only after the owner's proof (a passkey prompt or
  the current password per try). Password signup needs no session, so there it is the cheaper
  question: it comes after the new password has been hashed and, with `INVITE_ONLY=1`, only to
  someone holding a valid unused invite code (which a refusal does not use up); on an open
  instance anyone can ask. Each refusal, in Settings or on signup, counts against the caller's
  address (and in Settings the account) like a wrong invite code, so probing which addresses are
  registered runs into a pause after about 20 tries.
  The full address is never logged or audited (masked to `a…@e…`) and is returned only to its
  owner (`GET /api/account/password`) and to admins (`GET /api/admin/users`, `/api/admin/user`);
  it is not in `/api/me`, Coach payloads, the MCP bridge or plan sharing.
- **Sessions are a signed cookie.** It carries `<uid>:<expiry>:<version>` plus an
  HMAC-SHA256 tag over it, compared in constant time (`api/server.js:230-243`). The key is 32
  random bytes generated on first run and written to `./data/secret` with mode `0600`
  (`api/server.js:40-43`). The cookie is `HttpOnly` and `SameSite=Lax`, and gets `Secure` **only
  when `ORIGIN` starts with `https:`** (`api/server.js:36`, `api/server.js:316-322`). On an https
  instance it is named `__Host-gymsid`: the prefix makes the *browser* enforce that the cookie is
  host-only, which is what stops a sibling subdomain from planting a second session cookie on the
  shared parent domain and having it shadow the real one. Over plain `http://localhost` the
  prefix is not allowed, so the old name `gymsid` stays; both are accepted on the way in, so
  upgrading signs nobody out. If one name ever arrives twice with different values, both are
  refused rather than guessing which is the real session (`api/server.js:261`).
- **Any user can end every session they have.** `POST /api/logout/all` increments that account's
  session version, and every authenticated request checks the version in the cookie against the
  one on the user record (`api/server.js:249`, `api/server.js:302-303`), so every cookie ever
  issued for the account — on every device, including a copy someone walked off with — stops
  verifying at once. Passkeys are untouched; signing back in works immediately.
- **Data is isolated per user by the session's uid.** `GET`/`PUT /api/data` only ever touch
  `state-<uid>.json` for the caller (`api/server.js:727-748`); no route lets a normal user name
  another user.
- **Disabling an account takes effect immediately.** Every authenticated request and every login
  is rejected for a disabled user (`api/server.js:299`, `api/server.js:667`).
- **Push endpoints cannot be aimed at your network.** A subscription's `endpoint` is a URL the
  server connects out to and it comes from whoever is signed in, so `/api/push/*` would otherwise
  be a request-forgery lever from inside the Docker network. It must be `https:`, and the
  connection is refused at socket level if the host resolves to a loopback, private, link-local
  (including cloud metadata) or CGNAT address — enforced in the agent's DNS lookup for hostnames,
  so there is no rebinding window, and for literal IP addresses — which never go through that
  lookup — by the same address check at subscribe time and again before every send, applied to
  every textual form of the address (`api/server.js:93-223`). Sends have a 10 s timeout
  (a stalling endpoint used to hang the request handler indefinitely), run at most 6 at a time,
  and each account is capped at 20 subscriptions, so one small request cannot become an unbounded
  burst of outbound connections (`api/server.js:108-110`).
- **An uploaded photo or video can only be one of seven file types, and only its owner gets it
  back.** People can attach one photo, GIF or short video to an exercise they made, and up to
  six to a workout they logged. The server
  decides what a file is from its first bytes, never from its name or the type the client
  declared, and stores JPEG, PNG, WebP, GIF, MP4, MOV and WebM only — SVG, HTML and everything
  else is refused. It never decodes a file, so there is no image or video parser to attack. Each
  file is named by its SHA-256, which the upload has to match, and kept per profile in
  `./data/uploads/<uid>/` (folders `0700`, files `0600`, out of the Coach runtime's reach). It is
  served to its owner only — no admin, Coach or plan-sharing route reads one — with a fixed
  `Content-Type`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cross-Origin-Resource-Policy: same-origin` and `Cache-Control: private, no-store`. Uploads
  need the same session and origin check as every other write, are capped per file, per profile
  (`MEDIA_QUOTA_MB`), to 600 an hour and two at a time per profile, streamed to disk rather than
  held in memory, cut off after 60 s without a byte, and refused when the disk runs low
  (`api/media.js`). The server never fetches anything a user supplies here: an exercise's link
  is only ever opened by its owner's own tap, in a new browsing context with
  `noopener,noreferrer`, and the Coach cannot write one.
- **There is an activity log.** Sign-ins, sign-outs, failed and refused attempts, and every admin
  action are appended to `./data/audit.log`, one JSON object per line, and shown in the admin
  dashboard. It is on by default (`AUDIT_LOG=0` disables it) and capped at `AUDIT_MAX` events /
  `AUDIT_DAYS` days. Clearing it from the dashboard is itself recorded and the event ids keep
  counting, so an erased stretch always leaves a visible gap.

### What it does not do

- **Nothing in `./data` is encrypted.** It holds `db.json` (users, passkey public keys, push
  subscriptions, invite codes), one `state-<uid>.json` per user with their complete workout
  history and body-weight log, `audit.log`, `secret`, and `vapid.json`. Anyone who can read that folder — you,
  whoever holds the backups, whoever gets into the host — can read every user's data, and with
  `secret` can mint a valid session cookie for any account. **If you host openGym for other
  people, they are trusting you exactly as much as they'd trust any server operator.** With the
  activity log on, `./data/audit.log` adds everyone's sign-in times to that — worth remembering
  before an archive of `./data` goes somewhere you don't run.
- **Photos and videos are not encrypted either, and a removed one lingers.** Whoever can read
  `./data/uploads/` can see every profile's files. A file its owner stopped using is kept for
  `MEDIA_GC_GRACE_DAYS` (14 by default) so their other devices can catch up, unless they use
  "Reset everything". Location data is removed by the app before a file leaves the device, not by
  the server: photos are re-encoded (no EXIF or GPS survives) and the metadata boxes and
  telemetry tracks of MP4/MOV videos are blanked, but WebM videos are uploaded as recorded, and a
  client other than the app can upload a file with its metadata intact — readable, still, only by
  that same profile.
- **Admins can read everything.** A user listed in `ADMIN_UIDS` (or flagged `admin: true` in
  `db.json`) gets every user's full history and body weight, can disable accounts, and can create
  or revoke invite codes (`api/server.js:825-947`). Off by default — a fresh instance has no admin.
- **Sessions can't be revoked one device at a time.** Revocation is per *account*, not per
  session: `POST /api/logout/all` kills all of them at once and there is no device list to pick
  from. `POST /api/logout` on its own only clears the cookie in that one browser
  (`api/server.js:677-681`) — a copy taken beforehand keeps working. Sessions last **90 days** by
  default, settable with `SESSION_DAYS` (`api/server.js:33`); each cookie carries the lifetime it
  was issued with, so changing the setting doesn't reach cookies that are already out. Deleting
  `./data/secret` and restarting still works as the instance-wide reset, and disabling an account
  still locks out one user completely.
- **CSRF protection is `SameSite=Lax` plus an origin check, not tokens.** There are no CSRF
  tokens. `SameSite=Lax` alone was not enough: it keeps the cookie off a cross-*site* request but
  a sibling subdomain (`gym.example.com` vs anything else under `example.com` — one domain, one
  reverse proxy, several apps, i.e. the usual self-hosting layout) is the *same* site and does
  get the cookie. So every state-changing request that a browser sent must also be
  `Sec-Fetch-Site: same-origin`, or carry an `Origin` equal to `ORIGIN` where that header is
  missing (`api/server.js:344`). Requests authenticated with a Bearer token skip the check —
  a browser never attaches one by itself, so there is no ambient authority to borrow — as do the
  register/login/pair handshakes, which carry their own credential in the body and act on no
  existing session (`api/server.js:338`). The device-code routes are not exempt: a code is
  redeemed on the app's own origin, the only one a passkey for it can be created on.
- **User verification is preferred, not required.** Both handshakes pass
  `requireUserVerification: false` (`api/server.js:575`, `api/server.js:644`), so a passkey
  released without a biometric or PIN is still accepted. In practice: unlocked device ≈ account
  access.
- **Recovery is another passkey, or an admin.** A profile can hold several passkeys, and a
  signed-in device can give a new one its own with a device code; there is no email path. Lose
  every passkey (and every signed-in device) and that profile is unreachable — unless the
  instance runs `PASSWORD_LOGIN=1`, where an admin can issue a reset code that sets a password on
  it. Without that, only direct surgery on `./data` gets it back.
- **A device code is a capability, and removing a passkey does not end sessions.** Anyone who
  reads a code off the screen within its ten minutes can add a passkey to that profile; the owner
  sees it in Settings → Passkeys and can remove it. The instance's activity log records it as
  `auth.link.ok`, but only an admin can read that log.
  Sessions are `uid:expiry:version` and are not tied to the passkey that opened them, so removing
  a passkey stops it signing in and drops an unused device code, but leaves any session it
  opened running; "sign out everywhere" ends those.
- **A password is weaker than a passkey, and the throttle is per process.** It can be phished,
  reused elsewhere or guessed; a stolen `db.json` allows offline guessing against the scrypt
  hashes. The throttle's counters live in memory: a restart clears them, and several API replicas
  would each keep their own. Behind a second proxy that hides the visitor's address every
  visitor shares one per-address count, so one client can pause *password* sign-in for everybody
  for up to 15 minutes at a time (the per-name pause still holds, and passkeys are never
  paused). Anyone who knows a name or a sign-in e-mail can keep its password sign-in paused, which the activity log
  shows as `auth.password.locked`. Because the pause is per account, a paused account also
  answers `429` for a guessed e-mail that belongs to it, which links that address to the name
  that was paused; the `409 email-taken` answer says an address is in use on the instance (never
  by whom), at the rate the throttle allows. Only two password checks run at once, with 32 queued behind
  them: someone sending from enough addresses can keep that queue full, and every password
  sign-in then answers `503` until they stop — passkeys are unaffected. The only password
  policy is 10–256 characters and a short built-in list of the passwords guessing scripts try
  first; no breached-password database is bundled.
- **Disabling someone isn't a ban.** They can still register a fresh profile with a new passkey
  unless `INVITE_ONLY=1` is set. It also makes them near-invisible in the activity log: a disabled
  account is refused at the session check, so nothing it does produces an entry except the failed
  sign-ins it keeps attempting.
- **HTTPS is required and the app doesn't provide it.** The API container speaks plain HTTP and
  nginx listens on `:80` (`web/nginx.conf`); TLS is your reverse proxy's job. Without it,
  browsers won't do passkeys at all (except on `http://localhost`) and the session cookie is sent
  in the clear.
- **Rate limiting covers password sign-in and device codes only.** The throttle above applies to
  the password routes and to device-code redemption; passkey sign-in and signup, pairing, writes
  and everything else behind a session are not limited, so an instance on the open internet should have a rate limit in front of it. `POST
  /api/register/options` still answers whether an invite code is valid, unthrottled. New invite
  codes are 16 hex characters — 64 bits — which makes guessing one impractical even unthrottled;
  codes generated by earlier versions are 8 characters / 32 bits and still work, so revoke and
  reissue any that are still unused. The other hard limit in the app is a 5 MB request body.
- **The activity log is not an audit archive, and it records less than you might assume.** No IP
  address unless you set `AUDIT_IP` (`net` truncates to a /24 or /48; the default is `off`). When it is on, the
  address comes from `CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP` or, failing all three,
  the connecting socket — so it is only as trustworthy as whatever sits in front, which has to
  *overwrite* those headers rather than pass a client-supplied one through. The bundled web
  container now does: it replaces `X-Forwarded-For`/`X-Real-IP` with the real peer and drops
  `CF-Connecting-IP` unless you set `CF_CONNECTING_IP=$http_cf_connecting_ip`, which is correct
  only with Cloudflare genuinely in front. Before that it appended to `X-Forwarded-For` and
  passed `CF-Connecting-IP` straight through, and the API reads the first entry — so any caller
  could choose the address recorded against it. Never the browser's user-agent,
  and never the passkey id behind a failed sign-in — that id is a stable
  handle for one device, and storing it would let an admin follow an unknown device from attempt
  to attempt. So a failed sign-in from a passkey this instance doesn't know is recorded as a time
  and nothing else. Retention is a cap, not an archive: old events are dropped, not exported. Any
  admin can clear the whole log from the dashboard. And four of the paths that write to it —
  the invite check on `POST /api/register/options`, and the expired-challenge and unknown-passkey
  branches of the register/login handshakes (and, with passwords on, the failed password and
  reset-code attempts, within their throttle) — are reachable **without a session**, so anyone
  can fill the log with noise. It is an append of ~110 bytes per
  event to a capped file, never a rewrite of `db.json`, so the cost is a log full of noise rather
  than a full disk or a slow server.
- **A few endpoints answer without a session:** `/api/health` (which includes the total user
  count), `/api/config` (whether invite-only and password sign-in are on), `/api/push/public-key`,
  the register/login handshakes, the two device-code redemption routes (which name the profile a
  valid code belongs to), and with `PASSWORD_LOGIN=1` the password sign-in, password
  registration and reset-code routes. Password registration says when a name is already taken
  by a profile with a password, as any sign-up form with usernames does; on an invite-only
  instance only someone with a valid code gets that far.
- **Changing `RP_ID` invalidates every existing passkey.** They were bound to the old hostname
  and will fail verification against the new one. The data stays on disk but is unreachable until
  each user registers again — as a *new* profile. Choose your hostname before anyone registers.
- **Guest mode never reaches the backend.** That data lives unencrypted in the browser's
  `localStorage` and is gone when the browser storage is cleared.
