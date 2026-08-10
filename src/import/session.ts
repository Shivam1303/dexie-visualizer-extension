import type { ImportedSession } from './types'

const SESSION_KEY = 'importedSnapshot'

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

function defaultStorage(): StorageAreaLike {
  return chrome.storage.local
}

function isImportedSession(value: unknown): value is ImportedSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<ImportedSession>
  return (
    session.version === 1 &&
    typeof session.storageName === 'string' &&
    session.storageName.startsWith('dvx-import-') &&
    typeof session.databaseName === 'string' &&
    typeof session.databaseVersion === 'number' &&
    typeof session.fileName === 'string' &&
    typeof session.importedAt === 'string' &&
    Array.isArray(session.tables)
  )
}

export async function loadImportedSession(storage: StorageAreaLike = defaultStorage()): Promise<ImportedSession | null> {
  try {
    const stored = await storage.get(SESSION_KEY)
    const session = stored[SESSION_KEY]
    if (isImportedSession(session)) return session
  } catch {
    return null
  }
  await storage.remove(SESSION_KEY).catch(() => {})
  return null
}

export function saveImportedSession(
  session: ImportedSession,
  storage: StorageAreaLike = defaultStorage(),
): Promise<void> {
  return storage.set({ [SESSION_KEY]: session })
}

export function clearImportedSession(storage: StorageAreaLike = defaultStorage()): Promise<void> {
  return storage.remove(SESSION_KEY)
}

export { SESSION_KEY as IMPORTED_SESSION_KEY }
