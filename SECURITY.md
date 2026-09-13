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
  being an admin, or creating a profile without a valid code while `INVITE_ONLY=1`.
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
- **Missing rate limiting**, brute force, or "I sent 100k requests and it got slow". The app
  has no rate limiting at all and doesn't pretend to; that belongs in the reverse proxy you put
  in front of it. Genuine amplification (one small request causing unbounded work) *is* in scope.
- **Missing security headers.** `web/nginx.conf.template` sets `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: same-origin`. It deliberately does **not** set HSTS or a full CSP: TLS is the
  reverse proxy's job, and a script/style policy tight enough to be worth having needs testing
  against the built app rather than being asserted here. A concrete attack that a header would
  have stopped is still worth reporting.
- Instances served over plain `http://` on a LAN IP. Unsupported: passkeys don't work there and
  the session cookie isn't marked `Secure`.
- Scanner output with no working exploit, and `npm audit` findings in build-time
  devDependencies (Vite, Vitest, Capacitor CLI) that never reach a running instance.
- The GitLab Pages demo build — it has no backend at all, everything stays in that browser.
- Third-party content: the exercise image/GIF dataset and the CDN it's fetched from.

## Security model

Read this before hosting openGym for anyone other than yourself.

### What it does

- **Passkeys only.** No passwords, no email addresses, no reset flow. Registration and login are
  verified server-side by `@simplewebauthn/server` against `expectedOrigin: ORIGIN` and
  `expectedRPID: RP_ID`, and the authenticator's signature counter is stored and updated on every
  login (`api/server.js:561-620`, `api/server.js:622-675`).
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
  existing session (`api/server.js:338`).
- **User verification is preferred, not required.** Both handshakes pass
  `requireUserVerification: false` (`api/server.js:575`, `api/server.js:644`), so a passkey
  released without a biometric or PIN is still accepted. In practice: unlocked device ≈ account
  access.
- **One passkey per profile, and no recovery.** Every successful registration creates a *new*
  profile (`api/server.js:600-609`); there is no route to attach a second passkey to an existing
  one, and no email or reset path. Lose the passkey and that profile is unreachable — only direct
  surgery on `./data` gets it back.
- **Disabling someone isn't a ban.** They can still register a fresh profile with a new passkey
  unless `INVITE_ONLY=1` is set. It also makes them near-invisible in the activity log: a disabled
  account is refused at the session check, so nothing it does produces an entry except the failed
  sign-ins it keeps attempting.
- **HTTPS is required and the app doesn't provide it.** The API container speaks plain HTTP and
  nginx listens on `:80` (`web/nginx.conf`); TLS is your reverse proxy's job. Without it,
  browsers won't do passkeys at all (except on `http://localhost`) and the session cookie is sent
  in the clear.
- **No rate limiting anywhere.** Nothing throttles logins, registrations or writes, and
  `POST /api/register/options` still answers whether an invite code is valid
  (`api/server.js:544`), so an invite-only instance on the open internet should have a rate limit
  in front of it. New invite codes are 16 hex characters — 64 bits (`api/server.js:891`) — which
  makes guessing one impractical even unthrottled; codes generated by earlier versions are 8
  characters / 32 bits and still work, so revoke and reissue any that are still unused. The only
  hard limit
  in the app is a 5 MB request body (`api/server.js:34`).
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
  branches of the register/login handshakes — are reachable **without a session**, so with no rate
  limit in front (see below) anyone can fill the log with noise. It is an append of ~110 bytes per
  event to a capped file, never a rewrite of `db.json`, so the cost is a log full of noise rather
  than a full disk or a slow server.
- **A few endpoints answer without a session:** `/api/health` (which includes the total user
  count), `/api/config` (whether invite-only is on), `/api/push/public-key`, and the
  register/login handshakes.
- **Changing `RP_ID` invalidates every existing passkey.** They were bound to the old hostname
  and will fail verification against the new one. The data stays on disk but is unreachable until
  each user registers again — as a *new* profile. Choose your hostname before anyone registers.
- **Guest mode never reaches the backend.** That data lives unencrypted in the browser's
  `localStorage` and is gone when the browser storage is cleared.
