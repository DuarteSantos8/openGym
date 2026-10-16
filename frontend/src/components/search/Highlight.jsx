import { segments } from '../../lib/search/match.js'

// Text with the matched ranges set in bold: weight, never colour, and never HTML (ui-search.md §7).
export default function Highlight({ text, ranges }) {
  if (!ranges?.length) return text
  return segments(text, ranges).map((s, i) => (s.match ? <strong key={i} className="sr-hl">{s.text}</strong> : s.text))
}
