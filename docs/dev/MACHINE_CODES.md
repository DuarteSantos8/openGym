# Machine codes: link an exercise to a code already on the machine

Design note for [#1334](https://github.com/DuarteSantos8/openGym/issues/1334). Status: design, not built.

## Why

Machine stickers (v1.4.4, `lib/nfc-tags.js`, `components/Nfc.jsx`) jump to an exercise with one tap.
Many gyms do not let members put their own stickers on equipment, but most machines already carry
a code of their own: a manufacturer or gym-app QR code, or an NFC tag. Some gyms also have two or
three brands of the same machine (a plate-loaded chest press from two makers), tracked as separate
exercises, so landing on the right one matters.

The feature: link the code that is already on a machine to an exercise once, and from then on
scanning that code brings that exercise up in the workout.

## Goals

- In an exercise's details, **Link a code on this machine**: read the machine's QR code or NFC tag
  once and remember it for that exercise. Several codes per exercise are fine.
- A **Scan a machine** button in the running workout's exercise-chip row, and the existing Plan > Scan a QR
  code, read QR and (where the device can) NFC. In a workout a linked code brings that exercise up
  next and makes it current, adding it if needed (see "What a scan does in a live workout").
- Outside a workout, **Scan a machine to start freestyle** in the start picker starts a freestyle
  workout with that machine's exercise first.
- An unknown, non-openGym code offers **Link to an exercise…** instead of only
  "That's not an openGym code".
- Links sync with the profile like other per-exercise settings.

## Non-goals and anti-goals

- **Nothing is written to a machine's tag, nothing is emulated, the linked URL is never opened or
  fetched.** The code is only an identifier. Same line as the stickers: not a card cloner.
- **No reading of foreign tags without a tap on a button.** Reacting to any tag the phone touches
  (a transit card, a door badge) would be wrong. Only an explicit scan reads a foreign tag.
  openGym's own stickers keep working as today (Android's manifest filter, iOS background reading).
- No background reading of foreign tags with the app closed (neither platform allows it anyway).
- No FeliCa / ISO 18092 polling on iPhone (needs system codes declared per card type).
- No watch apps (Apple Watch, Wear OS, Garmin) in this change.

## Safety: a code is untrusted text

Whatever a QR code or a tag holds was written by someone else. A scan never acts on it: no URL
is opened or fetched, no other app or intent is started, nothing is run. The code is compared,
stored and shown, and that is all. Concretely:

- **Reading.** Android reads only while the scan sheet holds reader mode, which keeps the tag
  from being dispatched to any other app (no browser, no app link); the plugin hands the page
  plain strings and never builds an `Intent` from a record. iPhone reads inside the app's own
  `NFCTagReaderSession`. ML Kit's scanner is used for its raw value only, never its suggested
  action (open URL, dial, add contact, join Wi-Fi). Web NFC records are decoded as text.
- **Cleaning before storing.** NFC normalised; C0/C1 control characters and bidi overrides
  (U+202A to U+202E, U+2066 to U+2069) removed, so a code can neither break a line nor reverse
  how it reads on screen; trimmed; at most 512 characters, else refused. NDEF records other than
  URI and text are ignored; their payloads are never decoded.
- **Showing.** Only as React text (`shownCode`), shortened. Never in an `href`, `src`, `style`
  or HTML; there is no `innerHTML` in the app and none is added. A link-looking code is not
  clickable.
- **Never a key.** Codes are values inside an exercise's list, so a `__proto__` or
  `constructor` text has no effect on any object.
- **Routing.** Only openGym's own forms (`parseTagUrl`, routine and library links) are acted on,
  through the handlers that already exist for them (a routine link shows its preview, it never
  imports by itself). Anything else is looked up as a plain string, and a match yields only
  exercise ids from the profile.
- **`searchHint`.** `decodeURIComponent` in a try/catch; the result keeps only letters and
  digits, as words for the picker's search box. It never leaves the device.
- **Not sent onward.** `machineCodes` is not given to the Coach, to MCP tools or to integration
  webhooks, so a code that reads like an instruction never reaches a language model. If a CSV
  export ever includes codes, cells starting with `= + - @` are escaped.

## How it works today (what this builds on)

- **Stickers.** `tagUrl` / `parseTagUrl` (`lib/nfc-tags.js`) write and read
  `https://opengym.ch/nfc?ex=<id>`. `routeTag(S, tag, …)` decides `jump` / `offer-add` /
  `details` / `unknown-exercise`; `handleTagLink` (`components/Nfc.jsx`) acts on it, with
  `tagDebouncer` against repeats.
