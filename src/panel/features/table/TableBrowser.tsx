import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { RefreshIcon, SearchIcon } from '../../components/Icons'
import { RowDrawer } from '../detail/RowDrawer'
import { FilterPanel } from './FilterPanel'
import { isOpaque } from '../../../shared/codec'
import { inferColumns, type InferredColumn } from '../../../shared/columns'
import type { DataSource, FilterRule, KeyedRow, QueryPage, SortRule, StoreMeta } from '../../../datasource/types'
import type { SourceMode } from '../../store'

const COLUMN_WIDTH = 180

function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])
  return debounced
}

function cellValue(value: unknown) {
  if (isOpaque(value)) return <Badge tone="neutral">{value.kind}</Badge>
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return <Badge tone="purple">[{value.length} items]</Badge>
  if (value && typeof value === 'object') return <Badge tone="blue">{'{object}'}</Badge>
  if (value === null || value === undefined) return <span className="null-cell">null</span>
  if (typeof value === 'boolean') return <Badge tone={value ? 'success' : 'neutral'}>{String(value)}</Badge>
  return String(value)
}

export function TableBrowser({
  source,
  dbName,
  storeName,
  storeMeta,
  sourceMode,
}: {
  source: DataSource
  dbName: string
  storeName: string
  storeMeta?: StoreMeta
  sourceMode: SourceMode
}) {
  const [columns, setColumns] = useState<InferredColumn[]>([])
  const [result, setResult] = useState<QueryPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [sort, setSort] = useState<SortRule | undefined>()
  const [filters, setFilters] = useState<FilterRule[]>([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selectedRow, setSelectedRow] = useState<KeyedRow | null>(null)
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  // Bumped after a write so the grid re-reads the real post-write state.
  const [reloadToken, setReloadToken] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const headerScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setColumns([])
    setResult(null)
    setError(null)
    setSearch('')
    setSort(undefined)
    setFilters([])
    setPage(0)
    setSelectedRow(null)
    setHiddenColumns([])

    let active = true
    source
      .sampleRows(dbName, storeName, 200)
      .then((rows) => active && setColumns(inferColumns(rows)))
      .catch((cause: Error) => active && setError(cause.message))

    return () => {
      active = false
    }
  }, [dbName, storeName, source])

  useEffect(() => setPage(0), [debouncedSearch, filters, sort])

  useEffect(() => {
    let active = true
    setError(null)
    setLoading(true)

    source
      .query(dbName, storeName, {
        page,
        pageSize,
        search: debouncedSearch,
        ...(sort ? { sort } : {}),
        filters,
      })
      .then((next) => active && setResult(next))
      .catch((cause: Error) => {
        if (!active) return
        setError(cause.message)
        setResult(null)
      })
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [dbName, storeName, source, page, pageSize, debouncedSearch, sort, filters, reloadToken])

  const rowValues = useMemo(() => result?.rows.map((row) => row.value) ?? [], [result])
  const visibleColumns = columns.filter((column) => !hiddenColumns.includes(column.key))
  const visibleColumnKey = visibleColumns.map((column) => column.key).join('|')

  const columnDefs = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      visibleColumns.map((column) => ({
        id: column.key,
        accessorFn: (row) => row[column.key],
        header: column.key,
        cell: ({ getValue }) => cellValue(getValue()),
      })),
    [visibleColumnKey],
  )

  const reactTable = useReactTable({
    data: rowValues,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
  })
  const rows = reactTable.getRowModel().rows

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 8,
  })

  const gridWidth = Math.max(visibleColumns.length * COLUMN_WIDTH, 1)
  const template = `repeat(${visibleColumns.length}, ${COLUMN_WIDTH}px)`
  const pageCount = result ? Math.max(1, Math.ceil(result.total / pageSize)) : 1

  function cycleSort(field: string) {
    setSort((current) => {
      if (!current || current.field !== field) return { field, direction: 'asc' }
      if (current.direction === 'asc') return { field, direction: 'desc' }
      return undefined
    })
  }

  return (
    <div className="table-workspace">
      <header className="table-heading">
        <div>
          <p className="eyebrow">Object store</p>
          <h1>{storeName}</h1>
          <p>
            {result ? `${result.total.toLocaleString()} matching rows` : `${storeMeta?.count.toLocaleString() ?? '—'} rows`}
            {storeMeta ? ` · ${storeMeta.indexes.length} ${storeMeta.indexes.length === 1 ? 'index' : 'indexes'}` : ''}
          </p>
        </div>
        <Badge tone="blue">{columns.length} columns discovered</Badge>
      </header>

      <div className="table-toolbar">
        <label className="global-search">
          <SearchIcon />
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this store, including nested values…"
            value={search}
          />
        </label>
        <Button
          aria-label="Refresh live data"
          compact
          onClick={() => {
            setResult(null)
            setReloadToken((token) => token + 1)
          }}
          title="Refresh live data"
        >
          <RefreshIcon />
          Refresh
        </Button>
        <Button
          compact
          disabled={columns.length === 0}
          onClick={() => setFiltersOpen((open) => !open)}
          variant={filtersOpen ? 'primary' : 'secondary'}
        >
          Filters{filters.length > 0 ? ` (${filters.length})` : ''}
        </Button>
        <details className="column-menu">
          <summary className="button button-secondary">Columns</summary>
          <div>
            {columns.map((column, index) => (
              <label key={column.key}>
                <input
                  checked={!hiddenColumns.includes(column.key)}
                  disabled={index === 0}
                  onChange={(event) =>
                    setHiddenColumns((current) =>
                      event.target.checked
                        ? current.filter((key) => key !== column.key)
                        : [...current, column.key],
                    )
                  }
                  type="checkbox"
                />
                <span>{column.key}</span>
                <small>{column.type}</small>
              </label>
            ))}
          </div>
        </details>
      </div>

      {filtersOpen && columns.length > 0 && (
        <FilterPanel columns={columns} filters={filters} onChange={setFilters} />
      )}

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}

      <div className="data-grid-shell">
        <div className="data-grid-header-viewport" ref={headerScrollRef}>
          <div
            className="data-grid-header"
            style={{ gridTemplateColumns: template, width: `${gridWidth}px` }}
          >
            {reactTable.getHeaderGroups()[0]?.headers.map((header, index) => (
              <button className={index === 0 ? 'pinned-column' : ''} key={header.id} onClick={() => cycleSort(header.id)} type="button">
                <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                <small>{sort?.field === header.id ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</small>
              </button>
            ))}
          </div>
        </div>

        <div
          className="data-grid-body"
          onScroll={(event) => {
            if (headerScrollRef.current) {
              headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft
            }
          }}
          ref={scrollRef}
        >
          {loading && <div className="grid-message">Reading IndexedDB…</div>}
          {result && result.rows.length === 0 && <div className="grid-message">No rows match this query.</div>}
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: `${gridWidth}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              const keyed = result?.rows[virtualRow.index]
              if (!row || !keyed) return null
              return (
                <button
                  className="data-grid-row"
                  key={row.id}
                  onClick={() => setSelectedRow(keyed)}
                  style={{
                    gridTemplateColumns: template,
                    width: `${gridWidth}px`,
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  type="button"
                >
                  {row.getVisibleCells().map((cell, index) => (
                    <span className={index === 0 ? 'pinned-column' : ''} key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>
                  ))}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <footer className="pagination">
        <span>{result ? `${result.total.toLocaleString()} matching rows` : 'Loading…'}</span>
        <label>Rows
          <select
            disabled={loading}
            onChange={(event) => {
              setPage(0)
              setPageSize(Number(event.target.value))
            }}
            value={pageSize}
          >
            <option>25</option>
            <option>50</option>
            <option>100</option>
          </select>
        </label>
        <Button compact disabled={loading || page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
          Previous
        </Button>
        <strong>
          {page + 1} / {pageCount}
        </strong>
        <Button compact disabled={loading || page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}>
          Next
        </Button>
      </footer>

      {selectedRow && (
        <RowDrawer
          dbName={dbName}
          onChanged={() => setReloadToken((token) => token + 1)}
          onClose={() => setSelectedRow(null)}
          row={selectedRow}
          source={source}
          storeName={storeName}
          sourceMode={sourceMode}
        />
      )}
    </div>
  )
}
