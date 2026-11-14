# EP-05a implementation evidence

2026-11-14, Linux, Node **v22.23.5**, npm **10.9.9**. Official Node tarball verified
against its published SHA256. Disk/load reviewed before installation and final suites;
heavy suites ran serially with two workers. No new dependencies or lockfile changes.

## Work completed

Authenticated, read-only Open Food Facts lookup with both default-off gates; strict
GTIN/normalization; connection-time guarded DNS; 2 s connect and 5 s total deadlines
including body reads; 64 KiB streamed cap; redirect refusal; bounded memory cache;
user/instance budgets; exact safe error mapping; truthful config discovery; OpenAPI,
generated API reference, deployment COPY manifest and operator/privacy/attribution docs.

No frontend, diary, sync, integration runtime or production data changes. No deploy,
merge, protected-branch push, Claude process or subagent. Test servers were terminated
using only their own spawned child handles. No dev server/browser was started.

## Changed files

- Runtime: `api/food-lookup.js`; narrow route/config wiring in `api/server.js`.
- Tests: `api/test/food-lookup.test.js`, `food-lookup-transport.test.js`,
  `food-lookup-http.test.js`, and test-only `food-lookup-transport.mjs`.
- Existing test adjustment: `api/test/server-config-session.test.js` keeps its exact
  object comparison, adds the documented disabled foodLookup key for the signed-in
  response, and pins FOOD_LOOKUP off. Its exact anonymous response assertion is unchanged.
  This minimal extra path is needed by the additive config contract.
- Contract/deployment: `api/openapi.yaml`, generated `website/api.html`, `.env.example`,
  `helm/values.yaml`, `docs/SELF_HOSTING.md`, `docs/INTEGRATIONS.md`.
  `api/Dockerfile` was explicitly authorized by the parent: otherwise the new import
  would not reach the image. Existing Docker COPY test reused, no duplicate added.
- Plan/evidence: `docs/superpowers/plans/EP-05-tasks.md` and this directory.

## Commits and PR

Assigned branch: `room/ep-05a-codex-implementation-wfhg`.
Published runtime: `176b1698b7e95dbd5e13fcd044e0bb3a074a8079`.
Final follow-up contains only tests, docs and evidence, not runtime changes.

The required pre-push rebase used `origin/next/integration` at `2efd92da`.
Inherited orchestration docs `be267053`, `9e35f366` precede task plan `57cc27c1`.
Parent will integrate task commits only, excluding those duplicate docs. This
implementer never edited `progress.md`; its inherited change is not task authorship.
Draft PR URL and final head are reported in the handoff rather than self-referential commits.

## RED and GREEN evidence

| Behavior | RED commit and result | GREEN commit and result | Logs |
| --- | --- | --- | --- |
| GTIN and normalization | `632adddd`: 0/20 | `fbd291b6`: 20/20 | `normalization-red.log`, `normalization-green.log` |
| Transport, DNS, cache, limits | `16f49bff`: 0/24 | `0b93c184`: 44/44 including normalization | `transport-red.log`, `transport-green.log` |
| Embedded IPv4 push override isolation | `dd8bbaa3`: 0/1, NAT64 bypass reproduced | `13b3b325`: 44/44 | `dns-override-red.log`, `dns-override-green.log` |
| Real HTTP route/config | `1f28611e`: 0/12 | `176b1698`: 62/62 including adapter and manifest/OpenAPI | `http-red.log`, `http-green.log` |

The existing Docker COPY test additionally failed 1/2 after the new server import,
then passed after the authorized manifest change (`docker-copy-red.log`, `http-green.log`).
The saved live fixture regression was added after the live samples were available,
without runtime changes. Final new test count: 57 (21 normalization, 24 transport,
12 actual HTTP); baseline API 854 + 57 = 911.

Final logs have trailing whitespace/blank EOF normalized as requested; substantive
output is unchanged. `gtin-newline-check.log` is a successful boundary probe, not RED.

## Checks run

All commands below used Node v22.23.5. Paths are relative to this evidence directory.

| Command (working directory) | Exit | Actual result | Evidence |
| --- | --- | --- | --- |
| `npm ci` (root, frontend, api, mcp, watch-zepp; serial) | 0 each | Existing lockfiles installed; no manifest changes | `install-{root,frontend,api,mcp,watch-zepp}.log` |
| `npm test -- --maxWorkers=2` (frontend) | 0 | **7,917/7,917**, 661 files, 417.98 s | `frontend-final.log` |
| `RAYON_NUM_THREADS=2 npm run build` (frontend) | 0 | Production build, 2.21 s | `build-final.log` |
| `node scripts/check-locales.mjs` (frontend) | 0 | 19 locales, 3,615 keys | `locales-check.log` |
| `node scripts/check-source-strings.mjs --strict` (frontend) | 0 | 2,961 strings | `source-strings-check.log` |
| `node --test --test-concurrency=2 test/*.test.js` (api), first run | 1 | 910/911; only complete config expectation lacked the new key | `api-first-run.log` |
| Same API command after expectation update | 0 | **911/911**, 9 suites, zero skipped/cancelled, 143.09 s | `api-final.log` |
| `npm test -- --maxWorkers=2` (mcp) | 0 | **140/140**, 6 files, 4.36 s | `mcp-final.log` |
| `node scripts/catalogue/build.mjs --check` (root) | 0 | 5,632 exercises in sync | `catalogue-check.log` |
| `node scripts/build-coach-assets.mjs --check` (root) | 0 | 5,632 exercises, 8 prompts in sync | `coach-assets-check.log` |
| `node scripts/build-api-docs.mjs --check` (root) | 0 | 93 endpoints, 34 schemas, 366.9 KB | `api-docs-check.log` |

