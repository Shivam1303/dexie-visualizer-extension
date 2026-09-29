import type Dexie from 'dexie'
import { importDB, peakImportFile } from 'dexie-export-import'
import { deleteImportedDatabase } from './database'
import {
  loadImportedSession,
  saveImportedSession,
  type StorageAreaLike,
} from './session'
import type { ExportPreview, ImportedSession, ImportProgressHandler } from './types'

function assertSupportedFile(file: File): void {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'json' && extension !== 'txt') {
    throw new Error('Choose a .json or .txt Dexie export file.')
  }
  if (file.size === 0) throw new Error('The selected file is empty.')
}

export function importFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''

  if (name === 'QuotaExceededError' || /quota|not enough space/i.test(message)) {
    return 'Import failed because the browser does not have enough storage for this database. Free disk space, remove an older imported copy, and try again.'
  }

  return 'Import failed. The previous imported copy was kept.'
}

export async function inspectExportFile(file: File): Promise<ExportPreview> {
  assertSupportedFile(file)

  try {
    const meta = await peakImportFile(file)
    if (meta.formatName !== 'dexie') throw new Error('This is not a Dexie export.')
    if (!meta.data?.databaseName || !Array.isArray(meta.data.tables)) {
      throw new Error('The Dexie export metadata is incomplete.')
    }
    return {
      formatName: meta.formatName,
      formatVersion: meta.formatVersion,
      databaseName: meta.data.databaseName,
      databaseVersion: meta.data.databaseVersion,
      tables: meta.data.tables.map((table) => ({ ...table })),
    }
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('Choose') || error.message.includes('empty'))) {
      throw error
    }
    throw new Error('The file could not be read as a valid Dexie export.', { cause: error })
  }
}

interface ReplaceOptions {
  onProgress?: ImportProgressHandler
  storage?: StorageAreaLike
  storageName?: string
  tableNames?: string[]
}

export async function replaceImportedSnapshot(
  file: File,
  preview: ExportPreview,
  options: ReplaceOptions = {},
): Promise<ImportedSession> {
  const storageName = options.storageName ?? `dvx-import-${crypto.randomUUID()}`
  const previous = await loadImportedSession(options.storage)
  const tables = options.tableNames
    ? preview.tables.filter((table) => options.tableNames?.includes(table.name))
    : preview.tables
  const skippedTables = preview.tables.filter((table) => !tables.some((selected) => selected.name === table.name))
  let database: Dexie | null = null

  try {
    if (tables.length === 0) throw new Error('Choose at least one table to import.')
    const importOptions = {
      name: storageName,
      skipTables: skippedTables.map((table) => table.name),
      progressCallback(progress) {
        options.onProgress?.({
          ...progress,
          totalTables: tables.length,
          totalRows: tables.reduce((sum, table) => sum + table.rowCount, 0),
        })
        return true
      },
    }
    database = await importDB(file, importOptions)

    const importedStores = new Set(database.tables.map((table) => table.name))
    const missing = tables.filter((table) => !importedStores.has(table.name))
    if (missing.length > 0) {
      throw new Error(`Imported database is missing ${missing.length} expected object stores.`)
    }

    const session: ImportedSession = {
      version: 1,
      storageName,
      databaseName: preview.databaseName,
      databaseVersion: preview.databaseVersion,
      fileName: file.name,
      importedAt: new Date().toISOString(),
      tables,
    }
    await saveImportedSession(session, options.storage)
    database.close()
    database = null

    if (previous && previous.storageName !== storageName) {
      await deleteImportedDatabase(previous.storageName).catch(() => {})
    }
    return session
  } catch (error) {
    database?.close()
    await deleteImportedDatabase(storageName).catch(() => {})
    if (error instanceof Error && error.message.startsWith('Imported database is missing')) throw error
    throw new Error(importFailureMessage(error), { cause: error })
  }
}
