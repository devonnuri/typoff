// Round 2: verify the preview actually UPDATES per keystroke, plus fast-typing bursts.
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'

const URL = 'http://127.0.0.1:5199/'
const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const editor = page.locator('.cm-content')
await editor.click()
await editor.fill('')
await page.waitForTimeout(1500)

async function previewHash() {
  return page.evaluate(() => {
    const el = document.querySelector('[class*=preview], [data-preview]') ?? document.body
    const svgs = el.querySelectorAll('svg')
    let h = ''
    svgs.forEach(s => { h += s.innerHTML.length + ':' })
    return createHash ? h : h // placeholder
  })
}

// hash in node instead
async function sig() {
  const html = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')]
    return svgs.map(s => s.outerHTML.length).join(',') + '|' + svgs.length
  })
  return createHash('sha1').update(html).digest('hex').slice(0, 10)
}

// Slow typing: does signature change each keystroke?
let missed = 0
const log = []
let prev = await sig()
for (const ch of 'Typing') {
  await page.keyboard.type(ch)
  await page.waitForTimeout(1200)
  const cur = await sig()
  const changed = cur !== prev
  if (!changed) missed++
  log.push({ ch, changed, cur })
  prev = cur
}
console.log('SLOW:', JSON.stringify({ missed, log }))

// Fast burst typing with no waits between chars
await editor.fill('')
await page.waitForTimeout(1500)
prev = await sig()
let burstChanged = 0
for (const ch of 'BurstTest') {
  await page.keyboard.type(ch)
  await page.waitForTimeout(60)
}
await page.waitForTimeout(3000)
const after = await sig()
console.log('FAST:', JSON.stringify({ before: prev, after, finalText: await page.evaluate(() => document.querySelector('.cm-content')?.textContent) }))
console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)))
await browser.close()
