export type RowRecord = Record<string, unknown>

/** IndexedDB primary keys may be a string, number, Date, or an array of those. */
export type RecordKey = IDBValidKey

export interface SortRule {
  field: string
  direction: 'asc' | 'desc'
}

export type FilterRule =
  | { field: string; kind: 'text'; value: string }
  | { field: string; kind: 'number'; min?: number; max?: number }
  | { field: string; kind: 'boolean'; value: boolean }
  | { field: string; kind: 'date'; from?: string; to?: string }
  | { field: string; kind: 'enum'; values: Array<string | number | boolean> }

export interface TableQuery {
  page: number
  pageSize: number
  search?: string
  sort?: SortRule
  filters?: FilterRule[]
}

/**
 * Rows travel with their key attached. Stores with an out-of-line key
 * (`keyPath === null`) do not carry it inside the record, and edit/delete need it.
 */
export interface KeyedRow {
  key: RecordKey
  value: RowRecord
}

export interface QueryPage {
  rows: KeyedRow[]
  total: number
  page: number
  pageSize: number
}

export interface QueryOptions {
  signal?: AbortSignal
}

export interface IndexMeta {
  name: string
  keyPath: string | string[]
  unique: boolean
  multiEntry: boolean
}

export interface StoreMeta {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: IndexMeta[]
  count: number
}

export interface DatabaseMeta {
  name: string
  version: number
}

/** A single edited leaf. Writes are patches, never whole re-serialized records. */
export interface RecordPatch {
  path: string[]
  value: unknown
}

/**
 * The only abstraction the panel UI depends on. Live and imported sources share
 * this contract, and a mock implementing it can exercise the UI headlessly. There
 * is no create/insert operation; the write scope is update + delete.
 */
export interface DataSource {
  listDatabases(): Promise<DatabaseMeta[]>
  listStores(dbName: string): Promise<StoreMeta[]>
  sampleRows(dbName: string, storeName: string, limit?: number): Promise<RowRecord[]>
  query(
    dbName: string,
    storeName: string,
    query: TableQuery,
    options?: QueryOptions,
  ): Promise<QueryPage>
  getRow(dbName: string, storeName: string, key: RecordKey): Promise<RowRecord>
  update(dbName: string, storeName: string, key: RecordKey, patches: RecordPatch[]): Promise<RowRecord>
  deleteRow(dbName: string, storeName: string, key: RecordKey): Promise<void>
}
