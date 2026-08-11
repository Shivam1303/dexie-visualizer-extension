import Dexie, { type Collection, type IndexableType, type Table } from 'dexie'
import type {
  DataSource,
  DatabaseMeta,
  QueryOptions,
  QueryPage,
  RecordKey,
  RecordPatch,
  RowRecord,
  StoreMeta,
  TableQuery,
} from './types'
import type { ImportedSession } from '../import/types'
import { compareValues, matchesQuery, valueAt } from '../shared/filters'
import { applyRecordPatches } from '../shared/recordPatches'
import { throwIfAborted } from '../shared/cancellation'
import { previewRecord } from '../shared/rowPreview'

interface OrderedPlan {
  indexName: string
  complete: boolean
}

function orderedPlan(table: Table<RowRecord, IndexableType>, field: string): OrderedPlan | null {
  if (typeof table.schema.primKey.keyPath === 'string' && table.schema.primKey.keyPath === field) {
    return { indexName: ':id', complete: true }
  }
  const index = table.schema.indexes.find(
    (candidate) => !candidate.multi && typeof candidate.keyPath === 'string' && candidate.keyPath === field,
  )
  return index ? { indexName: index.name, complete: false } : null
}

function numericCollection(
  table: Table<RowRecord, IndexableType>,
  query: TableQuery,
  indexName: string,
): Collection<RowRecord, IndexableType> | null {
  if (!query.sort || query.filters?.length !== 1 || query.search?.trim()) return null
  const filter = query.filters[0]
  if (filter.kind !== 'number' || filter.field !== query.sort.field) return null
  if (filter.min !== undefined && filter.max !== undefined) {
    if (filter.min > filter.max) return null
    return table.where(indexName).between(filter.min, filter.max, true, true)
  }
  if (filter.min !== undefined) return table.where(indexName).aboveOrEqual(filter.min)
  if (filter.max !== undefined) return table.where(indexName).belowOrEqual(filter.max)
  return null
}

