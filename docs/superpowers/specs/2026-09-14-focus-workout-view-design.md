# Design Spec: Focus Workout View Mode

**Date:** 2026-09-14  
**Status:** Approved for Implementation  
**Topic:** Adding "Focus" View Mode to Active Workout and Settings  
**References:** `single_exercise.png`, `superset.png`, `docs/LIST_VIEW.md`

---

## 1. Overview & Objective

OpenGym currently provides three layouts for the active workout view:
1. `cards`: One exercise unit at a time, with Prev/Next buttons and horizontal swipe.
2. `list`: All exercise units stacked vertically in a scrollable list with compact rows.
3. `compact`: Dense variant of `list` stripping non-essential media, tags, and guidance lines.

This specification introduces a fourth view option: **`focus`**.
The Focus view mode displays a **single set at a time** for each exercise with large, tactile inputs (steppers for load and reps, RPE slider, prominent completion button) and intra-exercise set navigation (footer pager with chevrons and pagination dots). In supersets, it presents a round-by-round flow with a dedicated superset header, round indicator, and exercise switchers.

All user-facing strings across the interface, code, and test cases must be in **English**.

---

## 2. Architecture & Data Model

### 2.1 Presentational Decoupling
Like `cards`, `list`, and `compact`, the `focus` view mode is strictly presentational:
- It relies on the identical `s.active` session model, entries array (`s.active.entries`), and set structure.
- It operates with the same set mutators, completion logic, sound/haptic feedback, progression system, and rest timers.
- Mid-workout layout changes (via the workout header `⋮` menu) remain non-destructive and instant.

### 2.2 Store & Persistence
- **Type signature**: `S.workoutView` and `s.active.workoutView` accept `'cards' | 'list' | 'compact' | 'focus'`.
- **Default value**: `'cards'`. Unrecognized or absent values safely fall back to `'cards'`.
- **Settings Screen (`frontend/src/views/Settings.jsx`)**:
  - The `Segmented` control under **Workout view** expands to 4 choices:
    - `{ value: 'cards', label: t('Cards') }`
    - `{ value: 'list', label: t('List') }`
    - `{ value: 'compact', label: t('Compact') }`
    - `{ value: 'focus', label: t('Focus') }`
  - Fallback check updated: `['list', 'compact', 'focus'].includes(S.workoutView) ? S.workoutView : 'cards'`.
- **Active Workout Header Menu (`frontend/src/views/Workout.jsx`)**:
  - `LAYOUT_LABEL` updated with `focus: t('Focus')`.
  - Layout picker menu includes `{ icon: 'target', label: t('Focus'), on: workoutView === 'focus', onClick: () => setWorkoutView('focus') }`.
- **Session Snapshotting (`frontend/src/sheets.jsx`)**:
  - `beginWorkout` and `beginBackfill` snapshot `st.workoutView || 'cards'` into `s.active.workoutView`.

---

## 3. Interaction & State Management

### 3.1 Active Set State Tracking
In Focus view, an exercise displays one focused set at a time:
- **Set Pointer (`curSetIdx`)**:
  - Tracked in local state keyed per entry index (e.g. `Map<number, number>` or local state inside the focus view component).
  - **Default on Mount / Entry Change**: Resolves to the **first incomplete set** (`entry.sets.findIndex(s => !s.done)`). If all sets are completed, defaults to the last set (`entry.sets.length - 1`).
  - **Manual Navigation**: Users can tap the `<` or `>` chevrons or tap any pagination dot to inspect or edit any set.
  - **Auto-Advance on Completion**:
    - Tapping `Complete` executes OpenGym's standard `onToggle(curSetIdx)`.
    - If another set exists in the current exercise, `curSetIdx` increments to `curSetIdx + 1`.
    - If the set was the final incomplete set for that exercise (or round in a superset), standard rest begins and navigation advances to the next exercise / round.

### 3.2 Exercise-Level Navigation
- Below the focus card, OpenGym's existing **Prev** and **Next** exercise buttons and horizontal swipe surface remain available to navigate between different exercises.
- Once all sets of an exercise are finished, the workout automatically advances to the next unfinished exercise.

---

## 4. UI Components & Visual Design

### 4.1 Single Exercise Layout (Inspiration: `single_exercise.png`)

1. **Card Header**:
   - Exercise name in bold title font.
   - Info button `(i)`: triggers exercise detail sheet.
   - Warm-up indicator: flame icon `🔥` displayed if the active set is a warm-up.
   - Exercise menu `⋮`: triggers standard exercise options (Notes, History, Progression Settings, Swap, Remove).
2. **Prescription & Target Badges**:
   - Set progress pill: e.g., `1/4` (representing `Set {current} of {total}`).
   - Prescribed Reps chip: e.g., `1–5 Reps` (or target reps).
   - Prescribed Load chip: e.g., `@ 20–25 kg` (when target load is configured).
   - Target RPE chip: e.g., `RPE 7–9` (when configured).
   - Rest target chip: e.g., `Rest 120–180s` (based on configured rest).
   - Tempo chip: e.g., `3010` (when tempo is configured).
