# Claude connector for openGym — design

Date: 2026-10-22. Status: approved; local implementation underway. No public deployment.

## Intent

The user wants to talk to Claude (claude.ai in the browser and the Claude desktop app) and
have it act on their openGym account exactly as they can in the web app. The motivating
example: "I want a chest routine" → Claude proposes exercises with sets, reps and rest, and
the routine exists in openGym, placed on days of the week. Later conversations keep editing
that week, and Claude uses the person's history to choose weights.

## Decisions the user made

- **One Claude per person.** Each of the three profiles on this instance connects their own
  Claude account. Nobody connects on someone else's behalf; no admin step per user.
- **Sign-in is the openGym passkey** the person already uses.
- **Full parity with the web.** The connected Claude can do everything that person can do in
  the web app, read and write, including logging workouts. An admin's Claude also gets that
  admin's admin actions. It never reaches data the person could not reach in the web app.
- **History informs the plan**: past workouts, weights, estimated 1RM, muscle balance.
- **Ordinary changes need no confirmation.** Creating and editing routines, assigning days,
  logging workouts and similar edits happen straight from the chat, as in the app.
- **Irreversible actions are confirmed in openGym, not in the chat.** A "yes" typed in Claude
  cannot prove to the server that the person said it. For deletions and disabling an account,
  Claude returns a link; the person opens it on `gym.areum.cl`, sees exactly what will be
  removed, and confirms with their passkey. Only then does the action run.
- **The existing plan is preserved.** Creating a week never deletes the person's existing
  routines, and Claude never switches between fixed-week and rotation mode on its own. When a
  plan is already active, Claude asks which one to modify before changing it.
- **Text in Claude, pictures in openGym.** The proposed plan includes exercise names, sets,
  repetitions and rest periods in the chat, plus a link to view the routine with its pictures
  in openGym. No licensed exercise media is sent to Claude.

## Calls I made (the user can overrule)

- **Separate connector service with one approved openGym exception.** This instance runs
  prebuilt images (`ghcr.io/duartesantos8/opengym-{api,web}:latest`). The connector acts through
  openGym's existing API; the user approved a minimal change to `frontend/public/sw.js` to
  exclude `/connector` and `/connector/` from service-worker interception. Public deployment
  requires a web image built from this branch rather than the unmodified prebuilt image. The
  API remains prebuilt; do not modify its code or the data files.
- **Same origin.** Passkeys are bound to `RP_ID` (`gym.areum.cl`), so the connector's pages
  are served at `https://gym.areum.cl/connector/` via a path rule in the Cloudflare tunnel.
  Its issuer is `https://gym.areum.cl/connector`; its MCP resource URL is
  `https://gym.areum.cl/connector/mcp`. Everything else keeps going to `127.0.0.1:8090`.
  Connector GET pages never embed account data: the existing service worker can already hold
  old cache entries, even after the approved bypass is shipped.
- **Getting a session for the person, without touching openGym:** the connector's sign-in
  page runs openGym's own passkey login (`POST /api/login/options` and `/verify`, same
  origin), then `POST /api/pair/create` with that session, then redeems the code with
  `POST /api/pair/redeem`. That yields a Bearer session for that person, the same one a paired
  phone holds. The connector keeps it server-side, encrypted at rest; Claude never sees it.
- **Revocation:** each Claude connection can be revoked in the connector. openGym's own
  "sign out everywhere" and password reset invalidate the Bearer. Disabling an account blocks
  API calls while disabled but does not bump its session version: re-enabling it can revive an
  unexpired Bearer. The connector must permanently revoke its grant on observed disablement.
- **Writes go through `PUT /api/data`**, like a second phone: read, patch, write with a
  numeric `baseRev` and `baseWid` from `state._wid` when present. Omit `stamped` so the API
  stamps the writer. On `409`, take `rev` and `state._wid` from the conflict response, reapply
  the patch to that current state and retry, preserving concurrent edits. Never omit `baseRev`:
  doing so overwrites unconditionally. One write at a time per person. The connector never
  writes `state-<uid>.json`. Reuse the validation in `frontend/src/lib/plan-share.js`, but
  edit routines in place by id instead of `mergePlan`, which always creates new ids.