async function readCollectionPage(
  collection: Collection<RowRecord, IndexableType>,
  start: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<QueryPage['rows']> {
  const rows: QueryPage['rows'] = []
  await collection.offset(start).limit(pageSize).each((value, cursor) => {
    throwIfAborted(signal)
    rows.push({ key: cursor.primaryKey as RecordKey, value: previewRecord(value) })
  })
  throwIfAborted(signal)
  return rows
}

async function readFilteredPage(
  collection: Collection<RowRecord, IndexableType>,
  query: TableQuery,
  start: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<{ rows: QueryPage['rows']; total: number }> {
  const rows: QueryPage['rows'] = []
  let total = 0
  await collection.each((value, cursor) => {
    throwIfAborted(signal)
    if (!matchesQuery(value, query)) return
    if (total >= start && rows.length < pageSize) {
      rows.push({ key: cursor.primaryKey as RecordKey, value: previewRecord(value) })
    }
    total += 1
  })
  throwIfAborted(signal)
  return { rows, total }
}

export class ImportedDexieSource implements DataSource {
  private databasePromise: Promise<Dexie>

  constructor(private session: ImportedSession) {
    this.databasePromise = this.open()
  }

  private async open(): Promise<Dexie> {
    if (!(await Dexie.exists(this.session.storageName))) {
      throw new Error('The imported database is missing. Import the export again.')
    }
    const database = new Dexie(this.session.storageName)
    await database.open()
    return database
  }

  private assertDatabase(dbName: string): void {
    if (dbName !== this.session.databaseName) {
      throw new Error(`Imported database "${dbName}" is not active.`)
    }
  }

  private async table(dbName: string, storeName: string): Promise<Table<RowRecord, IndexableType>> {
    this.assertDatabase(dbName)
    const database = await this.databasePromise
    const table = database.tables.find((candidate) => candidate.name === storeName)
    if (!table) throw new Error(`Object store "${storeName}" does not exist in the imported copy.`)
    return table as Table<RowRecord, IndexableType>
  }

  async listDatabases(): Promise<DatabaseMeta[]> {
    await this.databasePromise
    return [{ name: this.session.databaseName, version: this.session.databaseVersion }]
  }

  async listStores(dbName: string): Promise<StoreMeta[]> {
    this.assertDatabase(dbName)
    const database = await this.databasePromise
    return Promise.all(
      database.tables.map(async (table) => ({
        name: table.name,
        keyPath: (table.schema.primKey.keyPath || null) as StoreMeta['keyPath'],
        autoIncrement: table.schema.primKey.auto,
        indexes: table.schema.indexes.map((index) => ({
          name: index.name,
          keyPath: index.keyPath as string | string[],
          unique: index.unique,
          multiEntry: index.multi,
        })),
        count: await table.count(),
      })),
    )
  }

  async sampleRows(dbName: string, storeName: string, limit = 200): Promise<RowRecord[]> {
    const rows = await (await this.table(dbName, storeName)).limit(limit).toArray()
    return rows.map(previewRecord)
  }

  async query(
    dbName: string,
    storeName: string,
    query: TableQuery,
    options: QueryOptions = {},
  ): Promise<QueryPage> {
    const table = await this.table(dbName, storeName)
    const database = await this.databasePromise
    const page = Math.max(0, query.page ?? 0)
    const pageSize = Math.max(1, query.pageSize ?? 50)
    const normalized = { ...query, page, pageSize }
    const start = page * pageSize

    return database.transaction('r', table, async () => {
      throwIfAborted(options.signal)
      const plan = normalized.sort ? orderedPlan(table, normalized.sort.field) : null
      const rangeCollection = plan
        ? numericCollection(table, normalized, plan.indexName)
        : null

      if (plan && rangeCollection) {
        const collection = normalized.sort?.direction === 'desc'
          ? rangeCollection.reverse()
          : rangeCollection
        const total = await collection.count()
        const rows = await readCollectionPage(collection, start, pageSize, options.signal)
        return { rows, total, page, pageSize }
      }

      if (plan && !normalized.search?.trim() && !normalized.filters?.length) {
        const total = await table.count()
        if (plan.complete || await table.orderBy(plan.indexName).count() === total) {
          let collection = table.orderBy(plan.indexName)
          if (normalized.sort?.direction === 'desc') collection = collection.reverse()
          const rows = await readCollectionPage(collection, start, pageSize, options.signal)
          return { rows, total, page, pageSize }
        }
      }

      if (!normalized.sort && !normalized.search?.trim() && !normalized.filters?.length) {
        const total = await table.count()
        const rows = await readCollectionPage(table.toCollection(), start, pageSize, options.signal)
        return { rows, total, page, pageSize }
      }

      if (!normalized.sort) {
        const { rows, total } = await readFilteredPage(
          table.toCollection(),
          normalized,
          start,
          pageSize,
          options.signal,
        )
        return { rows, total, page, pageSize }
      }

      const tuples: Array<{ key: RecordKey; sortValue: unknown }> = []
      await table.toCollection().each((row, cursor) => {
        throwIfAborted(options.signal)
        if (!matchesQuery(row, normalized)) return
        tuples.push({
          key: cursor.primaryKey as RecordKey,
          sortValue: valueAt(row, normalized.sort!.field),
        })
      })

      throwIfAborted(options.signal)
      const direction = normalized.sort.direction === 'desc' ? -1 : 1
      tuples.sort((left, right) => compareValues(left.sortValue, right.sortValue) * direction)
      const keys = tuples.slice(start, start + pageSize).map((tuple) => tuple.key)
      const values = await table.bulkGet(keys as IndexableType[])
      throwIfAborted(options.signal)

      return {
        rows: values.flatMap((value, index) =>
          value === undefined ? [] : [{ key: keys[index], value: previewRecord(value) }],
        ),
        total: tuples.length,
        page,
        pageSize,
      }
    })
  }

  async getRow(dbName: string, storeName: string, key: RecordKey): Promise<RowRecord> {
    const record = await (await this.table(dbName, storeName)).get(key as IndexableType)
    if (record === undefined) throw new Error('The imported record no longer exists.')
    return record
  }

  async update(
    dbName: string,
    storeName: string,
    key: RecordKey,
    patches: RecordPatch[],
  ): Promise<RowRecord> {
    const table = await this.table(dbName, storeName)
    const database = await this.databasePromise
    return database.transaction('rw', table, async () => {
      const record = await table.get(key as IndexableType)
      if (record === undefined) throw new Error('The imported record no longer exists.')
      applyRecordPatches(record, patches)
      if (table.schema.primKey.keyPath) await table.put(record)
      else await table.put(record, key as IndexableType)
      return record
    })
  }

  async deleteRow(dbName: string, storeName: string, key: RecordKey): Promise<void> {
    const table = await this.table(dbName, storeName)
    await table.delete(key as IndexableType)
  }

  async close(): Promise<void> {
    const database = await this.databasePromise.catch(() => null)
    database?.close()
  }
}
