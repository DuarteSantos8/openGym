// End-to-end tests (EP16): the production build in a real browser, as a guest, against a real
// API on a throwaway data folder. Every test also fails if any request leaves this machine.
//
//   npm run build && npm run test:e2e            starts the API and `vite preview` itself
//   E2E_BASE_URL=http://localhost:4173 ...       reuses servers you started
//   E2E_CHANNEL=chrome ...                       the installed Chrome for the Chromium projects
//   npx playwright test --project=iphone-webkit  one project only
//   npx playwright test --project=cloud-chromium the Cloud edition's own tests (e2e/cloud/)
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

// The Cloud edition (ADR 0008) is a second build of the same source, so it gets its own server
// and its own projects: e2e/cloud/ runs against it and nothing else does. Its "project" is an
// address on this machine that no server listens on; each test answers for it with page.route
// (e2e/cloud/pretend-project.mjs), so the rule that nothing leaves this device still holds.
const CLOUD_URL = process.env.E2E_CLOUD_BASE_URL || 'http://localhost:4174'
const CLOUD_ENV = { VITE_EDITION: 'cloud', VITE_SUPABASE_URL: 'http://127.0.0.1:4175', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e' }
const cloud = !reuse || !!process.env.E2E_CLOUD_BASE_URL
const CLOUD_TESTS = /cloud\/.*\.e2e\.mjs$/
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
    { name: 'chromium', testIgnore: CLOUD_TESTS, use: { viewport: { width: 390, height: 844 }, channel: process.env.E2E_CHANNEL || undefined, ...fakeCamera } },
    { name: 'iphone-webkit', testIgnore: CLOUD_TESTS, use: { ...devices['iPhone 13'] } },
    { name: 'pixel-chromium', testIgnore: CLOUD_TESTS, use: { ...devices['Pixel 7'], channel: process.env.E2E_CHANNEL || undefined, ...fakeCamera } },
    ...(cloud ? [
      { name: 'cloud-chromium', testMatch: CLOUD_TESTS, use: { baseURL: CLOUD_URL, viewport: { width: 390, height: 844 }, channel: process.env.E2E_CHANNEL || undefined } },
      { name: 'cloud-iphone-webkit', testMatch: CLOUD_TESTS, use: { ...devices['iPhone 13'], baseURL: CLOUD_URL } },
    ] : []),
  ],
  webServer: reuse ? undefined : [
    { command: 'node server.js', cwd: '../api', port: 3000, reuseExistingServer: false,
      env: { PORT: '3000', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080' } },
    { command: 'npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: false },
    // Builds the Cloud edition into its own folder, then serves it. Slower to come up than the
    // others because of the build, hence the longer wait.
    { command: 'npx vite build --outDir dist-cloud --emptyOutDir --logLevel error && npx vite preview --outDir dist-cloud --port 4174 --strictPort',
      port: 4174, reuseExistingServer: false, timeout: 300_000, env: { ...CLOUD_ENV, NODE_ENV: 'production' } },
  ],
})
