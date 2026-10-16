import { LineArt, equipmentOf } from './line-art.jsx'

// The thumbnail of an exercise with no picture, or whose picture will not load: what it is done
// with, in line art (ui-redesign-components §3), never a figure.
export default function EquipmentThumb({ ex }) {
  return <div className="thumb thumb-x"><LineArt scene="equipment" state={{ eq: equipmentOf(ex?.eq) }} /></div>
}
