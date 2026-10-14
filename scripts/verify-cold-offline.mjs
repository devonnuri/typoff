import assert from 'node:assert/strict'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

// Build first; run against vite preview, not dev. Fresh context = cold HTTP/SW caches.
// TYPOFF_URL=http://127.0.0.1:4173 TYPOFF_REPORT=/path/report.json node scripts/verify-cold-offline.mjs
// Loopback timings are not real-world bandwidth measurements. Requests include
// workers and SW precaching; null transfer sizes mean Chromium did not expose them.
const url = process.env.TYPOFF_URL ?? 'http://127.0.0.1:4173'
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const requests = []
  const captures = []
  const errors = []
  let phase = 'cold'
  const started = performance.now()
  context.on('response', (response) => {
    const requestPhase = phase
    captures.push((async () => {
      const request = response.request()
      await response.finished()
      const sizes = await request.sizes().catch(() => ({}))
      requests.push({ phase: requestPhase, url: response.url(), finishedMs: Math.round(performance.now() - started), fromServiceWorker: response.fromServiceWorker(), timing: request.timing(), responseBodySize: sizes.responseBodySize >= 0 ? sizes.responseBodySize : null })
    })())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.locator('.cm-content').waitFor()
  const editorMs = Math.round(performance.now() - started)
  await page.locator('.preview-surface').first().waitFor({ timeout: 120000 })
  const previewMs = Math.round(performance.now() - started)
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; if (registration.active?.state !== 'activated') await new Promise((resolve) => registration.active.addEventListener('statechange', resolve, { once: true })) })
  // Activated means the precache install completed, including dynamically loaded assets.
  const cachedUrls = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => request.url)))).flat())
  assert.ok(cachedUrls.some((url) => /web_compiler.*\.wasm/.test(url)), 'Compiler WASM must be cached')
  const offlineReadyMs = Math.round(performance.now() - started)
  await Promise.all(captures)
  phase = 'offline'
  await context.setOffline(true)
  await page.reload()
  await page.locator('.cm-content').waitFor()
  await page.locator('.preview-surface').first().waitFor({ timeout: 120000 })
  const oldSrc = await page.locator('.preview-surface').first().getAttribute('src')
  await page.locator('.cm-content').fill('= Offline cold regression\nA newly compiled offline document.')
  await page.waitForFunction((old) => document.querySelector('.preview-surface')?.getAttribute('src') !== old && document.querySelector('.preview-pane [role="status"]')?.textContent?.startsWith('Preview ready'), oldSrc, { timeout: 120000 })
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'SVG', exact: true }).click()
  const download = await downloadPromise
  assert.match(download.suggestedFilename(), /\.svg$/)
  assert.match(await readFile(await download.path(), 'utf8'), /<svg/)

  // Exercise the actual handler even if the UI control is disabled.
  const successfulSrc = await page.locator('.preview-surface').first().getAttribute('src')
  await page.locator('.cm-content').fill('#cold_missing_function()')
  await page.waitForFunction(() => document.querySelector('.preview-pane [role="status"]')?.textContent === 'Preview error')
  assert.equal(await page.locator('.preview-surface').first().getAttribute('src'), successfulSrc)
  await page.locator('.preview-stale-strip').waitFor()
  let staleDownloads = 0
  page.on('download', () => { staleDownloads += 1 })
  const svgButton = page.getByRole('button', { name: 'SVG', exact: true })
  assert.equal(await svgButton.isDisabled(), true, 'Stale export control must be disabled')
  // React suppresses events on disabled buttons even if the DOM flag is removed.
  // Invoke the installed callback to test the handler's independent safety gate.
  await svgButton.evaluate((button) => {
    const key = Object.keys(button).find((name) => name.startsWith('__reactProps$'))
    assertHandler(key && button[key]?.onClick)
    function assertHandler(handler) {
      if (typeof handler !== 'function') throw new Error('SVG React handler missing')
      handler()
    }
  })
  await page.waitForTimeout(250)
  assert.equal(staleDownloads, 0, 'Stale SVG must not download')
  assert.match(await page.locator('.preview-stale-strip').textContent(), /SVG export blocked/)
  assert.deepEqual(errors, [])
  await Promise.all(captures)
  await context.close()

  // Deliberately delay WASM without a SW to prove the UI is not gated on compiler
  // startup. This is a responsiveness regression, not a throughput benchmark.
  const slow = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } })
  await slow.route('**/*.wasm', async (route) => { await new Promise((resolve) => setTimeout(resolve, 3000)); await route.continue() })
  const slowPage = await slow.newPage()
  await slowPage.goto(url)
  await slowPage.locator('.cm-content').waitFor()
  await slowPage.getByText('Preparing the Typst preview…', { exact: true }).waitFor()
  await slowPage.locator('.cm-content').fill('= Edited during compiler startup\nThe editor remained available.')
  assert.match(await slowPage.locator('.cm-content').textContent(), /Edited during compiler startup/)
  await slowPage.locator('.preview-surface').first().waitFor({ timeout: 120000 })
  await slow.close()

  const assets = await Promise.all((await readdir(new URL('../dist/assets/', import.meta.url))).map(async (name) => ({ name, bytes: (await stat(new URL(`../dist/assets/${name}`, import.meta.url))).size })))
  const coldTransferBytesObserved = requests.filter((request) => request.phase === 'cold' && !request.fromServiceWorker).reduce((sum, request) => sum + (request.responseBodySize ?? 0), 0)
  const report = { editorMs, previewMs, offlineReadyMs, coldTransferBytesObserved, assets, requests, cachedAssetCount: cachedUrls.length, offlineReloadCompileExport: 'PASS', staleExportHandler: 'PASS', delayedCompilerEditableWithFeedback: 'PASS', browserErrors: errors }
  if (process.env.TYPOFF_REPORT) await writeFile(process.env.TYPOFF_REPORT, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, requests: `${requests.length} recorded requests (see TYPOFF_REPORT for details)`, assets: assets.filter((asset) => /\.js$|\.wasm$/.test(asset.name)) }, null, 2))
} finally { await browser.close() }