Frontend logs include Happy DOM's disabled iframe-load warnings. Build logs retain
the existing large-chunk and ineffective dynamic-import warnings. Neither run failed.
`npm ci` reported existing vulnerabilities: frontend 7 (6 moderate, 1 high), API 1
moderate, MCP 1 moderate, watch-zepp 35 (5 low, 9 moderate, 19 high, 2 critical), root 0.
No dependency remediation was authorized or attempted.

## Bundle delta

`bundle.json` records all 155 emitted JS/CSS assets with raw and level-9 gzip sizes.
Entry `assets/index-C2d7rxhe.js`: **587,167 raw / 183,570 gzip bytes**.
Total: **29,267,924 raw / 5,885,889 gzip bytes**.
Against the EP-00 baseline: entry +713/+254, total +5,588/+1,812 bytes.
These include intervening EP-01/02 changes, not an isolated EP-05a build delta.
`git diff --quiet origin/next/integration...HEAD -- frontend api/coach/core` exited 0;
this task adds no frontend code or frontend-imported runtime module.

## Licence and privacy notes

Three manual public product requests in total, all successful; **budget exhausted**.
Two selected-field, image-free upstream fixtures are in `fixtures/`; the third used
the real guarded adapter and finished in 498 ms (`live-adapter.json`). See the fixture
README for exact endpoint, fields, response dates, product links and trimming.
Automated tests use injected transport, synthetic profiles and local HTTP only.

OFF database ODbL; individual contents Database Contents License. Attribution links
and fetch time are returned for later UI/snapshot retention. No exercise media or
product images were read, sent to AI, requested or returned. No profile, uid, cookie,
token or client header leaves the server; only barcode, fixed request fields/headers,
app/version and optional operator contact. OFF necessarily sees server IP and timing.

## Blocked or unverified items

- **Fresh independent Codex review pending.** Parent reported no blocking runtime
  issue in its independent source pass and 16 grouped offline adapter probes on
  `176b1698`. Those are parent-run evidence, not rerun or claimed as final approval
  here. Parent branch path: `docs/superpowers/evidence/EP-05-parent-review/`.
- **Docker image build/boot unverified:** no Docker executable. Existing COPY manifest
  gate passed; actual source server boot/HTTP verified in throwaway directories.
- **GitHub Actions unavailable per parent/common brief:** local Node 22 evidence is
  supplied. No new Actions success is claimed or dispatch attempted here.
- Browser screenshots not applicable: server-only scope, no UI changed. Actual HTTP
  paths verified. Phone/standalone/native builds and deployment not run; standalone
  lookup is intentionally unavailable. No production change or release approval.
- Provider 100ml handling is synthetic-tested; both real samples report 100g. Live
  unknown-product/timeout/rate failures were not induced; injected tests cover them.
- Limits/cache are per process, reset on restart, and do not coordinate replicas or
  other services behind one public IP. No distributed limit or live availability claim.

## Integration notes and exact EP-05b interface

`GET /api/food-lookup?barcode=<GTIN>` with the existing cookie/bearer session. Exactly
one query parameter, ASCII digits, length 8/12/13/14, valid check digit, zeros preserved.
`FOOD_LOOKUP` off by default and current `modules.nutrition === true` both required,
even for cache hits. No lookup writes the diary. No new locale keys.

200 is a direct product, not a wrapper: `source: 'open-food-facts'`, `externalId`,
`label`, optional `brand`/`quantityText`, `per100: {basis: 'g'|'ml', energyKcal?,
proteinG?, carbohydrateG?, fatG?, energyConversion?: 'kJ/4.184'}`, optional
`serving: {label, grams}` or `{label, millilitres}`, ISO `fetchedAt`, and
`attribution: {text, url, license: 'ODbL-1.0', licenseUrl}`. Missing nutrients are
unknown, not zero. Never infer basis from quantity/serving; confirm a conversion
factor before crossing g/ml. Display attribution and require explicit confirmation
before any future snapshot save. Data remains as-sold, not prepared.

Signed-in `GET /api/config` adds `foodLookup: {status: 'disabled'|'configured-unverified'}`;
signed-out omits it. Config makes no provider request and never claims availability.
`validateBarcode(value) -> boolean`; `normalizeProduct(payload, barcode, nowMs) ->
preview|null` (explicit not-found) or safe `FoodLookupError`.

Error body `{error, code}`: 401 `food-lookup-auth-required`; 403
`food-lookup-disabled` or `nutrition-disabled`; 400 `food-lookup-invalid-barcode`;
404 `food-lookup-not-found`; 429 `food-lookup-rate-limited` plus integer Retry-After;
502 `food-lookup-upstream`; 504 `food-lookup-timeout`. See OpenAPI for full schemas.

Shared integration files: `api/server.js`, `api/openapi.yaml`, generated API docs,
`.env.example`, Helm env values and operator guides. Merge these with EP-04 carefully.

## Recommended next steps

Parent assigns the fresh read-only reviewer, integrates reviewed task commits while
excluding inherited orchestration docs, and briefs EP-05b only after producer review.
Run a real Docker build/boot when Docker is available. Operator completes OFF usage
registration/contact setup and coordinates IP budgets before enabling. No deployment
or merge is authorized by this implementation report.
