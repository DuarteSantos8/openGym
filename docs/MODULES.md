# Modules

openGym can be a plain training log or the whole lot. **Settings → Modules** switches whole
feature areas on and off, so the app shows only what you use. The idea came from the community on
Discord (thanks seals187 and Shadowbyte): "it's important not to overload the app with 1000
functions and settings".

These are parts of openGym itself, not third-party plugins. Nothing outside the app can add code.

## What stays on

Logging a workout, your plans and routines, history, the exercise library and the basic stats
(workouts, the activity heatmap, exercise progress, muscles) are the core. They are not modules and
cannot be switched off.

## The modules

| Module | What it adds, and what disappears while it's off |
|---|---|
| **Effort** | The RIR or RPE column in a workout, the Effort part of Stats, effort on the exercise chart and in its day list, the Effort per set setting. Ratings you already logged stay in your history. |
| **Plates and warm-ups** | The plate line under each set (and the plate badge in Focus view), and automatic warm-ups. Warm-ups you planned yourself stay. Your plates, bars and dumbbells in Equipment stay, as they also round weights. |
| **Strength levels** | The Strength levels card in Stats, the level in an exercise's detail, the About you row. |
| **Form videos** | Filming a set, the video badge on a set row, the form videos in an exercise's detail. Videos you filmed stay. |
| **Watch** | The Apple Watch and Zepp OS pages. A paired Apple Watch, Wear OS, Zepp or Garmin watch is told there is nothing to show, as with the watch's own off switch. It stays paired. |
| **Gym check-in** | The check-in card on Home, the check-in screen with your membership codes, NFC stickers. Your cards stay. Before 1.4.4 this had its own switch in Look & Home, which still counts until you set the module. |
| **Body** | The body weight card on Home, the Body part of Stats (weight chart, goal, measurements, progress photos) and its Weight 30d figure, the weigh-in before a workout, the measurements and photos screens, the weight block of the widgets, the body weight settings. |
| **Health** | The Apple Health and Health Connect pages and cards, the Works with list, live heart rate during a workout, recovery tips on Home. Syncing with the health app pauses (see below). |
| **Motivation** | The streak card on Home and in Stats, monthly challenges and the trophy shelf, the week and month recap, Your year (its Home card, its Stats rows and its December notification), Share as image, the streak on the watch. With it off, Weekly sets on Home gets a small card of its own. |
| **AI Coach** | The Coach button on Plan, Ask the Coach in a workout, the Coach screens, its Settings row and Integrations card, scheduled reviews. |
| **Integrations** | The Webhooks and MCP server cards and search hits. Webhooks pause (see below). Imports and the CSV export are core and stay. |
| **Seasonal themes** | Halloween, Christmas and the advent calendar, their colours and decorations, the Seasonal themes page. |

A module that is off is gone everywhere it shows: Home, Stats and its index, Settings pages and
rows, the Settings search, tour stops that point at it (they are passed over), notifications it
would send, widget fields.

## Presets

The row at the top picks a preset for every module at once:

- **Just training**: Effort, Plates and warm-ups, Watch. Everything else off.
- **Training and body**: Just training plus Strength levels, Body and Health.
- **Everything**: every module on.
- **Custom** is what the row says once you flip a switch away from a preset.

New profiles are asked once, on the first card after setup (the one that offers the tour). Everything
is chosen until another one is tapped, so skipping straight on gives you every module.

## Nothing is deleted

Switching a module off only hides it. Your weigh-ins, photos, ratings, videos, challenges and the
rest are kept, backed up, exported and synced as always. Switch it back on and everything is where
it was.

A module that is connected to something asks once before it goes off and says what pauses:

- **Health**: the sync with Apple Health or Health Connect pauses, in both directions. Nothing is
  disconnected; switched back on, it catches up with what changed meanwhile.
- **Watch**: the watch gets no workouts while it's off. It stays paired.
- **Integrations**: your webhooks stop sending. They stay set up; events that happen while it's off
  are not sent later.
- **AI Coach**: scheduled reviews pause, on your server and on a phone with its own key. Your setup
  and chats stay.

## Sync

The modules are a setting of your profile and sync between your devices like other settings, one
module at a time: Body off on the phone and Seasonal themes off on the laptop both hold.

## The Coach and the MCP server

Modules are about what the app shows. The data is the same either way, so the AI Coach (when its
module is on) and the MCP server keep reading everything they read before, body weight included
when Body is off. That is a deliberate choice: hiding a part of the screen should not change the
advice you get or what your own assistant can answer.

## For developers

- `frontend/src/lib/modules.js` is the one source of truth: ids, groups, presets, `isOn(S, id)`,
  `presetOf`, `applyPreset`, `setModule`. Views call `isOn`, never `S.modules` directly. Its words
  are in `lib/modules-copy.js`, inside `t()` so the string checks see them.
- `S.modules` is `{ [id]: boolean }` with only the choices made; a missing key is on. It is a
  per-key field in `lib/sync-merge.js` and `api/sync-stamps.js` (`PER_KEY`).
- Central gates rather than checks in every view where a helper already decides: `effortOf`
  (history.js), `warmupAutoOf` (warmup-ramp.js), `activeSeason` (seasonal.js), `challengesOn`,
  `recapOn`, Wrapped `notifyOn`, `syncHealth` / `readHealth`, the watch snapshot, the Coach gate and
  schedule, `directory()` in lib/integrations.js, and the settings index (`mod` on `PAGES` and
  `SEARCH` entries in views/settings-pages.js).
- The server reads `S.modules` in three places: the Wrapped push (`api/wrapped.js`), scheduled Coach
  reviews (`api/coach/core/due.js`) and the webhook hub (`api/integrations/index.js`).
- A new module: add it to `MODULES` (and to a preset), its words to `modules-copy.js` and every
  locale, its `MODULE_KW` search words, then gate its surfaces with `isOn`.
