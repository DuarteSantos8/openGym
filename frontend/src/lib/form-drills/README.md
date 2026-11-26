# Form check drills

Form check films the lifter with the iPhone camera (`ios/App/App/FormCheckPlugin.swift`), and a
**drill** turns the 2D body pose into reps (or seconds held) and a few measured facts. Everything
around the drill is drill-agnostic: the page glue (`lib/form-check-native.js`), the sheets
(`components/FormCheckSheet.jsx`), the stored standard (`lib/form-check-standard.js`) and the
Workout entry (`views/Workout.jsx`, "Form check" shows on an exercise when `drillFor(ex)` finds a
drill).

A drill measures, it never grades: depth is where a joint was, tempo is seconds, lean is degrees.

## Adding a drill

1. `form-drills/<id>.js`: one self-contained module, `export default` a drill definition (below).
2. `form-drills/<id>.test.js`: its tests, every case filmed at several yaws through `test-kit.js`
   (at least `YAWS` for the views it claims; see `squat.test.js`).
3. One import line in `form-drills/index.js` (`DRILLS`); a more particular drill goes before a
   broader one, since `drillFor()` takes the first that matches.
4. Its strings in every locale (`src/locales/*.js`, pt-BR in `PT_BR_OVERRIDES` when it differs):
   the declared ones (name, setup, standard labels, misses) are checked by `index.test.js`; the
   ones it passes to `t('...')` itself by `node scripts/check-source-strings.mjs --strict`.

Nothing else changes. `index.test.js` runs every registered drill through `checkDrill()`, checks
its declared strings in every locale, and pushes an empty frame through it.

## The drills

In `index.js` order (`drillFor()` asks them in this order), with the views each judges:

| drill | kind | views | what it reads |
| --- | --- | --- | --- |
| `squat` | reps | side, front, diagonal | hip drop and hip against knee |
| `split-squat` | reps | side, diagonal, front | hip over the front knee |
| `side-lunge` | reps | front | hip drop, hip against the bending knee, the other knee |
| `romanian-deadlift` | reps | side, diagonal, front | the hinge, hands against the legs |
| `hip-abduction` | reps | front | the working leg's angle out from upright, torso lean, knee |
| `pull-up` | reps | front, side, diagonal | wrists over shoulders, nose over the wrists |
| `hanging-leg-raise` | reps | side | thigh lift against the torso while hanging, knees, swing |
| `inverted-row` | reps | side, diagonal | chest to the bar |
| `chest-supported-row` | reps | side | elbows past the shoulder-hip line |
| `seated-cable-row` | reps | side | wrist in to the shoulder, elbows to the torso, straight-arm start |
| `rear-fly` | reps | side, front, diagonal | elbows to shoulder height |
| `upright-row` | reps | front, diagonal | elbows to shoulder height, both arms, torso tilt |
| `straight-arm-pulldown` | reps | side | the angle at the shoulder between hip and wrist |
| `push-up`, `dip` | reps | side, diagonal, front | shoulders against the elbows |
| `overhead-press` | reps | front, diagonal | lockout |
| `triceps-pushdown` | reps | side, diagonal | lockout, elbow drift |
| `curl` | reps | side, front, diagonal | the forearm's swing |
| `lateral-raise` | reps | front, diagonal | elbows to shoulder height |
| `front-raise` | reps | side, diagonal | wrists to shoulder height and back to the hang, lean, elbows |
| `side-plank` | hold | front | the body line |
| `plank` | hold | side | the body line |
| `wall-sit` | hold | side | thigh against level, torso against upright |

The registry test (`index.test.js`) checks that no catalogue exercise matches two drills and pins
the neighbours that look alike (lateral and front raise, pull-up and hanging leg raise,
chest-supported and seated row, squat, split squat and side lunge, rear fly and upright row,
triceps pushdown and straight-arm pulldown).

## The contract

```js
export default {
  id: 'squat',                  // lower-case letters, digits, dashes; also the stored-standard key
  name: 'Squat',                // English key for t()
  kind: 'reps',                 // 'reps' | 'hold' (a hold reports seconds held in good position)
  views: ['side', 'front', 'diagonal'], // the camera angles it can judge, best first (the intro's "Works from")
  setup: 'Phone at knee height and level, ...', // English key for t(): the intro's how-to-stand line
  matches(ex),                  // catalogue exercise { id, n, cat } -> boolean. An id allow-list
                                // plus a guarded name test (kit.matchExercise). false for null.
  standards: [{ id: 'parallel', label: 'Parallel' }, ...], // label: English key for t()
  defaultStandard: 'parallel',  // one of the standards' ids
  misses: {                     // why a rep did not count, by reason id (English keys for t())
    shallow: { line: 'Too shallow. Not counted.', say: 'Too shallow', row: 'Not counted: too shallow' },
  },                            // line: status line for 2 s; say: spoken; row: under the rep in "Every rep"
  create({ standard, view }),   // -> tracker. standard: one of standards (the glue passes a valid one);
                                // view: optional, holds the tracker to 'side' | 'diagonal' | 'front'
                                // instead of detecting it
}
```

### The tracker

`tracker.push(frame)` is called about 15 times a second with one frame:

