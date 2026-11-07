# iPhone tab bar (Liquid Glass G1)

The floating bar in `frontend/src/components/TabBar.jsx` (iOS app only, `html[data-platform="ios"]`; Android and web keep the old bar). Look and numbers: `index.css`, "the iPhone tab bar". Pure logic: `lib/tabbar-glass.js`.

Decisions to remember:

- **Custom web tab bar, not the system `TabView`.** The app runs in a WKWebView, so glass, lens and minimize are rebuilt in CSS. It will not pick up future system changes by itself.
- **Start lives in the bar.** It is an action, not a section: an accepted bend. It sits outside the two tablists. Long press (500 ms), Shift+Enter and the hidden "Choose routine" button open the routine picker.
- **The accent means Start (an action) and data only.** The tab you are on is monochrome: the lens, a bolder label, a thicker icon.
- **Minimizing hides three sections behind one tap.** Scroll down 24 pt to shrink, up 12 pt, the top, or a tap on the capsule to grow back. Start is never hidden.

Device checks (cannot be proven in a browser): the bounce at the bottom of a page must not change the bar; fast drag up and down, no flicker; VoiceOver reads "tab, 3 of 4"; Voice Control "tap Resume"; no callout on a long press of Start; Reduce Motion, the lens only fades; Text size Larger, labels clear of the lens ("Ejercicios" is tight, fallback "Ejerc."); frame rate on an iPhone SE class device (the lens, tabs and bar animate left/right/width; if it janks, move the lens to `transform` and the bar to `clip-path`); `linear()` springs and `backdrop-filter` in WKWebView.
