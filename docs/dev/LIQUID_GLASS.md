# Liquid Glass on iPhone

How the iPhone app gets its glass look, and the rules that keep it fast and readable. Notes for whoever touches it next. See [`CLAUDE.md`](../../CLAUDE.md) for the general architecture. The numbers live in `frontend/src/index.css`; this file explains why they are what they are.

The work was done in steps, G0 to G7. Comments in the code say "Liquid Glass G3" and so on. This file is the map.

## Scope

- iPhone app only. `App.jsx` sets `<html data-platform="ios">`. Every glass rule starts with `:root[data-platform="ios"]`. Android, the web and the iPad-as-web keep the old look.
- JS asks the same question with `isIOS()` in `lib/platform-now.js`. It reads the attribute when it is called, so a test can set it by hand.
- The components stay shared. Where the iPhone differs, the component branches on the flag (`ScreenHeader.jsx`, `Toast.jsx`, `TabBar.jsx`). Do not fork a screen for it.
- It is a web imitation. The app runs in a WKWebView, not SwiftUI. Glass, the lens and the springs are rebuilt in CSS. They will not pick up a future system change by themselves.

## The two-layer rule

Glass is for controls and chrome. Content stays solid.

- **Glass:** the tab bar, the rest timer row, header buttons, the soft edges, sheets, menus, the toast.
- **Solid:** cards, set rows, lists, charts, form fields, and every button inside a card (`.btn`, chips, segments, steppers, switches, ticks).

Why: text on a blurred photo or a moving list is hard to read. Content that is solid reads the same everywhere. Controls in a card get "feel" instead of glass (`lib/feel.js`, below).

A sheet holds forms, so it is near solid (94 %). It goes fully opaque at the large detent.

## Tokens

All are defined on `:root` (dark) and redefined for light. The opaque fallbacks are at the end of the glass block.

| Token | What it is for |
|---|---|
| `--glass-bg` | Glass fill for floating things (tab bar, timer, menus, toast). 74 % of the card colour. |
| `--glass-bg-bar` | Glass fill for bars pinned to the page, not to a card. 74 % of the page colour. |
| `--sheet-bg` | Sheet fill. 94 %, near solid, because sheets hold forms. |
| `--glass-bg-clear` | Clear glass for round buttons over a photo. Has a dim layer for bright pictures. |
| `--glass-blur`, `--glass-blur-clear` | The `backdrop-filter` values (20 px and 24 px, saturate 180 %). |
| `--glass-label` | Text and icon colour on glass. 88 % white in dark, 72 % black in light. |
| `--glass-edge` | The thin lit edge: a top highlight tinted by the accent, and a hairline. |
| `--glass-shadow` | The lift under floating glass. |
| `--glass-lens`, `--glass-lens-edge` | The moving highlight behind the active tab, and the circle behind small marks. |
| `--glass-prom-edge` | A brighter top edge for a prominent glass piece (Start). |
| `--scrim` | The dim behind a sheet. A plain colour, no blur. |
| `--dr` | The device corner radius (48 px, 55 px on wide phones). Sheets follow it. |
| `--tab-on` | The tab you are on. Monochrome. The accent means Start (an action) and data only. |
| `--acc-fill` | The accent under small text, darker where the text on it is white. |
| `--spring`, `--spring-soft` | Springs as `linear()` curves. `--spring` overshoots a little. `--spring-soft` overshoots less. Plain `--ease` where `linear()` is missing. |
| `--fx`, `--hr`, `--press-scale` | Feel switches. `--fx` is 1, or 0 under Reduce Motion. |
| `--edge`, `--ew` | Control edges, 3:1 against the card in both themes. 1.5 px with Increase Contrast. |

Rule: new glass uses a token. Never write a raw `rgba` or a new blur value.

## Blur rules

A live `backdrop-filter` costs a layer every frame. Three rules.

1. **At most 3 blurred layers on screen.** Usually: the tab bar, the open surface (sheet, menu or the rest timer) and the toast. The header edge is the one that gives way: it drops its blur while a sheet or menu is open (`body:has(.sheet.born,.menu) .gh .edge`), and on the workout screen it is a plain fade. The bottom edge is a plain gradient and the scrim has no blur. If you add a blurred thing, take one away.
2. **Never put a `backdrop-filter` on a parent of a blurred child.** The child would blur the parent's own blur, which is nothing. This is why the tab bar's glass is its `::before`, not the bar (`#tabbar` has `backdrop-filter:none`). It is also why the header buttons have no blur of their own: the edge behind them is the blurred layer.
3. **A named view-transition element carries opacity on a child.** The browser takes a picture of a named element. Its own `opacity` is not in that picture, so a fade on it vanishes or pops. Put the opacity on a child (`.edge` in the header, `.inl` in the tab bar). See Transitions.

Also: no `backdrop-filter` on something that animates `clip-path` (the full rest view). It drops frames. That view ends opaque.

## Motion

