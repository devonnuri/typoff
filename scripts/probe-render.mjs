// Probe: track preview status label + state transitions while typing.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
const events = []
page.on('console', m => events.push(['console', m.type(), m.text()].join('|')))
page.on('pageerror', e => events.push('pageerror|' + String(e)))

await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

async function snap(tag) {
  const s = await page.evaluate(() => {
    const panes = [...document.querySelectorAll('.pane-header')]
    const previewHeader = panes.find(p => p.textContent.includes('Preview'))
    const errPane = document.querySelector('.preview-error')
    const imgs = [...document.querySelectorAll('img.preview-surface')].map(i => i.src.slice(-12))
    return {
      label: previewHeader?.querySelector('.pane-title span')?.textContent ?? '?',
      err: errPane?.textContent?.slice(0, 120) ?? null,
      problems: document.querySelector('.error-pane-header')?.textContent ?? null,
      imgTail: imgs.join(','),
      docLen: document.querySelector('.cm-content')?.textContent?.length ?? -1,
    }
  })
  events.push(`${tag}|${JSON.stringify(s)}`)
}

await snap('initial')
const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.type('X')
await page.waitForTimeout(300)
await snap('t+0.3s')
await page.waitForTimeout(700)
await snap('t+1s')
await page.waitForTimeout(1500)
await snap('t+2.5s')
await page.keyboard.press('End')
for (const c of 'abc') { await page.keyboard.type(c); await page.waitForTimeout(100) }
await page.waitForTimeout(2500)
await snap('after abc')

console.log(events.join('\n'))
await browser.close()
