// Copies text to the clipboard and says whether it did. The Clipboard API is there in every
// secure context — https, localhost, the native shells' own origins — but a self-hosted server
// reached over plain http on the LAN is not one, and there the old selection copy still works.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* refused (no permission, page not focused): the selection copy may still work */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    // iOS selects nothing on select() alone.
    area.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    area.remove()
    return !!ok
  } catch {
    return false
  }
}

/**
 * Copies text that is still being put together (the health hub read first). WebKit lets a page
 * write to the clipboard only during the tap, so where it can the write starts then, with the
 * text to come (a ClipboardItem of a promise); elsewhere the text is copied once it is there.
 */
export async function copyTextLater(textPromise) {
  const text = Promise.resolve(textPromise)
  try {
    if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
      const blob = text.then(v => new Blob([v], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return true
    }
  } catch { /* refused, or no ClipboardItem of a promise here: the plain copy below */ }
  try { return await copyText(await text) } catch { return false }
}
