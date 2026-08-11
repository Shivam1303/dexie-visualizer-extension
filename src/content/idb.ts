/**
 * Raw IndexedDB engine. Runs inside the page's own origin (content script), so it
 * sees exactly the databases the page sees.
 *
 * Deliberately free of chrome APIs and React — every function here is a plain
 * async call over IndexedDB, which is what makes it testable under fake-indexeddb.
 */
import { compareValues, matchesQuery, valueAt } from '../shared/filters'
import { abortError } from '../shared/cancellation'
import { previewRecord } from '../shared/rowPreview'
import { applyRecordPatches } from '../shared/recordPatches'
import type {
  DatabaseMeta,
  QueryPage,
  RecordKey,
  RecordPatch,
  RowRecord,
  StoreMeta,
  TableQuery,
} from '../datasource/types'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Opens an existing database. Opening a *missing* name would silently create an
 * empty database on the user's real site, so an upgrade attempt is aborted instead.
 */
function open(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName)
    let creating = false
    req.onupgradeneeded = () => {
      creating = true
      req.transaction?.abort()
      reject(new Error(`Database "${dbName}" does not exist.`))
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      if (!creating) reject(req.error ?? new Error(`Could not open "${dbName}".`))
    }
    req.onblocked = () => reject(new Error(`Opening "${dbName}" is blocked by another connection.`))
  })
}

async function withDb<T>(dbName: string, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await open(dbName)
  try {
    return await run(db)
  } finally {
    db.close()
  }
}

function storeOf(db: IDBDatabase, storeName: string, mode: IDBTransactionMode): IDBObjectStore {
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error(`Object store "${storeName}" does not exist in "${db.name}".`)
  }
  return db.transaction(storeName, mode).objectStore(storeName)
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted.'))
  })
}

export function listDatabases(): Promise<DatabaseMeta[]> {
  if (typeof indexedDB.databases !== 'function') {
    return Promise.reject(new Error('This browser cannot enumerate IndexedDB databases.'))
  }
  return indexedDB
    .databases()
    .then((dbs) => dbs.filter((db) => db.name).map((db) => ({ name: db.name!, version: db.version ?? 0 })))
}

export function listStores(dbName: string): Promise<StoreMeta[]> {
  return withDb(dbName, async (db) => {
    const names = [...db.objectStoreNames]
    if (names.length === 0) return []
    const tx = db.transaction(names, 'readonly')
    // Every count() is issued synchronously below, so the transaction stays alive.
    return Promise.all(
      names.map(async (name): Promise<StoreMeta> => {
        const store = tx.objectStore(name)
        const indexes = [...store.indexNames].map((indexName) => {
          const index = store.index(indexName)
          return {
            name: indexName,
            keyPath: index.keyPath,
            unique: index.unique,
            multiEntry: index.multiEntry,
          }
        })
        return {
          name,
          keyPath: (store.keyPath ?? null) as StoreMeta['keyPath'],
          autoIncrement: store.autoIncrement,
          indexes,
          count: await request(store.count()),
        }
      }),
    )
  })
}

