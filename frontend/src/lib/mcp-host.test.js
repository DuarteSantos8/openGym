import { describe, expect, it } from 'vitest'
import { suggestMcpHost } from './mcp-host.js'

describe('suggestMcpHost', () => {
  it('stays one level under the domain, so a wildcard certificate still covers it', () => {
    expect(suggestMcpHost('gym.example.com')).toBe('gym-mcp.example.com')
    expect(suggestMcpHost('fit.home.example.org')).toBe('fit-mcp.home.example.org')
  })
  it('puts mcp. in front of a bare domain', () => {
    expect(suggestMcpHost('example.com')).toBe('mcp.example.com')
  })
  it('falls back to a placeholder where there is no domain to borrow', () => {
    for (const host of ['localhost', '192.168.1.20', '::1', '', undefined, 'nas']) expect(suggestMcpHost(host)).toBe('mcp.example.com')
  })
  it('ignores case and a trailing dot', () => {
    expect(suggestMcpHost('Gym.Example.COM.')).toBe('gym-mcp.example.com')
  })
})
