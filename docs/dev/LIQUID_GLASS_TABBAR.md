# iPhone tab bar (Liquid Glass G1)

The floating bar in `frontend/src/components/TabBar.jsx` (iOS app only, `html[data-platform="ios"]`; Android and web keep the old bar). Look and numbers: `index.css`, "the iPhone tab bar". Pure logic: `lib/tabbar-glass.js`.

Decisions to remember:

- **Custom web tab bar, not the system `TabView`.** The app runs in a WKWebView, so glass, lens and minimize are rebuilt in CSS. It will not pick up future system changes by itself.
- **Start lives in the bar.** It is an action, not a section: an accepted bend. It sits outside the two tablists. Long press (500 ms), Shift+Enter and the hidden "Choose routine" button open the routine picker.
- **The accent means Start (an action) and data only.** The tab you are on is monochrome: the lens, a bolder label, a thicker icon.
- **Minimizing hides three sections behind one tap.** Scroll down 24 pt to shrink, up 12 pt, the top, or a tap on the capsule to grow back. Start is never hidden.

Device checks (cannot be proven in a browser): the bounce at the bottom of a page must not change the bar; fast drag up and down, no flicker; VoiceOver reads "tab, 3 of 4"; Voice Control "tap Resume"; no callout on a long press of Start; Reduce Motion, everything is an instant swap (the global `*{transition:none!important}` also removes the lens cross-fade; kept that way); Text size Larger, labels clear of the lens ("Ejercicios" is tight, fallback "Ejerc."); frame rate on an iPhone SE class device (the lens, tabs and bar animate left/right/width; if it janks, move the lens to `transform` and the bar to `clip-path`); `linear()` springs and `backdrop-filter` in WKWebView.

## The rest timer in the bar (Liquid Glass G2)

iPhone app only. A plain rest, or a hold you time by hand, is a row on top of the bar (`TimerRow` in `components/RestTimer.jsx`, rendered by `TabBar.jsx` inside the bar). The bar's glass is its `::before`, so it grows `--rh` taller upwards and stays one piece of glass; its `::after` is the glow. The count-in, a hold that runs itself and the rest before one (they carry Stop auto) keep the old `#timer` card. Android and web keep the card too.

- **Workout screen** (no bar): the same row docks flat at the bottom edge (`RestTimer docked`).
- **Shrunk bar**: the time takes the active tab's place in the capsule (`.mtime`, 16 pt wider when paused); every tab is inert and a hidden "show all tabs" button is the way back. Tap the row or the time to open the full view.
- **Full view** (`.xv`, a portal on `body`): `role=dialog`, everything else on `body` is inert, focus goes to Close and back. Esc, the chevron or a swipe down close it. It grows from the row by `clip-path` and the digits by a FLIP; both are skipped under Reduce Motion (the global rule makes it an instant swap). Nothing waits for `transitionend`. The big digits open the time wheel, as the clock did.
- **Rest over** stays until tapped or the next set. "Rest over" is said once (a polite region, cleared after 3 s), never per second. The glow in the last 3 s is 3 pulses, then nothing (a still ring under Reduce Motion).
- Numbers and states are pure in `lib/rest-timer-view.js`.

Device checks: glass legibility over bright content; clip-path + FLIP frame rate on an iPhone SE class device (fall back to the Reduce Motion swap if it drops frames); VoiceOver walk (row, capsule, dialog; the row sits after the tabs in reading order, inside the bar); thumb mis-taps on -15s/+15s (8 pt apart) and Skip next to the orange orb; haptics at 0:00 and the last 3 ticks (the store fires them, unchanged); Text size Larger; real Reduce Transparency; the rest-before-auto-hold card still clears the raised orb.
