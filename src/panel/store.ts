import { create } from 'zustand'
import { NO_CONNECTION, type Connection } from '../shared/rpc'

export type SourceMode = 'live' | 'imported'

interface AppState {
  connection: Connection
  sourceMode: SourceMode
  dbName: string | null
  storeName: string | null
  setConnection: (connection: Connection) => void
  setSourceMode: (sourceMode: SourceMode) => void
  setDbName: (dbName: string | null) => void
  setStoreName: (storeName: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  connection: { ...NO_CONNECTION },
  sourceMode: 'live',
  dbName: null,
  storeName: null,

  // Pointing at a different tab invalidates whatever was being browsed — the new
  // page almost certainly has different databases.
  setConnection: (connection) =>
    set((state) =>
      connection.tabId === state.connection.tabId && connection.origin === state.connection.origin
        ? { connection }
        : state.sourceMode === 'live'
          ? { connection, dbName: null, storeName: null }
          : { connection },
    ),

  setSourceMode: (sourceMode) =>
    set((state) =>
      sourceMode === state.sourceMode
        ? { sourceMode }
        : { sourceMode, dbName: null, storeName: null },
    ),
  setDbName: (dbName) => set({ dbName, storeName: null }),
  setStoreName: (storeName) => set({ storeName }),
}))
