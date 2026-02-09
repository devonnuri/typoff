import { openDB, type DBSchema } from 'idb'

export type StoredFile = {
  id: string
  name: string
  content: string
  updatedAt: number
}

interface TypoffDb extends DBSchema {
  files: {
    key: string
    value: StoredFile
  }
}

const DB_NAME = 'typoff-db'
const STORE_NAME = 'files'

const dbPromise = openDB<TypoffDb>(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
  },
})

export async function listFiles(): Promise<StoredFile[]> {
  const db = await dbPromise
  return db.getAll(STORE_NAME)
}

export async function getFile(id: string): Promise<StoredFile | undefined> {
  const db = await dbPromise
  return db.get(STORE_NAME, id)
}

export async function saveFile(file: StoredFile): Promise<void> {
  const db = await dbPromise
  await db.put(STORE_NAME, file)
}

export async function deleteFile(id: string): Promise<void> {
  const db = await dbPromise
  await db.delete(STORE_NAME, id)
}
