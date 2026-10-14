import { describe, expect, it } from 'vitest'
import { createRenderVersionGate } from './renderVersion'
import { isRenderedSourceCurrent, workspaceKey } from './previewEligibility'
import { buildTypstWorkspace } from './typstWorkspace'

function fixture() {
  const files = [{ id: 'main', name: 'main.typ', content: '#include "part.typ"' },
    { id: 'part', name: 'part.typ', content: 'AAA' }]
  const gate = createRenderVersionGate()
  const workspace = buildTypstWorkspace(files, 'main', files[0].content)
  const rendered = { version: gate.begin(), activeFileId: 'main', workspaceKey: workspaceKey(workspace), documentId: 'doc-1' }
  const eligible = () => isRenderedSourceCurrent(rendered, gate, 'main', buildTypstWorkspace(files, 'main', files[0].content), 'doc-1')
  return { files, gate, workspace, rendered, eligible }
}

describe('current-source SVG eligibility', () => {
  it('permits only the successful current document', () => {
    const { rendered, gate, workspace, eligible } = fixture()
    expect(eligible()).toBe(true)
    expect(isRenderedSourceCurrent(null, gate, 'main', workspace, 'doc-1')).toBe(false)
    expect(isRenderedSourceCurrent(rendered, gate, 'main', workspace, 'doc-2')).toBe(false)
    expect(isRenderedSourceCurrent(rendered, gate, 'other', workspace, 'doc-1')).toBe(false)
    expect(isRenderedSourceCurrent(rendered, gate, 'main', null, 'doc-1')).toBe(false)
  })
  it('blocks synchronously after source edit/switch/workspace invalidation before queued rendering', () => {
    const { gate, eligible } = fixture()
    gate.invalidate()
    expect(eligible()).toBe(false)
  })
  it('does not re-enable an old render after failed compilation or an edit-and-revert', () => {
    const { gate, eligible } = fixture()
    gate.invalidate()
    gate.begin() // Current compile failed: old successful record remains buffered.
    expect(eligible()).toBe(false)
  })
  it('detects equal-length active edits and included-file updates without relying on notifications', () => {
    const { files, eligible } = fixture()
    files[1].content = 'BBB'
    expect(eligible()).toBe(false)
    files[1].content = 'AAA'
    files[0].content = '#include "else.typ"'
    expect(eligible()).toBe(false)
  })
  it('detects workspace renames and removed dependencies', () => {
    const { files, eligible } = fixture()
    files[1].name = 'renamed.typ'
    expect(eligible()).toBe(false)
    files.pop()
    expect(eligible()).toBe(false)
  })
})
