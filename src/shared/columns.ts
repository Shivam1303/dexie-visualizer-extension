/**
 * Column discovery, ported from Dexie-visualizer's src/db/columns.ts.
 *
 * `discoverColumns` is gone — it took a Dexie Table handle. Sampling now happens
 * in the content script (see content/idb.ts `sampleRows`), and this module stays a
 * pure function over the sampled rows. Real Date objects are recognised as dates,
 * which the parent tool never had to handle.
 */
import { isOpaque } from './codec'
import type { RowRecord } from '../datasource/types'

export type ColumnType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'object'
  | 'array'
  | 'binary'
  | 'null'

export interface InferredColumn {
  key: string
  type: ColumnType
  nullable: boolean
  enumValues?: Array<string | number | boolean>
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+(?:Z)?)?$/
const ENUM_LIMIT = 12

function valueType(value: unknown): ColumnType {
  if (value === null || value === undefined) return 'null'
  if (value instanceof Date) return 'date'
  if (isOpaque(value)) return 'binary'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) {
    return 'date'
  }
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'object'
}

function chooseType(types: Set<ColumnType>): ColumnType {
  const nonNull = [...types].filter((type) => type !== 'null')
  if (nonNull.length === 0) return 'null'
  if (nonNull.length === 1) return nonNull[0] ?? 'null'
  if (nonNull.every((type) => type === 'date' || type === 'string')) return 'string'
  return 'object'
}

export function inferColumns(rows: RowRecord[]): InferredColumn[] {
  const keys: string[] = []
  const seenKeys = new Set<string>()

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const key of Object.keys(row)) {
      if (!seenKeys.has(key)) {
        keys.push(key)
        seenKeys.add(key)
      }
    }
  }

  return keys.map((key) => {
    const types = new Set<ColumnType>()
    const enumCandidates = new Set<string | number | boolean>()
    let nullable = false

    for (const row of rows) {
      const value = (row as RowRecord)[key]
      const type = valueType(value)
      types.add(type)
      if (type === 'null') nullable = true
      if (['string', 'number', 'boolean'].includes(type) && value !== undefined) {
        enumCandidates.add(value as string | number | boolean)
      }
    }

    const type = chooseType(types)
    const column: InferredColumn = { key, type, nullable }
    if (enumCandidates.size > 0 && enumCandidates.size <= ENUM_LIMIT) {
      column.enumValues = [...enumCandidates]
    }
    return column
  })
}
