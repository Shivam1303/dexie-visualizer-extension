import { useRef, useState, type DragEvent } from 'react'
import { inspectExportFile, replaceImportedSnapshot } from '../../../import/importFile'
import type { ExportPreview, ImportedSession, ImportProgress } from '../../../import/types'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { DatabaseIcon, UploadIcon } from '../../components/Icons'

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ImportScreen({
  onCancel,
  onImported,
}: {
  onCancel?: () => void
  onImported: (session: ImportedSession) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const importing = progress !== null && !progress.done

  async function inspect(fileToInspect: File) {
    setError(null)
    setPreview(null)
    setFile(fileToInspect)
    setInspecting(true)
    try {
      setPreview(await inspectExportFile(fileToInspect))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected file could not be read.')
    } finally {
      setInspecting(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const dropped = event.dataTransfer.files[0]
    if (dropped) void inspect(dropped)
  }

  async function importFile() {
    if (!file || !preview) return
    setError(null)
    setProgress({
      totalTables: preview.tables.length,
      completedTables: 0,
      totalRows: preview.tables.reduce((sum, table) => sum + table.rowCount, 0),
      completedRows: 0,
      done: false,
    })
    try {
      onImported(await replaceImportedSnapshot(file, preview, { onProgress: setProgress }))
    } catch (cause) {
      setProgress(null)
      setError(cause instanceof Error ? cause.message : 'Import failed unexpectedly.')
    }
  }

  const populatedStores = preview?.tables.filter((table) => table.rowCount > 0).length ?? 0
  const totalRows = preview?.tables.reduce((sum, table) => sum + table.rowCount, 0) ?? 0
  const progressValue = progress?.totalRows
    ? Math.round((progress.completedRows / progress.totalRows) * 100)
    : 0

  return (
    <main className="upload-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="upload-panel">
        <div className="brand-mark"><DatabaseIcon /></div>
        <p className="eyebrow">Imported snapshot</p>
        <h1>Explore a Dexie export locally.</h1>
        <p className="upload-lead">
          Import a snapshot into extension-owned IndexedDB. Nothing is uploaded, and changes never affect the original file or a live site.
        </p>

        {!preview ? (
          <div
            className={`dropzone ${inspecting ? 'dropzone-loading' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              accept=".json,.txt,application/json,text/plain"
              aria-label="Choose Dexie export"
              hidden
              onChange={(event) => {
                const selected = event.target.files?.[0]
                if (selected) void inspect(selected)
              }}
              ref={inputRef}
              type="file"
            />
            <div className="dropzone-icon"><UploadIcon /></div>
            <strong>{inspecting ? 'Reading export metadata…' : 'Drop your export here'}</strong>
            <span>Dexie .json or .txt files</span>
            <Button disabled={inspecting} onClick={() => inputRef.current?.click()} variant="primary">
              Choose a file
            </Button>
          </div>
        ) : (
          <div className="confirm-card">
            <div className="confirm-file">
              <div className="file-icon">JSON</div>
              <div><strong>{file?.name}</strong><span>{file ? fileSize(file.size) : ''}</span></div>
              <Badge tone="success">Valid Dexie export</Badge>
            </div>
            <div className="database-preview">
              <div><span>Database</span><strong>{preview.databaseName}</strong></div>
              <div><span>Version</span><strong>{preview.databaseVersion}</strong></div>
              <div><span>Stores</span><strong>{preview.tables.length}</strong><small>{populatedStores} with data</small></div>
              <div><span>Total rows</span><strong>{totalRows.toLocaleString()}</strong></div>
            </div>
            {progress && (
              <div className="import-progress" aria-live="polite">
                <div><span>Importing into local extension storage</span><strong>{progressValue}%</strong></div>
                <progress max="100" value={progressValue} />
                <small>{progress.completedRows.toLocaleString()} / {progress.totalRows?.toLocaleString() ?? '—'} rows</small>
              </div>
            )}
            <div className="confirm-actions">
              <Button
                disabled={importing}
                onClick={() => {
                  setPreview(null)
                  setFile(null)
                  setProgress(null)
                }}
                variant="ghost"
              >
                Choose another
              </Button>
              <Button disabled={importing} onClick={() => void importFile()} variant="primary">
                {importing ? 'Importing…' : 'Import snapshot'}
              </Button>
            </div>
          </div>
        )}

        {error && <div className="inline-error" role="alert">{error}</div>}
        {onCancel && (
          <button className="text-button" disabled={importing} onClick={onCancel} type="button">
            Back to workspace
          </button>
        )}
        <p className="privacy-note"><span>●</span> Stored only inside this extension</p>
      </section>
    </main>
  )
}
