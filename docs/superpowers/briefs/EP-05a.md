# Task EP-05a: Open Food Facts barcode lookup, server side

Read `docs/superpowers/briefs/WAVE-2-common.md` first. Epic outline:
`docs/superpowers/plans/EP-05-food-lookup.md`, Tasks 1 to 3 only. Security rules you must meet:
`docs/product/DATA_CONTRACTS.md`, "Server provider adapter security contract".

Task 4 of the epic (preview in the diary and saving a snapshot) is **EP-05b**, a later task that
starts after EP-04 (the diary, built in parallel by another thread) is integrated. You build no
frontend UI and do not touch the diary.

## Approved scope

One authenticated, read-only API route that looks up one barcode at Open Food Facts and returns a
small normalized product, safe to show as a preview. Off unless the operator turns it on and the
signed-in user has turned the Nutrition module on.

Decisions already taken by the orchestrator:

- **Two switches, both required, checked on the server.** An operator environment switch that is
  off by default (follow how `INTEGRATIONS` is read and documented; name it `FOOD_LOOKUP`), and
  the user's own profile choice `modules.nutrition === true` (the module EP-04 adds; treat a
  missing or non-boolean value as off). The frontend flag alone is never authorization.
- **Fixed origin.** The only outbound host is the Open Food Facts product API over HTTPS. No
  client-supplied URL, host, path fragment or header reaches the request. Redirects are refused.
  The barcode is the only user value in the outbound request: no cookie, no uid, no profile data.
- **Strict barcode.** Digits only, GTIN lengths (8, 12, 13, 14) with a valid check digit, leading
  zeros preserved. Anything else is a 400 before any network use.
- **Bounded.** Explicit connect and total timeouts, a streamed response size cap enforced before
  parsing, per-user and per-instance rate limits (reuse `rate-limit.js`), a small bounded
  in-memory cache with a time limit, including a shorter one for "not found". No disk writes.
- **Honest values.** Normalize to: `source: 'open-food-facts'`, `externalId` (the barcode),
  `label`, optional `brand`, optional `quantityText`, `per100` with a `basis` of `g` or `ml` and
  `energyKcal`, `proteinG`, `carbohydrateG`, `fatG`, an optional `serving` (label plus grams or
  millilitres when the upstream states it in a parseable way), `fetchedAt`, and the attribution
  the licence requires. A missing, null, negative, non-finite or absurd nutrient is **omitted**,
  never 0. Energy given only in kJ is converted and the conversion stated in the tasks file.
  **No image URLs** and no free-text fields beyond a bounded, control-character-free label, brand
  and quantity.
- **Status mapping.** 401 signed out, 403 switch off (say which in a stable error code, without
  leaking operator configuration beyond on or off), 400 bad barcode, 404 product unknown, 429
  rate limited with `Retry-After`, 502 upstream error or unparseable or oversized answer, 504
  timeout. Error bodies carry stable codes and never upstream text.
- **Availability is discoverable honestly.** Extend whatever the app already reads to learn which
  server features exist (see how the integrations report "off") so a later UI can show "not set up
  on this server" instead of guessing. Do not report "available" from configuration alone as if
  it were a successful call.
- The phones in standalone mode have no server and therefore no lookup. That stays so in this
  wave; state it in the docs.

## Deliverables

1. `docs/superpowers/plans/EP-05-tasks.md`: the contract you confirmed from Open Food Facts'
   current public documentation (endpoint and version, fields requested, User-Agent requirement,
   rate limits, ODbL attribution and what the licence means for stored snapshots), with links and
   the date you read them. Use Context7 or the web for this; do not rely on memory. If the terms
   forbid or restrict something in this brief, stop and report rather than work around it.
2. `api/food-lookup.js` (or the name that fits the neighbours): pure normalization and barcode
   validation, and the fetcher with an **injected transport**, so every test runs without the
   network. Tests beside the other api tests.
3. RED tests first for: GTIN lengths, check digit and leading zeros; null, negative, string,
   huge and missing nutrients; kJ only; basis g versus ml; hostile label text; truncated JSON;
   oversized stream; slow upstream; redirect; non-200; product "not found" shape; cache hit, cache
   expiry and bounded size; per-user and per-instance limits.
4. The route in `api/server.js`, its entry in `api/openapi.yaml`, and regenerated API docs
   (`node scripts/build-api-docs.mjs`). Route tests over real HTTP against a throwaway `DATA_DIR`
   for 401, 403 (each switch), 400, 404, 429, 502, 504 and 200, and a test that proves the
   outbound request carries nothing but the barcode and the fixed headers.
5. The User-Agent identifies the app and version as Open Food Facts asks. Any contact value comes
   from operator configuration, with no personal data hard-coded in the source.
6. Docs: the environment switch in `.env.example`, `docs/SELF_HOSTING.md` and wherever
   `INTEGRATIONS` is documented, a short privacy note (what leaves the server, when), and the
   attribution text for the later UI.
7. At most three live requests in total against the real service, by hand, with a well-known
   public barcode and the proper User-Agent, to confirm the real answer still matches your
   fixtures. Save the trimmed, image-free answers as fixtures. If the sandbox has no outbound
   access, mark this UNVERIFIED.

## Authorized paths

A new module under `api/` with its tests, `api/server.js` (the route and its wiring only),
`api/openapi.yaml`, the generated API docs, `.env.example`, `docs/SELF_HOSTING.md`,
`docs/INTEGRATIONS.md` if that is where the switch belongs, `docker-compose.yml` and the helm or
kubernetes examples only if `INTEGRATIONS` is passed through there in the same way,
`docs/superpowers/plans/EP-05-tasks.md`, `docs/superpowers/evidence/EP-05/**`.

Not allowed: anything under `frontend/`, `api/sync-stamps.js`, `api/integrations/**` runtime
files (read them as the reference; this lookup holds no credentials and is not a connection),
any new dependency, any background or scheduled request, storing lookups on disk.

## Acceptance

- With either switch off, no outbound request can happen (proven by a test on the transport).
- No test touches the network.
- `openapi-routes.test.js` and the generated docs check stay green; api suite green.
- A reviewer can find, in one place, exactly what is sent to Open Food Facts and when.
