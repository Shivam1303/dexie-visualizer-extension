import { useEffect, useMemo, useState } from 'react'
import { createRemoteBridgeSource } from '../datasource/remoteBridge'
import type { DatabaseMeta, StoreMeta } from '../datasource/types'
import { MSG_CONNECTION_CHANGED, MSG_GET_CONNECTION, type Connection } from '../shared/rpc'
import { DatabaseIcon } from './components/Icons'
import { ConnectScreen } from './features/connect/ConnectScreen'
import { DatabaseOverview } from './features/overview/DatabaseOverview'
import { WorkspaceSidebar } from './features/overview/WorkspaceSidebar'
import { TableBrowser } from './features/table/TableBrowser'
import { useAppStore } from './store'

export function App() {
  const { connection, dbName, storeName, setConnection, setDbName, setStoreName } = useAppStore()
  const source = useMemo(() => createRemoteBridgeSource(), [])
  const [databases, setDatabases] = useState<DatabaseMeta[] | null>(null)
  const [stores, setStores] = useState<StoreMeta[] | null>(null)
  const [loadingDatabases, setLoadingDatabases] = useState(false)
  const [loadingStores, setLoadingStores] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Ask for the current state (the panel may have opened after the connection was
    // made) and then follow every change.
    chrome.runtime
      .sendMessage({ type: MSG_GET_CONNECTION })
      .then((current: Connection) => current && setConnection(current))
      .catch(() => {})

    const onMessage = (message: any) => {
      if (message?.type === MSG_CONNECTION_CHANGED) setConnection(message.connection)
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [setConnection])

  useEffect(() => {
    if (connection.status !== 'connected') return
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
  }, [connection.origin, connection.status, connection.tabId, source, setDbName])

  useEffect(() => {
    if (!dbName || connection.status !== 'connected') {
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
  }, [connection.status, dbName, source, setStoreName])

  if (connection.status !== 'connected') return <ConnectScreen connection={connection} />

  const database = databases?.find((item) => item.name === dbName)
  const store = stores?.find((item) => item.name === storeName)

  return (
    <div className="app-shell">
      <WorkspaceSidebar
        connection={connection}
        databases={databases}
        loadingDatabases={loadingDatabases}
        loadingStores={loadingStores}
        stores={stores}
      />
      <div className="workspace">
        <header className="topbar">
          <div className="database-crumb">
            <DatabaseIcon />
            <div>
              <span>{database ? 'Current database' : 'Connected site'}</span>
              <strong>{database?.name ?? connection.title ?? connection.origin}</strong>
            </div>
            {database && <small>v{database.version}</small>}
          </div>
          <div className="live-status" role="status" title={connection.origin ?? ''}>
            <span className="live-dot" />
            <span>Live editing</span>
            <strong>{connection.origin}</strong>
          </div>
        </header>
        <main className="workspace-main">
          {error && <div className="inline-error workspace-error" role="alert">{error}</div>}
          {storeName && dbName ? (
            <TableBrowser dbName={dbName} source={source} storeMeta={store} storeName={storeName} />
          ) : (
            <DatabaseOverview
              connection={connection}
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
