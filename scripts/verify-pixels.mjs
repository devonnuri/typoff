// The compile runs but the img src never changes. Check whether render-page
// returns identical SVG (renderer diff bug) by hashing the blob content per keystroke
// with longer waits, AND check whether the worker even receives render-page requests.
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
const workerLogs = []
page.on('worker', w => {
  w.on('console', m => workerLogs.push(m.text()))
})

await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

async function imgBytes() {
  return await page.evaluate(async () => {
    const img = document.querySelector('.preview-body img.preview-surface')
    if (!img) return null
    const res = await fetch(img.src)
    const buf = await res.arrayBuffer()
    return buf.byteLength
  })
}

// Instead of fetch (which may cache), read pixels via canvas draw.
async function pixelSig() {
  return await page.evaluate(async () => {
    const img = document.querySelector('.preview-body img.preview-surface')
    if (!img) return null
    const canvas = document.createElement('canvas')
    canvas.width = img.clientWidth || 100
    canvas.height = img.clientHeight || 140
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let h = 0
    for (let i = 0; i < data.length; i += 97) h = (h * 31 + data[i]) >>> 0
    return h
  })
}

const ed = page.locator('.cm-content')
await ed.click()
await page.keyboard.press('Control+End')

const sigs = []
for (let i = 0; i < 5; i++) {
  await page.keyboard.type(i === 0 ? 'Q' : 'j')
  await page.waitForTimeout(2500)
  sigs.push({ k: i, bytes: await imgBytes(), px: await pixelSig() })
}
console.log(JSON.stringify(sigs, null, 1))
console.log('WORKER:', JSON.stringify(workerLogs.slice(0, 10)))
await browser.close()
