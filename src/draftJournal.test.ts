import { describe, expect, it } from 'vitest'
import { DraftLibrary, type DraftStore } from './draftJournal'
import type { StoredFile } from './storage'

class MemoryJournal implements Storage {
  values = new Map<string, string>()
  blocked = false
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) {
    if (this.blocked) throw new Error('QuotaExceededError')
    this.values.set(key, value)
  }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}
const initial = (): StoredFile => ({ id: 'a', name: 'A.typ', content: 'saved', updatedAt: 1 })
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const disk = new Map<string, StoredFile>([['a', initial()]])
  const journal = new MemoryJournal()
  const store: DraftStore = {
    listFiles: async () => [...disk.values()],
    saveFile: async file => { disk.set(file.id, { ...file }) },
    deleteFile: async id => { disk.delete(id) },
  }
  return { disk, journal, store, library: new DraftLibrary(store, journal) }
}

describe('draft journal + serialized store coordination', () => {
  it('recovers an edit on immediate reload before any asynchronous write', async () => {
    const { library, journal, store, disk } = setup()
    await library.load()
    library.put({ ...initial(), content: 'latest', updatedAt: 2 })
    expect(disk.get('a')?.content).toBe('saved')
    const reloaded = new DraftLibrary(store, journal)
    await reloaded.load()
    expect(reloaded.get('a')?.content).toBe('latest')
    expect(reloaded.dirty).toBe(true)
    await reloaded.flush()
    expect(disk.get('a')?.content).toBe('latest')
    expect(journal.length).toBe(0)
    expect(reloaded.dirty).toBe(false)
  })

  it.each([
    ['invalid JSON', '{broken'],
    ['null record', 'null'],
    ['array record', '[]'],
    ['empty id', JSON.stringify({ id: '', token: 'draft', file: null })],
    ['wrong key id', JSON.stringify({ id: 'other', token: 'draft', file: null })],
    ['empty token', JSON.stringify({ id: 'broken', token: '', file: null })],
    ['wrong file id', JSON.stringify({ id: 'broken', token: 'draft', file: { ...initial(), id: 'other' } })],
    ['invalid timestamp', JSON.stringify({ id: 'broken', token: 'draft', file: { ...initial(), id: 'broken', updatedAt: null } })],
    ['invalid file content', JSON.stringify({ id: 'broken', token: 'draft', file: { ...initial(), id: 'broken', content: 42 } })],
  ])('recovers a newer pending draft after an earlier %s journal entry and preserves the malformed record', async (_, raw) => {
    const { store, disk, journal } = setup()
    journal.setItem('typoff-draft-v1:broken', raw)
    journal.setItem('typoff-draft-v1:a', JSON.stringify({ id: 'a', token: 'valid-newer', file: { ...initial(), content: 'newer pending draft', updatedAt: 2 } }))
    const reloaded = new DraftLibrary(store, journal)
    await reloaded.load()
    expect(reloaded.get('a')?.content).toBe('newer pending draft')
    expect(reloaded.error).toContain('typoff-draft-v1:broken')
    expect(journal.getItem('typoff-draft-v1:broken')).toBe(raw)
    await reloaded.flush()
    expect(disk.get('a')?.content).toBe('newer pending draft')
    expect(journal.getItem('typoff-draft-v1:broken')).toBe(raw)
    expect(journal.getItem('typoff-draft-v1:a')).toBeNull()
    const again = new DraftLibrary(store, journal)
    await again.load()
    expect(again.get('a')?.content).toBe('newer pending draft')
  })

  it('reports workspace changes only when load reconciles different file names or contents', async () => {
    const { library, store } = setup()
    store.listFiles = async () => { throw new Error('transient startup failure') }
    expect(await library.load()).toBe(false)
    library.put({ id: 'new', name: 'New.typ', content: '#include "A.typ"', updatedAt: 2 })
    await library.flush()
    store.listFiles = async () => [initial(), { id: 'new', name: 'Old.typ', content: 'old', updatedAt: 0 }]
    expect(await library.load()).toBe(true)
    expect(library.get('new')?.content).toBe('#include "A.typ"')
    expect(await library.load()).toBe(false)
    store.listFiles = async () => [{ ...initial(), updatedAt: 3 }]
    expect(await library.load()).toBe(false)
    store.listFiles = async () => [{ ...initial(), content: 'changed dependency' }]
    expect(await library.load()).toBe(true)
  })

  it('keeps per-file drafts across new/import-like writes and outbound switches', async () => {
    const { library, disk } = setup()
    await library.load()
    library.put({ ...initial(), content: 'outbound' })
    library.put({ id: 'new', name: 'New.typ', content: 'new', updatedAt: 2 })
    library.put({ id: 'import', name: 'Import.typ', content: 'imported', updatedAt: 3 })
    expect(library.get('a')?.content).toBe('outbound')
    await library.flush()
    expect(disk.get('a')?.content).toBe('outbound')
    expect(disk.size).toBe(3)
  })

  it('never clears a newer journal version when an older IndexedDB put completes', async () => {
    const { library, store, disk, journal } = setup()
    await library.load()
    const first = deferred(), second = deferred()
    let calls = 0
    store.saveFile = async file => {
      await (++calls === 1 ? first.promise : second.promise)
      disk.set(file.id, { ...file })
    }
    library.put({ ...initial(), content: 'old draft' })
    const flush = library.flush()
    library.put({ ...initial(), content: 'new draft', name: 'Renamed.typ' })
    first.resolve()
    await Promise.resolve(); await Promise.resolve()
    expect(journal.getItem('typoff-draft-v1:a')).toContain('new draft')
    expect(library.dirty).toBe(true)
    second.resolve()
    await flush
    expect(disk.get('a')).toMatchObject({ name: 'Renamed.typ', content: 'new draft' })
    expect(journal.length).toBe(0)
  })

  it('serializes delete after a pending put and Undo restores the latest draft', async () => {
    const { library, store, disk } = setup()
    await library.load()
    const gate = deferred()
    store.saveFile = async file => { await gate.promise; disk.set(file.id, { ...file }) }
    library.put({ ...initial(), content: 'unsaved newest' })
    const flush = library.flush()
    const deleted = library.remove('a')!
    expect(deleted.content).toBe('unsaved newest')
    gate.resolve()
    await flush
    expect(disk.has('a')).toBe(false)
    expect(library.get('a')).toBeUndefined()
    library.put(deleted)
    await library.flush()
    expect(disk.get('a')?.content).toBe('unsaved newest')
  })

  it('replays pending deletion after reload without resurrecting the saved file', async () => {
    const { library, journal, store, disk } = setup()
    await library.load()
    library.remove('a')
    const reloaded = new DraftLibrary(store, journal)
    await reloaded.load()
    expect(reloaded.get('a')).toBeUndefined()
    await reloaded.flush()
    expect(disk.has('a')).toBe(false)
    expect(journal.length).toBe(0)
  })

  it('retains failed saves for recoverable retry and never reports them saved', async () => {
    const { library, journal, store, disk } = setup()
    await library.load()
    library.put({ ...initial(), content: 'recoverable' })
    store.saveFile = async () => { throw new Error('disk full') }
    await library.flush()
    expect(library.error).toContain('disk full')
    expect(library.dirty).toBe(true)
    expect(library.saving).toBe(false)
    expect(journal.length).toBe(1)
    expect(library.needsUnloadWarning).toBe(false)
    store.saveFile = async file => { disk.set(file.id, file) }
    await library.flush()
    expect(library.error).toBeNull()
    expect(disk.get('a')?.content).toBe('recoverable')
  })

  it('cleans an obsolete journal after commit without requiring quota recovery', async () => {
    const { library, journal, disk, store } = setup()
    await library.load()
    library.put({ ...initial(), content: 'older' })
    journal.blocked = true
    library.put({ ...initial(), content: 'newest' })
    await library.flush()
    expect(disk.get('a')?.content).toBe('newest')
    expect(library.dirty).toBe(false)
    expect(library.needsUnloadWarning).toBe(false)
    // Keep quota blocked: a successful commit must already be reload-safe.
    const reloaded = new DraftLibrary(store, journal)
    await reloaded.load()
    expect(reloaded.get('a')?.content).toBe('newest')
  })

  it.each(['delete', 'rename', 'edit'])('does not replay a committed %s during quota failure on reload', async operation => {
    const { library, journal, disk, store } = setup()
    await library.load()
    library.put({ ...initial(), content: 'obsolete journal' })
    library.put({ id: 'other', name: 'Other.typ', content: 'still unsaved', updatedAt: 2 })
    journal.blocked = true
    if (operation === 'delete') library.remove('a')
    else library.put({ ...initial(), name: operation === 'rename' ? 'Renamed.typ' : 'A.typ', content: 'committed newest' })
    store.saveFile = async file => {
      if (file.id === 'other') throw new Error('other write unavailable')
      disk.set(file.id, { ...file })
    }
    await library.flush()
    // Reload BEFORE quota recovery/retry, not after the stale journal is repaired.
    const reloaded = new DraftLibrary(store, journal)
    await reloaded.load()
    expect(reloaded.get('a')).toEqual(disk.get('a'))
    expect(reloaded.get('other')?.content).toBe('still unsaved')
    expect(journal.blocked).toBe(true)
  })

  it('retries a failed read and does not clear its error after an unrelated successful write', async () => {
    const { library, store } = setup()
    const list = store.listFiles
    store.listFiles = async () => { throw new Error('transient read failure') }
    await library.load()
    library.put({ id: 'new', name: 'New.typ', content: 'new draft', updatedAt: 2 })
    await library.flush()
    expect(library.error).toContain('transient read failure')
    store.listFiles = list
    await library.load()
    expect(library.snapshot().map(file => file.id).sort()).toEqual(['a', 'new'])
    expect(library.error).toBeNull()
  })

  it('reconciles a read retry without overwriting edits or resurrecting deletes made during that read', async () => {
    const { library, store } = setup()
    store.listFiles = async () => { throw new Error('startup read unavailable') }
    await library.load()
    expect(library.loaded).toBe(false)
    library.put(initial())
    const gate = deferred()
    store.listFiles = async () => { await gate.promise; return [initial()] }
    const retry = library.load()
    library.put({ ...initial(), content: 'edit during read' })
    await library.flush()
    gate.resolve()
    await retry
    expect(library.get('a')?.content).toBe('edit during read')
    expect(library.loaded).toBe(true)
    expect(library.error).toBeNull()
    const deletionRead = library.load()
    library.remove('a')
    await library.flush()
    await deletionRead
    expect(library.get('a')).toBeUndefined()
  })

  it('recovers journal drafts even if IndexedDB reads fail', async () => {
    const { library, journal, store } = setup()
    await library.load()
    library.put({ ...initial(), content: 'recover without database' })
    store.listFiles = async () => { throw new Error('database unavailable') }
    const reloaded = new DraftLibrary(store, journal)
    await reloaded.load()
    expect(reloaded.get('a')?.content).toBe('recover without database')
    expect(reloaded.error).toContain('database unavailable')
  })

  it('warns on unload only while an unjournaled mutation has not committed', async () => {
    const { library, journal } = setup()
    await library.load()
    journal.blocked = true
    library.put({ ...initial(), content: 'unsafe until saved' })
    expect(library.needsUnloadWarning).toBe(true)
    expect(library.error).toContain('keep this tab open')
    await library.flush()
    expect(library.needsUnloadWarning).toBe(false)
    expect(library.dirty).toBe(false)
  })
})