- **NFC on the device** (`lib/nfc.js`): Android writes with the adapter's reader mode
  (`NfcTagsPlugin.java`) and reads only openGym links through the manifest's `NDEF_DISCOVERED`
  filter. iPhone writes with `NFCNDEFReaderSession` (`NfcTagsPlugin.swift`) and reads stickers in
  the background. Web: `NDEFReader` (Chrome on Android). No path reads a foreign tag or a UID.
- **QR.** Plan > Scan a QR code (`views/Plan.jsx`, `components/ScanCode.jsx`): ML Kit in the
  phone apps, `CameraScan` + jsQR in a browser and F-Droid. `routeScannedText`
  (`lib/scan-route.js`) sends routine links, library links and sticker links to their handlers;
  anything else is `unknown` and toasted back.
- **Sync.** Per-key maps (`PER_KEY` in `lib/sync-merge.js`, mirrored in `api/sync-stamps.js`) are
  stamped per entry as `edited['<field>.<key>']`; `applyEdits` splits on the first dot, so keys
  may contain dots.

## Approaches considered

**Android NFC reading.**

1. *Always on while the app is in the foreground* (reader mode or foreground dispatch from
   `MainActivity`): tap and go. Rejected: every tag the phone touches would be read and could pop
   up a prompt, and other NFC apps would lose tags while openGym is open.
2. *Only from an explicit scan* (**picked**): the Scan a machine sheet turns reader mode on while it
   is open, the same mechanism the sticker write already uses, and off when it closes. Same
   behaviour as the iPhone, which can only do it this way.

**Where the link lives.** Links go both ways: one machine can carry several codes (an NFC tag
and a QR code), and one code can open several exercises (a Hammer Strength machine used for both
a chest press and a lat pull, a cable station). Two shapes were weighed:

- *Keyed by code*, `{ [code]: [exerciseId, ...] }`: a scan finds its exercises in one step. But
  the keys come from outside (a QR reading `__proto__` needs guarding), sync stamps per code (two
  phones adding the chest press and the lat pull to the same code offline keep only one), and
  merging or deleting an exercise means rewriting values inside every list.
- *Keyed by exercise*, `{ [exerciseId]: [code, ...] }` (**picked**): the same shape as `exNotes`,
  `barWeights` and the other per-exercise settings. Keys are exercise ids, safe by construction;
  sync stamps per exercise, so the two offline phones above both keep their link; the details
  sheet reads its codes directly; merge and delete move or drop one key. A scan walks every
  exercise's list instead of one lookup, which for even 500 codes is microseconds.

## Design

### Data

`S.machineCodes: { [exerciseId]: code[] }`, default `{}`. Keys are exercise ids, the same ones
`exNotes` uses: a catalogue exercise's (`0150`, its file name in `catalogue/exercises/`) or an own
exercise's (`c` + a random id). Renaming an exercise keeps its links.

```
machineCodes: {
  "0150":     ["t:https://brand.com/m/12", "uid:04A25B…"],
  "c1k2x9ab": ["t:https://brand.com/m/12"]
}
```
 A list has no duplicates and is never
empty: removing an exercise's last code deletes the key.

**Settle this shape with the maintainers before building** (name and format, in the issue): once
links exist on people's phones, a renamed field or a changed format needs a migration, and links
made on a build of this branch would otherwise be stranded. An app without this feature keeps the
field untouched (the store loads it over the defaults, `mergeStates` carries unknown fields), so
going back to such a build and forward again loses nothing.

- `code` for a QR: `t:` + its text, trimmed. For an NFC tag with an NDEF URI or text record:
  `t:` + that record's text (the first URI record, else the first text record). For a tag
  without one: `uid:` + the UID as upper-case hex. A QR and an NFC tag carrying the same URL are
  the same code. The prefix tells text from a UID; codes are only ever values, never keys.
- Codes longer than 512 characters, empty codes, openGym's own codes (anything
  `routeScannedText` or `parseTagUrl` already recognises) and a code equal to one of the
  profile's gym membership codes (`gymCards`, scanned by mistake) are never stored.
- Added to `PER_KEY` in both `frontend/src/lib/sync-merge.js` and `api/sync-stamps.js` (the parity
  test must pass), to the per-key union loop next to `exNotes`, and to `RESET_MAPS` where
  `exNotes` / `exAliases` are reset.
