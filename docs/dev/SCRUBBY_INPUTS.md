# Optional workout value scrubbing

Enable **Settings → Workout → Fine-tuning → Scrubby slider**. The switch stores
`S.wc.scrubby`, defaults to false for new and existing profiles, and is independent of
the weight/reps buttons. It uses the existing profile persistence and sync writer.

Cards, List, Compact and Focus support weight, reps and visible RIR/RPE fields, including
individual sides and drop/burst inputs where those fields exist. Disabled Focus fields
remain disabled. Duration, speed and incline keep their existing input methods.

## Interaction and implementation

- A transparent, non-editable hit surface covers an unfocused numeric input while scrubbing
  is enabled. Touch therefore never starts on a native editable element: Android WebView cannot
  open its keyboard during the hold. A short release focuses the real input in the same user
  task. Mouse down focuses it immediately; keyboard/assistive focus is never blocked. While
  the input is focused the hit surface stops intercepting events, preserving native caret
  and selection behavior. Disabled scrubbing adds no hit surface. Effort taps keep their picker.
- Hold a touch or pen for 300 ms to activate, with a subtle accent and the existing haptic
  utility. Movement beyond 8 px before activation cancels recognition and allows scrolling
  or an ancestor's horizontal swipe.
- Move up to increase, down to decrease. The first step needs a 4 px dead zone plus 18 px;
  subsequent steps consume 18 px. Residual movement is retained. Reversing at a bound or
  an equipment-list endpoint does not require undoing unreachable steps.
- Only a changed value is committed on release, once. Releasing at the initial value makes
  no write. Cancellation discards the entire preview. No intermediate values reach Zustand,
  persistence, sync, weight cascading or warm-up recalculation.
- The hook cancels on a second pointer, pointer cancellation, losing its own capture,
  backgrounding, window blur, Escape, unmount, target changes or any profile-state change.
  The live validity check also protects the interval before a React rerender.
- Native non-passive touch listeners prevent scrolling only while active. Changing
  `touch-action` during an existing gesture is deliberately avoided. The original input's
  implicit pointer capture (on the hit surface or effort button) can transfer to the wrapper
  without cancelling the gesture.
- Movement is intercepted while active; release still reaches ancestor swipe handlers so
  their pending presses are cleared. A temporary document click guard prevents the release
  from opening a picker or triggering a control, even if committing unmounts the original
  field. It leaves keyboard clicks alone and expires or clears on the next press.
- Haptics use `sound.js` and its existing preference/native bridge. Activation is 6 ms;
  changed values use 4 ms, at most once every 50 ms. Unsupported devices are harmless.
- The description is translated and attached with `aria-describedby`. Existing controls
  remain the accessible ways to edit values; there is no new required gesture or motion.

`EffortInput.jsx` owns one tint derived from the currently displayed RIR/RPE value. Row
layouts put it on the whole effort group; Focus and empty fields put it on the button.
Scrub feedback is an outline only. Inner pressed backgrounds and color transitions are
disabled during the scrub, so the original and preview tint cannot overlap. Cancellation
restores the original tint. The control stays mounted when a rating is created or cleared.

`scrubby-input.js` contains pure distance consumption. `use-scrubby-input.js` owns the
gesture and preview. `ScrubbyInput.jsx` renders the existing input/button through a render
prop, so no hooks live in workout row-rendering helpers. The generic Stepper opts in through
its `scrubby` prop. Workout-specific callbacks stay in the workout views.

Weight adapters use `stepWeight`, `weightIncrement`, `stepOwned`, existing exercise-unit
views and the existing update functions. Side edits share `editSide` across Focus and the
row layouts to preserve side aggregation, manual markers, inheritance and warm-up ramps.
Effort uses `stepEffort`, including its null/clearing semantics and half steps. Scrubbing is
always edit-only: it never calls a picker callback that completes a set or starts rest.
The short-tap picker's existing layout-specific completion behavior remains intact.

## Files

| Path | Responsibility |
|---|---|
| `frontend/src/lib/scrubby-input.js` | Pure gesture constants and distance consumption |
| `frontend/src/lib/use-scrubby-input.js` | Gesture lifecycle, local preview, cancellation and haptics |
| `frontend/src/components/ScrubbyInput.jsx` | Non-editable numeric hit target, reusable preview/frame adapter and accessible description |
| `frontend/src/components/EffortInput.jsx` | Single preview-derived effort tint and shared row/Focus controls |
| `frontend/src/components/ui.jsx` | Optional Stepper scrubbing and independent button visibility |
| `frontend/src/views/Workout.jsx` | Row, side, drop/burst and effort integrations; shared side edit pipeline |
| `frontend/src/views/FocusView.jsx` | Focus integration, respecting read-only fields and button setting |
| `frontend/src/lib/workout-controls.js` | Disabled-by-default profile setting |
| `frontend/src/views/Settings.jsx` | Independent settings switch |
| `frontend/src/views/settings-pages.js` | Settings search entry |
| `frontend/src/index.css` | Activation styling without changing field geometry |
| `frontend/src/components/ScrubbyInput.test.jsx` | Lifecycle, hit-target focus isolation, cancellation, haptics and click tests |
| `frontend/src/components/EffortInput.test.jsx` | Populated/empty previews, tint ownership, cancellation/commit and rating transitions |
| `frontend/src/lib/scrubby-input.test.js` | Distance, reversal and bound tests |
| `frontend/src/views/Workout.scrubby.test.jsx` | Real-store integration across layouts and value/update types |
| `frontend/src/views/settings-pages.test.jsx` | Independent settings and search regression coverage |
| `docs/dev/SCRUBBY_INPUTS.md` | Architecture and device verification instructions |

