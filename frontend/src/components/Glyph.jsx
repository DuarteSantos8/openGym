import Icon from './Icon.jsx'

// A picture that stands for something in the app (the warm-up flame, a medal, the advent tree):
// openGym's own icon by default, so it takes the accent or the colour around it and looks the
// same on every phone, or the system's emoji for those who like them (Settings → Look & Home →
// Icons, `S.icons === 'emoji'`). Both are in the page; App.jsx sets data-icons on <html> and the
// stylesheet shows one (index.css .glyph), so nothing re-renders when the choice changes.
//
// `icon` may be null where the emoji is extra (the Wrapped card's 🎉 next to its own icon): with
// openGym icons it is then just left out. Decorative either way: what it means is in the text
// beside it, or in `label`.
export default function Glyph({ icon, emoji, label, className = '' }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
  return <span className={'glyph ' + className} {...a11y}>
    {icon ? <Icon name={icon} /> : null}
    {emoji ? <span className="glyph-e">{emoji}</span> : null}
  </span>
}

// Emoji at the start or end of a sentence: "Your 2026 in openGym is ready 🎉" → text and 🎉.
const EDGE = /^([\p{Extended_Pictographic}\u{FE0F}\u{200D}]+)\s*|\s*([\p{Extended_Pictographic}\u{FE0F}\u{200D}]+)$/gu
export function splitEmoji(text) {
  let emoji = ''
  const rest = String(text ?? '').replace(EDGE, (m, a, b) => { emoji += a || b || ''; return '' })
  return { text: rest, emoji }
}

/** A translated line with an emoji in it: the words, and the emoji only when emoji are chosen. */
export function EmojiText({ text, icon = null }) {
  const { text: words, emoji } = splitEmoji(text)
  if (!emoji) return words
  return <>{words} <Glyph icon={icon} emoji={emoji} /></>
}
