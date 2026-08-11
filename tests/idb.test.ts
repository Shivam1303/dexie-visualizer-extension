import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteRecord,
  getRecord,
  listDatabases,
  listStores,
  patchRecord,
  queryStore,
  sampleRows,
} from '../src/content/idb'
import { isPreviewValue } from '../src/shared/rowPreview'

const DB = 'POSdb_test'

function seed() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      const products = request.result.createObjectStore('product', { keyPath: 'uuid' })
      products.createIndex('categoryId', 'categoryId', { unique: false })
      request.result.createObjectStore('logs', { autoIncrement: true })
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['product', 'logs'], 'readwrite')
      const products = tx.objectStore('product')
      for (let index = 0; index < 25; index += 1) {
        products.put({
          uuid: `u${String(index).padStart(2, '0')}`,
          name: index % 2 ? `Latte ${index}` : `Mocha ${index}`,
          price: index,
          categoryId: index % 3,
          createdAt: new Date(Date.UTC(2026, 0, index + 1)),
          meta: { tags: ['a', 'b'] },
        })
      }
      tx.objectStore('logs').put({ msg: 'first' })
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
  await seed()
})

describe('listDatabases', () => {
  it('enumerates databases', async () => {
    expect(await listDatabases()).toEqual(expect.arrayContaining([{ name: DB, version: 1 }]))
  })
})

describe('listStores', () => {
  it('reports keyPath, indexes and counts per store', async () => {
    const stores = await listStores(DB)
    const product = stores.find((store) => store.name === 'product')!
    expect(product.keyPath).toBe('uuid')
    expect(product.count).toBe(25)
    expect(product.indexes).toEqual([
      { name: 'categoryId', keyPath: 'categoryId', unique: false, multiEntry: false },
    ])
  })

  it('reports an out-of-line auto-increment key as keyPath null', async () => {
    const logs = (await listStores(DB)).find((store) => store.name === 'logs')!
    expect(logs.keyPath).toBeNull()
    expect(logs.autoIncrement).toBe(true)
    expect(logs.count).toBe(1)
  })

  it('refuses to open a database that does not exist rather than creating it', async () => {
    await expect(listStores('no_such_db')).rejects.toThrow(/does not exist/i)
    expect((await listDatabases()).some((db) => db.name === 'no_such_db')).toBe(false)
  })
})

describe('sampleRows', () => {
  it('caps the sample at the requested limit', async () => {
    expect(await sampleRows(DB, 'product', 10)).toHaveLength(10)
  })

  it('returns every row when the store is smaller than the limit', async () => {
    expect(await sampleRows(DB, 'logs', 200)).toEqual([{ msg: 'first' }])
  })

  it('rejects for a store that does not exist', async () => {
    await expect(sampleRows(DB, 'nope', 10)).rejects.toThrow(/does not exist/i)
  })
})

