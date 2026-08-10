import { describe, expect, it } from 'vitest'
import { compareValues, matchesQuery, valueAt } from '../src/shared/filters'

const base = { page: 0, pageSize: 50 }

describe('valueAt', () => {
  it('reads nested paths', () => {
    expect(valueAt({ product: { category: { name: 'Drinks' } } }, 'product.category.name')).toBe('Drinks')
  })

  it('returns undefined for a missing path instead of throwing', () => {
    expect(valueAt({ a: 1 }, 'a.b.c')).toBeUndefined()
  })
})

describe('matchesQuery', () => {
  const row = { name: 'Latte', price: 4.5, active: true, createdAt: '2026-05-20T10:46:00.000Z' }

  it('matches a case-insensitive text filter', () => {
    expect(matchesQuery(row, { ...base, filters: [{ field: 'name', kind: 'text', value: 'lat' }] })).toBe(true)
  })

  it('rejects a number filter outside the range', () => {
    expect(matchesQuery(row, { ...base, filters: [{ field: 'price', kind: 'number', min: 5 }] })).toBe(false)
  })

  it('ANDs multiple filters', () => {
    const filters = [
      { field: 'active', kind: 'boolean', value: true },
      { field: 'price', kind: 'number', max: 5 },
    ]
    expect(matchesQuery(row, { ...base, filters } as any)).toBe(true)
  })

  it('matches an enum filter', () => {
    expect(matchesQuery(row, { ...base, filters: [{ field: 'name', kind: 'enum', values: ['Latte', 'Mocha'] }] })).toBe(true)
  })

  it('searches nested values', () => {
    expect(matchesQuery({ a: { b: 'needle' } }, { ...base, search: 'needle' })).toBe(true)
  })

  it('does not match object keys, only values', () => {
    expect(matchesQuery({ tags: ['a'] }, { ...base, search: 'tags' })).toBe(false)
  })

  it('matches a date range', () => {
    const filters = [{ field: 'createdAt', kind: 'date', from: '2026-05-01', to: '2026-06-01' }]
    expect(matchesQuery(row, { ...base, filters } as any)).toBe(true)
  })

  it('matches everything when there are no criteria', () => {
    expect(matchesQuery(row, base)).toBe(true)
  })
})

describe('compareValues', () => {
  it('sorts numbers numerically, not lexically', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
  })

  it('sorts nullish values last', () => {
    expect(compareValues(null, 1)).toBeGreaterThan(0)
    expect(compareValues(1, undefined)).toBeLessThan(0)
  })

  it('compares strings naturally', () => {
    expect(compareValues('item2', 'item10')).toBeLessThan(0)
  })
})
