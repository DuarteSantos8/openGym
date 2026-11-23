// LIFTIQ-FORK: Settings > LiftIQ sensor sheet (connect / disconnect, state, battery, firmware).
import { useUI } from '../store/useUI.js'
import { Button } from '../components/ui.jsx'
import SensorPanel from './SensorPanel.jsx'
import { getSensor } from './controller.js'

function SensorSheet({ sensor, close }) {
  return <div>
    <h3>LiftIQ sensor</h3>
    <SensorPanel sensor={sensor} />
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" onClick={close}>Done</Button>
  </div>
}

export function openSensorSheet(sensor = getSensor()) {
  return useUI.getState().openSheet(close => <SensorSheet sensor={sensor} close={close} />)
}
