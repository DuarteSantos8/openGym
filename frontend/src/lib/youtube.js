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
