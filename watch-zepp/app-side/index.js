// The Side Service: openGym's part inside the Zepp phone app (docs/ZEPP_OS.md). openGym itself
// cannot run in there, so this talks to the user's own openGym server instead, where the openGym
// page leaves its snapshot and picks up the watch's events (api/watch-relay.js):
//
//   watch  --'sync' {events}-->  here  --POST /api/watch/box-->  server  <--  openGym page
//   watch  <--{accepted, json}--  here  <--{accepted, json}------
//
// Pairing: the settings page (setting/index.js) stores the server's address and a code; this
// trades the code for a watch token (POST /api/watch/redeem) and keeps it in the Zepp app's
// settings storage. Nothing is sent anywhere else.
import { BaseSideService } from '@zeppos/zml/base-side'
import { boxUrl, redeemUrl, cleanServer, bodyOf } from '../lib/relay-client.js'

const store = () => settings.settingsStorage
const get = k => { try { return store().getItem(k) || '' } catch (e) { return '' } }
const put = (k, v) => { try { store().setItem(k, v) } catch (e) { /* nothing to keep it in */ } }
const status = (state, extra = {}) => put('status', JSON.stringify({ state, at: Date.now(), ...extra }))

AppSideService(
  BaseSideService({
    onInit () {},
    onRun () {},
    onDestroy () {},

    onRequest (req, res) {
      if (req.method === 'sync') return this.sync(req.params || {}).then(r => res(null, r), () => res(null, { error: 'offline' }))
      res(null, { error: 'unknown' })
    },

    // The watch's events up, the snapshot down, in one request.
    async sync ({ events = [], name = '' }) {
      if (name) put('device', String(name).slice(0, 40))
      const server = cleanServer(get('server'))
      const token = get('token')
      if (!server || !token) return { unpaired: true }
      const r = await this.fetch({
        url: boxUrl(server),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ events: Array.isArray(events) ? events.slice(0, 50) : [] }),
        timeout: 15000,
      })
      if (r.status === 401) {
        // Unpaired on the server (Settings there, "sign out everywhere", 90 idle days).
        put('token', '')
        status('none')
        return { unpaired: true }
      }
      const body = bodyOf(r.body)
      if (r.status !== 200 || !body) return { error: 'server' }
      return { accepted: Array.isArray(body.accepted) ? body.accepted : [], json: typeof body.json === 'string' ? body.json : null, at: body.at || 0 }
    },

    async pair (code) {
      const server = cleanServer(get('server'))
      if (!server || !code) return status('failed')
      status('pairing')
      try {
        const r = await this.fetch({
          url: redeemUrl(server),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, name: get('device') || 'Zepp OS watch' }),
          timeout: 15000,
        })
        const body = bodyOf(r.body)
        if (r.status === 200 && body && body.token) {
          put('token', body.token)
          put('server', server)
          status('paired', { name: body.name || '' })
        } else status('failed')
      } catch (e) { status('failed') }
      put('code', '')
    },

    onSettingsChange ({ key, newValue }) {
      if (key === 'code' && newValue) this.pair(String(newValue))
      if (key === 'unpair' && newValue) { put('token', ''); put('unpair', ''); status('none') }
    },
  }),
)
