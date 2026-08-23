import type { StoredFile } from './storage'

export type SavePayloadSources = {
  activeFileId: string | null
  latestName: string | undefined
  latestContentRef: { current: string }
}

export function buildSavePayload(sources: SavePayloadSources): StoredFile | null {
  if (!sources.activeFileId || !sources.latestContentRef.current) return null
  return {
    id: sources.activeFileId,
    name: sources.latestName ?? 'Untitled.typ',
    content: sources.latestContentRef.current,
    updatedAt: Date.now(),
  }
}
