// Talking to the video-import endpoints (api/video-import.js), through api() like everything
// else. The job is minutes-scale, so the screen polls; it polls only while it is on screen.

import { api } from './api.js'
import { t } from './i18n-core.js'

/** Whether this server offers the import at all: the flag GET /api/config carries for a session. */
export const videoImportAvailable = (config, user, { demo } = {}) => !demo && !!(user && config?.video_import)

export const startVideoImport = (url, { mode = 'auto', redraw = false } = {}) =>
  api('/api/video-import', { method: 'POST', body: JSON.stringify({ url, mode, ...(redraw ? { redraw: true } : {}) }) })
export const videoImportJob = id => api('/api/video-import/job?id=' + encodeURIComponent(id))
export const submitVideoRoi = (id, { name, timer, remember = true }) =>
  api('/api/video-import/roi', { method: 'POST', body: JSON.stringify({ id, name, timer: timer || null, remember }) })
export const cancelVideoImport = id => api('/api/video-import/cancel', { method: 'POST', body: JSON.stringify({ id }) })

/** A job's progress line, in the reader's language. */
export function stageText(stage) {
  switch (stage) {
    case 'queued': return t('Waiting for a free slot…')
    case 'metadata': return t('Reading the video’s details…')
    case 'download': return t('Downloading a small copy of the video…')
    case 'needs_roi': return t('Waiting for you to mark the name and the timer')
    case 'frames': return t('Taking one frame per second…')
    case 'ocr': return t('Reading the names and the timer…')
    case 'thumbs': return t('Making thumbnails…')
    case 'done': return t('Done')
    default: return ''
  }
}

/** What went wrong, for a job or a refused request (its `code`), in the reader's language. */
export function videoImportError(code, fallback) {
  switch (code) {
    case 'bad-url': return t('That is not a link to a YouTube video.')
    case 'busy': return t('An import is already running. Wait for it to finish or cancel it.')
    case 'queue-full': return t('Too many imports are waiting on this server. Try again in a few minutes.')
    case 'worker-down': return t('The video importer on this server is not running. Ask whoever runs the server.')
    case 'too-long': return t('This video is too long to import.')
    case 'unavailable': return t('This video is private, age-restricted or no longer available.')
    case 'blocked': return t('YouTube refused this server for now. Try again later.')
    case 'unsupported': return t('Only single videos can be imported, not playlists or live streams.')
    case 'roi-timeout': return t('Nobody marked the name and the timer in time, so the import stopped.')
    case 'not-found': return t('This import has expired. Start it again.')
    default: return fallback || t('The video could not be imported.')
  }
}
