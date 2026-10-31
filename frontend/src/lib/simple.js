// Simple mode (Settings → Look & Home, on by default): the screens keep what is needed to train and
// fold the rest away. Nothing is removed. The advanced options (pyramid sets, drop-sets, failure
// sets, warm-up planning, plate loading, progression rules, supersets, the effort column…) are one
// switch away, and an exercise that already uses one shows it whatever the mode.
//
// Read as `=== true`: a state built without the key (a test, an older copy) reads as the full app.
// The default lives in the store's DEF, so a profile saved before the switch existed picks it up.
export const isSimple = S => S?.simple === true