- Keys go through `canonicalExId` when read, like stickers.
- **Merging exercises** (`lib/exercise-merge.js`): the merged-away exercise's codes join the
  target's list (a union, deduplicated: `MOVE_MAPS` keeps the target's own entry and would drop
  them), and `machineCodes` joins `RESTORE` so the merge's Undo puts them back.
- **Deleting an own exercise** (`deleteCustomEx`) drops its key.
- **API tokens** (`api/tokens.js` `KEY_CATEGORY`): `machineCodes: ['plans']`, so a token sees
  and changes the links only with the plans scope, next to routines.
- **Size:** a code is at most about 520 bytes, usually 100 to 200, plus one stamp per exercise in
  `edited`. Five gyms of 50 machines with two codes each is roughly 100 KB (250 KB at worst)
  against the 5 MB body cap. No limit on the count is needed.
- **Conflicts:** stamped per exercise. Two devices changing different exercises' codes both
  keep theirs, the same code added to two exercises on two phones included. Two devices changing
  the same exercise's list: the later change wins whole. An unlink stays unlinked.
- **Same code at two gyms.** A maker's QR that is only the model's product page is the same at
  every gym with that model. If those machines are tracked as separate exercises, the code finds
  them all and the scan asks (below). Not in this change: remembering the gym a code was linked
  at and preferring the active gym's exercise; a code entry could later grow from a string into
  `{ c, gym }` for that.

A pure helper `lib/machine-codes.js` (with `machine-codes.test.js`):

- `codeFromQr(text)`, `codeFromNfc({ records, uid })` → code or null
- `isOwnCode(text)` → true for openGym codes (delegates to `routeScannedText` / `parseTagUrl`)
- `exercisesFor(S, code)` → every exercise whose list holds the code (canonical ids, known to the
  library), `[]` if none
- `codesOf(S, exId)` → that exercise's codes
- `link(S, exId, code, { only })` → adds the code to the exercise; with `only`, also takes it off
  every other exercise
- `unlink(S, exId, code)` → takes one code off one exercise
- `pickForScan(active, ids)` → which of a code's exercises a scan in a live workout means:
  the one not yet done in this workout when exactly one is; null (ask) when several are, or
  when none is in it and the code has several
- `isRandomUid(uid)` → true for a 4-byte NFCID1 starting with `0x08` (random per read)
- `shownCode(code)` → short label for lists (`QR https://brand.com/m/12…`, `NFC 04:A2:…`)
- `searchHint(code)` → search words from a text code, or `''`: the URL's path and query values
  (not the host, not `www`), split on `/ - _ . + %20` and camelCase, decoded, lower-cased; drops
  pure numbers, hex-looking ids, one-letter pieces and filler (`product(s)`, `equipment`,
  `machine`, `qr`, `index`, `html`, `en`, `de`, ...); at most six words

### Routing

`routeScannedText` gains a lookup: after openGym's own kinds, a code that any exercise in
`machineCodes` holds returns `{ kind: 'machine', ids }`; an unknown one stays `unknown`.

