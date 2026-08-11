import type { DatabaseMeta, StoreMeta } from '../../../datasource/types'
import { Badge } from '../../components/Badge'
import { ChevronIcon, DatabaseIcon, TableIcon } from '../../components/Icons'
import { useAppStore } from '../../store'

function keyLabel(store: StoreMeta): string {
  if (store.keyPath === null) return store.autoIncrement ? 'Auto-increment key' : 'Out-of-line key'
  const path = Array.isArray(store.keyPath) ? store.keyPath.join(' + ') : store.keyPath
  return `Primary key: ${path}`
}

export function DatabaseOverview({
  databases,
  database,
  stores,
  loading,
}: {
  databases: DatabaseMeta[] | null
  database?: DatabaseMeta
  stores: StoreMeta[] | null
  loading: boolean
}) {
  const { setDbName, setStoreName } = useAppStore()

  if (!database) {
    return (
      <div className="content-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Get started</p>
            <h1>Choose a database</h1>
            <p>Select one below to review its object stores and records.</p>
          </div>
        </header>

        {loading && <div className="overview-loading">Reading available databases…</div>}
        {databases?.length === 0 && (
          <div className="overview-loading">This site has no IndexedDB databases.</div>
        )}
        <div className="database-card-grid">
          {databases?.map((item) => (
            <button className="database-card" key={item.name} onClick={() => setDbName(item.name)} type="button">
              <span className="table-card-icon"><DatabaseIcon /></span>
              <span>
                <strong>{item.name}</strong>
                <small>IndexedDB version {item.version}</small>
              </span>
              <ChevronIcon />
            </button>
          ))}
        </div>
      </div>
    )
  }

  const totalRows = stores?.reduce((sum, store) => sum + store.count, 0) ?? 0
  const emptyStores = stores?.filter((store) => store.count === 0).length ?? 0

  return (
    <div className="content-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Selected database</p>
          <h1>Database overview</h1>
          <p>Review its structure and row counts, then choose an object store to explore.</p>
        </div>
      </header>

      <section className="metric-grid" aria-label="Database metrics">
        <article><DatabaseIcon /><span>Database version</span><strong>{database.version}</strong></article>
        <article><TableIcon /><span>Object stores</span><strong>{stores?.length ?? '—'}</strong></article>
        <article><span className="metric-glyph">≡</span><span>Total rows</span><strong>{totalRows.toLocaleString()}</strong></article>
        <article><span className="metric-glyph">○</span><span>Empty stores</span><strong>{emptyStores}</strong></article>
      </section>

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <h2>Object stores</h2>
            <p>Select a store to browse, filter, edit, or delete its records.</p>
          </div>
          {stores && <Badge>{stores.length} stores</Badge>}
        </div>

        {loading && <div className="overview-loading">Reading object store metadata…</div>}
        <div className="table-card-grid">
          {stores?.map((store) => (
            <button className={`table-card ${store.count === 0 ? 'is-empty' : ''}`} key={store.name} onClick={() => setStoreName(store.name)} type="button">
              <div className="table-card-icon"><TableIcon /></div>
              <div className="table-card-title">
                <strong>{store.name}</strong>
                <span>{store.count.toLocaleString()} rows</span>
              </div>
              <ChevronIcon />
              <div className="table-card-schema">
                <span>{keyLabel(store)}</span>
                <span>{store.indexes.length} {store.indexes.length === 1 ? 'index' : 'indexes'}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
