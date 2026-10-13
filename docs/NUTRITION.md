# Nutrition integration

This proof of concept adds an ASP.NET Core **.NET 10** service alongside the existing
Node backend. React remains the only frontend. Open **Home → Nutrition**
(Russian: **Нутрициология**) to receive `Hi, <your profile name>!` from ASP.NET.
An account is required; guest and unpaired mobile modes cannot call this service.
Loading, retry and sign-in messages use the existing localization packs, including
the derived Swiss German and Brazilian Portuguese locales. The API greeting itself
stays in English, as required by this proof of concept.

## Request and authentication flow

1. React's existing `api()` client calls `GET /api/nutrition/hello` on the app's own origin.
2. nginx's existing `/api` proxy passes the request to Node. Subpaths continue to work.
3. Node checks its existing session and forwards only Cookie/Authorization credentials
   to the internal `nutrition` service. Query parameters and identity headers are dropped.
4. ASP.NET's authentication handler calls Node's existing `GET /api/me` with those
   credentials and constructs its principal from the verified user id and name.
5. ASP.NET returns `{ "message": "Hi, UserName!" }`, relayed by Node to React.

No separate login, JWT issuer, shared session secret, user database mount or Nutrition
storage is introduced. Node remains authoritative for signature, expiry, disabled users
and session-version revocation. ASP.NET rechecks on each request, without an identity cache.
Its HttpClient neither stores cookies nor follows redirects. Do not log credentials.
The paired mobile app continues using the same bearer authentication and Node CORS handling.

The extra internal `/api/me` request is deliberate for this small foundation. Future
Nutrition endpoints should require the same authentication policy; future state-changing
routes must also go through Node's existing CSRF checks.

Invalid/missing sessions return 401. A service or authentication outage returns 503;
an invalid successful service response returns 502 at the gateway. Responses are
`Cache-Control: no-store`. An outage affects Nutrition only; Node and the rest of React
remain available. `GET /health` on ASP.NET is an internal liveness endpoint.

## Docker and updates

Use the existing Compose commands:

```sh
cp .env.example .env                         # first install only; preserve existing config
docker compose up -d --build                 # source build
docker compose ps
```

Only `web` publishes the existing application port. `nutrition:8080` and Node stay on
the Compose network; the local override still exposes Node only on loopback for development.
The existing domain, TLS proxy, passkeys, `data/`, media and Coach services remain in place.
Nutrition has no persistent volume to back up.

This fork's `main` CI publishes `opengym-api`, `opengym-web` and `opengym-nutrition` to
`ghcr.io/illya228666` **after** tests and the three-container smoke check. All receive
`latest` and `sha-<full commit>` tags. Compose uses that owner by default; `GHCR_OWNER`
selects another publisher containing all three compatible images. Upstream's original
publisher is still repository-gated and its matrix includes Nutrition.

For a consistent update, set `IMAGE_TAG=sha-<tested main commit>` in `.env`, then:

```sh
git pull
docker compose pull api web nutrition
docker compose up -d api web nutrition
```

The first prebuilt install/update needs a successful main publish of all three images.
Until then, build from source. Rolling back uses the previous shared `IMAGE_TAG` and
the same pull/up commands for a manual installation. The existing Proxmox installation
uses the verified-SHA timer, readiness checks and exact-image rollback documented in
[PROXMOX_CD.md](PROXMOX_CD.md); do not mix manual updates with its running timer.

## Native development

Install Node 22 and the **.NET 10 SDK**. In three terminals from the repository root:

```sh
PORT=3000 DATA_DIR=./data RP_ID=localhost ORIGIN=http://localhost:5173 node --watch api/server.js
```

```sh
cd nutrition
dotnet watch --project src/OpenGym.Nutrition/OpenGym.Nutrition.csproj run --no-launch-profile --urls http://127.0.0.1:5080
```

```sh
cd frontend
API_ORIGIN=http://localhost:5173 npm run dev
```

Node defaults to `NUTRITION_URL=http://127.0.0.1:5080`. ASP.NET defaults to
`OpenGym__ApiBaseUrl=http://127.0.0.1:3000`; override it if Node uses another port.
Both values must identify trusted internal services. Neither value is sent by React.
Windows: `scripts/dev.ps1` starts and stops all three processes with hot reload;
`scripts/check-windows.ps1` also runs the .NET tests. See [LOCAL_WINDOWS.md](LOCAL_WINDOWS.md).

## Verification

```sh
cd nutrition
dotnet test tests/OpenGym.Nutrition.Tests/OpenGym.Nutrition.Tests.csproj -c Release
cd ../api
node --test test/server-nutrition.test.js
cd ../frontend
npm test -- src/views/Nutrition.test.jsx src/views/Home.startdoor.test.jsx src/components/TabBar.test.jsx
node scripts/check-locales.mjs
npm run build
```

The .NET tests exercise real authentication middleware with a controlled Node response.
The Node test drives the real server with valid, forged, expired, revoked, missing-account
and disabled-account sessions, header spoofing and service failure. React tests cover the
Home link, loading, greeting, localized errors/retry, guest mode and account changes.
CI builds and starts all three production images and runs
`node scripts/ci/nutrition-smoke.mjs http://localhost:8080` on **throwaway data** with
`PASSWORD_LOGIN=1`: it registers a test account through the existing login system,
checks cookie/bearer greetings, spoofing and revocation, and verifies existing API health.
Password login is enabled only in this test stack, not in the shipped Compose defaults.
