export interface ExportTableMeta {
  name: string
  schema: string
  rowCount: number
}

export interface ExportPreview {
  formatName: 'dexie'
  formatVersion: number
  databaseName: string
  databaseVersion: number
  tables: ExportTableMeta[]
}

export interface ImportedSession {
  version: 1
  storageName: string
  databaseName: string
  databaseVersion: number
  fileName: string
  importedAt: string
  tables: ExportTableMeta[]
}

export interface ImportProgress {
  totalTables: number
  completedTables: number
  totalRows: number | undefined
  completedRows: number
  done: boolean
}

export type ImportProgressHandler = (progress: ImportProgress) => void
