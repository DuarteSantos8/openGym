// Which day a picked photo is from, and how sure that is (#940). In order:
//
//   'photo'  the EXIF date the camera wrote (lib/exif-date.js)
//   'name'   a date in the file name: IMG_20260914_073102, PXL_20260914_…, IMG-20260914-WA0001,
//            Screenshot 2026-09-14 at 07.31.02, 2026-09-14 07.31.02.jpg
//   'file'   the file's last-modified time, a guess (a copied or downloaded file has the day it
//            was copied), so the sheet says so
//
// A day in the future or before 2000 is never believed, and a file last modified today counts as
// no date at all: that is the day it was saved or picked, not the day it was taken.
import { exifDateOfFile, isoDay } from './exif-date.js'
import { isoOf } from './format.js'

const MIN = '2000-01-01'
const believable = (d, today) => !!d && d >= MIN && d <= today

// Year, month, day as one run (20260914) or with - _ . between them, not glued to more digits on
// the left. On the right a time may follow straight on (20260914073102), so only the day's own
// two digits are checked.
const NAME = /(?:^|\D)(20\d{2})([-_.]?)(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])(?!\d{1,5}(?:\D|$))/

/** 'YYYY-MM-DD' from a file name, or null. */
export function dateFromName(name) {
  const m = NAME.exec(String(name || ''))
  return m ? isoDay(m[1], m[3], m[4]) : null
}

/** The day a file was last modified (local time), or null. */
export function dateFromModified(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  return isoOf(new Date(ms))
}

/** { d, source } from what is already known about a photo; d null when nothing is believable. */
export function photoDateFrom({ exif, name, modified }, today) {
  if (believable(exif, today)) return { d: exif, source: 'photo' }
  const n = dateFromName(name)
  if (believable(n, today)) return { d: n, source: 'name' }
  const f = dateFromModified(modified)
  if (believable(f, today) && f !== today) return { d: f, source: 'file' }
  return { d: null, source: null }
}

/** The same from a File. Never throws. */
export async function photoDateOfFile(file, today) {
  const exif = await exifDateOfFile(file)
  return photoDateFrom({ exif, name: file?.name, modified: file?.lastModified }, today)
}

