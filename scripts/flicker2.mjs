// Where do img removals happen? Track parent chain of removed nodes.
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
      for (const n of m.removedNodes) {
        if (n.nodeName === 'IMG') {
          window.__evts.push(`removed img from <${m.target.className}> at idx ${[...m.target.children].indexOf(n)}`)
        }
      }
    }
  })
  mo.observe(body, { childList: true, subtree: true })
})

const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')
for (let i = 0; i < 5; i++) {
  await page.keyboard.type('z')
  await page.waitForTimeout(800)
}
console.log(JSON.stringify(await page.evaluate(() => window.__evts), null, 1))
await browser.close()
