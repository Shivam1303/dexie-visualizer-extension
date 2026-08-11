/** Message contract shared by all three runtime contexts (panel, background, content). */

export const OPS = {
  HELLO: 'HELLO',
  LIST_DATABASES: 'LIST_DATABASES',
  LIST_STORES: 'LIST_STORES',
  SAMPLE_ROWS: 'SAMPLE_ROWS',
  QUERY: 'QUERY',
  CANCEL_QUERY: 'CANCEL_QUERY',
  GET_ROW: 'GET_ROW',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
} as const

export type Op = (typeof OPS)[keyof typeof OPS]

/** panel -> background */
export const MSG_RPC = 'RPC'
export const MSG_GET_CONNECTION = 'GET_CONNECTION'
/** background -> panel */
export const MSG_CONNECTION_CHANGED = 'CONNECTION_CHANGED'

export type ConnectionStatus = 'none' | 'connected' | 'stale'

export interface Connection {
  tabId: number | null
  origin: string | null
  title: string | null
  status: ConnectionStatus
  error?: string
}

export const NO_CONNECTION: Connection = {
  tabId: null,
  origin: null,
  title: null,
  status: 'none',
}

export interface RpcRequest {
  op: Op
  args: Record<string, unknown>
}

export type RpcResponse = { ok: true; data: unknown } | { ok: false; error: string }

export const ERROR_NO_TAB =
  'No tab is connected. Click the extension icon on the tab you want to inspect.'
