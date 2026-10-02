import Icon from './Icon.jsx'

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(part => Array.from(part)[0] || '').join('').toLocaleUpperCase() || '?'
}

export default function ProfileAvatar({ name, avatar, size = 'md', onClick, label, editable = false }) {
  const Tag = onClick ? 'button' : 'span'
  return <Tag className={`profile-avatar ${size}${onClick ? ' tappable' : ''}`} onClick={onClick}
    aria-label={onClick ? label : undefined}>
    {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{initials(name)}</span>}
    {editable && <span className="profile-avatar-edit" aria-hidden="true"><Icon name="camera" /></span>}
  </Tag>
}
