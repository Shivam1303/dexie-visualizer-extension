/**
 * Injected on demand into the connected tab (never declared in the manifest — that
 * would auto-inject everywhere and force host permissions). Runs in the page's
 * origin, so it is the only place with real access to that site's IndexedDB.
 *
 * Its whole job is: decode args -> call the engine -> encode the result. All
 * failures come back as { ok: false, error }, because letting a rejection escape
 * surfaces as an opaque "message port closed" with no useful detail.
 */
import { decode, encode } from '../shared/codec'
import { OPS, type RpcRequest } from '../shared/rpc'
import { deleteRecord, getRecord, listDatabases, listStores, patchRecord, queryStore, sampleRows } from './idb'

declare global {
  interface Window {
    __dvxInstalled?: boolean
  }
}

// Clicking the icon again on an already-connected tab re-runs this file; without
// the sentinel every click would stack another listener.
if (!window.__dvxInstalled) {
  window.__dvxInstalled = true

  const cancelledQueries = new Set<string>()

  const handlers: Record<string, (args: any) => Promise<unknown> | unknown> = {
    [OPS.HELLO]: () => ({ origin: location.origin, title: document.title }),
    [OPS.LIST_DATABASES]: () => listDatabases(),
    [OPS.LIST_STORES]: ({ dbName }) => listStores(dbName),
    [OPS.SAMPLE_ROWS]: ({ dbName, storeName, limit }) => sampleRows(dbName, storeName, limit),
    [OPS.QUERY]: async ({ dbName, storeName, query, requestId }) => {
      try {
        return await queryStore(dbName, storeName, query, {
          isCancelled: () => cancelledQueries.has(requestId),
        })
      } finally {
        cancelledQueries.delete(requestId)
      }
    },
    [OPS.CANCEL_QUERY]: ({ requestId }) => {
      cancelledQueries.add(requestId)
    },
    [OPS.GET_ROW]: ({ dbName, storeName, key }) => getRecord(dbName, storeName, key),
    [OPS.PATCH]: ({ dbName, storeName, key, patches }) => patchRecord(dbName, storeName, key, patches),
    [OPS.DELETE]: ({ dbName, storeName, key }) => deleteRecord(dbName, storeName, key),
  }

  chrome.runtime.onMessage.addListener((message: RpcRequest, _sender, sendResponse) => {
    const handler = handlers[message?.op]
    if (!handler) return undefined

    Promise.resolve()
      .then(() => handler(decode(message.args ?? {})))
      .then((data) => sendResponse({ ok: true, data: encode(data) }))
      .catch((error) => sendResponse({ ok: false, error: error?.message ?? String(error) }))

    return true
  })
}
