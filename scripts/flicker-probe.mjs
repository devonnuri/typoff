// Flicker probe: watch img elements with MutationObserver, count removals/additions
// while a single keystroke triggers re-render.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

await page.evaluate(() => {
  window.__flicker = { added: 0, removed: 0 }
  const body = document.querySelector('.preview-body')
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.removedNodes) if (n.nodeName === 'IMG' || n.querySelector?.('img')) window.__flicker.removed++
      for (const n of m.addedNodes) if (n.nodeName === 'IMG' || n.querySelector?.('img')) window.__flicker.added++
    }
  })
  mo.observe(body, { childList: true, subtree: true })
})

const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')
for (let i = 0; i < 10; i++) {
  await page.keyboard.type('y')
  await page.waitForTimeout(700)
}
const flick = await page.evaluate(() => window.__flicker)
console.log(JSON.stringify(flick))
await browser.close()
