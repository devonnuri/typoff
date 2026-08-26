// Burst typing: type 30 chars with 80ms gaps, snapshot every ~500ms.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

async function snap(tag) {
  return await page.evaluate((tag) => {
    const panes = [...document.querySelectorAll('.pane-header')]
    const previewHeader = panes.find(p => p.textContent.includes('Preview'))
    const imgs = [...document.querySelectorAll('img.preview-surface')].map(i => i.src.slice(-10))
    return `${tag}|${previewHeader?.querySelector('.pane-title span')?.textContent}|imgs=${imgs.join(',')}|len=${document.querySelector('.cm-content')?.textContent?.length}`
  }, tag)
}

const ed = page.locator('.cm-content')
await ed.click()
// put cursor at end
await page.keyboard.press('Control+End')

let prevImg = ''
let staleCount = 0
const log = []
for (let i = 1; i <= 40; i++) {
  await page.keyboard.type('x')
  if (i % 4 === 0) {
    await page.waitForTimeout(400)
    const s = await snap(`k${i}`)
    log.push(s)
    // check the doc length grew vs imgs changed eventually
  }
}
await page.waitForTimeout(3000)
log.push(await snap('final'))

// Verify: does final img differ from initial? count distinct imgs over time
console.log(log.join('\n'))
await browser.close()
