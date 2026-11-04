// A short note on one set (set menu → Note): "grip slipped", "a little twinge", "felt easy". It
// rides on the set row as `note` (on a per-side set the row, not a side; on a timed per-side pair
// the L row, where the menu opens), is kept when the workout is saved, and shows as a small line
// under the row in the workout and after the set in History. It goes into the CSV export
// (`set_note`), MCP get_workout (`sets[].note`) and, like a workout's own note, the Coach's full
// workouts (api/coach/core/payload.js cleanWorkout); never into share cards or the PDF's numbers.
export const SET_NOTE_MAX = 140

/** The set's note, trimmed, or '' when it has none. */
export const setNoteOf = s => (s && typeof s.note === 'string' ? s.note.trim() : '')

/** `row` with `text` as its note (cut to SET_NOTE_MAX), or without one when `text` is blank. */
export function withSetNote(row, text) {
  const note = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, SET_NOTE_MAX)
  const { note: _old, ...rest } = row || {}
  return note ? { ...rest, note } : rest
}
