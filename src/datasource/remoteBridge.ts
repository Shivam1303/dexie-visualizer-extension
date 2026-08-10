/**
 * The only DataSource implementation in v1: marshals calls through the background
 * worker to the connected tab's content script.
 *
 * The panel depends on the DataSource interface rather than on chrome messaging
 * directly, so the UI can be exercised against any object with these six methods —
 * no browser tab required.
 */
import { decode, encode } from '../shared/codec'
import { MSG_RPC, OPS, type Op } from '../shared/rpc'
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

async function call(op: Op, args: Record<string, unknown> = {}): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type: MSG_RPC, payload: { op, args } })
  if (!response) throw new Error('The extension background did not respond.')
  if (!response.ok) throw new Error(response.error ?? 'The page did not respond.')
  return decode(response.data)
}

export function createRemoteBridgeSource(): DataSource {
  return {
    listDatabases: (): Promise<DatabaseMeta[]> => call(OPS.LIST_DATABASES),

    listStores: (dbName: string): Promise<StoreMeta[]> => call(OPS.LIST_STORES, { dbName }),

    sampleRows: (dbName: string, storeName: string, limit?: number): Promise<RowRecord[]> =>
      call(OPS.SAMPLE_ROWS, { dbName, storeName, limit }),

    query: (dbName: string, storeName: string, query: TableQuery): Promise<QueryPage> =>
      call(OPS.QUERY, { dbName, storeName, query }),

    // Keys and patch values are encoded: a Date primary key or a Date leaf must
    // arrive at the content script as a Date, not as a string.
    update: (dbName: string, storeName: string, key: RecordKey, patches: RecordPatch[]): Promise<RowRecord> =>
      call(OPS.PATCH, { dbName, storeName, key: encode(key), patches: encode(patches) }),

    deleteRow: (dbName: string, storeName: string, key: RecordKey): Promise<void> =>
      call(OPS.DELETE, { dbName, storeName, key: encode(key) }),
  }
}
