import AvatarButton from './AvatarButton.jsx'

// The header of a tab's root (Home, Training, Nutrition, Progress): its large title and the
// avatar. Every page under a root carries SubHeader instead.
export default function RootHeader({ title, sub }) {
  return (
    <div className="hdr root-hdr">
      <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      <AvatarButton />
    </div>
  )
}
