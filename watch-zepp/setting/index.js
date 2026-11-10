// The openGym watch app's settings page, shown inside the Zepp phone app: where the watch is paired
// with the user's own openGym server. The address and the code from openGym (Settings, Zepp OS
// watch, Pair a watch) go into the Zepp app's settings storage, and the Side Service trades the
// code for a watch token (app-side/index.js). In the phone's language (setting/i18n).
import { gettext } from 'i18n'

const LIME = '#30D158'
const QUIET = '#6E6E73'

AppSettingsPage({
  state: { server: '', code: '' },

  build (props) {
    const st = props.settingsStorage
    let status = {}
    try { status = JSON.parse(st.getItem('status') || '{}') || {} } catch (e) { status = {} }
    const paired = !!st.getItem('token') && status.state !== 'failed'
    const line = status.state === 'pairing' ? gettext('pairing')
      : status.state === 'failed' ? gettext('failed')
      : paired ? gettext('paired').replace('{0}', status.name || 'openGym')
      : gettext('not_paired_yet')

    const field = (key, label, extra = {}) => TextInput({
      label,
      value: st.getItem(key) || '',
      subStyle: { color: QUIET, fontSize: '14px' },
      labelStyle: { fontSize: '16px', fontWeight: '600' },
      maxLength: 200,
      onChange: v => { this.state[key] = String(v || '').trim(); if (key === 'server') st.setItem('server', this.state.server) },
      ...extra,
    })

    return Section({ style: { padding: '16px' } }, [
      Text({ paragraph: true, style: { fontSize: '15px', lineHeight: '22px', color: QUIET, marginBottom: '12px' } }, gettext('how')),
      field('server', gettext('server'), { placeholder: 'gym.example.com' }),
      field('code', gettext('code'), { placeholder: 'XXXX-XXXX-XXXX' }),
      View({ style: { marginTop: '16px' } }, [
        Button({
          label: gettext('pair'),
          style: { width: '100%', borderRadius: '24px', background: LIME, color: '#000000', fontWeight: '700', fontSize: '17px', height: '48px' },
          onClick: () => {
            if (this.state.server) st.setItem('server', this.state.server)
            // The Side Service hears the change and redeems it (onSettingsChange).
            if (this.state.code) st.setItem('code', this.state.code)
          },
        }),
      ]),
      Text({ paragraph: true, style: { fontSize: '15px', lineHeight: '22px', marginTop: '16px', color: status.state === 'failed' ? '#FF453A' : paired ? LIME : QUIET } }, line),
      paired ? View({ style: { marginTop: '24px' } }, [
        Button({
          label: gettext('unpair'),
          style: { width: '100%', borderRadius: '24px', fontSize: '15px', height: '44px' },
          onClick: () => st.setItem('unpair', String(Date.now())),
        }),
      ]) : null,
    ].filter(Boolean))
  },
})
