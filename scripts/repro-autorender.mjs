// Reproduce intermittent auto-render failure: type char-by-char, wait for
// debounce after each keystroke, count how many renders actually appear.
import { chromium } from 'playwright'

const URL = 'http://127.0.0.1:5199/'
const TEXT = 'Hello World'

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

// Find the editor
const editor = page.locator('.cm-content')
await editor.click()
await editor.fill('')

let missed = 0
let rendered = 0
const results = []
for (const ch of TEXT) {
  await page.keyboard.type(ch)
  await page.waitForTimeout(1500) // generous wait for adaptive debounce
  const body = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
  const svgCount = await page.locator('svg').count()
  const canvasCount = await page.locator('canvas').count()
  const hasRender = svgCount > 0 || canvasCount > 0
  if (hasRender) rendered++
  else missed++
  results.push({ typed: JSON.stringify(body), svg: svgCount, canvas: canvasCount })
}
console.log(JSON.stringify({ results, rendered, missed, consoleErrors: errors }, null, 2))
await browser.close()