describe('queryStore', () => {
  it('pages unfiltered rows and reports the true total', async () => {
    const page = await queryStore(DB, 'product', { page: 0, pageSize: 10 })
    expect(page.rows).toHaveLength(10)
    expect(page.total).toBe(25)
    expect(page.rows[0].key).toBe('u00')
    expect((page.rows[0].value as any).name).toBe('Mocha 0')
  })

  it('returns a later page', async () => {
    const page = await queryStore(DB, 'product', { page: 2, pageSize: 10 })
    expect(page.rows).toHaveLength(5)
    expect(page.rows[0].key).toBe('u20')
  })

  it('streams an unsorted filtered page while preserving primary-key order', async () => {
    const page = await queryStore(DB, 'product', {
      page: 1,
      pageSize: 3,
      search: 'Latte',
    })
    expect(page.total).toBe(12)
    expect(page.rows.map((row) => row.key)).toEqual(['u07', 'u09', 'u11'])
  })

  it('uses an indexed numeric range for matching sort and filter fields', async () => {
    const page = await queryStore(DB, 'product', {
      page: 0,
      pageSize: 20,
      sort: { field: 'categoryId', direction: 'desc' },
      filters: [{ field: 'categoryId', kind: 'number', min: 1, max: 1 }],
    })
    expect(page.total).toBe(8)
    expect(page.rows.every((row) => row.value.categoryId === 1)).toBe(true)
  })

  it('returns lightweight page previews and fetches full records by key', async () => {
    const page = await queryStore(DB, 'product', { page: 0, pageSize: 1 })
    expect(isPreviewValue(page.rows[0].value.meta)).toBe(true)
    expect(await getRecord(DB, 'product', page.rows[0].key)).toMatchObject({
      meta: { tags: ['a', 'b'] },
    })
  })

  it('cooperatively cancels a scan superseded by a newer query', async () => {
    let checks = 0
    await expect(
      queryStore(
        DB,
        'product',
        { page: 0, pageSize: 10, search: 'Latte' },
        { isCancelled: () => (checks += 1) > 3 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('loads a page beyond 100,000 rows without scanning the whole store', async () => {
    const largeDb = `${DB}_large`
    await new Promise<void>((resolve) => {
      const deletion = indexedDB.deleteDatabase(largeDb)
      deletion.onsuccess = () => resolve()
      deletion.onerror = () => resolve()
      deletion.onblocked = () => resolve()
    })

    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open(largeDb, 1)
      opening.onupgradeneeded = () => opening.result.createObjectStore('rows', { keyPath: 'id' })
      opening.onsuccess = () => {
        const db = opening.result
        const tx = db.transaction('rows', 'readwrite')
        const store = tx.objectStore('rows')
        for (let id = 0; id < 100_025; id += 1) store.put({ id })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      opening.onerror = () => reject(opening.error)
    })

    try {
      const page = await queryStore(largeDb, 'rows', { page: 2000, pageSize: 50 })
      expect(page.total).toBe(100_025)
      expect(page.rows).toHaveLength(25)
      expect(page.rows[0].key).toBe(100_000)
      expect(page.rows.at(-1)?.key).toBe(100_024)
    } finally {
      indexedDB.deleteDatabase(largeDb)
    }
  }, 30_000)

  it('returns keys for out-of-line-key stores', async () => {
    const page = await queryStore(DB, 'logs', { page: 0, pageSize: 10 })
    expect(page.rows[0].key).toBe(1)
    expect(page.rows[0].value).toEqual({ msg: 'first' })
  })

  it('filters, and totals only matching rows', async () => {
    const page = await queryStore(DB, 'product', {
      page: 0,
      pageSize: 50,
      filters: [{ field: 'name', kind: 'text', value: 'latte' }],
    })
    expect(page.total).toBe(12)
    expect(page.rows.every((row) => String((row.value as any).name).startsWith('Latte'))).toBe(true)
  })

  it('sorts descending across the whole match set, not just the page', async () => {
    const page = await queryStore(DB, 'product', {
      page: 0,
      pageSize: 5,
      sort: { field: 'price', direction: 'desc' },
    })
    expect(page.rows.map((row) => (row.value as any).price)).toEqual([24, 23, 22, 21, 20])
  })

  it('sorts by a real Date column', async () => {
    const page = await queryStore(DB, 'product', {
      page: 0,
      pageSize: 3,
      sort: { field: 'createdAt', direction: 'desc' },
    })
    expect(page.rows.map((row) => (row.value as any).uuid)).toEqual(['u24', 'u23', 'u22'])
  })

  it('searches nested values', async () => {
    expect((await queryStore(DB, 'product', { page: 0, pageSize: 50, search: 'tags' })).total).toBe(0)
    expect((await queryStore(DB, 'product', { page: 0, pageSize: 50, search: 'Mocha 4' })).total).toBe(1)
  })

  it('returns an empty page rather than throwing when nothing matches', async () => {
    const page = await queryStore(DB, 'product', { page: 0, pageSize: 50, search: 'zzzz' })
    expect(page).toMatchObject({ rows: [], total: 0 })
  })
})

describe('patchRecord', () => {
  it('updates only the patched path and leaves siblings intact', async () => {
    const updated: any = await patchRecord(DB, 'product', 'u01', [{ path: ['name'], value: 'Renamed' }])
    expect(updated.name).toBe('Renamed')
    expect(updated.price).toBe(1)
    expect(updated.createdAt).toBeInstanceOf(Date)
    expect(updated.meta.tags).toEqual(['a', 'b'])
  })

  it('persists the change', async () => {
    await patchRecord(DB, 'product', 'u01', [{ path: ['name'], value: 'Renamed' }])
    const page = await queryStore(DB, 'product', { page: 0, pageSize: 50, search: 'Renamed' })
    expect(page.total).toBe(1)
  })

  it('patches a nested path', async () => {
    const updated: any = await patchRecord(DB, 'product', 'u02', [
      { path: ['meta', 'tags', '0'], value: 'z' },
    ])
    expect(updated.meta.tags).toEqual(['z', 'b'])
  })

  it('keeps a Date a Date when given a date string', async () => {
    const updated: any = await patchRecord(DB, 'product', 'u03', [
      { path: ['createdAt'], value: '2027-03-01T00:00:00.000Z' },
    ])
    expect(updated.createdAt).toBeInstanceOf(Date)
    expect(updated.createdAt.toISOString()).toBe('2027-03-01T00:00:00.000Z')
  })

  it('coerces a numeric string back to a number', async () => {
    const updated: any = await patchRecord(DB, 'product', 'u04', [{ path: ['price'], value: '99' }])
    expect(updated.price).toBe(99)
  })

  it('applies several patches at once', async () => {
    const updated: any = await patchRecord(DB, 'product', 'u06', [
      { path: ['name'], value: 'A' },
      { path: ['price'], value: '7' },
    ])
    expect(updated).toMatchObject({ name: 'A', price: 7 })
  })

  it('works on out-of-line-key stores', async () => {
    const updated: any = await patchRecord(DB, 'logs', 1, [{ path: ['msg'], value: 'edited' }])
    expect(updated.msg).toBe('edited')
    expect((await queryStore(DB, 'logs', { page: 0, pageSize: 10 })).rows[0].value).toEqual({ msg: 'edited' })
  })

  it('rejects a patch against a missing key', async () => {
    await expect(patchRecord(DB, 'product', 'nope', [{ path: ['name'], value: 'x' }])).rejects.toThrow(/not found/i)
  })

  it('rejects a patch through a primitive', async () => {
    await expect(patchRecord(DB, 'product', 'u07', [{ path: ['price', 'nested'], value: 1 }])).rejects.toThrow(/cannot patch/i)
  })
})

describe('deleteRecord', () => {
  it('removes the row', async () => {
    await deleteRecord(DB, 'product', 'u05')
    const page = await queryStore(DB, 'product', { page: 0, pageSize: 50 })
    expect(page.total).toBe(24)
    expect(page.rows.some((row) => row.key === 'u05')).toBe(false)
  })
})
