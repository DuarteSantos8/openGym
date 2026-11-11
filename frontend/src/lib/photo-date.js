// The day a picked photo was taken, as well as it can be told (#939). Three sources, the most
// trustworthy first, and which one answered is part of the result so the screen can say how sure
// it is:
//   exif      the date the camera wrote into the file (lib/exif-date.js)
//   name      a date in the file name: IMG_20260914_073102.jpg, PXL_20260914_..., IMG-20260914-WA0001,
//             2026-09-14 07.31.02.jpg, Screenshot 2026-09-14 at 07.31.jpg
//   modified  the file's last-modified time. The phone pickers often keep the capture time here,
//             but a download, an edit or a copy sets it to the day it happened, so it is only a
//             guess, and a guess that says "today" is no better than not knowing.
// Dates in the future and before 2000 are never believed.
import { exifDateOfFile } from './exif-date.js'
import { todayISO } from './format.js'

const NAME = /(?:^|\D)((?:19|20)\d{2})[-_. ]?(0[1-9]|1[0-2])[-_. ]?(0[1-9]|[12]\d|3[01])(?!\d)/

const sane = (d, today) => !!d && d >= '2000-01-01' && d <= today

/** 'YYYY-MM-DD' from a file name that carries one, or null. */
export function dateFromFileName(name, today = todayISO()) {
  const m = NAME.exec(String(name || ''))
  if (!m) return null
  const d = `${m[1]}-${m[2]}-${m[3]}`
  // 31 February and the like: the date has to survive a round trip through a real calendar.
  const back = new Date(d + 'T12:00:00')
  if (Number.isNaN(back.getTime()) || back.getMonth() + 1 !== +m[2] || back.getDate() !== +m[3]) return null
  return sane(d, today) ? d : null
}

/** The local day of a last-modified time in ms, or null. */
export function dateFromModified(ms, today = todayISO()) {
  if (!Number.isFinite(ms) || ms <= 0) return null
  const x = new Date(ms)
  const d = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return sane(d, today) ? d : null
}

/** { date, source } for a File, or null when nothing in it says. Never throws. */
export async function photoDateOfFile(file, today = todayISO()) {
  const exif = await exifDateOfFile(file)
  if (sane(exif, today)) return { date: exif, source: 'exif' }
  const named = dateFromFileName(file && file.name, today)
  if (named) return { date: named, source: 'name' }
  const modified = dateFromModified(file && file.lastModified, today)
  // Today is what the picker would suggest anyway, and a file saved today may be an old photo.
  if (modified && modified !== today) return { date: modified, source: 'modified' }
  return null
}