**A code with several exercises** becomes one exercise before anything else happens. In a live
workout, `pickForScan` takes the one still to do in this workout when there is exactly one (the
Hammer machine during a chest day opens the chest press). Otherwise a small sheet lists the
code's exercises, the ones in this workout first, marked done or not; the pick goes on as if the
code had that one exercise. Outside a workout (start freestyle, Plan's scan) the sheet always asks. A read NFC tag goes through the
same function (its own-sticker URL first, then the code).

`unknown` in a scan now opens a small sheet: the code shown back, and **Link to an exercise…**,
which opens the exercise picker, links, and then goes on with the flow below for the picked
exercise.

**The picker's search starts from the code's own words.** Many maker and gym QR codes are URLs
whose path names the machine (`https://brand.com/products/lat-pulldown-plate-loaded`). The picker
opens with its search box filled from that text (`lat pulldown plate loaded`), so the likely
exercise is near the top. Nothing is fetched or guessed: it is only a prefilled search, the user
still picks, and the box can be cleared. A code with no readable words (a short link, a bare id,
an NFC UID) opens the picker empty, as before. `ExercisePicker` (`sheets.jsx`) has no starting
query today; `exercisePicker(onPick, { query })` adds one.

Not in this change: recognising a machine without the user picking (a shipped or community table
of makers' code formats → exercise ids). Fetching the URL to read the page is ruled out above.

### What a scan does in a live workout

A scan is a deliberate tap on the Scan button, so it acts at once, with no confirmation:

```
scan (QR / NFC)
 └ code linked?        no  → pick an exercise to link it to, then go on
                       yes → its exercise (several: pickForScan, or ask)
 └ in this workout?    yes, every set done → jump to it, order unchanged
                       yes, not done       → move it to the slot below, make it current
                       no                  → add it at the slot below, make it current
 └ toast with Undo (puts the order and the current exercise back; removes an added exercise)
```

**The slot:** right after the current exercise when it has at least one set done (you are in
the middle of it: A done, B half done and current, C not started, scan D → A B D C). When the
current exercise has no set done yet, the scanned one goes in front of it (A done, B current but
not started → A D B C). Never inside a superset: the slot is before or after a whole unit.

**Supersets:** an exercise that belongs to a superset moves with its whole superset; the current
exercise becomes the scanned member.

A pure helper decides it (`scanInWorkout(active, exId)` in `lib/machine-codes.js` or
`lib/active-workout-order.js` → `{ do: 'jump' | 'move' | 'add', at, indices }`), unit-tested on
the cases above. The move reuses `lib/active-workout-order.js` (a move-to-index next to the
existing one-step move, returning the same index permutation so the rest timer, the rest owner
and the progress high-water marks remap the way `moveUnitAt` already does). The add reuses
`addExerciseToSession`'s prescription rules with the new slot.

### Starting a workout from a machine

The start picker (**What are we training?**, `components/StartSheets.jsx`) gets a row right under
**Freestyle workout (pick as you go)**: **Scan a machine to start freestyle**. The empty Workout
screen's Freestyle button (`views/Workout.jsx`) gets the same as a second button.

```
 Your routines
   Limbs                 8 exercises   ›
   Chest & back          8 exercises   ›

   ⤨  Freestyle workout (pick as you go)   ›
   ⌗  Scan a machine to start freestyle     ›     ← new

              Cancel
```

It opens the Scan a machine sheet; the code resolves to an exercise (linking it first if it is
not linked yet, as above), and then a freestyle workout starts through the usual `startFlow([])`
(daily check-in and weigh-in included) with that exercise as its first entry, current. From
there every further scan follows the live-workout flow. `startFlow`'s `opts.lead` (the leftovers'
"done first" exercises) is the likely way in; if its shape does not fit one exercise, a small
`opts.first` beside it.

**Plan > Scan a QR code outside a workout** stays as today for every kind it already handles; a
linked machine code there opens the exercise's details (what a machine sticker does outside a
workout). Starting is the start picker's job.

**openGym's own stickers keep today's behaviour** (`routeTag`: jump without reordering, ask
before adding). They are read whenever the app listens, so a tap can be an accident. The new
flow is only for a scan started from the Scan button; an openGym sticker link read by that
button (its QR, or the sticker via the scan sheet) follows the new flow, since the scan itself was
deliberate.

### UI

**Workout exercise-chip row** (`views/Workout.jsx`, `chipRow` / `.wchips-row`): a round scan
button at the end of the row, left of the session-map button, fixed while the chips scroll
sideways. The same pattern the session map already uses: the row is taller than a button and
scrolls, so it costs no height, and the header bar has no width to spare on a phone. It sits
far from ⌄ Minimize (mis-taps there leave the screen) and next to what it does: go to an
exercise. Only in a live session (not in the saved-workout editor, not in a backfill).

```
 (⌄)          Limbs          (…) [ Finish ]
 (1)(2)(3)(4)(5)(6)(7)(8) ‹scrolls›   (⌗) [map]
```

With the chips switched off (Settings, `wc.exerciseChips`), the button is not moved into the
header; the workout's ⋯ menu gets **Scan a machine** under Add exercise instead (shown always, so
it can be found either way).

**Scan a machine sheet** (new, `components/ScanMachine.jsx`), opened from the workout's chip row (or
its ⋯ menu) and from Plan > Scan a QR code:

```
 Scan a machine
 Hold your phone to the machine's NFC tag,      ← only where NFC reading works
 or scan its QR code.
 [ Scan QR code ]                                ← opens the existing camera scan
                                     [ Cancel ]
```

