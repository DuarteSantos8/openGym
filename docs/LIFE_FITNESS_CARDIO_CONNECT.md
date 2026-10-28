# Life Fitness cardio consoles: the QR codes

A Life Fitness cardio console (bike, treadmill, cross trainer, stair climber, rower) shows a QR
code in two places. openGym reads both with the scanner it already has: the QR button in a
running workout. Nothing goes over the network.

## The two codes

Both are URLs on `lfconnect.com` (or `halo.fitness`); `vtqa` in the host is the test
environment. Anything else is not a Life Fitness code and goes to the next scan handler.

| Code | Shape | What openGym does |
|---|---|---|
| **Result** | `https://lfconnect.com/q?t=c&r=<Base64 JSON>` | Shown at the end of a workout when no app was connected. The whole summary is in `r`: it becomes a cardio set. |
| **Connect** | `https://lfconnect.com/q?t=c&a=…&u=…&l=…&x=…` | Shown in the console's connect menu, to join it over Bluetooth. openGym has no live link: it says so and points at the result code. Nothing changes. |
| other | `t=c&s=…`, `t=s…` | Console login and strength machines: not supported, said so. |

The query is read the way Android's `Uri.getQueryParameter` reads it: `%`-escapes decoded, a `+`
kept as `+` (`URLSearchParams` would turn it into a space and break the Base64). Standard and
URL-safe Base64 are both accepted.

## The result JSON

| Key | Meaning |
|---|---|
| `id` | GUID of the workout (openGym keeps it on the set to recognise the same code twice) |
| `bs` | console serial number |
| `t` | console model id |
| `et` | duration, seconds |
| `c` | kcal |
| `d` `{v, u}` | distance |
| `dc` `{v, u}` | climbed: height, or steps/floors on a stair climber |
| `as` `{v, u}` | average speed |
| `ap` `{v: "mm:ss"}` | average pace |
| `ai` | average incline, % |
| `al` | average level |
| `ahr` | average heart rate |
| `am` | METs × 10 |
| `aw` | average watts |
| `ar` | average rpm |
| `asl` | stride length |
| `dt` | date (Java `Date.toString()` or ISO) |

**Units:** `u == 1` is metric (km, km/h, m), any other value imperial (mi, mph, ft). On a stair
climber `dc` counts steps when `u == 1`, otherwise floors (17 steps each).

**Model id → machine:** `t` names the console model. `lib/lfopen/devices.js` maps the known ids
to six kinds of machine (upright bike, recumbent bike, treadmill, cross trainer, stair climber,
rower) and those to an openGym exercise: a custom exercise with a matching name first, otherwise
the catalogue's. An id it does not know asks which exercise it was.

## In openGym

| File | Role |
|---|---|
| `frontend/src/lib/scan-dispatch.js` | The first scan handler that recognises a code wins; exercise stickers stay the last one, unchanged. |
| `frontend/src/lib/lfopen/qr.js` | `parseLfUrl`: result / connect / unsupported / invalid. |
| `frontend/src/lib/lfopen/result.js` | The JSON above → a cardio set: minutes, km/h, a treadmill's incline; distance, kcal, heart rate, watts, cadence and level in the set's note. |
| `frontend/src/lib/lfopen/devices.js` | Model id → kind of machine → exercise. |
| `frontend/src/lib/lfopen/assign.js` | Where the set goes: the exercise you are on takes it without a question; one further down the workout, or one to add, is offered first. |
| `frontend/src/views/Workout.jsx` | The workout's QR button → dispatcher → Life Fitness handler. |

Scanning the same result twice is recognised (`id`), a broken code says it could not be read,
and the set comes with Undo.

## Not done

- A live Bluetooth link to the console (the connect code). `lib/lfopen/protocol.js` holds pure,
  unused groundwork for it; it needs a Bluetooth plugin and is out of scope here.
- A scan outside a running workout (the scanner sits in the workout).
- A test vector from a real console: the tests use hand-made codes in the format above.
