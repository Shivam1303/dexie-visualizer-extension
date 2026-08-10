import { useEffect, useState } from 'react'
import type { DatabaseMeta, StoreMeta } from '../../../datasource/types'
import type { Connection } from '../../../shared/rpc'
import { DatabaseIcon, SearchIcon, TableIcon } from '../../components/Icons'
import { useAppStore } from '../../store'

export function WorkspaceSidebar({
  connection,
  databases,
  stores,
  loadingDatabases,
  loadingStores,
}: {
  connection: Connection
  databases: DatabaseMeta[] | null
  stores: StoreMeta[] | null
  loadingDatabases: boolean
  loadingStores: boolean
}) {
  const { dbName, storeName, setDbName, setStoreName } = useAppStore()
  const [search, setSearch] = useState('')

  useEffect(() => setSearch(''), [dbName])

  const query = search.trim().toLocaleLowerCase()
  const visibleStores = stores?.filter((store) => store.name.toLocaleLowerCase().includes(query)) ?? []

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark brand-mark-small">
          <DatabaseIcon />
        </div>
        <div>
          <strong>Dexie</strong>
          <span>Live Visualizer</span>
        </div>
      </div>

      <label className="sidebar-database">
        <span>Database</span>
        <select
          disabled={loadingDatabases || databases?.length === 0}
          onChange={(event) => setDbName(event.target.value || null)}
          value={dbName ?? ''}
        >
          <option value="">{loadingDatabases ? 'Loading databases…' : 'Choose a database'}</option>
          {databases?.map((database) => (
            <option key={database.name} value={database.name}>
              {database.name} · v{database.version}
            </option>
          ))}
        </select>
      </label>

      <button
        className={`overview-link ${dbName && !storeName ? 'active' : ''}`}
        disabled={!dbName}
        onClick={() => setStoreName(null)}
        type="button"
      >
        <DatabaseIcon />
        Overview
      </button>

      <div className="sidebar-heading">
        <span>Object stores</span>
        <span>{stores?.length ?? 0}</span>
      </div>

      <label className="sidebar-search">
        <SearchIcon />
        <input
          disabled={!dbName || loadingStores}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={loadingStores ? 'Loading stores…' : 'Find a store'}
          value={search}
        />
      </label>

      <nav aria-label="Object stores" className="table-nav">
        {visibleStores.map((store) => (
          <button
            className={store.name === storeName ? 'active' : ''}
            key={store.name}
            onClick={() => setStoreName(store.name)}
            type="button"
          >
            <TableIcon />
            <span>{store.name}</span>
            <small>{store.count.toLocaleString()}</small>
          </button>
        ))}
        {dbName && !loadingStores && stores?.length === 0 && (
          <p className="sidebar-empty">No object stores</p>
        )}
        {stores && stores.length > 0 && visibleStores.length === 0 && (
          <p className="sidebar-empty">No matching stores</p>
        )}
      </nav>

      <div className="sidebar-footer" title={connection.origin ?? ''}>
        <span className="live-dot" />
        <div>
          <strong>Live editing</strong>
          <span>{connection.origin}</span>
        </div>
      </div>
    </aside>
  )
}