While it is open, NFC reading is on (Android reader mode, Web NFC scan). On iPhone the sheet's
NFC row is a button that starts `NFCTagReaderSession` with Apple's own sheet. Whatever it reads
goes through the routing above. Where NFC reading is not available, Plan > Scan a QR code opens the
camera directly, as today.

**Exercise details** (`sheets.jsx`, next to Write NFC sticker for this exercise):

```
 [ Write NFC sticker for this exercise ]
 [ Link a code on this machine · 2 ]          ← the count when there are any
   QR   https://brand.com/m/123          ✕
   NFC  04:A2:5B:…                        ✕
```

The button carries the number of linked codes, and the list under it shows each with its own ✕,
so the details answer "what is linked here" without opening anything. Linking opens the same Scan a machine sheet in link mode: the read code is linked to this exercise
instead of routed. If the code already opens other exercises: "This code also opens {other}."
with **Open both** (the default: one machine, several exercises) and **Only {this}**. An
openGym code is refused with a line saying what it already does. After a link, the sheet offers
**Scan another code on this machine** (a machine with both an NFC tag and a QR code), so a second
code needs no trip back through the details.
A random-UID tag: "This tag changes its ID every time, so it can't be linked."

All new strings go into every locale pack (`check-locales.mjs`, pt-BR fingerprint). Plain text, no
em dashes.

### Native

**Android** (`NfcTagsPlugin.java`): a `read` / `stopRead` pair. `read` turns reader mode on
(NFC-A, B, F, V; without the skip-NDEF-check flag, so the system reads the NDEF message
first, and tags without one still come through) and emits a `tag` event per tag
with `{ uid, records: [{ type: 'uri'|'text', value }] }` from the cached NDEF message (no write,
no connect beyond reading). Only one of read or write at a time: starting one stops the other.
`stopRead` runs on sheet close and on `onPause`.

**iPhone** (`NfcTagsPlugin.swift`): `read` starts `NFCTagReaderSession(pollingOption:
[.iso14443, .iso15693])`, connects to the first tag, takes its identifier (MIFARE / ISO 15693),
reads NDEF if the tag has it, resolves with the same shape and invalidates the session. The
entitlement already lists `TAG`. `NFCReaderUsageDescription` is reworded to cover reading a
machine's tag. ISO 7816 tags without declared AIDs are not detected; the sheet's error says to try
the QR code.

**Web** (`lib/nfc.js`): `readMachineTag()` runs `NDEFReader.scan()` from the sheet's tap and uses
the event's `serialNumber` and records. The background reader in `onTagLink` keeps ignoring
non-openGym tags.

`lib/nfc.js` exposes `nfcReadSupport()` (Android app, iPhone app, Web NFC) and
`readMachineTag({ signal })` → `{ uid, records }`.

## Tests

- `lib/machine-codes.test.js`: code normalisation, own-code and gym-card refusal, link / link
  only / unlink one / last unlink drops the key, one code on several exercises, `pickForScan` (one to do, several to do, none in
  the workout, all done), random UID, length limit, a QR reading `__proto__` / `constructor` links and looks up
  like any other text.
- `lib/exercise-merge.test.js`: a merge joins the codes into the target's list (the target's own
  kept), its Undo restores them; deleting an own exercise drops its codes.
- `lib/sync-merge.test.js`: the same code added to two exercises on two devices keeps both.
- `api` tokens test: `machineCodes` needs the plans scope.
- Cleaning: control and bidi characters are removed, the 512 limit holds, a QR's suggested
  action is ignored (only its raw value is read).
- `searchHint`: a malformed `%` escape does not throw; a product-page URL gives its words; a short link, a bare id and a UID give `''`;
  host and file extensions never show up.
- `lib/scan-route.test.js`: a linked code routes to `machine`, own kinds still win.
- `lib/sync-merge.test.js` + the api parity test: two devices linking and unlinking different codes
  merge per code; an unlink stays unlinked.
- Component tests: the chip-row button shows only in a live session, the ⋯ menu item with the
  chips off; the link sheet's replace prompt;
  unknown code → Link to an exercise….
- On devices: Android app (reader mode on and off with the sheet, a write right after a read), iPhone
  app built from Xcode, Chrome on Android.

## Left to the builder

- Exact icon for the chip-row button (an existing `qr` or a new scan glyph in `Icon.jsx`).
- Whether Plan's row is renamed to cover NFC ("Scan a machine or QR code").
- Event / method names on the plugins, as long as both platforms answer the same shape.
