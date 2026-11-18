# EP-05a independent review

Reviewed 2026-11-14 in `/code/openGym-fork/.worktrees/review-ep05a`, frozen at `c976b9638332859a1b341e5995634bb24e2bc8ce`. Runtime is unchanged from `176b1698b7e95dbd5e13fcd044e0bb3a074a8079`.

**Spec compliance: PASS within the EP-05a server-only scope and the verification limits below.**

**Task quality: PASS. No actionable Critical, Important or Minor defect found.**

These are task review verdicts, not Docker/deployment, live-service reliability, merge or release approval.

## Findings

- Critical: none found.
- Important: none found.
- Minor: none found.

No implementation correction is required by this review. The evidence gaps below are not being classified as source defects.

## Independent source assessment

Requirements read first: `docs/superpowers/briefs/EP-05a.md`, `WAVE-2-common.md`, the inherited EP-02 common rules, the listed repository/product guidance, and the provider security contract in `docs/product/DATA_CONTRACTS.md`. Also inspected the EP-05 outline, author plan/report, saved fixtures, task commit list/stat/diff in `/tmp/opengym-review/ep05a-review.txt`, actual source, tests and supporting deployment wiring. The narrower brief governs the outline's later diary/UI task. The recorded Windows prerequisite waiver and Cloudroom communication authorization apply.

| Area | Assessment and source anchors |
| --- | --- |
| Exact normalization and basis | `api/food-lookup.js:55` validates the v3 success/result shape and product identity, including equivalent leading-zero GTINs. `api/food-lookup.js:63` requires explicit `aggregated_set.per` of 100g/100ml and as-sold preparation. Both saved upstream fixtures report 100g, including the drink sold in ml; code preserves that distinction. No inferred density or legacy v2 numeric-status assumption. |
| Unknown versus zero | `api/food-lookup.js:50` accepts finite numeric values only, with expected units and bounds; excludes qualified/estimated values and never substitutes computed-only values. `api/food-lookup.js:69` prefers valid kcal, otherwise converts valid kJ by 4.184 with conversion metadata. Explicit zero survives; absent/invalid nutrients remain absent. |
| Provenance and text | `api/food-lookup.js:33` bounds/sanitizes the three free-text fields. `api/food-lookup.js:38` parses explicit g/ml servings into a canonical label. `api/food-lookup.js:81` returns only selected fields, requested external ID, fetch time, source and fixed attribution/product/licence links. No image fields escape. |
| Authorization and discovery | `api/server.js:2129` obtains identity from existing signed-session verification, reads that user's current stored module choice, and accepts only one barcode parameter. `api/food-lookup.js:202` checks authenticated identity, strict operator/module booleans and barcode before cache/transport. `api/server.js:2124` exposes setup status only to signed-in callers; `api/food-lookup.js:201` never claims successful availability or probes the provider. |
| Fixed outbound request and DNS | `api/food-lookup.js:168` constructs the fixed HTTPS v3.6 path/query and selected fields. `api/food-lookup.js:151` permits only a bounded operator contact in fixed app/version headers. `api/food-lookup.js:108` validates all connection-time DNS answers; `api/food-lookup.js:95` also rejects private-address overrides and embedded IPv4 variants. `api/food-lookup.js:122` checks origin, uses the guarded socket lookup with no pooled agent, and does not follow redirects. No request cookie, authorization, uid or profile fields are forwarded. |
| Resource and failure bounds | `api/food-lookup.js:131` bounds DNS/TCP/TLS connection time. `api/food-lookup.js:156` imposes total timeout including body, rejects compressed/non-success responses, caps streamed bytes before parsing, destroys streams and maps untrusted errors to stable messages. `api/food-lookup.js:207` counts cache hits against user rate limits, reserves instance budget before awaiting transport and bounds cache size/TTL. The 7 calls/61-second instance window allows at most 14 across adjacent window boundaries in 60 seconds. Per-process/restart/shared-IP limitations are documented. |
| Packaging and scope | `api/Dockerfile:56` includes the new module in the common COPY manifest; package.json and its local imports are present in the image recipe. Compose passes `.env`; Helm's existing config-map/envFrom path carries the added switches. OpenAPI and generated docs describe the route. No task changes to frontend, integration runtime, sync implementation or dependency manifests/lockfiles; no persistent lookup storage or passive fetch was introduced. Dockerfile approval and the minimal existing config-test adjustment are recorded in the author report. |

