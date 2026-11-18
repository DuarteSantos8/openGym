# openGym webhooks in Node-RED

An importable Node-RED flow that receives openGym's webhooks and only lets through the ones openGym
really sent. It checks the signature over the exact bytes received, refuses old timestamps, answers a
repeated delivery without running it twice, and caps the body size. The handler at the end is a
harmless demo: it describes the event and does nothing else. Replace it with what you want to happen.

Tested with Node-RED **5.0.9** (the e2e test below runs it).

| File | What it is |
|---|---|
| `opengym-webhook-flow.json` | The flow to import. Generated, do not edit by hand. |
| `verify.js` | The check itself. The flow's "Check openGym signature" node runs this file's code. |
| `build-flow.mjs` | Writes the JSON from `verify.js`; `--check` fails when the JSON is stale. |
| `sign-example.mjs` | Prints curl commands signed the way openGym signs, to try the flow by hand. |
| `test/` | Unit tests of the check and of the flow, signed with openGym's own code. |
| `e2e/` | Starts a real Node-RED with the flow and sends it real requests. |

## Set it up

1. **Add the webhook in openGym.** Settings → Integrations → Webhooks → Connect. The URL is your
   Node-RED's address plus `/opengym/webhook`, for example `https://nodered.example.com/opengym/webhook`.
   openGym shows the **signing secret** (`ogwh_…`) once. Keep it.
   Node-RED on your home network over plain http (`http://192.168.1.20:1880/...`) needs the openGym
   admin to set `INTEGRATIONS_ALLOW_LAN=1` ([docs/INTEGRATIONS.md](../../docs/INTEGRATIONS.md)).
2. **Give Node-RED the secret as an environment variable**, `OPENGYM_WEBHOOK_SECRET`, on the Node-RED
   process. Docker: `-e OPENGYM_WEBHOOK_SECRET=ogwh_...` (or `environment:` in compose, from an
   `.env` file that is not in git). Do not type it into the flow or a tab's environment properties:
   those are saved in the flow and travel with every export.
3. **Import the flow.** Menu → Import → select `opengym-webhook-flow.json` → Import → Deploy.
4. **Send a test.** In openGym, the webhook's sheet → *Send test event*. The *Event summary* debug
   node shows `(test) Workout finished: Test workout, 3 sets`.

Optional environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `OPENGYM_WEBHOOK_TOLERANCE_SEC` | `300` | How old (or how far ahead) a signature's timestamp may be. |
| `OPENGYM_WEBHOOK_MAX_BYTES` | `65536` | Largest body accepted. openGym's payloads are a few KB. |

### Two Node-RED settings this depends on

- **"Do not parse request body"** is ticked on the *openGym webhook* (http in) node; the import does
  this. The signature is over the bytes openGym sent, so the check needs them unchanged. With it,
  Node-RED hands the body over as a Buffer: `skipBodyParsing` in
  `@node-red/nodes/core/network/21-httpin.js` (5.0.9: lines 261 to 271) adds the route to
  `rawBodyCapture` (lines 107 to 126), which sets `req.body` to the raw Buffer and skips every
  parser. Untick it and the node answers 500 and logs why.
- **`functionExternalModules` is not `false`** in `settings.js` (it is `true` by default). The check
  node loads Node's built-in `crypto` through its Setup tab (*Modules*: `crypto` as `crypto`),
  the supported way for a Function node to use a module (`10-function.js`, `libs`).

## What it checks, in order

1. The secret is set, and the body arrived raw. Otherwise 500.
2. The body is at most `OPENGYM_WEBHOOK_MAX_BYTES`. Otherwise 413, before any other work.
3. `X-OpenGym-Signature` is exactly `t=<digits>,v1=<64 lower-case hex>`. Otherwise 401.
4. `t` is within the tolerance of Node-RED's clock, either way. Otherwise 401.
5. HMAC-SHA256 of `"<t>." + raw body` with the secret equals `v1`, compared with
   `crypto.timingSafeEqual`. Otherwise 401.
6. Only now the body is parsed: JSON, `version` 1, a string `id`, a string `type`. Otherwise 400.
   An authentic event of a type this flow does not handle yet (one openGym adds later) gets a
   200 `{"ok":true,"ignored":true}` and goes nowhere: a 400 would be a final failure in openGym
   and mark the webhook *Needs attention*.
7. The `id` from the signed body has not been seen in the last twice-the-tolerance. If it has: 200
   `{"ok":true,"duplicate":true}` and nothing runs. An id counts as seen only once the handler has
   finished (the *Record as delivered* node, after it). If the handler throws, openGym gets a 500
   and its retry, with the same id, runs the handler again instead of being dropped as a duplicate.

