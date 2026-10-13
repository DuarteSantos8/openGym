# Nutrition food diary

Open **Home → Nutrition** for a personal food diary and product catalog. React uses
the existing OpenGym controls, theme, localization and API client. A signed-in account
is required; guest/local mode has no Nutrition storage. Nutrition is online-only.

## API and authentication

React → existing nginx `/api` proxy → Node gateway → internal ASP.NET Core (.NET 10).
Node keeps its existing session and CSRF checks. ASP.NET independently verifies the
forwarded Cookie/Authorization credentials with Node `/api/me` on **every request**.
Only that response supplies the user id; client identity headers, body ids and query
ids never establish ownership. HttpClient keeps no cookie jar and follows no redirects.
Every product/entry lookup and write is scoped to the authenticated user, including
retry keys. A foreign id returns 404, not someone else's data.

| Endpoint | Operation |
| --- | --- |
| `GET /api/nutrition/products?search=&offset=0` | Unicode-normalized substring search of name/brand; 50 rows and `hasMore` |
| `POST /api/nutrition/products` | Create a product |
| `GET, PUT, DELETE /api/nutrition/products/{id}` | Read, replace nutritional definition, remove from catalog |
| `GET /api/nutrition/diary?date=2026-10-13` | Entries and unrounded daily totals |
| `POST /api/nutrition/entries` | Create an entry with a client-generated UUID |
| `GET, PUT, DELETE /api/nutrition/entries/{id}` | Read, edit, delete an entry |

The existing `/api/nutrition/hello` remains for compatible clients and internal auth
smoke checks; the React screen no longer uses it. See [OpenAPI](../api/openapi.yaml)
and the generated [API reference](../website/api.html) for payloads and responses.

Missing/revoked sessions return 401; validation 400; missing/foreign items 404;
retry conflicts 409; retry of a deleted entry 410. Service/auth/database failure is
503; an invalid upstream response is 502. All responses are `no-store`. Nutrition
failure does not stop the workout API. Internal `/health` is available only after
startup migrations succeed. No new public port is exposed.

## Historical data and calculations

- Products have a UUID, user id, name (1–200 characters), optional brand (≤100),
  kcal (0–1000), protein/fat/carbohydrates (each 0–100 g), all **per 100 g**.
- Inputs accept at most 3 decimal places. Consumption quantity is positive and
  ≤100000 g. Date is a local calendar date (`yyyy-MM-dd`); optional time is `HH:mm`.
  There is no timezone conversion or meal category. Timed entries precede untimed
  ones, with deterministic creation-order ties.
- `NutritionCalculator` multiplies each value by `quantityGrams / 100m` using C#
  decimal. SQLite stores decimals as TEXT, not binary floating point. Totals sum
  unrounded values; React rounds only displayed numbers to at most 2 decimal places.
- An entry stores product id **and** a copy of name, brand and all nutritional
  values. Product edits/deletion never affect history. Editing quantity/date/time
  retains that copy. An explicit `productId` in PUT takes a new snapshot; null or
  omitted retains the historical snapshot, even when the product was deleted.
- POST entry requires `id`, `productId`, `quantityGrams`, `date`, optional `time`.
  Reuse **the same UUID and payload** after an uncertain network failure. First
  creation returns 201; equivalent retries return 200 with the entry's current
  state. A different payload with that UUID returns 409. Unique `(UserId, Id)` keys
  handle concurrent retries. Deletion markers retain the UUID/fingerprint so a late
  retry returns 410 and cannot resurrect food. The React form retains its UUID while
  open, including failed saves; after closing/reloading, check the diary before
  adding again. This is not an offline queue. Product creation is not idempotent.

Domain models, EF persistence, `NutritionService`, and endpoint contracts are separate
small files. No repository/mediator framework was introduced. Future external ids,
barcodes or additional nutrient columns can be additive migrations on Product; UUIDs
are not derived from names or external identifiers. Future MCP clients can call the
same user-scoped service/API and idempotent entry operation. Batch APIs, MCP tools,
external catalogs, recipes, targets and dietary advice are deliberately absent.

## SQLite, Docker and migrations

Both Compose files mount `nutrition-data:/data` (normally `opengym_nutrition-data`).
The image creates `/data` owned by its non-root app user. Docker initializes an empty
named volume with that ownership. The database is `/data/nutrition.db`; WAL/SHM files
stay beside it. Container recreation, updates and exact-image rollback retain the
volume. **Do not use `docker compose down -v` or prune this volume.** If substituting
a bind mount, create it with permissions for the image's `APP_UID` first.

