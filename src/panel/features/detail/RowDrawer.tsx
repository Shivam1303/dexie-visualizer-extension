import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { CloseIcon } from '../../components/Icons'
import { JsonTree } from '../../components/JsonTree'
import type { DataSource, KeyedRow, RecordKey, RecordPatch, RowRecord } from '../../../datasource/types'
import type { SourceMode } from '../../store'

function formatKey(key: RecordKey): string {
  if (key instanceof Date) return key.toISOString()
  if (Array.isArray(key)) return key.map((part) => formatKey(part as RecordKey)).join(' · ')
  return String(key)
}

export function RowDrawer({
  source,
  dbName,
  storeName,
  row,
  onClose,
  onChanged,
  sourceMode,
}: {
  source: DataSource
  dbName: string
  storeName: string
  row: KeyedRow
  onClose: () => void
  onChanged: () => void
  sourceMode: SourceMode
}) {
  // Full records are fetched only when opened; table pages carry lightweight previews.
  const [record, setRecord] = useState<RowRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [patches, setPatches] = useState<Map<string, RecordPatch>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setRecord(null)
    setError(null)
    source
      .getRow(dbName, storeName, row.key)
      .then((value) => active && setRecord(value))
      .catch((cause: Error) => active && setError(cause.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [dbName, row.key, source, storeName])

  function stagePatch(path: string[], value: unknown) {
    setSaved(false)
    // Keyed by path so re-editing one field replaces rather than stacks.
    setPatches((current) => new Map(current).set(path.join('.'), { path, value }))
  }

  function revertPatch(path: string[]) {
    setPatches((current) => {
      const next = new Map(current)
      next.delete(path.join('.'))
      return next
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const updated = await source.update(dbName, storeName, row.key, [...patches.values()])
      setRecord(updated)
      setPatches(new Map())
      setSaved(true)
      onChanged()
    } catch (cause: any) {
      setError(cause?.message ?? 'The write failed.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await source.deleteRow(dbName, storeName, row.key)
      onChanged()
      onClose()
    } catch (cause: any) {
      setError(cause?.message ?? 'The delete failed.')
      setBusy(false)
      setConfirmingDelete(false)
    }
  }

  const staged = patches.size
  const fieldCount = record ? Object.keys(record).length : 0

  return (
    <div className="drawer-layer" onMouseDown={onClose} role="presentation">
      <aside aria-label="Record detail" className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div className="drawer-identity">
            <p className="eyebrow">Record</p>
            <h2 title={formatKey(row.key)}>{formatKey(row.key)}</h2>
            <p className="drawer-sub">
              {storeName} · {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}
            </p>
          </div>
          <Button aria-label="Close record detail" compact onClick={onClose} variant="ghost">
            <CloseIcon />
          </Button>
        </header>

        <div aria-busy={loading} className="drawer-body">
          {loading && (
            <div aria-live="polite" className="drawer-loading" role="status">
              Loading complete record…
            </div>
          )}
          {record && <JsonTree editable onEdit={stagePatch} onRevert={revertPatch} staged={patches} value={record} />}
        </div>

        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}

        {/* Appears only when there is something to say — a clean record says nothing. */}
        {staged > 0 && !confirmingDelete && (
          <div className="staged-strip" role="status">
            <span className="staged-dot" />
            <span className="staged-count">
              {staged} {staged === 1 ? 'field' : 'fields'} staged
            </span>
            <Button compact disabled={busy} onClick={() => setPatches(new Map())} variant="ghost">
              Undo all
            </Button>
          </div>
        )}

        {saved && staged === 0 && !confirmingDelete && (
          <div className="saved-strip" role="status">
            {sourceMode === 'live' ? `Saved live to ${storeName}` : 'Saved to imported local copy'}
          </div>
        )}

        <footer className="drawer-footer">
          {confirmingDelete ? (
            <>
              <span className="confirm-note">
                {sourceMode === 'live' ? 'Delete this live record?' : 'Delete from the imported copy?'} This can't be undone.
              </span>
              <Button compact disabled={busy} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button compact disabled={busy} onClick={() => void remove()} variant="danger">
                {busy ? 'Deleting…' : 'Delete record'}
              </Button>
            </>
          ) : (
            <>
              <Button compact disabled={busy} onClick={() => setConfirmingDelete(true)} variant="danger">
                Delete record
              </Button>
              <span className="footer-spacer" />
              <Button compact disabled={!record || staged === 0 || busy} onClick={() => void save()} variant="primary">
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          )}
        </footer>
      </aside>
    </div>
  )
}