export function sampleRows(dbName: string, storeName: string, limit = 200): Promise<RowRecord[]> {
  return withDb(dbName, (db) => {
    const store = storeOf(db, storeName, 'readonly')
    return new Promise<RowRecord[]>((resolve, reject) => {
      const rows: RowRecord[] = []
      const cursorReq = store.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor || rows.length >= limit) {
          resolve(rows)
          return
        }
        rows.push(previewRecord(cursor.value))
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  })
}

interface QueryControl {
  isCancelled?: () => boolean
}

export function getRecord(dbName: string, storeName: string, key: RecordKey): Promise<RowRecord> {
  return withDb(dbName, async (db) => {
    const record = await request(storeOf(db, storeName, 'readonly').get(key))
    if (record === undefined) {
      throw new Error(`Record "${String(key)}" was not found in "${storeName}". It may have just been deleted.`)
    }
    return record
  })
}

function canPageWithCursor(query: TableQuery): boolean {
  return !query.sort && !query.search?.trim() && !query.filters?.length
}

type CursorSource = IDBObjectStore | IDBIndex

function ensureActive(control: QueryControl): void {
  if (control.isCancelled?.()) throw abortError()
}

function readCursorPage(
  source: CursorSource,
  start: number,
  pageSize: number,
  direction: IDBCursorDirection,
  control: QueryControl,
  range?: IDBKeyRange,
): Promise<QueryPage['rows']> {
  return new Promise<QueryPage['rows']>((resolve, reject) => {
    const rows: QueryPage['rows'] = []
    const cursorReq = source.openCursor(range, direction)
    let positioned = start === 0

    cursorReq.onsuccess = () => {
      if (control.isCancelled?.()) {
        reject(abortError())
        return
      }
      const cursor = cursorReq.result
      if (!cursor) {
        resolve(rows)
        return
      }
      if (!positioned) {
        positioned = true
        cursor.advance(start)
        return
      }
      rows.push({ key: cursor.primaryKey, value: previewRecord(cursor.value) })
      if (rows.length >= pageSize) {
        resolve(rows)
        return
      }
      cursor.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
}

function readFilteredPage(
  store: IDBObjectStore,
  query: TableQuery,
  start: number,
  pageSize: number,
  control: QueryControl,
): Promise<{ rows: QueryPage['rows']; total: number }> {
  return new Promise((resolve, reject) => {
    const rows: QueryPage['rows'] = []
    let total = 0
    const cursorReq = store.openCursor()

    cursorReq.onsuccess = () => {
      if (control.isCancelled?.()) {
        reject(abortError())
        return
      }
      const cursor = cursorReq.result
      if (!cursor) {
        resolve({ rows, total })
        return
      }
      if (matchesQuery(cursor.value, query)) {
        if (total >= start && rows.length < pageSize) {
          rows.push({ key: cursor.primaryKey, value: previewRecord(cursor.value) })
        }
        total += 1
      }
      cursor.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
}

function sourceForSort(
  store: IDBObjectStore,
  field: string,
): { source: CursorSource; complete: boolean } | null {
  if (typeof store.keyPath === 'string' && store.keyPath === field) {
    return { source: store, complete: true }
  }
  for (const indexName of store.indexNames) {
    const index = store.index(indexName)
    if (!index.multiEntry && typeof index.keyPath === 'string' && index.keyPath === field) {
      return { source: index, complete: false }
    }
  }
  return null
}

function numericRange(query: TableQuery): IDBKeyRange | undefined {
  if (!query.sort || query.filters?.length !== 1 || query.search?.trim()) return undefined
  const filter = query.filters[0]
  if (filter.kind !== 'number' || filter.field !== query.sort.field) return undefined
  if (filter.min !== undefined && filter.max !== undefined) {
    if (filter.min > filter.max) return undefined
    return IDBKeyRange.bound(filter.min, filter.max)
  }
  if (filter.min !== undefined) return IDBKeyRange.lowerBound(filter.min)
  if (filter.max !== undefined) return IDBKeyRange.upperBound(filter.max)
  return undefined
}

async function queryIndexedSort(
  db: IDBDatabase,
  storeName: string,
  query: TableQuery,
  control: QueryControl,
): Promise<QueryPage | null> {
  if (!query.sort || query.search?.trim() || (query.filters?.length && !numericRange(query))) return null

  const tx = db.transaction(storeName, 'readonly')
  const store = tx.objectStore(storeName)
  const plan = sourceForSort(store, query.sort.field)
  if (!plan) return null

  const range = numericRange(query)
  const direction = query.sort.direction === 'desc' ? 'prev' : 'next'
  const start = query.page * query.pageSize
  ensureActive(control)

  if (range) {
    const [total, rows] = await Promise.all([
      request(plan.source.count(range)),
      readCursorPage(plan.source, start, query.pageSize, direction, control, range),
    ])
    return { rows, total, page: query.page, pageSize: query.pageSize }
  }

  const indexedTotalPromise = plan.complete
    ? Promise.resolve<number | undefined>(undefined)
    : request(plan.source.count())
  const [total, rows, indexedTotal] = await Promise.all([
    request(store.count()),
    readCursorPage(plan.source, start, query.pageSize, direction, control),
    indexedTotalPromise,
  ])
  if (indexedTotal !== undefined && indexedTotal !== total) return null
  return { rows, total, page: query.page, pageSize: query.pageSize }
}

/**
 * Plain and indexed browsing skip directly to the requested page. Unsorted
 * filters stream through the store while retaining only one page. Arbitrary
 * non-indexed sorting keeps compact key tuples and hydrates just that page.
 */
export function queryStore(
  dbName: string,
  storeName: string,
  query: TableQuery,
  control: QueryControl = {},
): Promise<QueryPage> {
  const page = Math.max(0, query.page ?? 0)
  const pageSize = Math.max(1, query.pageSize ?? 50)
  const normalized: TableQuery = { ...query, page, pageSize }

  return withDb(dbName, async (db) => {
    ensureActive(control)
    const indexed = await queryIndexedSort(db, storeName, normalized, control)
    if (indexed) return indexed

    const start = page * pageSize
    if (canPageWithCursor(normalized)) {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const [total, rows] = await Promise.all([
        request(store.count()),
        readCursorPage(store, start, pageSize, 'next', control),
      ])
      return { rows, total, page, pageSize }
    }

    if (!normalized.sort) {
      const { rows, total } = await readFilteredPage(
        storeOf(db, storeName, 'readonly'),
        normalized,
        start,
        pageSize,
        control,
      )
      return { rows, total, page, pageSize }
    }

    const scanStore = storeOf(db, storeName, 'readonly')
    const tuples = await new Promise<Array<{ key: RecordKey; sortValue: unknown }>>((resolve, reject) => {
      const collected: Array<{ key: RecordKey; sortValue: unknown }> = []
      const cursorReq = scanStore.openCursor()
      cursorReq.onsuccess = () => {
        if (control.isCancelled?.()) {
          reject(abortError())
          return
        }
        const cursor = cursorReq.result
        if (!cursor) {
          resolve(collected)
          return
        }
        if (matchesQuery(cursor.value, normalized)) {
          collected.push({
            key: cursor.primaryKey,
            sortValue: valueAt(cursor.value, normalized.sort!.field),
          })
        }
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })

    ensureActive(control)
    const direction = normalized.sort.direction === 'desc' ? -1 : 1
    tuples.sort((left, right) => compareValues(left.sortValue, right.sortValue) * direction)

    const keys = tuples.slice(start, start + pageSize).map((tuple) => tuple.key)
    if (keys.length === 0) return { rows: [], total: tuples.length, page, pageSize }

    const hydrateStore = storeOf(db, storeName, 'readonly')
    const hydrated = await Promise.all(
      keys.map(async (key) => ({ key, value: await request(hydrateStore.get(key)) })),
    )

    ensureActive(control)
    return {
      rows: hydrated.flatMap((row) =>
        row.value === undefined ? [] : [{ key: row.key, value: previewRecord(row.value) }],
      ),
      total: tuples.length,
      page,
      pageSize,
    }
  })
}

/**
 * Read-modify-write inside one transaction, touching only the given paths.
 *
 * This is what keeps live edits safe: fields the panel never saw properly —
 * Blobs, ArrayBuffers, anything the JSON transport cannot carry — are never
 * re-serialized, because they are never rewritten.
 */
export function patchRecord(
  dbName: string,
  storeName: string,
  key: RecordKey,
  patches: RecordPatch[],
): Promise<RowRecord> {
  return withDb(dbName, async (db) => {
    const store = storeOf(db, storeName, 'readwrite')
    const record = await request(store.get(key))
    if (record === undefined) {
      throw new Error(`Record "${String(key)}" was not found in "${storeName}". It may have just been deleted.`)
    }
    applyRecordPatches(record, patches)
    await request(store.keyPath === null ? store.put(record, key) : store.put(record))
    await txDone(store.transaction)
    return record as RowRecord
  })
}

export function deleteRecord(dbName: string, storeName: string, key: RecordKey): Promise<void> {
  return withDb(dbName, async (db) => {
    const store = storeOf(db, storeName, 'readwrite')
    await request(store.delete(key))
    await txDone(store.transaction)
  })
}
