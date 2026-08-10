import { create } from 'zustand'
import { NO_CONNECTION, type Connection } from '../shared/rpc'

interface AppState {
  connection: Connection
  dbName: string | null
  storeName: string | null
  setConnection: (connection: Connection) => void
  setDbName: (dbName: string | null) => void
  setStoreName: (storeName: string | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  connection: { ...NO_CONNECTION },
  dbName: null,
  storeName: null,

  // Pointing at a different tab invalidates whatever was being browsed — the new
  // page almost certainly has different databases.
  setConnection: (connection) =>
    set((state) =>
      connection.tabId === state.connection.tabId && connection.origin === state.connection.origin
        ? { connection }
        : { connection, dbName: null, storeName: null },
    ),

  setDbName: (dbName) => set({ dbName, storeName: null }),
  setStoreName: (storeName) => set({ storeName }),
}))
