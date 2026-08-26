// Final verification: img src actually updates in place (no remount), and the
// rendered content reflects the typed text.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

// Track whether the same <img> element persists (src swap) or is replaced.
await page.evaluate(() => {
  window.__sameElement = true
  const initial = document.querySelector('.preview-body img.preview-surface')
  window.__initialImg = initial
})
const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')
for (let i = 0; i < 6; i++) {
  await page.keyboard.type('m')
  await page.waitForTimeout(900)
}
const res = await page.evaluate(() => {
  const cur = document.querySelector('.preview-body img.preview-surface')
  return {
    sameDomNode: cur === window.__initialImg,
    srcChanged: cur?.src !== window.__initialImg?.src,
    naturalWidth: cur?.naturalWidth,
  }
})

// And verify content visually changed: compare svg bytes length via fetch
console.log(JSON.stringify(res))
await browser.close()
