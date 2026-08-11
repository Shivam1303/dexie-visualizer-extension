import { describe, expect, it } from 'vitest'
import { inferColumns } from '../src/shared/columns'
import { makePreviewValue } from '../src/shared/rowPreview'

describe('inferColumns', () => {
  it('unions keys across rows in first-seen order', () => {
    expect(inferColumns([{ a: 1 }, { b: 2 }]).map((column) => column.key)).toEqual(['a', 'b'])
  })

  it('infers ISO strings as date', () => {
    expect(inferColumns([{ at: '2026-05-20T10:46:00.000Z' }])[0].type).toBe('date')
  })

  it('infers real Date objects as date', () => {
    expect(inferColumns([{ at: new Date('2026-05-20T10:46:00.000Z') }])[0].type).toBe('date')
  })

  it('flags nullable columns and collects low-cardinality enums', () => {
    const [column] = inferColumns([{ s: 'a' }, { s: null }, { s: 'b' }, { s: 'a' }])
    expect(column.nullable).toBe(true)
    expect(column.enumValues!.sort()).toEqual(['a', 'b'])
  })

  it('omits enumValues for high-cardinality columns', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ id: `id-${index}` }))
    expect(inferColumns(rows)[0].enumValues).toBeUndefined()
  })

  it('infers arrays and objects', () => {
    const columns = inferColumns([{ list: [1], obj: { x: 1 } }])
    expect(columns.find((column) => column.key === 'list')!.type).toBe('array')
    expect(columns.find((column) => column.key === 'obj')!.type).toBe('object')
  })

  it('infers types from lightweight row previews', () => {
    const columns = inferColumns([
      {
        list: makePreviewValue('array', 3),
        obj: makePreviewValue('object', 2),
        blob: makePreviewValue('Blob', 100),
      },
    ])
    expect(columns.map((column) => column.type)).toEqual(['array', 'object', 'binary'])
  })

  it('falls back to string when a column mixes date and string', () => {
    expect(inferColumns([{ v: '2026-05-20' }, { v: 'not a date' }])[0].type).toBe('string')
  })

  it('returns no columns for no rows', () => {
    expect(inferColumns([])).toEqual([])
  })
})