Both setting/description strings were added to all locale files:
`frontend/src/locales/ar.js`, `bn.js`, `de.js`, `es.js`, `fr.js`, `hi.js`, `hu.js`,
`it.js`, `ko.js`, `pl.js`, `pt.js`, `pt-BR.js`, `ru.js`, `sv.js`, `th.js`, `tr.js`,
`uk.js`, `zh.js`, `zh-TW.js`. Brazilian Portuguese has explicit overrides, leaving the
deliberately inherited-string fingerprint unchanged.

## Verification

Automated tests cover gesture thresholds/reversal, native-input focus, nullable effort,
pointer/capture cancellation, multitouch, app visibility, unmount cleanup, click suppression,
haptic throttling, equipment lists, kg/lb boundaries, side reps/weights, combined unilateral
reps, drops/bursts, weight inheritance, warm-up recalculation, one-write commits, no-write
cancellation, effort without completion/rest, setting persistence and all four settings
combinations. Existing workout, Focus, input, swipe and side-effort suites also remain relevant.

Run the targeted tests from `frontend/`:

```sh
npx vitest run src/components/ScrubbyInput.test.jsx src/lib/scrubby-input.test.js src/views/Workout.scrubby.test.jsx src/views/settings-pages.test.jsx
npm test
node scripts/check-locales.mjs
node scripts/check-source-strings.mjs --strict
npm run build
```

There is no ESLint/formatter configuration. Follow the surrounding JavaScript style and run
`git diff --check`. Phone packages still need their native build toolchains.

## Manual device checks

Use an expendable local workout on Android Chrome, Android WebView, iPhone Safari/PWA and
the iPhone app. Desktop Chrome touch emulation checks scrolling/capture but cannot certify
iOS keyboard, touch-callout or native haptic behavior.

1. Start with the switch off. Tap and type values, open effort pickers, and use +/- as before.
2. Enable scrubbing in Fine-tuning. Try all four layouts, with +/- both on and off.
3. Tap weight/reps briefly: the keyboard should open with the usual selection. Tap effort:
   the normal picker should open and retain its existing completion behavior.
4. Blur a text field, hold its value for 300 ms, then move up/down and reverse. Check the
   accent outline, discrete increments and haptics. Also hold directly on the displayed digits
   without moving. No keyboard, text selection or picker should appear during the hold, drag
   or release. Repeat at the edges of the number, and after scrolling. A short tap must still
   open the keyboard. Already-focused inputs retain their existing editing gestures.
5. Begin a vertical scroll immediately over a value. It must scroll without changing it.
   Begin a horizontal swipe immediately; normal row/card behavior must still work. Swipe
   again after releasing a scrub unchanged to verify ancestor gesture cleanup.
6. Compare regular weights with an irregular dumbbell/machine list, and an exercise pinned
   to lb in a kg profile. Check the stored result, inherited rows and pending warm-up ramps.
7. Check individual L/R values, combined unilateral warm-up reps, drop weights/reps and
   burst reps. Check their aggregates and ensure the other side remains unchanged.
8. For both RIR and RPE, start empty, move in half steps, reach bounds and clear downward
   through the floor. Start from a populated RIR 1 (orange) or RPE 9 (orange), scrub to
   RIR 2 (yellow) or RPE 10 (purple) and cancel/release. Exactly one rating background must
   track the preview and restore on cancel; check with +/- both shown and hidden, on each
   layout and each side, in light and dark themes. Scrubbing must neither complete the set
   nor start a rest timer.
9. Interrupt a preview with another finger, navigation, app switching or a workout update
   from another control/device. The preview must be discarded without a write.
10. Verify vibration off/on, light/dark themes, VoiceOver/TalkBack and reduced motion.
    Keyboard and picker editing must remain available without using the gesture.

## Validation limits and Windows baseline

happy-dom component tests check focus calls, hit-target composition, value/tint ownership and
state writes; they cannot certify a physical Android virtual keyboard. Native Chrome touch
checks additionally exercise actual browser hit-testing, focus, scrolling and computed colors.
A successful APK launch alone does not establish that the two reported UX issues are fixed
on the Samsung. Repeat the physical checks above on the updated OpenGymTest app.

On this Windows checkout the complete suite retains 11 baseline failures in six unchanged
files. The same failures are reproduced from the upstream base commit independently:

- `scripts/check-mobile-bundle.test.mjs` (4): POSIX path-string assumptions.
- `src/color-mix-fallback.test.js` (1): expected POSIX path separators.
- `src/components/Seasonal.lazy.test.jsx` (2): Windows separators prevent excluding test files.
- `src/lib/android-asset-packs.test.js` (2): POSIX path assumptions.
- `scripts/app-icons.test.mjs` (1): generated text differs from CRLF checkout files.
- `src/lib/csp.test.js` (1): CRLF changes the exact inline-script hash.

These files are not changed by this feature. The existing Git-for-Windows `bin` directory
must be on PATH for the separate shell-script tests in `api-base.test.js`.
