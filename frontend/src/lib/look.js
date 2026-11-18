// Settings → Look & Home → Look: Ironvane's two looks, on top of the theme (dark/light) and the
// accent. Bold is the default: tighter corners, Space Grotesk for page titles (upper case) and the
// numbers you log. Refined is the softer look the app had before. The choice syncs like the theme;
// a profile that never picked one is Bold. App.jsx puts it on the page root as data-look, and
// index.css does the rest (`:root[data-look="bold"]`).
export const LOOKS = ['bold', 'refined']
export const DEFAULT_LOOK = 'bold'
export const lookOf = S => (S?.look === 'refined' ? 'refined' : DEFAULT_LOOK)
