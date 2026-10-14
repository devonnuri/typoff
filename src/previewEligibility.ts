import type { RenderVersionGate } from './renderVersion'
import type { TypstWorkspace } from './typstWorkspace'

export interface RenderedSource {
  version: number
  activeFileId: string
  workspaceKey: string
  documentId: string
}

// Exact source identity, including included files and virtual paths. Do not use
// lengths or timestamps: equal-length edits and renames also invalidate exports.
export function workspaceKey(workspace: TypstWorkspace): string {
  return JSON.stringify(workspace)
}

export function isRenderedSourceCurrent(
  rendered: RenderedSource | null,
  gate: RenderVersionGate,
  activeFileId: string | null,
  workspace: TypstWorkspace | null,
  documentId: string | undefined,
): boolean {
  return Boolean(rendered && workspace &&
    rendered.documentId === documentId &&
    rendered.activeFileId === activeFileId &&
    gate.isCurrent(rendered.version) &&
    rendered.workspaceKey === workspaceKey(workspace))
}
