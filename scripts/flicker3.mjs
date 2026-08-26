// Does the img element get replaced (new img node) or does src change in place?
// Track added nodes too, plus check whether the same <img> persists.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

await page.evaluate(() => {
  window.__evts = []
  const body = document.querySelector('.preview-body')
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeName === 'IMG') window.__evts.push('added new <img>')
      for (const n of m.removedNodes) if (n.nodeName === 'IMG') window.__evts.push('removed <img>')
      // attribute changes on existing imgs
      if (m.type === 'attributes') window.__evts.push('attr-change')
    }
  })
  mo.observe(body, { childList: true, subtree: true, attributes: true })
})

const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')
await page.keyboard.type('q')
await page.waitForTimeout(2500)
console.log(JSON.stringify(await page.evaluate(() => window.__evts)))
await browser.close()
