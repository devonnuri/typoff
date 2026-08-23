import type { useFileLibrary } from '../hooks/useFileLibrary'

type FileLibrary = ReturnType<typeof useFileLibrary>

interface FileSidebarProps {
  /** State + callbacks from useFileLibrary. */
  library: FileLibrary
  /** Whether the SVG export button is disabled (no rendered preview or mid-export). */
  exportSvgDisabled: boolean
  /** Current SVG export state from the preview pipeline. */
  svgExportState: 'idle' | 'exporting'
  onExportSvg: () => void
  onHide: () => void
}

export function FileSidebar({
  library,
  exportSvgDisabled,
  svgExportState,
  onExportSvg,
  onHide,
}: FileSidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <h2>Files</h2>
          <span className="file-count">{library.files.length}</span>
        </div>
        <div className="sidebar-actions">
          <button
            className="icon-button"
            onClick={library.createFile}
            type="button"
            aria-label="New file"
            title="New file"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
              />
            </svg>
          </button>
          <button
            className="ghost"
            onClick={library.handleImportFile}
            type="button"
          >
            Import
          </button>
          <button
            className="ghost"
            onClick={library.handleExportFile}
            type="button"
            disabled={!library.activeFile}
          >
            Export
          </button>
          <button
            className="ghost"
            onClick={onExportSvg}
            type="button"
            disabled={exportSvgDisabled}
          >
            {svgExportState === 'exporting' ? 'Exporting…' : 'SVG'}
          </button>
          <button className="ghost" onClick={onHide} type="button">
            Hide
          </button>
        </div>
      </div>
      <div className="file-list">
        {library.files.map((file) => (
          <div
            key={file.id}
            className={`file-item ${
              file.id === library.activeFileId ? 'active' : ''
            }`}
          >
            {library.renamingId === file.id ? (
              <input
                className="file-rename"
                value={library.renameDraft}
                onChange={(event) => library.setRenameDraft(event.target.value)}
                onBlur={library.handleRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    library.handleRename()
                  }
                  if (event.key === 'Escape') {
                    library.cancelRename()
                  }
                }}
                autoFocus
              />
            ) : (
              <button
                className="file-name"
                type="button"
                onClick={() => library.openFile(file)}
              >
                {file.name}
              </button>
            )}
            <div className="file-actions">
              <button
                type="button"
                onClick={() => library.startRename(file)}
                aria-label={`Rename ${file.name}`}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => library.handleDelete(file)}
                aria-label={`Delete ${file.name}`}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
