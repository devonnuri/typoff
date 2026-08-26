// Measure visual blank gap: poll img presence at high frequency during re-render.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

await page.evaluate(() => {
  window.__blankFrames = 0
  window.__polling = true
  const check = () => {
    if (!window.__polling) return
    const has = !!document.querySelector('.preview-body img.preview-surface')
    if (!has) window.__blankFrames++
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
})

const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')
for (let i = 0; i < 8; i++) {
  await page.keyboard.type('w')
  await page.waitForTimeout(800)
}
console.log(JSON.stringify(await page.evaluate(() => { window.__polling = false; return window.__blankFrames })))
await browser.close()