- **Exercise choice follows the Library:** when the person's equipment filter is on, only
  exercises available with their active equipment profile; otherwise the full catalogue.
- **Weights in the profile's unit (`kg`/`lb`), exercise names in the profile's language.**
  Dumbbell load stays as written (`as`) unless the person says per hand or both.
- **Plain text first.** Interactive cards inside the Claude chat exist but are out of the
  first version.

## Claude-side requirements (checked against current Anthropic docs)

- Remote custom connectors work on claude.ai and Claude Desktop with the same URL, over
  Streamable HTTP on public HTTPS. The Desktop JSON config is only for local stdio servers.
- OAuth: protected-resource metadata (RFC 9728) whose `resource` is the exact MCP URL,
  authorization-server metadata (RFC 8414), `401` + `WWW-Authenticate` with
  `resource_metadata` on unauthenticated calls, PKCE S256, dynamic client registration,
  redirect `https://claude.ai/api/mcp/auth_callback`, plus loopback redirects so Claude Code
  also works. Refresh tokens rotate (public client).
- The free Claude plan allows one custom connector. On Team/Enterprise only an Owner can add
  it; each member then connects their own account.
- Tool results carry images only as base64, with a per-result size limit.

## Exercise images — resolved

The user chose a text plan in Claude. The stills and clips are licensed by Gym visual for
use inside openGym only. `NOTICE.md` says they "may not be used to train, prompt or feed
any AI system", and nginx serves them with `Cross-Origin-Resource-Policy: same-origin`.
The connector must not send exercise media to Claude. It may send exercise text (names,
muscles and instructions). Claude answers with names, sets, reps and rest, plus a link to
the routine in openGym (`https://gym.areum.cl/#/plan/r/:id`), where the images remain visible.

## What exists today (verified against the code)

- `mcp/` is a stdio MCP server: read-only, nine tools, authenticated by the filesystem. No
  HTTP listener, no OAuth, no writes, not in `docker-compose.yml`. Its read logic (1RM,
  muscle balance, session preview) is reusable.
- The API authenticates with a signed session (cookie, or the same value as a Bearer). There
  is no OAuth and no per-token revocation; sessions die together when the session version
  bumps.
- There is no per-routine endpoint. Every change is a conditional write of the whole
  per-user document.
- The app has both a fixed week (`S.week`) and rotation/queue mode (`S.rotation`, `S.queue`);
  a live queue takes precedence over the week on Home.

## Left to the builder

- Tool shape: few tools that map onto what the web app does.
- The exact list of irreversible actions, derived from the real routes and written down.
- Token lifetimes and storage.
- Tests beside anything that decides what gets written or how a conflict merges. No new
  dependency without a stated reason.

## Steps that need the user (or someone with access)

- Add path rules before the catch-all `gym.areum.cl` rule in the Cloudflare Zero Trust
  dashboard: `^/connector(/|$)` to the connector, plus
  `^/\.well-known/(oauth-authorization-server|openid-configuration)/connector$` to the
  connector when issuer discovery needs it. The tunnel is remote-managed by token.
- Build/deploy the patched openGym web image so its service worker excludes `/connector/`;
  the unmodified prebuilt web image does not. Verify the deployed worker before sign-in.
- Each person adds the connector URL in Claude (Settings → Connectors) and signs in with
  their passkey.

## Non-goals

- Changing openGym code beyond the approved service-worker exclusion; replacing the API
  image or the in-app AI Coach.
- One person's Claude seeing or changing another person's data, beyond what that person
  already can in the web app.
- Sending exercise media to Claude.

## Open risks

- Untrusted text: routine names and notes are user-controlled and reach the model. The
  passkey confirmation is what stops a manipulated Claude from deleting anything; ordinary
  edits remain possible, and are reversible.
- Whole-document writes race with the web app's debounced pushes. The `409` loop must stay
  inside the connector.
