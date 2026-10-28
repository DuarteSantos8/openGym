// The only URLs the worker hands to yt-dlp: a YouTube video, rewritten to its canonical form.
//
// The id is all that survives from what the caller sent, so nothing they typed reaches a
// command line — no playlist parameter, no other site yt-dlp happens to support, no option
// smuggled in as a URL. The same function lives in api/video-import.js (the API refuses a bad
// URL before it ever calls the worker); the two are tested against the same cases.

const ID_RE = /^[A-Za-z0-9_-]{11}$/
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

/** { id, url } for a YouTube video link, or null. */
export function canonicalYouTube(input) {
  let u
  try { u = new URL(String(input || '').trim()) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  if (!HOSTS.has(host)) return null
  let id = null
  if (host.endsWith('youtu.be')) id = u.pathname.split('/')[1]
  else if (u.pathname === '/watch') id = u.searchParams.get('v')
  else {
    const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(u.pathname)
    if (m) id = m[1]
  }
  if (!id || !ID_RE.test(id)) return null
  return { id, url: 'https://www.youtube.com/watch?v=' + id }
}
