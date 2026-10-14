import type { StoredFile } from './storage'

const PREFIX = 'typoff-draft-v1:'
type Mutation = { token: string; id: string; file: StoredFile | null }
export interface DraftStore {
  listFiles(): Promise<StoredFile[]>
  saveFile(file: StoredFile): Promise<void>
  deleteFile(id: string): Promise<void>
}

/** Latest drafts are synchronous; one writer serializes puts and tombstones.
 * A journal entry is removed only after its exact version commits to IndexedDB.
 */
export class DraftLibrary {
  private files = new Map<string, StoredFile>()
  private pending = new Map<string, Mutation>()
  private unsafe = new Set<string>()
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private sequence = 0
  private loadError: string | null = null
  private writeError: string | null = null
  private recoveryError: string | null = null
  private touched = new Set<string>()
  private journalRecovered = false
  loaded = false
  saving = false
  get error() {
    return [this.loadError, this.recoveryError, this.writeError].filter(Boolean).join('; ') || null
  }

  private store: DraftStore
  private journal: Storage
  constructor(store: DraftStore, journal: Storage) {
    this.store = store
    this.journal = journal
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private emit() { this.listeners.forEach(listener => listener()) }
  snapshot() { return [...this.files.values()].sort((a, b) => b.updatedAt - a.updatedAt) }
  get(id: string) { return this.files.get(id) }
  get dirty() { return this.pending.size > 0 }
  get needsUnloadWarning() { return this.unsafe.size > 0 }

  /** Returns whether reconciliation changed the render workspace, not save metadata. */
  async load(): Promise<boolean> {
    let workspaceChanged = false
    const reconcile = (id: string, file: StoredFile | null) => {
      const previous = this.files.get(id)
      if (file) {
        if (!previous || previous.name !== file.name || previous.content !== file.content) workspaceChanged = true
        this.files.set(id, file)
      } else {
        if (previous) workspaceChanged = true
        this.files.delete(id)
      }
    }
    try {
      const stored = await this.store.listFiles()
      // A retry's snapshot may predate edits/deletes that have already flushed.
      // Pending alone is insufficient: keep every locally touched id authoritative.
      stored.forEach(file => { if (!this.touched.has(file.id)) reconcile(file.id, file) })
      this.loaded = true
      this.loadError = null
    } catch (error) {
      this.loadError = `Could not load local files; recovering drafts: ${String(error)}`
    }
    if (!this.journalRecovered) {
      const errors: string[] = []
      try {
        for (let i = 0; i < this.journal.length; i++) {
          const key = this.journal.key(i)
          if (!key?.startsWith(PREFIX)) continue
          try {
            const raw = this.journal.getItem(key)
            const entry: Mutation = JSON.parse(raw ?? 'null')
            if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
              typeof entry.id !== 'string' || !entry.id.trim() ||
              typeof entry.token !== 'string' || !entry.token.trim() ||
              key !== PREFIX + entry.id || (entry.file !== null &&
                (!entry.file || typeof entry.file !== 'object' || Array.isArray(entry.file) ||
                  entry.file.id !== entry.id || typeof entry.file.name !== 'string' || !entry.file.name.trim() ||
                  typeof entry.file.content !== 'string' || typeof entry.file.updatedAt !== 'number' ||
                  !Number.isFinite(entry.file.updatedAt)))) {
              throw new Error('Invalid recovery journal entry')
            }
            if (this.touched.has(entry.id)) continue
            this.touched.add(entry.id)
            this.pending.set(entry.id, entry)
            reconcile(entry.id, entry.file)
          } catch (error) {
            // Keep the original record for diagnosis/manual recovery, but never
            // let one malformed neighbor hide another file's valid newer draft.
            errors.push(`${key}: ${String(error)}`)
          }
        }
        this.journalRecovered = true
      } catch (error) {
        // Enumeration/storage failures remain retryable; recovered ids are touched.
        errors.push(String(error))
      }
      this.recoveryError = errors.length ? `Draft recovery failed: ${errors.join('; ')}` : null
    }
    this.emit()
    return workspaceChanged
  }

  put(file: StoredFile) {
    const snapshot = { ...file }
    this.files.set(file.id, snapshot)
    this.record(file.id, snapshot)
  }
  remove(id: string) {
    const file = this.files.get(id)
    if (!file) return undefined
    this.files.delete(id)
    this.record(id, null)
    return { ...file }
  }
  private record(id: string, file: StoredFile | null) {
    const mutation = { id, file, token: `${Date.now()}-${++this.sequence}-${Math.random()}` }
    this.touched.add(id)
    this.pending.set(id, mutation)
    try {
      this.journal.setItem(PREFIX + id, JSON.stringify(mutation))
      this.unsafe.delete(id)
    } catch (error) {
      this.unsafe.add(id)
      this.writeError = `Draft recovery unavailable; keep this tab open until saved: ${String(error)}`
    }
    this.emit()
  }

  flush(): Promise<void> {
    if (this.running) return this.running
    if (!this.pending.size) return Promise.resolve()
    this.running = this.drain().finally(() => { this.running = null })
    return this.running
  }
  private async drain() {
    this.saving = this.pending.size > 0
    this.emit()
    try {
      while (this.pending.size) {
        const mutation = this.pending.values().next().value!
        if (mutation.file) await this.store.saveFile(mutation.file)
        else await this.store.deleteFile(mutation.id)
        // A newer edit/rename/delete made during the write still needs saving.
        if (this.pending.get(mutation.id)?.token !== mutation.token) continue
        const key = PREFIX + mutation.id
        // The exact in-memory version has committed and no newer local mutation
        // exists. Remove its per-file record, including an obsolete version left
        // by failed setItem. Removal requires no quota; rewriting before removal
        // would leave stale live data that can undo this commit on reload.
        this.journal.removeItem(key)
        this.pending.delete(mutation.id)
        this.unsafe.delete(mutation.id)
      }
      this.writeError = null
    } catch (error) {
      this.writeError = `Local save failed; drafts retained for retry: ${String(error)}`
    } finally {
      this.saving = false
      this.emit()
    }
  }
}