`X-OpenGym-Delivery` carries the same id but is not signed, so it is never used. Every refusal
answers a fixed body (`{"error":"unauthorized"}` and so on); the reason goes to the Node-RED log
only, and never includes the secret or the expected signature.

## What each answer means to openGym

openGym reads the status code (`api/integrations/providers/webhook.js`):

| The flow answers | When | openGym |
|---|---|---|
| 200 `{"ok":true,"handled":…}` | A new, authentic event, handled | Delivered |
| 200 `{"ok":true,"duplicate":true}` | The same delivery again (openGym retries with the same id) | Delivered, nothing runs twice |
| 200 `{"ok":true,"ignored":true}` | Authentic, of a type this flow does not handle | Delivered |
| 400 | Signed, but not an openGym version-1 event | Failed, not retried |
| 401 | Missing, malformed, wrong or expired signature | Failed, not retried |
| 413 | Body too large | Failed, not retried |
| 500 | Secret not set, body not raw, or the handler threw | Retried later with backoff |

## Try it by hand

```bash
OPENGYM_WEBHOOK_SECRET=ogwh_... node contrib/node-red/sign-example.mjs http://localhost:1880/opengym/webhook
```

prints three curl commands: a valid delivery (200, and 200 duplicate when run twice), a tampered
body (401) and a ten-minute-old signature (401). They are signed when printed, so print fresh ones
after five minutes. The secret itself is not printed.

## Limits, said plainly

- **Replay memory resets on restart.** Seen ids live in the flow's context (the check and *Record
  as delivered* share it), in memory by default. A
  delivery captured in the last few minutes could be accepted once more right after a restart (its
  timestamp still has to be inside the window). To keep them across restarts, give Node-RED a
  persistent context store in `settings.js`:
  `contextStorage: { default: { module: "localfilesystem" } }`. Several Node-RED replicas behind
  one URL do not share this memory.
- **Node-RED reads the whole body before the flow can refuse it.** `rawBodyCapture` has no size limit
  of its own (the e2e sends 8 MiB and gets 413, after it is in memory). On an exposed instance, cap
  the size in front of Node-RED, for example nginx `client_max_body_size 64k;` on this location.
- **The signature proves who sent it, not secrecy.** Over plain http the payload (workout names,
  weights) crosses the network readable. Use https outside your home network.
- **A handler that does its work and then throws runs again on the retry.** Make the handler's
  effects safe to repeat (keyed by `msg.opengym.id`) if a second run would matter.
- **Clocks.** The timestamp check needs both clocks roughly right (NTP). A Node-RED clock off by more
  than five minutes refuses every delivery.
- At most 10,000 ids are remembered; past that the oldest go first. Only authentic deliveries are
  stored, so nobody without the secret can fill it.

## Troubleshooting

| openGym or Node-RED shows | Cause | Fix |
|---|---|---|
| openGym: *answered 500*; Node-RED log: `OPENGYM_WEBHOOK_SECRET is not set` | The variable is not in Node-RED's environment | Set it on the process (step 2) and restart Node-RED |
| Node-RED log: `raw body not available` | "Do not parse request body" is unticked | Tick it on the http in node, Deploy |
| Node-RED log: `crypto module not available`, or the node will not start (`externalModuleNotAllowed`) | `functionExternalModules: false` in settings.js | Set it to `true`, or remove the line |
| openGym: *answered 401*; log: `signature does not match` | The secret in Node-RED is not this webhook's | Copy it again; lost it? Disconnect the webhook in openGym and add it again for a new one |
| log: `timestamp outside the 300 s window` | A clock is off, or something delayed the request | Fix NTP; raise `OPENGYM_WEBHOOK_TOLERANCE_SEC` only if you must |
| openGym: *answered 413* | A proxy or the limit is lower than the payload | Raise `OPENGYM_WEBHOOK_MAX_BYTES` (and the proxy's limit) |
| openGym: *That address is not one openGym calls* | Node-RED is on a private address | `INTEGRATIONS_ALLOW_LAN=1` on the openGym server |
| openGym: *redirects are not followed* | The URL redirects (http to https, a trailing slash) | Use the final URL |
| Nothing in the debug sidebar, openGym says delivered | It was a duplicate | Expected: openGym's retry of a delivery already handled |

## Tests

```bash
cd contrib/node-red
npm test          # 22 tests: the check and the flow, signed with openGym's own api/integrations/crypto.js
npm run check     # the JSON matches verify.js
npm run e2e       # installs Node-RED 5.0.9 from e2e/package-lock.json, runs the flow, sends 16 kinds of request
```

After changing `verify.js` or `build-flow.mjs`, run `node build-flow.mjs` and commit the JSON.
