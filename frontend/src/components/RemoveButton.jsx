import Icon from './Icon.jsx'

// The trash button at the end of a settings list row. Painted 36px, with a 48px hit area (index.css
// .iconbtn), so a thumb finds it; `label` names it for a screen reader.
export default function RemoveButton({ label, disabled, onClick }) {
  return <button type="button" className="iconbtn" aria-label={label} disabled={disabled} onClick={onClick}><Icon name="trash" /></button>
}
