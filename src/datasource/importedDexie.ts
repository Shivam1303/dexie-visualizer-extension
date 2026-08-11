import Dexie, { type IndexableType, type Table } from 'dexie'
import type {
  DataSource,
  DatabaseMeta,
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
    return (await this.table(dbName, storeName)).limit(limit).toArray()
  }

  async query(dbName: string, storeName: string, query: TableQuery): Promise<QueryPage> {
    const table = await this.table(dbName, storeName)
    const page = Math.max(0, query.page ?? 0)
    const pageSize = Math.max(1, query.pageSize ?? 50)
    const normalized = { ...query, page, pageSize }

    if (!normalized.sort && !normalized.search?.trim() && !normalized.filters?.length) {
      const start = page * pageSize
      const [total, indexableKeys] = await Promise.all([
        table.count(),
        table.toCollection().offset(start).limit(pageSize).primaryKeys(),
      ])
      const keys = indexableKeys as RecordKey[]
      const values = await table.bulkGet(indexableKeys)
      return {
        rows: values.flatMap((value, index) =>
          value === undefined ? [] : [{ key: keys[index], value }],
        ),
        total,
        page,
        pageSize,
      }
    }

    const tuples: Array<{ key: RecordKey; sortValue: unknown }> = []

    await table.toCollection().each((row, cursor) => {
      if (!matchesQuery(row, normalized)) return
      tuples.push({
        key: cursor.primaryKey as RecordKey,
        sortValue: normalized.sort ? valueAt(row, normalized.sort.field) : cursor.primaryKey,
      })
    })

    const direction = normalized.sort?.direction === 'desc' ? -1 : 1
    tuples.sort((left, right) => compareValues(left.sortValue, right.sortValue) * direction)
    const start = page * pageSize
    const keys = tuples.slice(start, start + pageSize).map((tuple) => tuple.key)
    const values = await table.bulkGet(keys as IndexableType[])

    return {
      rows: values.flatMap((value, index) =>
        value === undefined ? [] : [{ key: keys[index], value }],
      ),
      total: tuples.length,
      page,
      pageSize,
    }
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
