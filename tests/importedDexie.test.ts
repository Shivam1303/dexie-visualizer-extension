/** @vitest-environment jsdom */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { exportDB } from 'dexie-export-import'
import { afterEach, describe, expect, it } from 'vitest'
import { ImportedDexieSource } from '../src/datasource/importedDexie'
import { inspectExportFile, replaceImportedSnapshot } from '../src/import/importFile'
import {
  IMPORTED_SESSION_KEY,
  clearImportedSession,
  loadImportedSession,
  saveImportedSession,
  type StorageAreaLike,
} from '../src/import/session'
import type { ImportedSession } from '../src/import/types'
import { applyRecordPatches } from '../src/shared/recordPatches'

function memoryStorage(): StorageAreaLike {
  const values = new Map<string, unknown>()
  return {
    async get(key) {
      return { [key]: values.get(key) }
    },
    async set(items) {
      Object.entries(items).forEach(([key, value]) => values.set(key, value))
    },
    async remove(key) {
      values.delete(key)
    },
  }
}

function session(storageName: string): ImportedSession {
  return {
    version: 1,
    storageName,
    databaseName: 'FixtureDB',
    databaseVersion: 1,
    fileName: 'fixture.json',
    importedAt: '2026-08-10T00:00:00.000Z',
    tables: [],
  }
}

const createdDatabases = new Set<string>()

afterEach(async () => {
  await Promise.all([...createdDatabases].map((name) => Dexie.delete(name).catch(() => {})))
  createdDatabases.clear()
})

describe('imported session metadata', () => {
  it('round-trips and clears a valid session', async () => {
    const storage = memoryStorage()
    const saved = session('dvx-import-session-test')
    await saveImportedSession(saved, storage)
    await expect(loadImportedSession(storage)).resolves.toEqual(saved)
    await clearImportedSession(storage)
    await expect(loadImportedSession(storage)).resolves.toBeNull()
  })

  it('discards invalid metadata', async () => {
    const storage = memoryStorage()
    await storage.set({ [IMPORTED_SESSION_KEY]: { version: 1, storageName: 'unsafe-name' } })
    await expect(loadImportedSession(storage)).resolves.toBeNull()
    await expect(storage.get(IMPORTED_SESSION_KEY)).resolves.toEqual({ [IMPORTED_SESSION_KEY]: undefined })
  })
})

describe('Dexie export import', () => {
  it('rejects unsupported and empty files before reading import metadata', async () => {
    await expect(inspectExportFile(new File(['{}'], 'fixture.csv'))).rejects.toThrow(/\.json or \.txt/i)
    await expect(inspectExportFile(new File([], 'fixture.json'))).rejects.toThrow(/empty/i)
  })

  it('previews and imports into a generated extension-local database name', async () => {
    const sourceName = 'dvx-export-source-test'
    const targetName = 'dvx-import-target-test'
    createdDatabases.add(sourceName)
    createdDatabases.add(targetName)
    const database = new Dexie(sourceName)
    database.version(1).stores({ users: 'id,email' })
    await database.table('users').bulkAdd([
      { id: 1, email: 'a@example.test' },
      { id: 2, email: 'b@example.test' },
    ])
    const exported = await exportDB(database)
    database.close()
    const file = new File([exported], 'fixture.json', { type: 'application/json' })

    const preview = await inspectExportFile(file)
    expect(preview.databaseName).toBe(sourceName)
    expect(preview.tables.find((table) => table.name === 'users')?.rowCount).toBe(2)

    const storage = memoryStorage()
    const imported = await replaceImportedSnapshot(file, preview, { storage, storageName: targetName })
    expect(imported.storageName).toBe(targetName)
    await expect(loadImportedSession(storage)).resolves.toEqual(imported)
    expect(await Dexie.exists(targetName)).toBe(true)
  })

  it('keeps the previous session when replacement fails', async () => {
    const storage = memoryStorage()
    const previous = session('dvx-import-previous-test')
    await saveImportedSession(previous, storage)
    const invalid = new File(['not json'], 'broken.json', { type: 'application/json' })

    await expect(
      replaceImportedSnapshot(
        invalid,
        { formatName: 'dexie', formatVersion: 1, databaseName: 'Broken', databaseVersion: 1, tables: [] },
        { storage, storageName: 'dvx-import-broken-test' },
      ),
    ).rejects.toThrow(/previous imported copy was kept/i)
    await expect(loadImportedSession(storage)).resolves.toEqual(previous)
    expect(await Dexie.exists('dvx-import-broken-test')).toBe(false)
  })
})

describe('ImportedDexieSource', () => {
  it('lists, queries, edits, and deletes imported records including outbound keys', async () => {
    const storageName = 'dvx-import-source-test'
    createdDatabases.add(storageName)
    const database = new Dexie(storageName)
    database.version(1).stores({ users: 'id,email', notes: '' })
    await database.open()
    await database.table('users').bulkAdd([
      { id: 1, email: 'z@example.test', profile: { active: true } },
      { id: 2, email: 'a@example.test', profile: { active: false } },
    ])
    await database.table('notes').add({ body: 'hello', count: 1 }, 'note-1')
    database.close()

    const importedSession = session(storageName)
    importedSession.tables = [
      { name: 'users', schema: 'id,email', rowCount: 2 },
      { name: 'notes', schema: '', rowCount: 1 },
    ]
    const source = new ImportedDexieSource(importedSession)
    const stores = await source.listStores('FixtureDB')
    expect(stores.find((store) => store.name === 'users')).toMatchObject({ count: 2, keyPath: 'id' })
    expect(stores.find((store) => store.name === 'notes')).toMatchObject({ count: 1, keyPath: null })

    const page = await source.query('FixtureDB', 'users', {
      page: 0,
      pageSize: 10,
      search: 'example',
      sort: { field: 'email', direction: 'asc' },
    })
    expect(page.rows.map((row) => row.key)).toEqual([2, 1])

    const secondPage = await source.query('FixtureDB', 'users', { page: 1, pageSize: 1 })
    expect(secondPage.total).toBe(2)
    expect(secondPage.rows.map((row) => row.key)).toEqual([2])

    const updated = await source.update('FixtureDB', 'notes', 'note-1', [
      { path: ['count'], value: '4' },
    ])
    expect(updated.count).toBe(4)
    await source.deleteRow('FixtureDB', 'users', 1)
    expect((await source.query('FixtureDB', 'users', { page: 0, pageSize: 10 })).total).toBe(1)
    await source.close()
  })
})

describe('shared record patches', () => {
  it('coerces editable strings to the existing native leaf type', () => {
    const record = { count: 1, active: false, at: new Date(0), nested: { label: 'old' } }
    applyRecordPatches(record, [
      { path: ['count'], value: '2' },
      { path: ['active'], value: 'true' },
      { path: ['at'], value: '2026-08-10T00:00:00.000Z' },
      { path: ['nested', 'label'], value: 'new' },
    ])
    expect(record.count).toBe(2)
    expect(record.active).toBe(true)
    expect(record.at).toBeInstanceOf(Date)
    expect(record.nested.label).toBe('new')
  })
})
