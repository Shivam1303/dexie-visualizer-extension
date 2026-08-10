import Dexie from 'dexie'

export async function openImportedDatabase(storageName: string): Promise<Dexie | null> {
  if (!(await Dexie.exists(storageName))) return null
  const database = new Dexie(storageName)
  await database.open()
  return database
}

export async function deleteImportedDatabase(storageName: string): Promise<void> {
  if (await Dexie.exists(storageName)) await Dexie.delete(storageName)
}
