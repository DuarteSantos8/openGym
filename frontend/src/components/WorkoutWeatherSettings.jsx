import { useState } from 'react'
import { Row, Switch } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n-core.js'
import { workoutWeatherEnabled, enableWorkoutWeather, disableWorkoutWeather } from '../lib/workout-weather.js'

export default function WorkoutWeatherSettings() {
  const owner = useStore(s => JSON.stringify([s.sync?.server || 'local', s.user?.id || 'local']))
  return <WeatherRow key={owner} />
}
function WeatherRow() {
  const [enabled, setEnabled] = useState(() => workoutWeatherEnabled(useStore))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <>
    <Row icon="cloud" title={t('Workout weather')} subtitle={t('Save outdoor temperature and humidity to Apple Health. Your approximate location is sent once per workout to Open-Meteo; it is not stored or sent to your openGym server.')}>
      <Switch checked={enabled} disabled={busy} onChange={async value => {
        setBusy(true); setError('')
        try {
          if (value) await enableWorkoutWeather(useStore)
          else disableWorkoutWeather()
          setEnabled(workoutWeatherEnabled(useStore))
        } catch (e) { setError(t(e.message || String(e))) }
        finally { setBusy(false) }
      }} />
    </Row>
    <div className="lrow-s" style={{ padding: '0 16px 8px' }}><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">{t('Weather data by Open-Meteo (CC BY 4.0)')}</a></div>
    {error && <div className="lrow" role="alert">{error}</div>}
  </>
}