## Evidence checked, not rerun

The commit history and saved failure output establish plan-before-code and RED-before-GREEN:

| Behavior | RED | GREEN |
| --- | --- | --- |
| Normalization/GTIN | `632adddd`, 0/20; explicit missing-function assertions | `fbd291b6`, 20/20 |
| Transport/DNS/cache/rates | `16f49bff`, 0/24 | `0b93c184`, 44/44 including normalization |
| Embedded IPv4 override | `dd8bbaa3`, reproduced NAT64 bypass, 0/1 | `13b3b325`, 44/44 |
| Actual HTTP route/config | `1f28611e`, 0/12 against missing route | `176b1698`, 62/62 including manifest/OpenAPI checks |

Plan `57cc27c1` precedes every source change. RED commit bodies identify actual assertions/results and logs. The Docker COPY test separately recorded 1 pass/1 fail before the manifest correction. Later live-fixture and newline tests add coverage without changing runtime; they are not misrepresented as original RED work.

Inspected final logs substantiate frontend **7,917/7,917**, API **911/911**, MCP **140/140**, production build, locale/source-string checks and all three generator checks. The first API run's sole failure was the exact config expectation missing the new field; the final test preserves exact anonymous-response checking. These are author-run Node v22.23.5 results, not reviewer reruns. Full suites were not rerun.

Reviewer `git diff --check 57cc27c1^ c976b963` passed with no output. Inspected task file scope excludes inherited orchestration documentation. Runtime-file comparison against `176b1698` was empty. Frozen checkout was clean at review start.

## Focused independent offline reproduction

One small inline Node **v22.23.5** probe addressed concrete boundary/cleanup doubts absent from the explicit tests. HTTPS was replaced with a function that throws if used, DNS was stubbed, and response streams were synthetic. It passed:

1. Exactly **65,536 bytes** of valid JSON plus whitespace succeeds; **65,537 bytes** returns 502; streams are destroyed.
2. A transport resolving only after a 20 ms injected total deadline returns 504 and destroys its late stream.
3. Seven private/embedded address variants are rejected despite broad `ALLOWED_PRIVATE_IPS` overrides: ordinary loopback/private IPv4, ULA IPv6, compatible/mapped IPv4, NAT64 and 6to4. A public IPv4 single-address callback succeeds.

Probe exited 0. It created no files or servers and made no network requests. No dependency installs, heavy tests, subagents or Claude were used. Only this report was written.

## Cannot-verify evidence gaps and practical limits

- **Docker image build/boot remains UNVERIFIED.** Static COPY/dependency inspection and saved manifest/HTTP test results support packaging, but do not establish either image target boots in Docker. Required follow-up before claiming image readiness: build and boot the applicable targets in a Docker-capable environment.
- **GitHub Actions remains UNVERIFIED/unavailable.** Local saved green logs are the available regression evidence; no new CI success is claimed. Run required CI when the fork permits it.
- **Live-product budget remains exhausted at 3/3.** This review made zero live product calls and no external documentation requests. Upstream contract/licence verification is limited to the author's dated linked research and saved image-free responses; their retrieval history cannot be independently authenticated from these artifacts. The 100ml branch and upstream failure cases are synthetic-tested, not independently live-confirmed.
- Rate limiting and caching are deliberately per process, reset on restart, and do not coordinate replicas or other services sharing an IP. Serving mass/volume conversions, diary snapshots/UI, standalone-phone lookup, staging and release remain outside EP-05a. A later consumer must retain attribution and must not silently convert the drink fixture's g basis into ml.

**Recommendation:** accept the reviewed EP-05a task implementation with these explicitly retained verification limits. Keep Docker/CI readiness separate from this source-review acceptance.