3. **Set Input Steppers**:
   - **Load (kg / lbs)**:
     - Label: `Load (kg)` or `Load (lbs)` based on active unit.
     - Stepper control: `[-]` button, centered editable numeric value, `[+]` button.
     - Increment: uses exercise-specific or default load increment (`weightIncrement`).
     - Tapping the numeric value opens the native numeric input keyboard.
   - **Reps**:
     - Label: `Reps`.
     - Stepper control: `[-]` button, centered editable numeric value, `[+]` button (step size `1`).
     - Direct numeric tap edit.
4. **RPE Slider**:
   - Label: `RPE`.
   - Horizontal slider ranging from `6` to `10` with `0.5` step increments, with an unrated state `-`.
   - Displays selected RPE score dynamically.
5. **Primary Action Button**:
   - Full-width high-contrast button: `✓ Complete` (or `✓ Completed` if already ticked).
   - Tapping toggles completion, beeps, vibrates, triggers rest countdown, and advances set.
6. **Secondary Actions Row**:
   - Set Note icon button: opens set note.
   - `▷| Skip` button: navigates to next set without marking complete.
   - `•••` Set Menu: opens set actions (toggle warm-up, add drop-set, add burst, delete set).
7. **Footer Set Pager**:
   - Left chevron button `<` (disabled on set 1).
   - Pagination dots (`• • • •`): one dot per set. Active set is highlighted (larger/accented). Tapping any dot selects that set directly.
   - Right chevron button `>` (disabled on last set).

---

### 4.2 Superset Layout (Inspiration: `superset.png`)

1. **Outer Superset Container**:
   - Header with superset icon `⟳` and joined exercise names: e.g., `Barbell Curl + French Press`.
   - Subheader bar:
     - `Round X` badge (e.g., `Round 1`).
     - Exercise indicator: `Exercise X of Y` (e.g., `Exercise 2 of 2`).
     - Navigation chevrons `<` `>` to cycle through exercises/rounds within the superset.
2. **Inner Active Exercise Card**:
   - Renders the active exercise's set for that round using the rich single-set card layout.
3. **Round-by-Round Progression Flow**:
   - Operates in round order: Exercise A Set 1 → Exercise B Set 1 → Round 2 (Exercise A Set 2 → Exercise B Set 2).
   - Driven by `supersetFlowStep` in `frontend/src/lib/supersetFlow.js`.

---

### 4.3 Special Set Types Handling

1. **Unilateral (Per-side L/R) Sets**:
   - Stacked Left (`L`) and Right (`R`) stepper sections inside the card.
   - Each side has its own Load and Reps steppers, alongside side completion ticks or combined completion.
2. **Timed Sets**:
   - In place of the Reps stepper, renders the hold duration and `▶ Start` timer button.
3. **Drop-Sets & Bursts**:
   - Displayed beneath the main set stepper as sub-stepper rows, maintaining full inline adjustability.

---

## 5. Implementation Structure

1. **`frontend/src/views/FocusView.jsx`**:
   - Core component rendering the focused exercise card, steppers, RPE slider, superset round header, and footer pager.
2. **`frontend/src/views/FocusView.css`**:
   - Dedicated styling for tactile steppers, RPE slider, pagination dots, and superset headers adhering to OpenGym's CSS variable design tokens.
3. **`frontend/src/views/Workout.jsx`**:
   - Integrated into `ActiveWorkout`: when `workoutView === 'focus'`, renders `<FocusView ... />` instead of `<ExerciseBlock />` or `.workout-list`.
   - Layout switcher menu includes `'focus'`.
4. **`frontend/src/views/Settings.jsx`**:
   - Segmented control updated to include `focus`.

---

## 6. Testing & Quality Assurance

1. **Settings View Tests (`frontend/src/views/Settings.workoutview.test.jsx`)**:
   - Verify Segmented control renders all 4 choices: Cards, List, Compact, Focus.
   - Verify selecting Focus sets `S.workoutView = 'focus'`.
2. **Session Snapshot Tests (`frontend/src/sheets.workoutview.test.jsx`)**:
   - Verify `beginWorkout` copies `workoutView: 'focus'` to `s.active.workoutView`.
3. **Focus View Component Tests (`frontend/src/views/FocusView.test.jsx` / `Workout.test.jsx`)**:
   - Verify rendering of set 1 of N with correct initial target values.
   - Verify `<` / `>` and pagination dots correctly change the active set.
   - Verify `Complete` button marks set done, starts rest, and increments `curSetIdx`.
   - Verify `Skip` button advances to next set without marking it done.
   - Verify superset round-by-round auto-advance and round header display.
   - Verify unilateral set rendering and mutator updates.
