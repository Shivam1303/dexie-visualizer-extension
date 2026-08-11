import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { LazyImportedSource } from '../datasource/lazyImported'
import { createRemoteBridgeSource } from '../datasource/remoteBridge'
import type { DataSource, DatabaseMeta, StoreMeta } from '../datasource/types'
import { deleteImportedDatabase } from '../import/database'
import {
  clearImportedSession,
  IMPORTED_SESSION_KEY,
  loadImportedSession,
} from '../import/session'
import type { ImportedSession } from '../import/types'
import {
  MSG_CONNECTION_CHANGED,
  MSG_GET_CONNECTION,
  NO_CONNECTION,
  type Connection,
} from '../shared/rpc'
import { DatabaseIcon } from './components/Icons'
import { WorkspaceHeader } from './components/WorkspaceHeader'
import { ConnectScreen } from './features/connect/ConnectScreen'
import { DatabaseOverview } from './features/overview/DatabaseOverview'
import { WorkspaceSidebar } from './features/overview/WorkspaceSidebar'
import { TableBrowser } from './features/table/TableBrowser'
import { useAppStore, type SourceMode } from './store'

const ImportScreen = lazy(() =>
  import('./features/import/ImportScreen').then((module) => ({ default: module.ImportScreen })),
)

export function App() {
  const {
    connection,
    sourceMode,
    dbName,
    storeName,
    setConnection,
    setSourceMode,
    setDbName,
    setStoreName,
  } = useAppStore()
  const remoteSource = useMemo(() => createRemoteBridgeSource(), [])
  const [importedSession, setImportedSession] = useState<ImportedSession | null>(null)
  const [booting, setBooting] = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [databases, setDatabases] = useState<DatabaseMeta[] | null>(null)
  const [stores, setStores] = useState<StoreMeta[] | null>(null)
  const [loadingDatabases, setLoadingDatabases] = useState(false)
  const [loadingStores, setLoadingStores] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const importedSource = useMemo(
    () => (importedSession && sourceMode === 'imported' ? new LazyImportedSource(importedSession) : null),
    [importedSession?.storageName, sourceMode],
  )
  const source: DataSource | null = sourceMode === 'imported' ? importedSource : remoteSource
  const sourceReady =
    sourceMode === 'imported'
      ? importedSession !== null && importedSource !== null
      : connection.status === 'connected'
  const sourceKey =
    sourceMode === 'imported'
      ? `imported:${importedSession?.storageName ?? 'none'}`
      : `live:${connection.tabId}:${connection.origin}:${connection.status}`

  useEffect(() => {
    let active = true

    Promise.all([
      chrome.runtime
        .sendMessage({ type: MSG_GET_CONNECTION })
        .catch(() => ({ ...NO_CONNECTION } as Connection)),
      loadImportedSession(),
    ]).then(([current, imported]) => {
      if (!active) return
      setConnection(current ?? { ...NO_CONNECTION })
      setImportedSession(imported)
      setSourceMode(current?.status === 'connected' ? 'live' : imported ? 'imported' : 'live')
      setBooting(false)
    })

    const onMessage = (message: any) => {
      if (message?.type === MSG_CONNECTION_CHANGED) setConnection(message.connection)
    }
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[IMPORTED_SESSION_KEY]) return
      void loadImportedSession().then((session) => active && setImportedSession(session))
    }
    chrome.runtime.onMessage.addListener(onMessage)
    chrome.storage.onChanged.addListener(onStorage)
    return () => {
      active = false
      chrome.runtime.onMessage.removeListener(onMessage)
      chrome.storage.onChanged.removeListener(onStorage)
    }
  }, [setConnection, setSourceMode])

  useEffect(
    () => () => {
      void importedSource?.close()
    },
    [importedSource],
  )

  useEffect(() => {
    if (!sourceReady || !source) {
      setDatabases(null)
      setStores(null)
      return
    }
    let active = true
    setLoadingDatabases(true)
    setDatabases(null)
    setStores(null)
    setError(null)

    source
      .listDatabases()
      .then((found) => {
        if (!active) return
        setDatabases(found)
        const selected = useAppStore.getState().dbName
        if (!selected || !found.some((database) => database.name === selected)) {
          setDbName(found.length === 1 ? found[0].name : null)
        }
      })
      .catch((cause: Error) => active && setError(cause.message))
      .finally(() => active && setLoadingDatabases(false))

    return () => {
      active = false
    }
  }, [source, sourceKey, sourceReady, setDbName])

  useEffect(() => {
    if (!dbName || !sourceReady || !source) {
      setStores(null)
      return
    }
    let active = true
    setLoadingStores(true)
    setStores(null)
    setError(null)

    source
      .listStores(dbName)
      .then((found) => {
        if (!active) return
        setStores(found)
        const selected = useAppStore.getState().storeName
        if (selected && !found.some((store) => store.name === selected)) setStoreName(null)
      })
      .catch((cause: Error) => active && setError(cause.message))
      .finally(() => active && setLoadingStores(false))

    return () => {
      active = false
    }
  }, [dbName, source, sourceKey, sourceReady, setStoreName])

  function changeSource(mode: SourceMode) {
    if (mode === 'live' && connection.status !== 'connected') return
    if (mode === 'imported' && !importedSession) {
      setImportOpen(true)
      return
    }
    setSourceMode(mode)
  }

  async function removeImportedCopy() {
    if (!importedSession) return
    if (!window.confirm(`Remove the imported copy of ${importedSession.databaseName}?`)) return
    setError(null)
    try {
      await importedSource?.close()
      await deleteImportedDatabase(importedSession.storageName)
      await clearImportedSession()
      setImportedSession(null)
      setSourceMode('live')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The imported copy could not be removed.')
    }
  }

  if (booting) {
    return <main className="connect-screen"><div className="brand-mark"><DatabaseIcon /></div><h1>Opening workspace…</h1></main>
  }

  if (importOpen) {
    return (
      <Suspense fallback={<main className="connect-screen"><h1>Opening importer…</h1></main>}>
        <ImportScreen
          onCancel={sourceReady ? () => setImportOpen(false) : undefined}
          onImported={(session) => {
            setImportedSession(session)
            setSourceMode('imported')
            setImportOpen(false)
          }}
        />
      </Suspense>
    )
  }

  if (!sourceReady || !source) {
    return (
      <ConnectScreen
        connection={connection}
        onImport={() => setImportOpen(true)}
        onOpenImported={importedSession ? () => setSourceMode('imported') : undefined}
      />
    )
  }

  const database = databases?.find((item) => item.name === dbName)
  const store = stores?.find((item) => item.name === storeName)
  const contextLabel = sourceMode === 'live' ? connection.origin : importedSession?.fileName
  const contextDisplay = sourceMode === 'live'
    ? contextLabel?.replace(/^https?:\/\//, '')
    : contextLabel

  return (
    <div className="app-shell">
      <WorkspaceSidebar
        connection={connection}
        databases={databases}
        importedSession={importedSession}
        loadingDatabases={loadingDatabases}
        loadingStores={loadingStores}
        onImport={() => setImportOpen(true)}
        onRemoveImported={() => void removeImportedCopy()}
        onSourceMode={changeSource}
        sourceMode={sourceMode}
        stores={stores}
      />
      <div className="workspace">
        <WorkspaceHeader
          contextDisplay={contextDisplay}
          contextLabel={contextLabel}
          onBackToOverview={storeName ? () => setStoreName(null) : undefined}
          sourceMode={sourceMode}
        />
        <main className="workspace-main">
          {sourceMode === 'imported' && (
            <div className="local-copy-banner" role="status">
              Changes affect only this extension-owned copy, not the original file or any website.
            </div>
          )}
          {error && <div className="inline-error workspace-error" role="alert">{error}</div>}
          {storeName && dbName ? (
            <TableBrowser
              dbName={dbName}
              key={`${sourceKey}:${dbName}:${storeName}`}
              source={source}
              sourceMode={sourceMode}
              storeMeta={store}
              storeName={storeName}
            />
          ) : (
            <DatabaseOverview
              database={database}
              databases={databases}
              loading={loadingDatabases || loadingStores}
              stores={stores}
            />
          )}
        </main>
      </div>
    </div>
  )
}
