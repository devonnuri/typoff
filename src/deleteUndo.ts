export interface DeleteIntent {
  file: import('./storage').StoredFile
  deletedAt: number
}

export const UNDO_WINDOW_MS = 7000

// Pure helpers, no DOM. Capture a delete intent so an accidental delete can be
// undone while the snackbar is visible.
export function createDeleteIntent(file: import('./storage').StoredFile): DeleteIntent {
  return { file, deletedAt: Date.now() }
}

export function isUndoWindowOpen(intent: DeleteIntent, now: number): boolean {
  return now - intent.deletedAt < UNDO_WINDOW_MS
}
