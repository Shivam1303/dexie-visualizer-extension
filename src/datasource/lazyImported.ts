import type { ImportedSession } from '../import/types'
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

export class LazyImportedSource implements DataSource {
  private sourcePromise

  constructor(session: ImportedSession) {
    this.sourcePromise = import('./importedDexie').then(
      ({ ImportedDexieSource }) => new ImportedDexieSource(session),
    )
  }

  async listDatabases(): Promise<DatabaseMeta[]> {
    return (await this.sourcePromise).listDatabases()
  }

  async listStores(dbName: string): Promise<StoreMeta[]> {
    return (await this.sourcePromise).listStores(dbName)
  }

  async sampleRows(dbName: string, storeName: string, limit?: number): Promise<RowRecord[]> {
    return (await this.sourcePromise).sampleRows(dbName, storeName, limit)
  }

  async query(
    dbName: string,
    storeName: string,
    query: TableQuery,
    options?: QueryOptions,
  ): Promise<QueryPage> {
    return (await this.sourcePromise).query(dbName, storeName, query, options)
  }

  async getRow(dbName: string, storeName: string, key: RecordKey): Promise<RowRecord> {
    return (await this.sourcePromise).getRow(dbName, storeName, key)
  }

  async update(
    dbName: string,
    storeName: string,
    key: RecordKey,
    patches: RecordPatch[],
  ): Promise<RowRecord> {
    return (await this.sourcePromise).update(dbName, storeName, key, patches)
  }

  async deleteRow(dbName: string, storeName: string, key: RecordKey): Promise<void> {
    return (await this.sourcePromise).deleteRow(dbName, storeName, key)
  }

  async close(): Promise<void> {
    const source = await this.sourcePromise.catch(() => null)
    await source?.close()
  }
}
