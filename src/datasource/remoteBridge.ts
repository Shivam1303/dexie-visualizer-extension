/**
 * Live DataSource implementation: marshals calls through the background worker
 * to the connected tab's content script.
 *
 * The panel depends on the DataSource interface rather than on chrome messaging
 * directly, so the UI can be exercised against any object with the same methods —
 * no browser tab required.
 */
import { abortError } from '../shared/cancellation'
import { decode, encode } from '../shared/codec'
import { MSG_RPC, OPS, type Op } from '../shared/rpc'
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

async function call(op: Op, args: Record<string, unknown> = {}): Promise<any> {
  const response = await chrome.runtime.sendMessage({ type: MSG_RPC, payload: { op, args } })
  if (!response) throw new Error('The extension background did not respond.')
  if (!response.ok) throw new Error(response.error ?? 'The page did not respond.')
  return decode(response.data)
}

let querySequence = 0

function queryCall(
  dbName: string,
  storeName: string,
  query: TableQuery,
  options: QueryOptions,
): Promise<QueryPage> {
  const signal = options.signal
  if (signal?.aborted) return Promise.reject(abortError())
  querySequence += 1
  const requestId = `query-${Date.now()}-${querySequence}`
  const pending = call(OPS.QUERY, { dbName, storeName, query, requestId }) as Promise<QueryPage>
  if (!signal) return pending

  return new Promise<QueryPage>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      void call(OPS.CANCEL_QUERY, { requestId }).catch(() => {})
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (page) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(page)
      },
      (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export function createRemoteBridgeSource(): DataSource {
  return {
    listDatabases: (): Promise<DatabaseMeta[]> => call(OPS.LIST_DATABASES),

    listStores: (dbName: string): Promise<StoreMeta[]> => call(OPS.LIST_STORES, { dbName }),

    sampleRows: (dbName: string, storeName: string, limit?: number): Promise<RowRecord[]> =>
      call(OPS.SAMPLE_ROWS, { dbName, storeName, limit }),

    query: (
      dbName: string,
      storeName: string,
      query: TableQuery,
      options: QueryOptions = {},
    ): Promise<QueryPage> => queryCall(dbName, storeName, query, options),

    getRow: (dbName: string, storeName: string, key: RecordKey): Promise<RowRecord> =>
      call(OPS.GET_ROW, { dbName, storeName, key: encode(key) }),

    // Keys and patch values are encoded: a Date primary key or a Date leaf must
    // arrive at the content script as a Date, not as a string.
    update: (dbName: string, storeName: string, key: RecordKey, patches: RecordPatch[]): Promise<RowRecord> =>
      call(OPS.PATCH, { dbName, storeName, key: encode(key), patches: encode(patches) }),

    deleteRow: (dbName: string, storeName: string, key: RecordKey): Promise<void> =>
      call(OPS.DELETE, { dbName, storeName, key: encode(key) }),
  }
}
