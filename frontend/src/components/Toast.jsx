import { useUI } from '../store/useUI.js'
export default function Toast() {
  const msg = useUI(s => s.toastMsg)
  return <div id="toast" className={msg ? 'show' : ''}>{msg}</div>
}
