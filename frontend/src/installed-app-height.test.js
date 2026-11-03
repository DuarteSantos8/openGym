import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = () => readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the installed app fills the screen', () => {
  // iOS 26 (WebKit bug 301108): a Home Screen app with viewport-fit=cover is laid out one status
  // bar short of the screen it is drawn on, and the tab bar floated 62px above the bottom edge on
  // an iPhone 17 Pro Max until the page was dragged. A body at least as tall as the large viewport
  // keeps the viewport full from the first frame; in a browser tab the body keeps 100dvh.
  it('a Home Screen app floors the body at the large viewport', () => {
    const standalone = css().match(/@media \(display-mode: standalone\)\{([^}]*\}[^}]*)\}/)?.[1] || ''
    expect(standalone).toMatch(/body\{[^}]*min-height:100lvh/)
  })
  it('a browser tab keeps the dynamic viewport height', () => {
    const body = css().match(/\nbody\{([^}]*)\}/)?.[1] || ''
    expect(body).toMatch(/min-height:100dvh/)
    expect(body).not.toMatch(/100lvh/)
  })
})
