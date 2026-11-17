import { useEffect, useState } from 'react'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { isCustomEx } from '../lib/exercises.js'
import { loadPictureIndex, mediaFor, pictureSrc, posterSrc, licenseOf } from '../lib/exercise-pictures.js'
import './exercise-pictures.css'

// "How to do it" under the animation on the exercise sheet: the best demonstration video when there
// is one, photo sequences of the whole movement, then pictures as numbered steps. Every file is free
// to share and shows its author, licence and source. Shows nothing when the exercise has none, so most
// sheets look exactly as before. `load` is injectable for tests.
const POSE = { start: 'Start position', end: 'End position' }

function Credit({ p }) {
  const lic = licenseOf(p)
  return <>
    {p.author} · <a href={lic.url} target="_blank" rel="noopener noreferrer">{lic.name}</a>
    {' · '}<a href={p.source} target="_blank" rel="noopener noreferrer">{t('source')}</a>
  </>
}

export default function ExercisePictures({ ex, load = loadPictureIndex }) {
  const id = ex && !isCustomEx(ex) ? ex.id : null
  const [media, setMedia] = useState(null)
  useEffect(() => {
    let live = true
    if (!id) { setMedia(null); return undefined }
    load().then(index => { if (live) setMedia(mediaFor(index, id)) })
    return () => { live = false }
  }, [id, load])
  if (!media || (!media.video && !media.sequences.length && !media.steps.length)) return null
  const name = exerciseNameFor(ex)
  const { video, sequences, steps } = media
  return <section className="expics" aria-label={t('How to do it')}>
    <h4 className="expics-title">{t('How to do it')}</h4>
    {video && <figure className="expics-video">
      <video src={pictureSrc(video)} poster={posterSrc(video)} width={video.w} height={video.h}
        controls muted loop playsInline preload="none" aria-label={`${name}, ${t('video')}`} />
      <figcaption><strong>{t('Video')}</strong><Credit p={video} /></figcaption>
    </figure>}
    {sequences.map(p => <figure key={p.f} className="expics-seq">
      <img src={pictureSrc(p)} alt={`${name}, ${t('the whole movement, step by step')}`} loading="lazy" decoding="async" />
      <figcaption><strong>{t('Step by step')}</strong>{p.caption && <span className="expics-cap">{p.caption}</span>}<Credit p={p} /></figcaption>
    </figure>)}
    {steps.length > 0 && <ol className="expics-strip">
      {steps.map((p, i) => {
        const pose = POSE[p.pose] ? t(POSE[p.pose]) : null
        return <li key={p.f}>
          <figure>
            <img src={pictureSrc(p)} alt={`${name}, ${t('step')} ${i + 1}${pose ? `: ${pose.toLowerCase()}` : ''}`} loading="lazy" decoding="async" />
            <figcaption>
              <strong>{t('Step')} {i + 1}{pose ? ` · ${pose}` : ''}</strong>
              <Credit p={p} />
            </figcaption>
          </figure>
        </li>
      })}
    </ol>}
  </section>
}
