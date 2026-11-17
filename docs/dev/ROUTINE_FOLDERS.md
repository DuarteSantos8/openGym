# Routine folders, current plan, archive, colours (Plan → Routines)

Status: design approved 2026-11-14. Builds on Q11 folders (lib/routine-folders.js, #858) and
favourite routines (lib/routine-favs.js, #327). Mockups: direction C "Compact shelves" (the PR
bodies carry the pictures).

## Why

A lifter keeps more routines than they train: this block's four, last block's six, a travel set,
a mobility day. Today they all sit in one list with the same yellow tile, folders are only a name
typed on each routine, and "Archive" is a folder that happens to be called Archive. Finding this
week's routine between sets means reading names. The owner wants:

- folders you manage from the list, one of them marked as the **current plan** and pinned on top;
- an **archive** reached at the bottom of the list, and archiving from the routine's menu and Edit;
- a folder **"…" menu**: archive the folder with its routines, delete the folder with its
  routines, or remove only the folder and keep the routines;
- **long press to drag** routines, also into and out of folders;
- a **colour** per routine, and a richer set of drawn **icons**;
- favourites kept as a star, shown through a **filter** instead of a pinned group.

## Goals, non-goals, anti-goals

Goals: the four current-plan routines are the first thing on the tab; any routine is two taps
away; reorganising works by drag and without drag; nothing is lost by accident.

Non-goals: Schedule, Home, the Start sheet order and Programmes do not change with the current
plan. No folder colours. No emoji (the owner, 2026-11-14; drawn glyphs stay the only icons). No
nested folders. No watch changes.

Anti-goals: a second colour system competing with the user's accent; a model change that makes an
older app lose folders; delete without a way back.

## Approaches considered

1. **Keep the name on the routine, add a folder list setting** (picked). `r.folder` stays the
   folder's name, as Q11 stores it. One new synced value holds the folder order, the current
   plan, archived folders and empty folders. Older apps keep showing folders. Cost: a rename
   rewrites the name on each routine, so two devices renaming at once can briefly split a folder.
2. Folders as records with ids (`S.folders`, `r.folderId`). Clean renames, but a new synced
   collection in both merge copies (`lib/sync-merge.js`, `api/sync-stamps.js`), a migration, and
   older apps lose every folder. Rejected for size and compatibility.
3. Folder colours and a hero card (direction B). Rejected by the design judge: two colour systems,
   routines pushed down the screen.

## Data

All new keys are optional; an older app keeps them as it keeps any key it does not know.

**On the routine** (merged field by field like `name` or `fav`, stampEntry):
- `folder`: unchanged, the folder name (cleanFolder).
- `color`: one of `blue indigo purple pink red orange yellow green mint teal brown grey`. Absent
  means today's look (the accent tile). New routines get the first colour not used by the routines
  around them (in the folder they are made in, else the loose list).
- `archived: true`: written only when on, like `fav`. An archived routine keeps its `folder`.

**On the state**, one synced value `S.routineFolders`, stamped as a whole in `edited` like other
settings (last writer wins):
```js
S.routineFolders = [
  { name: 'Upper/Lower · Block 3', current: true },
  { name: 'Hypertrophy 2026' },
  { name: 'Travel' },            // may hold no routine: an empty folder
]
```
- Order of the array is the order folders are listed.
- At most one `current: true` (a helper enforces it).
- **The routines are the one source of truth for archive.** A folder is never marked archived in
  the array: it shows in the main list when it has a routine that is not archived, or is listed in
  the array; it shows in the Archive screen when it has an archived routine. Archiving a folder
  archives its routines and takes its entry out of the array (and the current mark with it).
  Restoring a folder un-archives its routines and puts the entry back at the end. A folder can be
  in both places at once (some routines archived): that is shown as it is, nothing to heal.
- **Names are unique without case.** Rename to a name in use is refused ("There's already a folder
  called Travel."). New folder with a name in use goes to that folder. A name that only exists in
  the Archive counts as free: restoring later joins the two, as same name means same folder.
  "Archive" (English or the reader's language) is not allowed as a folder name.
- A folder named on some routine but missing from the array (older app, another device) is shown
  after the listed ones, in the order of its first routine (today's rule), and added to the array
  on the next folder write. Names match without case, as today.
- Reading never needs the array: no array means Q11 behaviour plus the new layout.

**Migration** (once per state, syncs): routines whose folder is "Archive" in English or in the
device's language get `archived: true` and lose that folder name. It runs when the synced marker
`S.archiveMoved` (a plain setting, stamped whole) is absent, and sets it only when something
moves (a bare marker would dirty every synced copy). The guard runs at boot and after each
pull, so an older device's late Archive routine is moved on arrival; "Archive" is a reserved
folder name, so a later folder can never be swept. Older apps then show those routines loose;
acceptable, and they update.

Every rule above is a pure helper in `lib/routine-folders.js` (and `lib/routine-archive.js` if it
grows), each with a unit test: group, order, current, rename, remove, archive folder, restore,
delete, migrate, the new-routine colour.

## Where archived routines go

Hidden wherever you pick a routine to train or plan: the Routines list, the Start sheet, Home's
suggestions, the Schedule day picker and the loop's add sheet, widgets, the watch snapshot.
Readable everywhere a past workout points at its routine (History, Stats, the Coach's history).
Archiving a routine that is on the week or in the loop asks first, naming the days ("Upper A is on
Monday. Archive takes it off the schedule."), then takes it off; Undo puts it back.

One shared selector, `activeRoutines(S)` in `lib/routine-folders.js`, is what every picker reads;
call sites that train or plan switch to it, readers of the past keep `S.routines`. A schedule
entry that still points at an archived routine (another device scheduled it before the archive
synced) is treated like one pointing at a deleted routine: skipped, the day reads as rest.
- The Coach's context of "your routines" and its weekday pointers use active routines only.
  `coach-adapt` is left alone: it adapts a workout already running.
- MCP and the API token routes: `list_routines` includes archived ones with `archived: true`, so
  an assistant can see them (no tool restores them); get and edit work on any routine, as today.
- Every watch snapshot (Apple, Wear, Garmin) is built from active routines.

## The Routines tab (direction C)

Top bar: Edit and the Plan options button (Share, import, starter plans) stay where they are.
The "+ New routine" button moves into the pill below. Swipe actions on rows (Settings → Swipe
actions) stay as they are: a swipe moves sideways at once, a drag needs a still long press, so
the two do not compete. The list, top to bottom:
1. **Current plan** block: the folder's row tinted with the accent (`--acc-soft`, ink measured
   at 4.5:1), pin tile, "Current plan · 4 routines", "…". Its routines below, always open.
   No current plan: the block is absent; loose routines come first.
2. **Not in a folder** header (graft from A), then the loose routines.
3. **One row per other folder**: grey folder tile, name (wraps, never cut), "6 routines", "…",
   chevron. Tapping opens the folder's own screen.
4. **Archive** row: "12 routines", chevron. Shown only when something is archived.
5. A floating pill above the tab bar: **Starred** filter and **+ New**. Hidden while dragging.
   The list ends with enough space that no row hides under it.

**Routine row**: colour tile with the glyph, name with a gold star when starred, "7 exercises ·
Mo", muscle maps (the second drops under 360 px, both drop at the largest text sizes), "…" (44 pt).
Tap opens the routine as today. 50 pt minimum height, grows with text.

**Folder screen** (`/plan/folder/:name`): back "Plan", title, "6 routines · Not the current plan"
(or "Current plan"), "…" with the folder menu, the same rows, "New routine in this folder" at the
end. Long press drags within the folder or up onto "Plan" to take a routine out.

**Starred filter** on: one flat list of starred routines from every folder (their folder named in
the subtitle), "Favourites only, 3 of 12 · Show all". Nothing starred: "No starred routines yet.
Tap … on a routine, then Add to favourites." Remembered per device (localStorage). The pinned
Favourites group goes away; the Start sheet keeps starred first.

## Menus

**Routine "…"**: Start workout (graft from A) · Edit routine · Add to / Remove from favourites ·
Colour and icon · Duplicate · Move to folder · Archive · (gap) Delete (red). In the Archive screen:
Restore · Delete for good.

**Folder "…"**: Make current plan / Not the current plan · Rename · New routine here · Archive
folder and routines · Remove folder (keep routines) · (gap) Delete folder and routines (red).
- Remove folder: its routines become loose, in place; Undo toast.
- Delete folder and routines: a confirm that names the count ("Delete Travel and its 3 routines?
  Your past workouts stay in History."), then an Undo toast (the deleteRoutineWithUndo pattern,
  kept while VoiceOver focus is on it).
- Archive folder: its routines get `archived`, the folder entry is removed; Undo toast.

**Move to folder** sheet (from the routine menu and Edit): current plan first, then folders,
No folder, and New folder at the bottom (graft from B).

**Edit** (replaces today's minus buttons): keeps the groups; a check circle on each routine, a grip on routines and folders (44 pt)
to reorder; "Select all" / "Done"; a bottom bar: Archive · Move to folder · Delete (apart, red).
Folders are reordered here, not selected. Share hidden while editing.

## Archive screen

A pushed screen: archived folders as headers with their routines, then loose archived routines.
Each routine's "…": Restore · Delete for good. Each archived folder's "…": Restore folder ·
Delete folder for good. At the bottom "Delete all 12 for good" with a confirm that names the count
(graft from B). Restore puts a routine back in its folder (recreating the folder entry if needed).

## Drag and drop

Long press (about 0.45 s) on a routine row lifts it: slightly larger, shadow, a small tilt; the old
slot stays as a dashed outline. It rides above the finger so the target name stays readable.
Haptic on lift and on drop (Capacitor Haptics where present; nothing on the web).
- Drop between routines: reorder (the existing `routineOrder` stamp).
- Drop on a folder row or the current plan header: the target fills with the accent and says
  "Move here", with a two-line ring (neutral inside, accent outside, graft from B) so it reads on
  any tile colour. Drop moves the routine to the end of that folder.
- Inside a folder screen: the "Plan" back link is a target ("Move out to Plan").
- Auto-scroll near the top and bottom edges.
- Reduce Motion: no tilt, scale or shadow; the held row gets a plain outline; nothing slides.
- VoiceOver: each row has the custom actions Move to folder, Move up, Move down; the drag
  announces "Moved Mobility to Travel" in a polite live region.
- Non-drag paths: Move to folder in the menu and in Edit.
- Scrolling still works: a long press starts a drag only if the finger has not moved.

## Colour and icon sheet

One medium sheet from the routine menu and the routine editor (replacing today's glyph picker):
tile preview and the name; 12 swatches (system colour tokens, both themes and increased
contrast), the chosen one with a ring and a check, its name in words under them; the glyphs in
three groups, Split, Kit, Session: about 28 in all. All 20 of today's picker glyphs stay and are
regrouped; roughly 8 new ones are drawn (push, pull, upper, lower, full body, grip, travel, home),
house stroke style, own drawings, Lucide, Phosphor or Tabler style allowed, no library added. The
old picker and legacy keys keep working through `glyphOf`. Tile ink per colour is measured (black on
yellow, orange, mint; white elsewhere). New glyph keys join `GLYPHS` in `lib/glyphs.js`, their
paths `components/Icon.jsx`, and the Coach copy `api/coach/core/glyphs.js` (coach-parity test).

The routine's colour shows wherever its tile shows on the phone (Routines, Start sheet, Home,
Schedule rows). Muscle maps on a row take the routine's colour.

## Words

New strings go through `t()` into every locale pack (check-locales.mjs, the pt-BR fingerprint).
Plain words, no em dashes. Folder and routine names are the user's own and never translated.

## PRs (base release-1.4.5)

1. **Colours and icons**: `color` on the routine, the Colour and icon sheet, the new glyphs, the
   tile everywhere. Independent of the rest.
2. **Folder model and archive**: `S.routineFolders`, the helpers and migration, archived hidden
   from every picker, the routine and folder menus, Move to folder, the Archive screen.
3. **The Routines tab**: direction C layout, current plan block, folder screens, Starred filter,
   the pill, Edit with select and the action bar. Stacked on 2.
4. **Drag and drop**: long press, folder targets, Reduce Motion and VoiceOver. Stacked on 3.

## Left to the builder

The exact sync stamping of `S.routineFolders` (follow how other settings are stamped in
`stampEdits`); file split between Plan.jsx and new components; the glyph drawings within the
brief; animation timing within the motion rules; how the folder route encodes names.
