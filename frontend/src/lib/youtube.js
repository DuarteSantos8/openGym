// Only a video ID crosses into the iframe URL; never embed an arbitrary exercise link.
export function youtubeId(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    const parts = url.pathname.split('/').filter(Boolean)
    const id = host === 'youtu.be' && parts.length === 1 ? parts[0]
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)
        ? url.pathname === '/watch' ? url.searchParams.get('v')
          : ['embed', 'shorts', 'live'].includes(parts[0]) && parts.length === 2 ? parts[1] : null
        : null
    return /^[\w-]{11}$/.test(id || '') ? id : null
  } catch { return null }
}

export function youtubeLinks(notes = '') {
  return [...new Map((String(notes).match(/https?:\/\/[^\s<>";]+/g) || [])
    .map(url => [youtubeId(url), url]).filter(([id]) => id)).values()]
}

// "Watch on YouTube" on every exercise: a plain search for the exercise's English catalogue name
// plus "form" (a custom exercise searches its own name). No API, no key, nothing embedded: the
// address is only built here, and only opened after a tap (in the YouTube app where the phone
// has it). Null when there is no name to search for.
export function youtubeSearchUrl(ex) {
  if (!ex || ex.missing) return null
  const name = String(ex?.n || '').replace(/\s+/g, ' ').trim().slice(0, 100)
  if (!name) return null
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' form').replace(/%20/g, '+')
}