```js
frame = { t: 1234,              // ms, the camera clock
          aspect: 0.75,         // image width / height; stretch x by it before any distance or angle
          joints: { leftHip: [x, y, conf], ... } } // normalised, y down; only joints Vision saw
                                // (nose, neck, left/right Shoulder Elbow Wrist Hip Knee Ankle, root)
```

and returns, every frame:

| field | type | meaning |
| --- | --- | --- |
| `count` | number | counted reps so far (`hold`: whole seconds held in good position) |
| `phase` | string | `'waiting'`, `'standing'`, `'descending'`, `'bottom'`, `'ascending'` (kit phase machine), or the drill's own |
| `inFrame` | boolean | false when the frame cannot be judged (a framing problem); the glue then never overrides `hint` |
| `hint` | string | the translated status line ('' for none): framing, view, camera, "stand tall", "ready" |
| `justCounted` | boolean | true on the one frame a rep is counted: the glue says `count` aloud, flashes green (`hold`: set it when a spoken milestone is due; the glue says "{count} seconds", and VoiceOver hears only those) |
| `justMissed` | boolean | true on the one frame a rep ends without counting |
| `reason` | string or null | with `justMissed`: a key of `misses` |
| `reached` | boolean | the rep under way already meets the standard |
| `highlight` | string[] | joint names the overlay draws large and green now (usually `reached ? [...] : []`) |

`tracker.result()` may be called at any time and returns:

| field | type | meaning |
| --- | --- | --- |
| `count` | number | counted reps (`hold`: seconds held) |
| `missed` | number | reps that did not count |
| `reps` | array | `{ counted, reason, lost, measures }` per rep in order, no-reps included; `reason` a `misses` key or null, `lost` the camera lost the lifter mid-rep, `measures` the drill's numbers (free-form) |
| `tiles` | array | 0 to 3 headline stats `{ id, label, value, sub? }`, translated strings; the sheet shows them as they come |
| `cue` | string | the one translated sentence the result ends with |
| `cueId` | string | its id; `'missed'` renders as a warning, anything else as a tip |
| `details` | array | per rep (same order as `reps`), a list of `{ label, value }` translated rows for "Every rep" |
| `note` | string | optional, one translated line under "Every rep" ('' for none) |

A drill may add fields of its own (the squat adds `summary`, `standard`, `view`); the glue adds
`drill` and `kind`. Only the fields above are read by the sheets.

Rules every drill keeps:

- Counted reps only in `count` and in the set's averages; no-reps stay in `reps` with `counted: false`.
- A rep the camera lost for a moment counts (it is flagged `lost`); one lost for longer than
  `LOST_RESET_MS` is dropped. The kit's phase machine does this for you.
- Measure only what the view can show (`views`, and `kit.createViewDetector()` at run time).
  An angle the drill cannot judge says so in `hint` (`kit.viewHint`).
- Strings: translate at call time (functions, or `t()` inside `push`/`result`), never at import.

## The kit (`kit.js`)

| helper | what |
| --- | --- |
| `seen`, `mid`, `dist`, `angleAt`, `deg` | joints over the confidence floor, a pair's middle, distances and the angle at a joint, x stretched by `aspect` |
| `ema`, `mean`, `round1`, `spread`, `fades` | smoothing and small statistics (`fades`: the last third fell below the first) |
| `chainConf`, `pickSide`, `createSidePicker` | the better-seen side of a chain, smoothed over time |
| `widthRatio`, `createViewDetector`, `detectView` | the view from shoulder and hip width over torso length (about 0.58 sin(yaw)), read while standing, with hysteresis |
| `framing`, `framingHint`, `viewHint` | why a frame cannot be judged and the status lines for it |
| `createPhaseMachine(thresholds)` | the rep state machine on one scalar, 0 at the top to about 1 at full depth, with the lost-pose rules |
| `tempo(rec)` | a rep record's way down and up in seconds |
| `pickCue(rules)` | the first `[id, test]` that holds |
| `matchExercise(ex, rule)` | the catalogue test: id allow-list, name pattern, exclusions, categories |

## The test kit (`test-kit.js`)

A 3D stick figure (`BODY`, metres), posed per drill (`squatPose(knee, { cave, shift })`; write a
`<movement>Pose` for a new drill), turned by a camera `yaw` (0 side-on, 90 facing the camera, any
value) and filmed through a pinhole camera (`CAMERA`: 2.6 m away, at knee height, level, 64°
vertical field, 3:4 portrait) into the frames the plugin emits. `project()` films one pose,
`film()` a list, `squatSet()` a set of reps. Options: `noise` (image units), `drop` (chance a
joint is missing), `gap: [from, to]` (ms with no pose), `height`, `pitch`, `dist`, `seed`.
The far side's confidence falls the more side-on the view, as Vision's does.

## The squat (`squat.js`)

Counted from image-vertical signals that turning about the vertical axis leaves alone: the hip's
drop from standing over the standing leg, and the hip's height against the knee's for depth.
Side-on it adds the knee angle, its spread and the torso lean; from the front, knees caving in
and the hips shifting sideways; at an angle, count, depth and tempo only. Facing the camera,
perspective makes a camera above or below the knees misjudge depth, so outside a side view depth
is judged only with the phone at knee height and level (the status line asks for it). Tested at
yaw 0, 30, 45, 60, 90, 135, 180 and -45.
