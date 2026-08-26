// Verify editor shortcuts (cleaner selection handling).
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage()
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

async function docText() {
  return page.evaluate(() => document.querySelector('.cm-content')?.textContent)
}
// Select `count` chars to the left of the cursor.
async function selectLeft(count) {
  await page.keyboard.press('Shift+ArrowLeft')
  for (let i = 1; i < count; i++) await page.keyboard.press('Shift+ArrowLeft')
}

const ed = page.locator('.cm-content')
await ed.click()
await ed.fill('')
await page.waitForTimeout(400)

// Bold
await page.keyboard.type('hello')
await selectLeft(5)
await page.keyboard.press(`${MOD}+b`)
await page.waitForTimeout(150)
console.log('bold:', JSON.stringify(await docText()))

// Italic on "world"
await ed.press('End')
await page.keyboard.type(' world')
await selectLeft(5)
await page.keyboard.press(`${MOD}+i`)
await page.waitForTimeout(150)
console.log('italic:', JSON.stringify(await docText()))

// Math autoclose: cursor at end, type $
await ed.press('End')
await page.keyboard.type(' ')
await page.keyboard.press('$')
await page.waitForTimeout(150)
console.log('math:', JSON.stringify(await docText()))

// Comment toggle
await ed.press('End')
await page.keyboard.press('Enter')
await page.keyboard.type('note this')
await page.keyboard.press('Home')
await page.keyboard.press('Shift+End')
await page.keyboard.press(`${MOD}+Slash`)
await page.waitForTimeout(150)
console.log('comment:', JSON.stringify(await docText()))
await page.keyboard.press(`${MOD}+Slash`)
await page.waitForTimeout(150)
console.log('uncomment:', JSON.stringify(await docText()))

await browser.close()
