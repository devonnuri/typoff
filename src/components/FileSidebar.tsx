import type { useFileLibrary } from '../hooks/useFileLibrary'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Plus, Upload, Download, FileCode2, PanelLeftClose } from 'lucide-react'

type FileLibrary = ReturnType<typeof useFileLibrary>

interface FileSidebarProps {
  library: FileLibrary
  exportSvgDisabled: boolean
  svgExportState: 'idle' | 'exporting'
  onExportSvg: () => void
  onHide: () => void
}

export function FileSidebar({ library, exportSvgDisabled, svgExportState, onExportSvg, onHide }: FileSidebarProps) {
  return (
    <aside className="sidebar" aria-label="File library">
      <div className="sidebar-header">
        <div className="sidebar-title"><h2>Files</h2><Badge variant="secondary">{library.files.length}</Badge></div>
        <Button variant="ghost" size="icon" onClick={onHide} type="button" aria-label="Hide files" title="Hide files"><PanelLeftClose aria-hidden="true" /></Button>
      </div>
      <Button className="new-file" onClick={library.createFile} type="button" aria-label="New file" title="New file (Ctrl/Cmd+N)"><Plus aria-hidden="true" />New file</Button>
      <div className="sidebar-actions">
        <Button variant="outline" size="sm" onClick={library.handleImportFile} type="button"><Upload aria-hidden="true" />Import</Button>
        <Button variant="outline" size="sm" onClick={library.handleExportFile} type="button" disabled={!library.activeFile}><Download aria-hidden="true" />Export</Button>
        <Button variant="outline" size="sm" onClick={onExportSvg} type="button" disabled={exportSvgDisabled}>{svgExportState === 'exporting' ? 'Exporting…' : 'SVG'}</Button>
      </div>
      <div className="file-list">
        {library.files.map((file) => (
          <div key={file.id} className={`file-item ${file.id === library.activeFileId ? 'active' : ''}`}>
            {library.renamingId === file.id ? (
              <Input className="file-rename" aria-label={`Rename ${file.name}`} value={library.renameDraft}
                onChange={(event) => library.setRenameDraft(event.target.value)} onBlur={library.handleRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') library.handleRename()
                  if (event.key === 'Escape') library.cancelRename()
                }} autoFocus />
            ) : (
              <Button variant="ghost" className="file-name" type="button" aria-current={file.id === library.activeFileId ? 'page' : undefined} onClick={() => library.openFile(file)}>
                <FileCode2 aria-hidden="true" /><span>{file.name}</span>
              </Button>
            )}
            <div className="file-actions">
              <Button variant="ghost" size="xs" type="button" onClick={() => library.startRename(file)} aria-label={`Rename ${file.name}`}>Rename</Button>
              <Button variant="ghost" size="xs" type="button" onClick={() => library.handleDelete(file)} aria-label={`Delete ${file.name}`}>Delete</Button>
            </div>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">Stored on this device<span>Autosave · .typ source</span></div>
    </aside>
  )
}
