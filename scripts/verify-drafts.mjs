import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(process.env.TYPOFF_URL ?? 'http://127.0.0.1:5174')
  const editor = page.locator('.cm-content')
  await editor.waitFor()
  await page.getByRole('button', { name: 'New file', exact: true }).click()
  await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
  await editor.fill('= Immediate switch draft')
  await page.getByRole('button', { name: 'Untitled.typ', exact: true }).click()
  await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
  assert.equal(await editor.innerText(), '= Immediate switch draft')
  console.log('PASS immediate file switch')
  await editor.fill('= Outbound new draft')
  await page.getByRole('button', { name: 'New file', exact: true }).click()
  await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
  assert.equal(await editor.innerText(), '= Outbound new draft')
  console.log('PASS immediate new file')
  await page.evaluate(() => { window.showOpenFilePicker = async () => [{ getFile: async () => new File(['= Imported'], 'Imported.typ') }] })
  await editor.fill('= Outbound import draft')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
  assert.equal(await editor.innerText(), '= Outbound import draft')
  console.log('PASS immediate import')
  await editor.fill('= Delete undo latest draft')
  await page.getByRole('button', { name: 'Delete Welcome.typ', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
  assert.equal(await editor.innerText(), '= Delete undo latest draft')
  console.log('PASS delete/Undo latest draft')
  await editor.fill('= Reload latest draft')
  await page.reload()
  await editor.waitFor()
  await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
  assert.equal(await editor.innerText(), '= Reload latest draft')
  console.log('PASS immediate reload')
  await editor.fill('= Rename latest draft')
  await page.getByRole('button', { name: 'Rename Welcome.typ', exact: true }).click()
  await page.getByRole('textbox', { name: 'Rename Welcome.typ', exact: true }).fill('Renamed.typ')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Untitled.typ', exact: true }).click()
  await page.getByRole('button', { name: 'Renamed.typ', exact: true }).click()
  assert.equal(await editor.innerText(), '= Rename latest draft')
  await page.waitForTimeout(800)
  const stored = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('typoff-db', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const result = await new Promise((resolve, reject) => { const r = db.transaction('files').objectStore('files').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    db.close(); return result
  })
  const renamed = stored.find(file => file.name === 'Renamed.typ')
  assert.equal(renamed?.content, '= Rename latest draft')
  assert.equal(stored.some(file => file.name === 'Welcome.typ'), false)
  await editor.fill('= Must stay deleted')
  await page.getByRole('button', { name: 'Delete Renamed.typ', exact: true }).click()
  await page.waitForTimeout(800)
  await page.reload()
  await editor.waitFor()
  assert.equal(await page.getByRole('button', { name: 'Renamed.typ', exact: true }).count(), 0)
  console.log('PASS fast rename/delete and IndexedDB readback; no resurrection')
  await page.getByRole('button', { name: 'Untitled.typ', exact: true }).click()
  await page.evaluate(() => {
    window.__originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () { throw new Error('Injected disk failure') }
  })
  await editor.fill('= Recoverable failed save')
  await page.waitForFunction(() => document.body.textContent.includes('Local save failed; drafts retained for retry'))
  await page.reload()
  await editor.waitFor()
  await page.getByRole('button', { name: 'Untitled.typ', exact: true }).click()
  assert.equal(await editor.innerText(), '= Recoverable failed save')
  await page.waitForFunction(() => !document.body.textContent.includes('Local save failed'))
  console.log('PASS surfaced IndexedDB failure and real reload recovery')
} finally {
  await browser.close()
}

// Isolated real-browser regressions; run both even if the first fails.
const recoveryBrowser = await chromium.launch({ headless: true })
const failures = []
async function regression(name, test) {
  const context = await recoveryBrowser.newContext()
  try {
    await test(context)
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(error)
    console.error(`FAIL ${name}: ${error.message}`)
  } finally { await context.close() }
}
const url = process.env.TYPOFF_URL ?? 'http://127.0.0.1:5174'
async function storedFiles(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('typoff-db', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const files = await new Promise((resolve, reject) => {
      const request = db.transaction('files').objectStore('files').getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return files
  })
}
try {
  await regression('malformed journal first does not block another file’s newer pending draft on reload', async context => {
    const page = await context.newPage()
    await page.goto(url)
    await page.locator('.cm-content').waitFor()
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('typoff-draft-v1:')))
    const welcome = (await storedFiles(page)).find(file => file.name === 'Welcome.typ')
    // Force enumeration order: the corrupted record is first, the valid draft second.
    await context.addInitScript(({ id }) => {
      localStorage.setItem('typoff-draft-v1:broken', '{broken')
      localStorage.setItem('typoff-draft-v1:' + id, JSON.stringify({ id, token: 'pending-newer', file: { id, name: 'Welcome.typ', content: '= Recovered despite malformed neighbor', updatedAt: Date.now() } }))
      const keys = ['typoff-draft-v1:broken', 'typoff-draft-v1:' + id]
      const key = Storage.prototype.key
      Storage.prototype.key = function (index) { return this === localStorage && index < keys.length ? keys[index] : key.call(this, index) }
    }, { id: welcome.id })
    await page.reload()
    await page.locator('.cm-content').waitFor()
    assert.equal(await page.locator('.cm-content').innerText(), '= Recovered despite malformed neighbor')
    assert.ok((await page.locator('body').innerText()).includes('typoff-draft-v1:broken'))
    assert.equal(await page.evaluate(() => localStorage.getItem('typoff-draft-v1:broken')), '{broken')
    await page.waitForFunction(id => !localStorage.getItem('typoff-draft-v1:' + id), welcome.id, { timeout: 7000 })
    assert.equal((await storedFiles(page)).find(file => file.id === welcome.id)?.content, '= Recovered despite malformed neighbor')
  })
  await regression('successful startup reconciliation automatically renders a recovered include without switching the active editor', async context => {
    const page = await context.newPage()
    await page.goto(url)
    await page.locator('.cm-content').waitFor()
    await page.locator('.cm-content').fill('= Recovered dependency')
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('typoff-draft-v1:')))
    await context.addInitScript(() => {
      const getAll = IDBObjectStore.prototype.getAll
      let allowReads = false
      window.__allowStartupReads = () => { allowReads = true }
      IDBObjectStore.prototype.getAll = function (...args) {
        if (!allowReads) throw new Error('Injected transient startup read failure')
        return getAll.apply(this, args)
      }
    })
    await page.reload()
    await page.waitForFunction(() => document.body.textContent.includes('Could not load local files'))
    await page.getByRole('button', { name: 'New file', exact: true }).click()
    await page.locator('.cm-content').fill('#include "Welcome.typ"')
    await page.waitForFunction(() => document.body.textContent.includes('Preview error'), null, { timeout: 20000 })
    assert.equal(await page.getByRole('button', { name: 'SVG', exact: true }).isDisabled(), true)
    await page.evaluate(() => {
      window.__editorBeforeRecovery = document.querySelector('.cm-content')
      window.__allowStartupReads()
    })
    await page.getByRole('button', { name: 'Welcome.typ', exact: true }).waitFor({ timeout: 7000 })
    assert.equal(await page.locator('.cm-content').innerText(), '#include "Welcome.typ"')
    assert.equal(await page.evaluate(() => window.__editorBeforeRecovery === document.querySelector('.cm-content')), true, 'editor must not remount')
    await page.waitForFunction(() => {
      const svg = [...document.querySelectorAll('button')].find(button => button.textContent === 'SVG')
      return svg && !svg.disabled
    }, null, { timeout: 15000 })
    assert.equal((await page.locator('body').innerText()).includes('Preview error'), false)
    assert.equal(await page.locator('.cm-content').innerText(), '#include "Welcome.typ"')
  })
  await regression('quota-failed journal replacement cannot resurrect a committed delete on immediate reload', async context => {
    const page = await context.newPage()
    await page.goto(url)
    await page.locator('.cm-content').waitFor()
    await page.getByRole('button', { name: 'New file', exact: true }).click()
    await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('typoff-draft-v1:')))
    const welcome = (await storedFiles(page)).find(file => file.name === 'Welcome.typ')
    await page.locator('.cm-content').fill('= Obsolete live journal')
    assert.ok(await page.evaluate(id => localStorage.getItem('typoff-draft-v1:' + id), welcome.id))
    await context.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('Injected quota failure', 'QuotaExceededError') }
    })
    await page.evaluate(() => {
      Storage.prototype.setItem = function () { throw new DOMException('Injected quota failure', 'QuotaExceededError') }
    })
    await page.getByRole('button', { name: 'Delete Welcome.typ', exact: true }).click()
    assert.equal((await storedFiles(page)).some(file => file.id === welcome.id), false)
    // Quota remains blocked on reload; do not wait for the five-second retry.
    await page.reload()
    await page.locator('.cm-content').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Welcome.typ', exact: true }).count(), 0)
    assert.equal((await storedFiles(page)).some(file => file.id === welcome.id), false)
    await page.waitForTimeout(600)
    assert.equal((await storedFiles(page)).some(file => file.id === welcome.id), false)
  })
  await regression('one-shot startup getAll failure recovers the library and editor within 5.5 seconds without user action', async context => {
    const page = await context.newPage()
    await page.goto(url)
    await page.locator('.cm-content').waitFor()
    await page.locator('.cm-content').fill('= Original after automatic read retry')
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('typoff-draft-v1:')))
    await context.addInitScript(() => {
      const getAll = IDBObjectStore.prototype.getAll
      let calls = 0
      IDBObjectStore.prototype.getAll = function (...args) {
        if (++calls === 1) throw new Error('Injected one-shot startup read failure')
        return getAll.apply(this, args)
      }
    })
    await page.reload()
    await page.waitForFunction(() => document.body.textContent.includes('Could not load local files'))
    await page.waitForTimeout(5500)
    assert.equal(await page.getByRole('button', { name: 'Welcome.typ', exact: true }).count(), 1)
    assert.equal(await page.locator('.cm-content').innerText(), '= Original after automatic read retry')
    assert.equal((await page.locator('body').innerText()).includes('Could not load local files'), false)
    assert.equal((await storedFiles(page)).length, 1)
  })
  await regression('transient startup getAll failure retries without hiding original files or losing a new edit', async context => {
    const page = await context.newPage()
    await page.goto(url)
    await page.locator('.cm-content').waitFor()
    await page.locator('.cm-content').fill('= Original durable file')
    await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('typoff-draft-v1:')))
    await context.addInitScript(() => {
      const getAll = IDBObjectStore.prototype.getAll
      IDBObjectStore.prototype.getAll = function (...args) {
        if (!sessionStorage.getItem('startup-read-failed')) {
          sessionStorage.setItem('startup-read-failed', 'yes')
          throw new Error('Injected transient startup read failure')
        }
        return getAll.apply(this, args)
      }
    })
    await page.reload()
    await page.waitForFunction(() => document.body.textContent.includes('Could not load local files'))
    await page.getByRole('button', { name: 'New file', exact: true }).click()
    await page.locator('.cm-content').fill('= New edit during failed load')
    await page.waitForTimeout(700)
    assert.ok((await page.locator('body').innerText()).includes('Could not load local files'), 'successful write must not clear the read error')
    await page.getByRole('button', { name: 'Welcome.typ', exact: true }).waitFor({ timeout: 7000 })
    assert.equal(await page.locator('.cm-content').innerText(), '= New edit during failed load')
    assert.equal((await page.locator('body').innerText()).includes('Could not load local files'), false)
    await page.getByRole('button', { name: 'Welcome.typ', exact: true }).click()
    assert.equal(await page.locator('.cm-content').innerText(), '= Original durable file')
    const files = await storedFiles(page)
    assert.equal(files.length, 2)
    assert.equal(files.find(file => file.name === 'Untitled.typ')?.content, '= New edit during failed load')
  })
} finally { await recoveryBrowser.close() }
if (failures.length) throw new AggregateError(failures, 'Recovery regressions failed')
