// Is the compile even happening? Instrument fetch of worker state via label
// transitions over a long window with slow single keystrokes.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

async function label() {
  return page.evaluate(() => {
    const panes = [...document.querySelectorAll('.pane-header')]
    const h = panes.find(p => p.textContent.includes('Preview'))
    return h?.querySelector('.pane-title span')?.textContent
  })
}

const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')

const seen = []
for (let i = 0; i < 4; i++) {
  await page.keyboard.type('p')
  // sample label every 150ms for 6 seconds
  let sawRendering = false
  for (let t = 0; t < 40; t++) {
    await page.waitForTimeout(150)
    const l = await label()
    if (l === 'Rendering preview') sawRendering = true
    if (l !== 'Preview ready (1 page, virtualized)' && l !== 'Rendering preview') {
      seen.push(`unexpected:${l}`)
    }
  }
  seen.push(`k${i + 1}:rendering=${sawRendering}`)
}
console.log(seen.join('\n'))
await browser.close()
