import { useEffect, useState } from 'react'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { isCustomEx } from '../lib/exercises.js'
import { loadPictureIndex, picturesFor, pictureSrc, licenseOf } from '../lib/exercise-pictures.js'
import './exercise-pictures.css'

// Start and end drawings of a catalogue exercise (catalogue/photos: Everkinetic, CC BY-SA 4.0,
// author and licence shown with each), under the animation on the exercise sheet. Shows nothing
// when the exercise has none, so most sheets look exactly as before. `load` is injectable for tests.
const POSE = { start: 'Start position', end: 'End position' }
export default function ExercisePictures({ ex, load = loadPictureIndex }) {
  const id = ex && !isCustomEx(ex) ? ex.id : null
  const [pics, setPics] = useState([])
  useEffect(() => {
    let live = true
    if (!id) { setPics([]); return undefined }
    load().then(index => { if (live) setPics(picturesFor(index, id)) })
    return () => { live = false }
  }, [id, load])
  if (!pics.length) return null
  const name = exerciseNameFor(ex)
  return <section className="expics" aria-label={t('More pictures')}>
    <h4 className="expics-title">{t('More pictures')}</h4>
    <ul className="expics-strip">
      {pics.map((p, i) => {
        const lic = licenseOf(p)
        return <li key={p.f}>
          <figure>
            <img src={pictureSrc(p)} alt={`${name}, ${POSE[p.pose] ? t(POSE[p.pose]).toLowerCase() : `${t('picture')} ${i + 1}`}`} loading="lazy" decoding="async" />
            <figcaption>
              {POSE[p.pose] && <strong>{t(POSE[p.pose])}</strong>}
              {p.author} · <a href={lic.url} target="_blank" rel="noopener noreferrer">{lic.name}</a>
              {' · '}<a href={p.source} target="_blank" rel="noopener noreferrer">{t('source')}</a>
            </figcaption>
          </figure>
        </li>
      })}
    </ul>
  </section>
}
