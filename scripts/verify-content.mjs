// Deep verification: fetch the img blob and hash its bytes to prove content updates.
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

async function imgHash() {
  return await page.evaluate(async () => {
    const img = document.querySelector('.preview-body img.preview-surface')
    if (!img) return null
    const res = await fetch(img.src)
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let h = 0
    for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) >>> 0
    return { hash: h, size: bytes.length }
  })
}

const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')

const hashes = []
hashes.push({ tag: 'before', ...(await imgHash()) })
for (let i = 0; i < 5; i++) {
  await page.keyboard.type('k')
  await page.waitForTimeout(1600)
  hashes.push({ tag: `after-k${i + 1}`, ...(await imgHash()) })
}
console.log(JSON.stringify(hashes, null, 1))
await browser.close()
