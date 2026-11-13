# W2-final: live set card menu, W1 opener
Idea: W2's menu (live card, three type toggles, Add/Remove) opened from W1's pill on the "Set 2 of 3" line. No extra line on the set page, so the boxes keep full size.

## Set page (40 mm 192 dp; 45 mm 227 dp)
| Element | dp / sp |
|---|---|
| Clock | 12 sp, 14 dp line, Label2 |
| Exercise name (plain text) | 16 sp bold, 20 dp line (45 mm: 22) |
| Opener pill | 28 dp visual, radius 14, Surface #1C1C1E. Content: "2/3" 13 sp semibold, tag chips, "..." 16 sp Label2. Hit area 48 dp (+10 dp invisible above and below, 4 dp sides; overlaps only text lines) |
| Tag chip (pill) | 18 dp tall, 12 sp bold, radius 9, fill = type colour, text #0C0E12. In the pill, German drop reads "Drop" (short) |
| Weight box / Reps box | 84 x 40 dp / 64 x 40 dp (45 mm: 44 dp tall), label 12 sp, number 20 sp rounded bold, unit 13 sp |
| Bar | side buttons 44 x 48, Done 82 x 48 (radius 24), 15 sp |
| Dots | 6 dp, 7 dp from bottom |
Long-press on either box also opens the menu. Crown and both pagers are unchanged.

## Menu (TransformingLazyColumn, crown scrolls)
| Element | dp / sp |
|---|---|
| Live card | 18 dp radius, Surface, pad 4/8. Weight x reps 18 sp rounded bold (kg 13 sp), tag chips 12 sp, 16 dp tall; "Work set" 12 sp Label2 when no tags. About 38 dp tall, width 122 (40 mm) |
| Toggle row | 44 dp visual, 4 dp gap = 48 dp pitch, so each 48 dp hit area is touching but not overlapping (grow the touch target by 2 dp each side). Radius 22, label 13 sp semibold, two lines allowed |
| Disc | 26 dp, 2 dp ring in type colour, letter 13 sp bold when off; filled with a check when on. Row on: type colour at 22% over black + 2 dp type-colour border |
| Locked row (warm-up on) | 40% opacity, dashed grey disc, not clickable |
| Add / Remove | side by side, 48 dp tall, radius 24, icon 16 dp over label 12 sp semibold. Add green on Surface2 (flex 1.2), Remove red text on red 20% |
| Edge fade | 18 dp top, 22 dp bottom |
Colours: warm-up #FF9F0A, failure #FF453A, drop #BF5AF2, accent #A3E635, on-accent #0C0E12, Surface #1C1C1E, Surface2 #2C2C2E, Label2 rgba(235,235,245,.6).

## Behaviour
- Tapping a toggle changes the set and the card; the menu stays open. Warm-up on: failure and drop are locked and dimmed. Warm-up off: they unlock.
- Remove: acts at once, menu closes, an Undo chip replaces the Done bar for 4 s ("Removed | Undo", 144 x 48 dp, progress line along the bottom). No confirm. Pill reads "2/2".
- Always On: menu closes; set page shows outlined, dimmed pill, chips and boxes. No animation anywhere.

## Compose for Wear
TransformingLazyColumn (menu), Card (live set card), ToggleButton / Button with a custom 26 dp leading icon (rows), two Buttons in a Row (Add, Remove), CompactButton or Chip for the pill, Text, a timed Box for the Undo chip.

## Checks done
Boxes and text checked in code against the circle (corner-inset test) and the 12 sp floor. German "Hinzufügen" and "Entfernen" fit at 12 sp on 40 mm (snug). Text 1.3: rows wrap, nothing clips.

## Open questions
- All three toggles do NOT fit with the card on the first 40 mm screen. Three 48 dp rows (144 dp) plus the card cannot fit in the round 192 dp with the corners cut. Card and warm-up and failure show in full; drop peeks, then Add/Remove are two crown steps down at 40 mm. At 45 mm the third row is nearly fully visible. Alternative if you want all at once: a row of three 48 dp discs (no labels).
- German in the pill: "Versagen Drop" (drop shortened) is tight at 40 mm; check on device.
- Disc letters differ per language (A V D in German).
- Pill hit area grows beyond 28 dp via touch slop; confirm on a real watch.
- Not drawn: the "2+ drops, edit on phone" state.

## Review (independent pass)
Render command: window 1052x1180, scale 2 (PNG 2104x2360).
Fixed:
- German set page (frame O): the "2/3 Versagen Drop •••" pill was 172 dp wide and its corners crossed the round edge at 40 mm. Tightened pill gap (3 to 2), side padding and chip padding (5 to 4) for all pills, so the element stays the same everywhere. Now 161 dp; corner test passes. English two-tag pill 156 to 145.
- Locked rows (frame K) were 40% opacity: text 3.42:1, failed AA. Now 55%: 5.70:1 (still clearly dimmed, dashed disc kept).
- Always On chips: red and purple at 70% opacity gave 3.36:1 and 3.30:1 on black. Now full colour, outlined: 6.16:1 and 5.96:1 (orange 10.22). AOD pill border #555 (2.82:1) to #666.
- The checker skipped the top 24 px of menu frames, which hid the top-card question. Card is now tested against the circle: D, F, H, J pass (the scrolled frames E, G, I cut the card on purpose, as a scroll does).
Contrast measured, no change needed: Remove #ff6a60 on red 20% over black 6.20:1 (the label is fine; #FF453A would be 5.10); chip text #0C0E12 on orange 9.40, red 5.67, purple 5.48; Label2 on Surface 5.95, on black 6.36; Add green on Surface2 9.24; white on on-state rows 14.9 to 16.9; Undo green segment 12.81; white on Surface2 13.94; AOD clock #777 4.69, name #999 7.37, box text 6.87.
Checked, fine: nothing under 12 sp (1.3x frame J scales up, nothing clips); toggle rows 44 dp plus 4 dp gap = 48 dp pitch; Add/Remove 48 dp; pill hit area 48 dp tall, 54 dp or wider; Undo chip target 62x48.
Open:
- Side arrow buttons are 44 dp wide (as in the real app); grow their touch area to 48 dp in code.
- German pill is still snug at 40 mm (161 of about 174 dp chord). Check on device; fallback is dropping "2/3" when two tags show.
- Pill "2/3 •••" replaces the words "Set 2 of 3"; it reads as a button because of the dark capsule and dots, but test with a lifter who has not seen it.
