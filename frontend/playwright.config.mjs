// End-to-end tests (EP16): the production build in a real browser, as a guest, against a real
// API on a throwaway data folder. Every test also fails if any request leaves this machine.
//
//   npm run build && npm run test:e2e            starts the API and `vite preview` itself
//   E2E_BASE_URL=http://localhost:4173 ...       reuses servers you started
//   E2E_CHANNEL=chrome ...                       the installed Chrome for the Chromium projects
//   npx playwright test --project=iphone-webkit  one project only
//
// Projects: a phone-sized Chromium (the default), an iPhone 13 profile on WebKit (Safari's
// engine; the iOS app is a WKWebView) and a Pixel 7 profile on Chromium (the Android app is a
// Chromium WebView). They emulate engine, viewport, touch and user agent. They are not devices:
// real-phone checks stay in docs/next/devices.md.
import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const reuse = process.env.E2E_BASE_URL
const dataDir = reuse ? '' : mkdtempSync(join(tmpdir(), 'og-e2e-'))

// Chromium only: a fake camera, so the Movement lab can start without hardware or a prompt.
const fakeCamera = {
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.mjs$/,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]] : 'list',
  outputDir: 'e2e-results',
  use: {
    baseURL: reuse || 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { viewport: { width: 390, height: 844 }, channel: process.env.E2E_CHANNEL || undefined, ...fakeCamera } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'pixel-chromium', use: { ...devices['Pixel 7'], channel: process.env.E2E_CHANNEL || undefined, ...fakeCamera } },
  ],
  webServer: reuse ? undefined : [
    { command: 'node server.js', cwd: '../api', port: 3000, reuseExistingServer: false,
      env: { PORT: '3000', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080' } },
    { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: false },
  ],
})
