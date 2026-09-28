import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import McpConnections from '../components/McpConnections.jsx'

// Settings → MCP / AI. Its own screen, so Settings itself keeps a single row for the connector.
export default function McpSettings() {
  const nav = useNavigate()
  const admin = useStore(s => !!s.user?.admin)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('MCP / AI')}</h1></div>
    </div>
    <McpConnections admin={admin} />
  </div>
}
