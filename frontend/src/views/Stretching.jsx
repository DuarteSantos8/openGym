import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { STRETCHES, STRETCH_GROUPS, STRETCHING_SAFETY, STRETCHING_SAFETY_ES } from '../lib/stretching.js'
import { getLang, t, useLang } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'

export default function Stretching() {
  useLang()
  const nav = useNavigate()
  const [group, setGroup] = useState('')
  const [assetErrors, setAssetErrors] = useState({})
  const isSpanish = getLang() === 'es'
  const visible = group ? STRETCHES.filter(stretch => stretch.group === group) : STRETCHES

  return <>
    <div className="hdr stretch-hdr">
      <button className="iconbtn" onClick={() => nav('/library')} aria-label={t('Exercises')}><Icon name="chevronLeft" /></button>
      <div className="grow"><h1>{t('Stretching')}</h1><div className="sub">{t('12 movements · one muscle group per guide')}</div></div>
      <Icon name="stretch" style={{ color: 'var(--acc)', fontSize: 28 }} />
    </div>

    <div className="card stretch-intro">
      <div className="row" style={{ gap: 9, marginBottom: 6 }}>
        <span className="lrow-i"><Icon name="stretch" /></span>
        <h2 style={{ margin: 0 }}>{t('Simple mobility')}</h2>
      </div>
      <p className="muted small">{isSpanish ? STRETCHING_SAFETY_ES : STRETCHING_SAFETY}</p>
    </div>

    <div className="chips stretch-filters" aria-label={t('Filter stretches')}>
      <button className={'chip nocap' + (!group ? ' on' : '')} aria-pressed={!group} onClick={() => setGroup('')}>{t('All stretches')}</button>
      {STRETCH_GROUPS.map(item => <button key={item.id} className={'chip' + (group === item.id ? ' on' : '')} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{isSpanish ? item.es : item.label}</button>)}
    </div>

    <div className="stretch-grid">
      {visible.map(stretch => {
        const copy = isSpanish ? stretch.es : stretch
        return <article className="card stretch-card" key={stretch.id}>
          <div className="stretch-image-wrap">
            {assetErrors[stretch.id]
              ? <div className="stretch-image-fallback" role="img" aria-label={`${copy.name}: ${t('image unavailable')}`}>{t('Image unavailable')}</div>
              : <img className="stretch-image" src={stretch.image} alt={`${copy.name}: ${copy.instructions[0]}`} width={stretch.width} height={stretch.height} data-resolution="1K" loading="lazy" decoding="async" onError={() => setAssetErrors(errors => ({ ...errors, [stretch.id]: true }))} />}
          </div>
          <div className="stretch-card-body">
            <div className="stretch-card-heading">
              <div><h2>{copy.name}</h2><div className="small muted">{copy.muscle} · {copy.target}</div></div>
              <span className="tag acc">{copy.hold}</span>
            </div>
            <ol className="stretch-steps">{copy.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol>
          </div>
        </article>
      })}
    </div>
  </>
}
