// @vitest-environment happy-dom
// Settings → About & updates → Network log (views/NetworkLog.jsx): the count, who, the latest.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import NetworkLogPage, { NetworkLogRow } from './NetworkLog.jsx'
import { logRequest, _resetNetLog } from '../lib/net-log.js'
import { setOfflineBuild } from '../lib/build-caps.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => { _resetNetLog(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); setOfflineBuild(false) })
const draw = el => act(() => root.render(<MemoryRouter>{el}</MemoryRouter>))

describe('Network log', () => {
  it('says 0 on a phone that talked to nobody, and why in openGym Offline', () => {
    draw(<NetworkLogPage />)
    expect(host.querySelector('.netlog-n').textContent).toBe('0 requests this session')
    expect(host.textContent).toContain('Not a single byte left this phone.')
    act(() => setOfflineBuild(true))
    expect(host.textContent).toContain('openGym Offline has no internet permission')
    expect(host.querySelectorAll('.sect-t').length).toBe(0)
  })

  it('lists the hosts and the latest requests as they happen', () => {
    draw(<NetworkLogPage />)
    act(() => { logRequest('https://gym.example/api/data?x=1', { method: 'PUT' }); logRequest('https://gym.example/api/me') })
    expect(host.querySelector('.netlog-n').textContent).toBe('2 requests this session')
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['Who', 'Latest'])
    expect(host.textContent).toContain('GET gym.example/api/me')
    expect(host.textContent).not.toContain('x=1')
  })

  it('the About row shows the count', () => {
    draw(<NetworkLogRow />)
    act(() => { logRequest('https://a.example/') })
    expect(host.querySelector('.lrow-v').textContent).toBe('1')
  })
})