| What | Time |
|---|---|
| Press light, tick pop, number roll | 80 to 400 ms, run once, never loop |
| Number roll | 320 ms |
| Tab bar shrink and grow | 420 ms, `--spring-soft` |
| Sheet and menu | 460 ms and 420 ms, `--spring-soft` |
| Tab switch | 140 ms fade |
| Slide | 380 ms |
| Zoom | 400 ms |
| Fly (picture) | 300 ms page, 380 ms picture |
| Reduce Motion page change | 150 ms fade |

Rules:

- Nothing waits on `transitionend`. A missed event must never leave a screen stuck.
- Nothing loops. The last-3-seconds glow on the timer is 3 pulses, then nothing.
- **Reduce Motion** is the system setting, or Settings, Motion: Less. Both are heard through `matchMedia('(prefers-reduced-motion: reduce)')` (`lib/display-prefs.js` makes it answer yes for the app's own switch, and adds the `reduce-motion` class). Then: the global `*{transition:none!important}` makes every move an instant swap, `--fx` is 0 so a press is a flat tint, page changes are one 150 ms fade, and the sheet does not morph.
- JS that animates asks `reduceMotion()` in `lib/feel.js` first.

## Transitions

`lib/transitions.js` wraps the router's history on iPhone. Every push, back and tab re-tap goes through it. It uses the View Transitions API. `html[data-nav]` says which style runs for one move; the CSS picks pieces by class (`*.page`, `*.row`, `*.pic`, `*.top`, `*.bot`).

| Style | Looks like | Used for |
|---|---|---|
| `slide` | The iOS push and pop. New page in from the right, old one 30 % left and dimmed. | The default. Any tap that is not one of the two below. |
| `zoom` | The tapped card grows into the page and shrinks back into the same card. | A routine card (`data-vt="zoom"`). |
| `fly` | The row's picture flies to the page's picture. The page fades in with a 28 pt drift. | A row with a thumbnail (exercise rows). One step only: a deeper page slides. |
| `fade` | One 150 ms fade. | Every style under Reduce Motion. |
| tab switch | Plain 140 ms CSS fade (`.vfade`), no View Transition. | A tab bar tap. This keeps the lens live. |

- The style is picked from what was tapped (`styleFor`) and saved on the history entry. Going back mirrors the way in.
- The glass never moves, in any style. The header crossfades in place. The bottom edge and tab bar do not animate.
- While the pictures are taken, the page is frozen to a viewport-sized clipped box (`.vt-f`). A 1,324-row Library must never become one huge picture.
- The edge swipe back (`lib/edge-swipe-back.js`) follows the finger with plain transforms. It does not use any of this.
- RTL: `--dir` flips the slide.
- The pure decisions (`styleFor`, `swipeDone`, `popStyle`, `retapStyle`) have tests in `lib/transitions.test.js`.

## The tab bar and the rest timer

The floating bar is `components/TabBar.jsx`. Pure logic (lens position, when to shrink) is in `lib/tabbar-glass.js`.

- **Custom web bar, not the system `TabView`.** Glass, lens and minimize are rebuilt in CSS.
- **Start lives in the bar.** It is an action, not a section: an accepted bend. It sits outside the two tablists. Long press (500 ms), Shift+Enter and the hidden "Choose routine" button open the routine picker.
- **The accent means Start and data only.** The tab you are on is monochrome: the lens, a bolder label, a thicker icon.
- **Minimizing** hides three sections behind one tap. Scroll down 24 pt to shrink, up 12 pt, the top, or a tap on the capsule to grow back. Start is never hidden.
- **The rest timer** (iPhone only): a plain rest, or a hold you time by hand, is a row on top of the bar (`TimerRow` in `components/RestTimer.jsx`). The bar's glass is its `::before`, so it grows `--rh` taller upwards and stays one piece of glass. Its `::after` is the glow. The count-in, a hold that runs itself and the rest before one keep the old `#timer` card, as do Android and the web.
  - On the workout screen (no bar) the same row docks flat at the bottom edge.
  - On a shrunk bar the time takes the active tab's place in the capsule. Every tab is inert; a hidden "show all tabs" button is the way back.
  - The full view (`.xv`, a portal on `body`) is a `role=dialog`. Everything else is inert. Esc, the chevron or a swipe down close it. It grows from the row by `clip-path`, the digits by a FLIP. Both are skipped under Reduce Motion.
  - "Rest over" stays until tapped or the next set. It is said once (a polite region, cleared after 3 s), never per second.
  - Numbers and states are pure in `lib/rest-timer-view.js`.

## Headers and sheets

- **Header** (`ScreenHeader.jsx`, `lib/useHeaderScroll.js`): a nav row of round glass buttons that stays put, the page's one h1 in the content, a soft edge that comes in as the title goes under it, and a small title that fades into the nav row. Opacities are written straight to the elements on a frame, so a scroll never re-renders the screen. Dense lists and the Stats index use the `hard` edge: opaque with a hairline.
- **Sheets, menus, dialogs** (`Modals.jsx`): the sheet floats 8 pt in and follows `--dr`. Two detents: small (as opened, at most 60 % of the screen) and large (nearly all, opaque). The Start picker is born from the tab bar. A menu grows out of its button. A dialog is near solid.

## Reduce Transparency and Increase Contrast

The fallback swaps the tokens. Components do not change.

- `prefers-reduced-transparency: reduce` or `prefers-contrast: more`: fills go opaque, blurs and shadows go to `none`, edges become a solid hairline.
- Increase Contrast also: edge is the full separator, labels are full strength, the lens edge is 1.5 px.
- The header edge and bottom edge become a solid bar with a hairline (`.gh` block).
- `:root[data-reduce-transparency]` does the same by attribute. The media query may not reach WKWebView, so a native check of the same setting is meant to set it. That check is not wired yet (see device checks).
- Controls: edges get 1.5 px under Increase Contrast.
- When you add glass, add its opaque fallback in the same change. Test with the attribute set by hand.

## Toasts never auto-dismiss on iPhone

`Toast.jsx` has two toasts. The web and Android one times out. The iPhone one (`GlassToast`) never does. A timer is wrong for people using VoiceOver, Switch Control or who are just slow.

- No action: the toast is one button. Tap it, or touch anything else, and it goes.
- With an action (Undo): a close button first, the action last. Touching elsewhere leaves it. It stays until one of those two is tapped.
- Both also go on a route change and when the app goes to the background.
- VoiceOver hears the message once, from a hidden polite live region. It is emptied and refilled on the next frame, so the same words twice are read twice.
- The close button is at the far end from Undo, so a thumb aiming for one does not hit the other.

## Haptics

Only on iPhone, only through the native side (`setNativeHaptic`, `RestAlertPlugin.swift`). Anywhere else it does nothing. They follow Settings, Vibrate. Call `tap(kind)` from `lib/feel.js`, not `haptic` directly.

| Kind | Means | Fired by |
|---|---|---|
| `success` | You logged a set. Your own tick only. | `Workout.jsx` when you tick a set. Not for a set ticked by sync, the watch or the programme. |
| `selection` | A value or choice changed. | Stepper step, a changed segment, a chip that picked something. |
| `light` | A switch flipped, or a stepper hit its limit. | Switch (`ui.jsx`), `stepOnce` at a limit. |

- Hold-to-repeat steps up to 18 times a second, so `selection` is rate-limited to one per 80 ms: a buzz, not a drumroll.
- A chip that opens a sheet or navigates stays silent. Only a chip whose state changed in that tap buzzes.
- Rest timer haptics at 0:00 and the last 3 ticks are fired by the store, unchanged.
- A haptic never carries information alone. It always goes with a visible change.

## Old iOS

Each step needs a feature. If it is missing, the old behaviour runs, not a broken one.

| Feature | Needed for | Without it |
|---|---|---|
| `view-transition-class` (Safari 18.2) | Slide, zoom, fly | API skipped. The page's own `.vpush` and `.vpop` CSS runs: a slide for slide and zoom, a fade for fly. |
| `linear()` easing | The springs | `--spring` and `--spring-soft` become `--ease`. |
| `color-mix()` | Glass fills | Tokens go opaque (`@supports not`). |
| `backdrop-filter` | Blur | Tokens go opaque, blur `none`. |
| `@property` | The press light fade | The light snaps instead of fading. |

The glass block also avoids `color-mix` in the fallbacks themselves, so Safari 15 still gets a legal declaration.

## Device checks still open

None of this can be proven in a browser. No simulator was used. Check on a real iPhone, and one SE class phone for frame rate.

- **Tab bar:** bounce at the bottom does not change the bar. Fast drag up and down, no flicker. VoiceOver reads "tab, 3 of 4". Voice Control "tap Resume". No callout on a long press of Start. Text size Larger: "Ejercicios" is tight (fallback "Ejerc."). Frame rate (the lens and bar animate `left`, `right` and `width`; if it janks, lens to `transform`, bar to `clip-path`).
- **Rest timer:** glass legible over bright content. `clip-path` plus FLIP frame rate. VoiceOver order (row, capsule, dialog). Mis-taps on -15s and +15s (8 pt apart) and Skip next to the orb. Rest before an auto hold still clears the raised orb.
- **Header:** WKWebView honours the mask on a blurred layer. If not, add `nomask` to `.gh`.
- **Sheets:** the drag between detents; the Start picker born from the bar; the keyboard.
- **Transitions:** all three styles on a real device, back and forth, with a Library scrolled far down. Zoom corner radius per model (`screenR` is approximate).
- **Reduce Transparency:** the real setting. The `data-reduce-transparency` native check is not built yet.
- **Reduce Motion:** the system switch and Settings, Motion: Less, every screen above.
- **Haptics:** each kind on a real phone; Settings, Vibrate off is silent.
- **Support:** `linear()` springs and `backdrop-filter` in WKWebView on the oldest iOS you still ship.