`Nutrition__DatabasePath` overrides the file path; native development defaults to
`data/nutrition.db` under the service's content root. Each test uses an isolated
temporary SQLite file. Never point tests at deployment data.

Committed EF migrations run before the service starts accepting requests. This MVP
uses one service instance and accepts startup-migration tradeoffs; migration failures
stop startup, never silently reset the database. EF uses its SQLite migration lock.
After an interrupted migration, inspect the database and backup before clearing any
abandoned `__EFMigrationsLock`; do not automatically drop locks or delete the database.
For future schema changes: inspect migration SQL, test upgrade on a copy, take a full
backup, and keep migrations compatible with the previous image when CD rollback is
needed. Image rollback **does not undo a database migration**.

Developer migration workflow from `nutrition/`:

```sh
dotnet tool restore
dotnet ef migrations add DescriptiveChange --project src/OpenGym.Nutrition/OpenGym.Nutrition.csproj --output-dir Persistence/Migrations
dotnet ef migrations has-pending-model-changes --project src/OpenGym.Nutrition/OpenGym.Nutrition.csproj
```

The fork still publishes all three tested images (`api`, `web`, `nutrition`) to GHCR
from main, with a shared `sha-<commit>` tag. Proxmox uses the existing transactional
deployment script; no host/timer changes are included here. The installed Compose
file must include the new volume before deploying this feature. See
[PROXMOX_CD.md](PROXMOX_CD.md) for the controlled installation/update procedure.

## Complete instance backup and restore

Nutrition is **not** part of workout JSON exports or client auto-backup. The existing
server `data/` archive must be paired with the Nutrition volume archive. For a
consistent instance backup, pause the CD timer if installed, stop both writers, and
archive both stores. Use the same Compose file/project as the running stack (for
Proxmox, add `-f compose.prod.yml` to every `docker compose` command below).

```sh
mkdir -p backups
chmod 700 backups
docker compose stop api nutrition
tar czf backups/opengym-data.tar.gz data/
docker compose run --rm --no-deps --user 0 --entrypoint tar nutrition -C /data -czf - . > backups/opengym-nutrition.tar.gz
docker compose up -d api nutrition
```

Copy both archives together to protected backup storage. Do not copy only a live
`nutrition.db`: committed data may still be in its WAL. Check both command exit codes
and archive contents before treating a backup as successful. Restart writers even
if backup fails. Exclude `data/uploads` only if knowingly omitting workout media.

Restore into an empty instance with the matching app/schema version, preserving
`data/secret` and user ids; mismatched account data makes the diary inaccessible.
Stop the writers, restore the data archive, create the Nutrition volume, then:

```sh
docker compose create nutrition
docker compose run --rm --no-deps --user 0 --entrypoint tar nutrition -C /data -xzf - < backups/opengym-nutrition.tar.gz
docker compose up -d api nutrition
```

Do not overlay an older archive onto a nonempty SQLite volume (stale WAL/SHM could
remain). Preserve existing data separately and follow a deliberate restore procedure.
Keep archive numeric ownership when restoring. These archives contain private diary
and account data and are not encrypted by the application. Protect them accordingly.

## Development and verification

Use Node 22 and the .NET 10 SDK. `scripts/dev.ps1` starts the existing three local
processes with hot reload; [LOCAL_WINDOWS.md](LOCAL_WINDOWS.md) documents setup.
Node defaults to `NUTRITION_URL=http://127.0.0.1:5080`; ASP.NET uses
`OpenGym__ApiBaseUrl=http://127.0.0.1:3000`. Those are trusted internal origins, never
client-supplied configuration.

```sh
cd nutrition
dotnet test tests/OpenGym.Nutrition.Tests/OpenGym.Nutrition.Tests.csproj -c Release
cd ../api
node --test test/server-nutrition.test.js
cd ../frontend
npm test -- src/views/Nutrition.test.jsx
node scripts/check-locales.mjs
npm run build
```

Tests cover exact decimal values, snapshots, CRUD/search/pagination, user isolation,
real authentication middleware, SQLite restart/repeated migration, concurrent/repeated
creation, gateway validation/CSRF, and React forms/date/account/error paths. CI's
three-container smoke now exercises real diary CRUD as well as auth through nginx →
Node → ASP.NET → `/api/me`, using disposable `PASSWORD_LOGIN=1` test accounts only.
Native local smoke uses the same script against an isolated API, not production.

MVP limitations: online only, no nutrition import/export in client backups, last-write
wins for simultaneous edits, no automatic orphan/tombstone cleanup or account-deletion
propagation. These retained rows are not visible to another account; deliberate
retention/purge policy belongs to a later account-lifecycle task.
